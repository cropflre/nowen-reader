package service

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"path"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/nowen-reader/nowen-reader/internal/config"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

// ============================================================
// 扫描期统一规则引擎（A1 阶段：AI 智能识别 + 虚拟归类）
//
// 设计原则：
//   1. 默认全关，用户在设置页主动启用
//   2. 不动磁盘文件（A1 范围内仅在数据库层面工作）
//   3. 每个动作独立可关闭，失败不影响其他动作
//   4. 全程写 ScanRuleOpLog，可审计、可观察
// ============================================================

// ScanRuleRunOptions 控制一次规则引擎调用的范围。
type ScanRuleRunOptions struct {
	BatchID       string                  // 同批次操作的 ID（自动生成 UUID 风格）
	ComicIDs      []string                // 指定 comic 列表；为空时根据 ApplyOn 自动选择
	DryRun        bool                    // 试运行：只生成日志，不真正写库
	Manual        bool                    // 是否手动触发（决定是否忽略 ApplyOn=newOnly）
	OverrideRules *config.ScanRulesConfig // 覆盖配置（用于"预览/试运行"）
}

// ScanRuleRunResult 汇总一次执行的结果。
type ScanRuleRunResult struct {
	BatchID    string `json:"batchId"`
	Total      int    `json:"total"`
	Inferred   int    `json:"inferred"`
	GroupedNew int    `json:"groupedNew"`
	Skipped    int    `json:"skipped"`
	Failed     int    `json:"failed"`
	DryRun     bool   `json:"dryRun"`
	Duration   int64  `json:"durationMs"`
}

// ScanRuleProgress 描述一次扫描规则执行的实时进度。
// 前端通过轮询 GET /api/scan-rules/progress 拉取此结构来渲染进度条。
type ScanRuleProgress struct {
	Running    bool   `json:"running"`
	BatchID    string `json:"batchId,omitempty"`
	Stage      string `json:"stage"`                // collecting | filtering | ai_infer | organize | done
	StageLabel string `json:"stageLabel,omitempty"` // 人类可读阶段名
	Current    int    `json:"current"`              // 已处理项数（按目录桶计数）
	Total      int    `json:"total"`                // 总项数（目录桶数 + 单文件数）
	Inferred   int    `json:"inferred"`
	GroupedNew int    `json:"groupedNew"`
	Skipped    int    `json:"skipped"`
	Failed     int    `json:"failed"`
	DryRun     bool   `json:"dryRun"`
	CurrentDir string `json:"currentDir,omitempty"` // 当前正在处理的目录
	StartedAt  int64  `json:"startedAt,omitempty"`  // 毫秒时间戳
	UpdatedAt  int64  `json:"updatedAt,omitempty"`
	FinishedAt int64  `json:"finishedAt,omitempty"`
	Manual     bool   `json:"manual"`
	Error      string `json:"error,omitempty"`
}

// 防止并发执行同一批次
var (
	scanRuleRunning  bool
	scanRuleMu       sync.Mutex
	scanRuleProgress ScanRuleProgress
	scanRuleProgMu   sync.RWMutex
)

// GetScanRulesProgress 返回最近一次（或当前正在执行）的进度快照。
func GetScanRulesProgress() ScanRuleProgress {
	scanRuleProgMu.RLock()
	defer scanRuleProgMu.RUnlock()
	return scanRuleProgress
}

// resetProgress 在新批次开始时重置进度。
func resetProgress(batchID string, manual, dryRun bool) {
	now := time.Now().UnixMilli()
	scanRuleProgMu.Lock()
	scanRuleProgress = ScanRuleProgress{
		Running:    true,
		BatchID:    batchID,
		Stage:      "collecting",
		StageLabel: "收集目标文件",
		Manual:     manual,
		DryRun:     dryRun,
		StartedAt:  now,
		UpdatedAt:  now,
	}
	scanRuleProgMu.Unlock()
}

// updateProgress 局部更新进度。fn 在持锁状态下被调用，可安全修改字段。
func updateProgress(fn func(p *ScanRuleProgress)) {
	scanRuleProgMu.Lock()
	fn(&scanRuleProgress)
	scanRuleProgress.UpdatedAt = time.Now().UnixMilli()
	scanRuleProgMu.Unlock()
}

// finishProgress 在批次结束时标记完成。
func finishProgress(errMsg string) {
	now := time.Now().UnixMilli()
	scanRuleProgMu.Lock()
	scanRuleProgress.Running = false
	scanRuleProgress.Stage = "done"
	scanRuleProgress.StageLabel = "已完成"
	scanRuleProgress.FinishedAt = now
	scanRuleProgress.UpdatedAt = now
	if errMsg != "" {
		scanRuleProgress.Error = errMsg
	}
	scanRuleProgMu.Unlock()
}

// IsScanRulesRunning 报告引擎是否正在执行。
func IsScanRulesRunning() bool {
	scanRuleMu.Lock()
	defer scanRuleMu.Unlock()
	return scanRuleRunning
}

func acquireScanRuleSlot() bool {
	scanRuleMu.Lock()
	defer scanRuleMu.Unlock()
	if scanRuleRunning {
		return false
	}
	scanRuleRunning = true
	return true
}

func releaseScanRuleSlot() {
	scanRuleMu.Lock()
	scanRuleRunning = false
	scanRuleMu.Unlock()
}

// genBatchID 生成批次 ID。
func genBatchID() string {
	var b [8]byte
	if _, err := rand.Read(b[:]); err != nil {
		return fmt.Sprintf("batch-%d", time.Now().UnixNano())
	}
	return time.Now().UTC().Format("20060102-150405-") + hex.EncodeToString(b[:])
}

// RunScanRulesForNewlyAdded 在 quickSync 末尾被调用：
// 自动按 site-config.scanRules 的设置，对最近新增的漫画执行规则。
// 此函数为 fire-and-forget 风格：在后台 goroutine 中运行，不阻塞调用方。
func RunScanRulesForNewlyAdded() {
	go func() {
		cfg := config.GetSiteConfig()
		rules := cfg.ResolvedScanRules()
		if rules == nil || !rules.Enabled {
			return
		}
		if rules.ApplyOn == "manual" {
			return // 仅手动触发模式
		}
		// 取最近 10 分钟新增的漫画
		ids, err := store.GetRecentlyAddedComicIDs(10, 200)
		if err != nil || len(ids) == 0 {
			return
		}
		_, _ = RunScanRules(ScanRuleRunOptions{
			ComicIDs: ids,
			Manual:   false,
		})
	}()
}

// RunScanRules 是规则引擎的主入口，可被自动触发或手动 API 调用。
func RunScanRules(opts ScanRuleRunOptions) (*ScanRuleRunResult, error) {
	if !acquireScanRuleSlot() {
		return nil, fmt.Errorf("scan rules engine is already running")
	}
	defer releaseScanRuleSlot()

	startedAt := time.Now()
	cfg := config.GetSiteConfig()
	rules := opts.OverrideRules
	if rules == nil {
		rules = cfg.ResolvedScanRules()
	}
	if rules == nil || !rules.Enabled {
		return &ScanRuleRunResult{BatchID: opts.BatchID, Total: 0}, nil
	}

	if opts.BatchID == "" {
		opts.BatchID = genBatchID()
	}

	// 初始化进度跟踪
	resetProgress(opts.BatchID, opts.Manual, opts.DryRun)
	defer finishProgress("")

	// 启动前先清洗历史已被 {N} 占位符污染的脏标题（轻量、无副作用）
	if !opts.DryRun {
		if fixed, _ := cleanupDirtyTitlesImpl(); fixed > 0 {
			_ = store.InsertScanRuleOpLog(store.ScanRuleOpLog{
				BatchID: opts.BatchID, Action: "cleanup_dirty_titles",
				Status:  "success",
				Message: fmt.Sprintf("fixed %d titles with {N} placeholders", fixed),
			})
		}
	}

	// 解析目标 comic ID 列表
	ids := opts.ComicIDs
	if len(ids) == 0 {
		switch rules.ApplyOn {
		case "all":
			// 全库（受过滤器控制）— 由 store 提供分页迭代器
			fetched, err := getAllComicIDs(0)
			if err != nil {
				finishProgress(err.Error())
				return nil, err
			}
			ids = fetched
		default: // newOnly | manual
			fetched, err := store.GetRecentlyAddedComicIDs(60, 1000)
			if err != nil {
				finishProgress(err.Error())
				return nil, err
			}
			ids = fetched
		}
	}

	updateProgress(func(p *ScanRuleProgress) {
		p.Stage = "filtering"
		p.StageLabel = "应用过滤器"
		p.Total = len(ids)
	})

	// 应用过滤器
	ids = filterScanRuleTargets(ids, rules.Filters)

	result := &ScanRuleRunResult{
		BatchID: opts.BatchID,
		Total:   len(ids),
		DryRun:  opts.DryRun,
	}

	updateProgress(func(p *ScanRuleProgress) {
		p.Total = result.Total
	})

	if len(ids) == 0 {
		result.Duration = time.Since(startedAt).Milliseconds()
		return result, nil
	}

	log.Printf("[scan-rules] batch=%s start, total=%d, dryRun=%v", opts.BatchID, result.Total, opts.DryRun)

	// 动作 1：AI 智能识别（按目录去重）
	if rules.AIInfer != nil && rules.AIInfer.Enabled {
		updateProgress(func(p *ScanRuleProgress) {
			p.Stage = "ai_infer"
			p.StageLabel = "AI 智能识别"
			p.Current = 0
		})
		inferred, skipped, failed := runAIInferAction(opts.BatchID, ids, rules.AIInfer, opts.DryRun)
		result.Inferred = inferred
		result.Skipped += skipped
		result.Failed += failed
	}

	// 动作 2：虚拟归类（仅在非 dryRun 时真的建分组）
	if rules.Organize != nil && rules.Organize.Enabled && rules.Organize.AutoGroupByDir {
		updateProgress(func(p *ScanRuleProgress) {
			p.Stage = "organize"
			p.StageLabel = "虚拟归类"
			p.CurrentDir = ""
		})
		created := 0
		var err error
		if !opts.DryRun {
			created, err = store.AutoGroupByDirectory()
			if err != nil {
				log.Printf("[scan-rules] auto-group failed: %v", err)
				_ = store.InsertScanRuleOpLog(store.ScanRuleOpLog{
					BatchID: opts.BatchID, Action: "auto_group", Status: "failed",
					Message: err.Error(),
				})
				result.Failed++
				updateProgress(func(p *ScanRuleProgress) { p.Failed++ })
			} else {
				result.GroupedNew = created
				_ = store.InsertScanRuleOpLog(store.ScanRuleOpLog{
					BatchID: opts.BatchID, Action: "auto_group", Status: "success",
					Message: fmt.Sprintf("created %d groups", created),
				})
				updateProgress(func(p *ScanRuleProgress) { p.GroupedNew = created })
			}
		} else {
			_ = store.InsertScanRuleOpLog(store.ScanRuleOpLog{
				BatchID: opts.BatchID, Action: "auto_group", Status: "dryRun",
				Message: "auto group by directory (preview)",
			})
		}
	}

	result.Duration = time.Since(startedAt).Milliseconds()
	log.Printf("[scan-rules] batch=%s done in %dms inferred=%d grouped=%d skipped=%d failed=%d",
		opts.BatchID, result.Duration, result.Inferred, result.GroupedNew, result.Skipped, result.Failed)
	return result, nil
}

// ============================================================
// 动作 1: AI 智能识别
// ============================================================

// runAIInferAction 按目录去重调用 AIInferTitleStructure，
// 然后把结果写回（受配置控制）每个 comic 与其分组。
func runAIInferAction(batchID string, ids []string, rule *config.AIInferRule, dryRun bool) (inferred, skipped, failed int) {
	cfg := LoadAIConfig()
	if !cfg.EnableCloudAI || cfg.CloudAPIKey == "" {
		// 全部跳过 + 单条日志说明
		_ = store.InsertScanRuleOpLog(store.ScanRuleOpLog{
			BatchID: batchID, Action: "ai_infer", Status: "skipped",
			Message: "AI not configured",
		})
		return 0, len(ids), 0
	}

	// 1) 把 comicId 按目录分桶
	type comicInfo struct {
		ID       string
		Filename string
		Title    string
		Dir      string
	}
	bucket := make(map[string][]comicInfo)
	rootless := []comicInfo{} // 根目录文件每个单独处理
	for _, id := range ids {
		c, err := store.GetComicByID(id)
		if err != nil || c == nil {
			continue
		}
		rel := strings.ReplaceAll(c.Filename, "\\", "/")
		dir := path.Dir(rel)
		info := comicInfo{ID: c.ID, Filename: rel, Title: c.Title, Dir: dir}
		if dir == "." || dir == "/" || dir == "" {
			rootless = append(rootless, info)
		} else {
			bucket[dir] = append(bucket[dir], info)
		}
	}

	// 进度总量 = 目录桶数 + 独立文件数（每个代表一次 AI 调用单位）
	totalSteps := len(bucket) + len(rootless)
	updateProgress(func(p *ScanRuleProgress) {
		p.Total = totalSteps
		p.Current = 0
	})

	processBucket := func(dir string, items []comicInfo) {
		if len(items) == 0 {
			return
		}
		dirName := ""
		if dir != "" {
			dirName = path.Base(dir)
		}
		// 上报“当前正在处理”的目录
		displayDir := dirName
		if displayDir == "" {
			displayDir = path.Base(items[0].Filename)
		}
		updateProgress(func(p *ScanRuleProgress) {
			p.CurrentDir = displayDir
		})
		// 收集样本（最多 8 个）
		samples := make([]string, 0, 8)
		for i, it := range items {
			if i >= 8 {
				break
			}
			samples = append(samples, path.Base(it.Filename))
		}

		existingTitle := items[0].Title
		structured, err := AIInferTitleStructure(cfg, dirName, samples, existingTitle)
		if err != nil {
			failed++
			updateProgress(func(p *ScanRuleProgress) { p.Failed++; p.Current++ })
			_ = store.InsertScanRuleOpLog(store.ScanRuleOpLog{
				BatchID: batchID, Action: "ai_infer", Status: "failed",
				ComicID: items[0].ID, Message: err.Error(),
			})
			return
		}
		if structured == nil || structured.Title == "" {
			skipped += len(items)
			updateProgress(func(p *ScanRuleProgress) { p.Skipped += len(items); p.Current++ })
			return
		}
		if !meetsConfidence(structured.Confidence, rule.MinConfidence) {
			skipped += len(items)
			updateProgress(func(p *ScanRuleProgress) { p.Skipped += len(items); p.Current++ })
			_ = store.InsertScanRuleOpLog(store.ScanRuleOpLog{
				BatchID: batchID, Action: "ai_infer", Status: "skipped",
				ComicID: items[0].ID,
				Message: fmt.Sprintf("confidence=%s < threshold=%s, dir=%s",
					structured.Confidence, rule.MinConfidence, dirName),
			})
			return
		}

		// 应用到每个 comic
		// 关键防御：把桶大小传下去，避免 AI 给出的非占位符模板把整桶 comic 写成同一标题。
		bucketSize := len(items)
		localInferred, localSkipped := 0, 0
		for _, it := range items {
			applied := applyInferredToComic(it.ID, it.Title, it.Filename, structured, rule, dryRun, bucketSize)
			if applied {
				inferred++
				localInferred++
				toJSON, _ := json.Marshal(structured)
				_ = store.InsertScanRuleOpLog(store.ScanRuleOpLog{
					BatchID: batchID, Action: "ai_infer",
					Status:    statusOf(dryRun),
					ComicID:   it.ID,
					FromValue: it.Title,
					ToValue:   string(toJSON),
					Message:   "dir=" + dirName,
				})
			} else {
				skipped++
				localSkipped++
			}
		}
		updateProgress(func(p *ScanRuleProgress) {
			p.Inferred += localInferred
			p.Skipped += localSkipped
			p.Current++
		})

		// 如果开启了 ApplyToGroup，把同目录的分组元数据更新一次（首个有分组的）
		if rule.ApplyToGroup && !dryRun {
			for _, it := range items {
				gid := findGroupIDByComicIDLocal(it.ID)
				if gid > 0 {
					// 分组名使用作品主名（不带卷号模板），并进行 sanitize 防御
					cleanGroupName := sanitizeTitle(structured.Title)
					update := store.GroupMetadataUpdate{
						Name:      strPtr(cleanGroupName),
						Author:    strPtr(structured.Author),
						Publisher: strPtr(structured.Publisher),
						Language:  strPtr(structured.Language),
						Genre:     strPtr(structured.Genre),
						Status:    strPtr(structured.Status),
					}
					if structured.Year != nil {
						y := *structured.Year
						update.Year = &y
					}
					_ = store.UpdateGroupMetadata(gid, update)
					_ = store.InsertScanRuleOpLog(store.ScanRuleOpLog{
						BatchID: batchID, Action: "ai_infer_group",
						Status: "success", GroupID: gid,
						ToValue: cleanGroupName,
					})
					break // 同目录共享分组，只更新一次
				}
			}
		}
	}

	for dir, items := range bucket {
		processBucket(dir, items)
	}
	for _, it := range rootless {
		processBucket("", []comicInfo{it})
	}
	return
}

func applyInferredToComic(comicID, oldTitle, oldFilename string, s *InferredTitleStructure,
	rule *config.AIInferRule, dryRun bool, bucketSize int) bool {
	if s == nil {
		return false
	}
	if dryRun {
		return true // 预览模式视为已应用，但不真正写库
	}
	if !rule.ApplyToComic {
		return false
	}

	updates := map[string]interface{}{}
	if s.Title != "" {
		// 关键修复：不能直接用含 {N}/{NNN} 的模板覆盖标题。
		// 1) 优先把 VolumeTitleTemplate 的占位符替换成本 comic 的实际卷号；
		// 2) 提取不到卷号或模板为空时，回退到干净的 s.Title；
		// 3) 最终再 sanitize 一次，剥掉任何残留的 {N+} 碎片。
		filenameOnly := path.Base(strings.ReplaceAll(oldFilename, "\\", "/"))

		// 防污染：当桶内 ≥2 个 comic、且 AI 给的模板"不含占位符"时，
		// 模板很可能是 AI 把作品名写错位置，直接套到所有 comic 会导致整桶同标题。
		// 此时强制忽略模板，回退到本卷文件名派生的智能标题。
		effectiveTpl := s.VolumeTitleTemplate
		if bucketSize >= 2 && strings.TrimSpace(effectiveTpl) != "" &&
			!volumeTemplatePlaceholders.MatchString(effectiveTpl) {
			log.Printf("[scan-rules] reject non-placeholder template in multi-comic bucket: tpl=%q size=%d comic=%s",
				effectiveTpl, bucketSize, comicID)
			effectiveTpl = ""
		}

		newTitle := renderVolumeTitle(effectiveTpl, s.Title, filenameOnly)
		newTitle = sanitizeTitle(newTitle)

		// 二次防御：如果桶 ≥2 且新标题仍未带任何卷号信息（与同桶其他 comic 必然撞名），
		// 改用本地 FilenameToSmartTitle 派生：作品名 + 文件名卷次。
		if bucketSize >= 2 && newTitle != "" && !containsVolumeMarker(newTitle, filenameOnly) {
			smart := store.FilenameToSmartTitle(oldFilename)
			smart = sanitizeTitle(smart)
			if smart != "" {
				newTitle = smart
			}
		}

		if newTitle != "" && (oldTitle == "" || rule.OverwriteTitle) {
			updates["title"] = newTitle
		}
	} // 仅在为空时填充作者等次要字段，避免覆盖刮削结果
	c, _ := store.GetComicByID(comicID)
	if c == nil {
		return false
	}
	if s.Author != "" && c.Author == "" {
		updates["author"] = s.Author
	}
	if s.Publisher != "" && c.Publisher == "" {
		updates["publisher"] = s.Publisher
	}
	if s.Language != "" && c.Language == "" {
		updates["language"] = s.Language
	}
	if s.Genre != "" && c.Genre == "" {
		updates["genre"] = s.Genre
	}
	if s.Year != nil && c.Year == nil {
		updates["year"] = *s.Year
	}
	if len(updates) == 0 {
		return false
	}
	updates["metadataSource"] = "ai_scan_rules"
	if err := store.UpdateComicFields(comicID, updates); err != nil {
		return false
	}

	// 把扫图组/版本/状态作为标签
	var tags []string
	if s.ScanGroup != "" {
		tags = append(tags, "扫图组:"+s.ScanGroup)
	}
	if s.Version != "" {
		tags = append(tags, "版本:"+s.Version)
	}
	if s.Status != "" {
		tags = append(tags, "状态:"+s.Status)
	}
	if len(tags) > 0 {
		_ = store.AddTagsToComic(comicID, tags)
	}
	return true
}

// meetsConfidence 把 AI 自评的 high/medium/low 转成数字比较。
func meetsConfidence(actual, required string) bool {
	rank := func(s string) int {
		switch strings.ToLower(strings.TrimSpace(s)) {
		case "high":
			return 3
		case "medium":
			return 2
		case "low":
			return 1
		default:
			return 2 // 未知按 medium 处理
		}
	}
	return rank(actual) >= rank(required)
}

func statusOf(dryRun bool) string {
	if dryRun {
		return "dryRun"
	}
	return "success"
}

func strPtr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// findGroupIDByComicIDLocal 是 handler 包里同名函数的内部副本，避免反向依赖。
func findGroupIDByComicIDLocal(comicID string) int {
	dbConn := store.DB()
	if dbConn == nil {
		return 0
	}
	var gid int
	err := dbConn.QueryRow(
		`SELECT "groupId" FROM "ComicGroupItem" WHERE "comicId" = ? ORDER BY "sortIndex" ASC LIMIT 1`,
		comicID,
	).Scan(&gid)
	if err != nil {
		return 0
	}
	return gid
}

// getAllComicIDs 返回所有漫画 ID（受 limit 限制；0=不限）。
func getAllComicIDs(limit int) ([]string, error) {
	dbConn := store.DB()
	if dbConn == nil {
		return nil, nil
	}
	q := `SELECT "id" FROM "Comic" ORDER BY "addedAt" DESC`
	if limit > 0 {
		q += fmt.Sprintf(" LIMIT %d", limit)
	}
	rows, err := dbConn.Query(q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if rows.Scan(&id) == nil {
			ids = append(ids, id)
		}
	}
	return ids, rows.Err()
}

// filterScanRuleTargets 按规则配置中的过滤器筛选目标 ID。
func filterScanRuleTargets(ids []string, f *config.ScanRuleFilters) []string {
	if f == nil {
		return ids
	}
	if len(f.IncludeExt) == 0 && len(f.ExcludeExt) == 0 &&
		f.IncludePathRegex == "" && f.ExcludePathRegex == "" {
		return ids
	}
	includeRe, _ := compileRegex(f.IncludePathRegex)
	excludeRe, _ := compileRegex(f.ExcludePathRegex)

	out := make([]string, 0, len(ids))
	for _, id := range ids {
		c, err := store.GetComicByID(id)
		if err != nil || c == nil {
			continue
		}
		fn := strings.ReplaceAll(c.Filename, "\\", "/")
		ext := strings.ToLower(path.Ext(fn))

		if len(f.IncludeExt) > 0 && !containsLower(f.IncludeExt, ext) {
			continue
		}
		if len(f.ExcludeExt) > 0 && containsLower(f.ExcludeExt, ext) {
			continue
		}
		if includeRe != nil && !includeRe.MatchString(fn) {
			continue
		}
		if excludeRe != nil && excludeRe.MatchString(fn) {
			continue
		}
		out = append(out, id)
	}
	return out
}

func compileRegex(p string) (*regexp.Regexp, error) {
	p = strings.TrimSpace(p)
	if p == "" {
		return nil, nil
	}
	return regexp.Compile(p)
}

func containsLower(list []string, target string) bool {
	for _, s := range list {
		if strings.EqualFold(s, target) {
			return true
		}
	}
	return false
}
