package store

import (
	"log"
	"path"
	"regexp"
	"strings"
	"unicode"
)

// ============================================================
// 智能分组：自动识别可合并的漫画系列
// ============================================================

// AutoDetectGroup 表示自动检测出的一个建议分组。
type AutoDetectGroup struct {
	Name     string   `json:"name"`
	ComicIDs []string `json:"comicIds"`
	Titles   []string `json:"titles"`
}

// AutoDetectGroups 使用 normalizeTitle 自动检测可合并的漫画。
// 排除已经在分组中的漫画。
// 增强版：路径分组 + 精确匹配 + 编辑距离模糊匹配。
// contentType 可选参数：传入 "comic" 或 "novel" 只检测对应类型的漫画。
func AutoDetectGroups(contentType ...string) ([]AutoDetectGroup, error) {
	// 获取已分组的漫画ID
	grouped, err := GetGroupedComicIDs()
	if err != nil {
		return nil, err
	}

	// 构建查询：可按 contentType 过滤（增加 filename 字段用于路径分组）
	querySQL := `SELECT "id", "title", "filename" FROM "Comic"`
	var queryArgs []interface{}
	if len(contentType) > 0 && (contentType[0] == "comic" || contentType[0] == "novel") {
		querySQL += ` WHERE "type" = ?`
		queryArgs = append(queryArgs, contentType[0])
	}
	querySQL += ` ORDER BY "title" ASC`

	rows, err := db.Query(querySQL, queryArgs...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	type comicRef struct {
		ID       string
		Title    string
		Filename string // 相对路径，如 "海贼王/1.cbz"
	}

	// 收集所有未分组漫画
	var allRefs []comicRef
	totalCount := 0
	skippedGrouped := 0
	for rows.Next() {
		var id, title, filename string
		if rows.Scan(&id, &title, &filename) != nil {
			continue
		}
		totalCount++
		// 跳过已分组的漫画
		if _, ok := grouped[id]; ok {
			skippedGrouped++
			continue
		}
		allRefs = append(allRefs, comicRef{ID: id, Title: title, Filename: filename})
	}
	log.Printf("[auto-detect] 总计 %d 本漫画，已分组 %d 本，待检测 %d 本", totalCount, skippedGrouped, len(allRefs))

	var suggestions []AutoDetectGroup
	matchedIDs := make(map[string]bool) // 记录已被匹配的漫画ID

	// ── 第零轮：路径分组（同一文件夹下的文件归为一组）──
	// 将 filename 按父文件夹聚合，如 "海贼王/1.cbz" → dir="海贼王"
	// 增强：支持多级目录结构，如 "乌龙院/乌龙院前篇/卷1.cbz" → dir="乌龙院/乌龙院前篇"
	dirMap := make(map[string][]comicRef)
	for _, ref := range allRefs {
		dir := path.Dir(ref.Filename) // 使用 path（正斜杠），因为 filename 已统一为 "/"
		if dir == "." || dir == "/" || dir == "" {
			continue // 根目录下的文件跳过路径分组，交给后续标题匹配
		}
		dirMap[dir] = append(dirMap[dir], ref)
	}

	// 多级目录分组策略：
	// 1. 优先按最深层目录分组（如 "乌龙院/乌龙院前篇" 下的文件归为一组）
	// 2. 如果某个目录下只有子目录没有直接文件，则不单独创建分组
	// 3. 组名使用完整的目录路径层级（如 "乌龙院 / 乌龙院前篇"）
	for dir, refs := range dirMap {
		if len(refs) < 2 {
			continue // 文件夹下只有一个文件，不构成分组
		}

		// 构建组名：使用目录路径中的各层级名称
		groupName := buildGroupNameFromPath(dir)
		if groupName == "" {
			continue
		}

		var ids []string
		var titles []string
		for _, ref := range refs {
			ids = append(ids, ref.ID)
			titles = append(titles, ref.Title)
			matchedIDs[ref.ID] = true
		}
		suggestions = append(suggestions, AutoDetectGroup{
			Name:     groupName,
			ComicIDs: ids,
			Titles:   titles,
		})
	}
	log.Printf("[auto-detect] 路径分组: 发现 %d 个目录分组，匹配 %d 本漫画", len(suggestions), len(matchedIDs))

	// ── 第一轮：精确匹配（normalizeTitle 完全相同）──
	titleMap := make(map[string][]comicRef)
	for _, ref := range allRefs {
		if matchedIDs[ref.ID] {
			continue // 已被路径分组匹配，跳过
		}
		normalized := normalizeTitle(ref.Title)
		if normalized == "" {
			continue
		}
		titleMap[normalized] = append(titleMap[normalized], ref)
	}

	// 收集精确匹配的结果
	for normalized, refs := range titleMap {
		if len(refs) < 2 {
			continue
		}
		groupName := normalized
		if len(refs) > 0 {
			name := extractSeriesName(refs[0].Title)
			if name != "" {
				groupName = name
			}
		}

		var ids []string
		var titles []string
		for _, ref := range refs {
			ids = append(ids, ref.ID)
			titles = append(titles, ref.Title)
			matchedIDs[ref.ID] = true
		}
		suggestions = append(suggestions, AutoDetectGroup{
			Name:     groupName,
			ComicIDs: ids,
			Titles:   titles,
		})
	}

	// ── 第二轮：对未匹配的漫画做编辑距离模糊匹配 ──
	var unmatched []struct {
		ref        comicRef
		normalized string
	}
	for _, ref := range allRefs {
		if matchedIDs[ref.ID] {
			continue
		}
		normalized := normalizeTitle(ref.Title)
		if normalized == "" {
			continue
		}
		unmatched = append(unmatched, struct {
			ref        comicRef
			normalized string
		}{ref: ref, normalized: normalized})
	}

	// 用编辑距离聚类未匹配的标题
	if len(unmatched) > 1 {
		used := make(map[int]bool)
		for i := 0; i < len(unmatched); i++ {
			if used[i] {
				continue
			}
			cluster := []int{i}
			ri := []rune(unmatched[i].normalized)
			for j := i + 1; j < len(unmatched); j++ {
				if used[j] {
					continue
				}
				rj := []rune(unmatched[j].normalized)
				// 长度差太大的直接跳过
				lenDiff := len(ri) - len(rj)
				if lenDiff < 0 {
					lenDiff = -lenDiff
				}
				if lenDiff > 3 {
					continue
				}
				// 编辑距离阈值：短字符串要求更严格
				maxLen := len(ri)
				if len(rj) > maxLen {
					maxLen = len(rj)
				}
				threshold := 2
				if maxLen >= 10 {
					threshold = 3
				}
				if maxLen < 4 {
					threshold = 1
				}

				dist := LevenshteinDistance(unmatched[i].normalized, unmatched[j].normalized)
				if dist <= threshold {
					cluster = append(cluster, j)
				}
			}

			if len(cluster) >= 2 {
				var ids []string
				var titles []string
				for _, idx := range cluster {
					used[idx] = true
					ids = append(ids, unmatched[idx].ref.ID)
					titles = append(titles, unmatched[idx].ref.Title)
				}
				// 组名取第一个的系列名
				groupName := extractSeriesName(unmatched[cluster[0]].ref.Title)
				if groupName == "" {
					groupName = unmatched[cluster[0]].normalized
				}
				suggestions = append(suggestions, AutoDetectGroup{
					Name:     groupName,
					ComicIDs: ids,
					Titles:   titles,
				})
			}
		}
	}

	log.Printf("[auto-detect] 检测完成: 共发现 %d 个可合并系列", len(suggestions))
	if len(suggestions) == 0 {
		log.Printf("[auto-detect] 未发现可合并系列。可能原因: 所有漫画已分组(%d本), 或文件名无法匹配", skippedGrouped)
	}
	if suggestions == nil {
		suggestions = []AutoDetectGroup{}
	}
	return suggestions, nil
}

// extractSeriesName 从标题中提取系列名（去掉卷号等）。
// 支持的格式：
//   - [Comic][FL063][佛陀01][手塚治虫][時報][HMM] → "佛陀"
//   - [三眼神童典藏版][手塚治虫][東販]Vol.01 → "三眼神童典藏版"
//   - 佛陀01 → "佛陀"
//   - NARUTO vol.23 → "NARUTO"
//   - 进击的巨人 第5卷 → "进击的巨人"
func extractSeriesName(title string) string {
	// 如果标题包含方括号，提取中括号内的部分
	if strings.Contains(title, "[") || strings.Contains(title, "]") {
		parts := splitBrackets(title)

		// 两类候选：
		// volumeCandidates: 包含末尾卷号的部分（去掉卷号后的名称）
		// nameCandidates:   纯名称部分（不含卷号，但含CJK且较长，可能是书名本身）
		var volumeCandidates []string
		var nameCandidates []string

		for _, part := range parts {
			part = strings.TrimSpace(part)
			if part == "" {
				continue
			}
			// 跳过常见标签
			lp := strings.ToLower(part)
			if lp == "comic" || lp == "manga" || lp == "漫画" {
				continue
			}
			// 跳过扫图组/汉化组/状态/格式标签
			if isScanGroupTag(part) || isStatusTag(part) || isFormatTag(part) {
				continue
			}
			// 跳过看起来纯编号的部分 (FL063, HMM, DL, 3A等)
			if isLikelyCode(part) {
				continue
			}
			// 尝试去掉末尾卷号
			trimmed := trimTrailingVolumeNumber(part)
			if trimmed != "" && trimmed != part {
				// 包含卷号 → 高优先级候选
				volumeCandidates = append(volumeCandidates, trimmed)
			} else if containsCJK(part) && cjkRuneCount(part) >= 2 {
				// 不含卷号，但含CJK字符且长度>=2（可能是书名、出版社、作者等）
				nameCandidates = append(nameCandidates, part)
			}
		}

		// 优先从volumeCandidates中选取含CJK的（如 "[佛陀01]" → "佛陀"）
		// 但要排除扫图组/状态/格式标签
		for _, c := range volumeCandidates {
			if isScanGroupTag(c) || isStatusTag(c) || isFormatTag(c) {
				continue
			}
			if containsCJK(c) {
				return c
			}
		}

		// 从nameCandidates中选取CJK字符最多的（最可能是书名）
		// 这一步优先于非CJK的volumeCandidates（如"Vol"），
		// 因为"三眼神童典藏版"比"Vol"更有意义
		bestName := ""
		bestNameLen := 0
		for _, c := range nameCandidates {
			if isScanGroupTag(c) || isStatusTag(c) || isFormatTag(c) {
				continue
			}
			l := cjkRuneCount(c)
			if l > bestNameLen {
				bestName = c
				bestNameLen = l
			}
		}
		if bestName != "" {
			return bestName
		}

		// 最后兜底：使用非CJK的volumeCandidates（如 NARUTO），但跳过扫图组等噪声
		for _, c := range volumeCandidates {
			if isScanGroupTag(c) || isStatusTag(c) || isFormatTag(c) {
				continue
			}
			return c
		}
	}

	// 处理方括号外的部分（如 "[...][...]Vol.01" 中的 "Vol.01"）
	// 先尝试整体去掉末尾卷号
	cleaned := trimTrailingVolumeNumber(title)
	if cleaned != "" && cleaned != title {
		return cleaned
	}

	return ""
}

// splitBrackets 分割方括号内的内容。
func splitBrackets(s string) []string {
	var parts []string
	inBracket := false
	var current strings.Builder
	for _, r := range s {
		switch r {
		case '[', '【', '「', '『':
			if current.Len() > 0 && !inBracket {
				parts = append(parts, current.String())
				current.Reset()
			}
			inBracket = true
		case ']', '】', '」', '』':
			if inBracket {
				parts = append(parts, current.String())
				current.Reset()
				inBracket = false
			}
		default:
			current.WriteRune(r)
		}
	}
	if current.Len() > 0 {
		parts = append(parts, current.String())
	}
	return parts
}

// trimTrailingVolumeNumber 去掉末尾的卷号标记。
// 支持: "佛陀01" "NARUTO23" "进击的巨人 第5卷" "ABC vol.3"
func trimTrailingVolumeNumber(s string) string {
	s = strings.TrimSpace(s)
	// 先尝试匹配常见的卷号后缀模式
	lowers := strings.ToLower(s)
	for _, suffix := range []string{" vol.", " vol ", " volume ", " 第", " 卷", " 集"} {
		idx := strings.LastIndex(lowers, suffix)
		if idx > 0 {
			return strings.TrimSpace(s[:idx])
		}
	}
	// 去掉末尾数字
	name := strings.TrimRight(s, "0123456789")
	name = strings.TrimRight(name, " .-_") // 去掉 "Name - " 或 "Name." 的分隔符
	if name == "" {
		return ""
	}
	return strings.TrimSpace(name)
}

// isLikelyCode 判断是否像编号（如 FL063, HMM, DL版 等）。
// 注意：含有多个CJK字符的字符串不应被判定为编号。
// 【P2修复】放宽对2字符CJK名称的限制，避免 "火影"、"死神"、"棋魂" 被误判。
func isLikelyCode(s string) bool {
	if len(s) <= 2 {
		// 如果是2字符且都是CJK，不算编号（如 "火影"、"死神"、"棋魂"）
		runes := []rune(s)
		if len(runes) == 2 && isCJKRune(runes[0]) && isCJKRune(runes[1]) {
			return false
		}
		return true
	}
	// 如果包含CJK字符且CJK字符数>=2，不太可能是编号
	if cjkRuneCount(s) >= 2 {
		return false
	}
	// 全大写字母+数字且较短 → 编号
	if len(s) <= 8 {
		allUpper := true
		hasLetter := false
		for _, r := range s {
			if r >= 'a' && r <= 'z' {
				allUpper = false
				break
			}
			if (r >= 'A' && r <= 'Z') || (r >= 'a' && r <= 'z') {
				hasLetter = true
			}
		}
		if allUpper && hasLetter && isAlphaNumeric(s) {
			return true
		}
	}
	// 以常见出版标签结尾，但仅对纯标签短字符串（如"DL版"）生效
	// 不对长CJK字符串（如"三眼神童典藏版"）误判
	for _, tag := range []string{"版", "出版", "文庫", "文库"} {
		if strings.HasSuffix(s, tag) {
			// 去掉标签后缀，如果剩余部分很短或不含CJK，才是编号
			base := strings.TrimSuffix(s, tag)
			if cjkRuneCount(base) < 2 {
				return true
			}
			return false
		}
	}
	return false
}

// containsCJK 判断字符串是否包含中日韩字符。
func containsCJK(s string) bool {
	for _, r := range s {
		if r >= 0x4E00 && r <= 0x9FFF { // CJK Unified Ideographs
			return true
		}
		if r >= 0x3040 && r <= 0x30FF { // Hiragana + Katakana
			return true
		}
		if r >= 0xAC00 && r <= 0xD7A3 { // Korean
			return true
		}
	}
	return false
}

// cjkRuneCount 统计字符串中CJK字符的数量。
func cjkRuneCount(s string) int {
	count := 0
	for _, r := range s {
		if (r >= 0x4E00 && r <= 0x9FFF) || // CJK Unified Ideographs
			(r >= 0x3040 && r <= 0x30FF) || // Hiragana + Katakana
			(r >= 0xAC00 && r <= 0xD7A3) { // Korean
			count++
		}
	}
	return count
}

func isAlphaNumeric(s string) bool {
	for _, r := range s {
		if !((r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9')) {
			return false
		}
	}
	return true
}

// buildGroupNameFromPath 从多级目录路径构建可读的组名。
// 例如：
//   - "乌龙院/乌龙院前篇" → "乌龙院前篇"
//   - "海贼王" → "海贼王"
//   - "[汉化组]作品名/第一部" → "作品名 / 第一部"（最后一级是分卷词时，与上一级拼接）
//   - "【郑健和 - 封神纪（武庚纪）】 PDF/第三部" → "封神纪（武庚纪） / 第三部"
func buildGroupNameFromPath(dirPath string) string {
	parts := strings.Split(dirPath, "/")
	var cleanParts []string
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" || p == "." {
			continue
		}
		cleaned := cleanDirName(p)
		if cleaned != "" {
			cleanParts = append(cleanParts, cleaned)
		}
	}
	if len(cleanParts) == 0 {
		return ""
	}
	// 如果只有一级，直接返回
	if len(cleanParts) == 1 {
		return cleanParts[0]
	}
	// 多级目录：
	//   - 若最后一级是分卷词（如 "第三部"、"上篇"、"Vol.1"），单独使用它无法描述系列，
	//     需要与上一级合并展示，例如 "封神纪（武庚纪） / 第三部"。
	//   - 否则使用最后一级作为主名称（保持原有行为）。
	lastPart := cleanParts[len(cleanParts)-1]
	if isVolumePartName(lastPart) && len(cleanParts) >= 2 {
		parent := cleanParts[len(cleanParts)-2]
		if parent != "" {
			return parent + " / " + lastPart
		}
	}
	return lastPart
}

// cleanDirName 清理文件夹名称，提取出可读的组名。
// 处理策略：
//  1. 去除方括号标签（如 [汉化组]、[作者名]），保留核心名称
//  2. 如果文件夹名本身就是简洁的系列名（如"海贼王"），直接返回
//  3. 处理嵌套路径时只取最近一级（path.Base 已在调用处完成）
func cleanDirName(name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		return ""
	}

	// 如果文件夹名不含方括号，直接作为组名（去掉首尾空白即可）
	if !strings.ContainsAny(name, "[]【】「」『』") {
		// 去掉常见的无意义前缀/后缀
		name = strings.TrimSpace(name)
		if name == "" {
			return ""
		}
		return name
	}

	// 包含方括号时，尝试提取核心名称
	// 收集方括号外的部分和方括号内含CJK的部分
	var outsideParts []string
	var bracketParts []string
	inBracket := false
	var current strings.Builder
	for _, r := range name {
		switch r {
		case '[', '【', '「', '『':
			if current.Len() > 0 && !inBracket {
				outsideParts = append(outsideParts, strings.TrimSpace(current.String()))
			}
			current.Reset()
			inBracket = true
		case ']', '】', '」', '』':
			if inBracket && current.Len() > 0 {
				part := strings.TrimSpace(current.String())
				if part != "" && !isLikelyCode(part) {
					bracketParts = append(bracketParts, part)
				}
			}
			current.Reset()
			inBracket = false
		default:
			current.WriteRune(r)
		}
	}
	if current.Len() > 0 && !inBracket {
		outsideParts = append(outsideParts, strings.TrimSpace(current.String()))
	}

	// 优先使用方括号外的非空内容（更可能是文件夹的主名称），
	// 但如果方括号外只是"格式标签"（如 PDF、ZIP、漫画 等），则降级使用方括号内的内容。
	for _, p := range outsideParts {
		p = strings.TrimSpace(p)
		if p == "" || len([]rune(p)) < 2 {
			continue
		}
		if isFormatTag(p) || isStatusTag(p) || isScanGroupTag(p) {
			continue
		}
		return p
	}

	// 其次使用方括号内CJK字符最多的部分（排除扫图组、状态标签、格式标签）
	bestPart := ""
	bestCJK := 0
	for _, p := range bracketParts {
		if isFormatTag(p) || isStatusTag(p) || isScanGroupTag(p) {
			continue
		}
		c := cjkRuneCount(p)
		if c > bestCJK {
			bestPart = p
			bestCJK = c
		}
	}
	if bestPart != "" {
		return bestPart
	}

	// 兜底：使用方括号内最长的非噪声部分
	for _, p := range bracketParts {
		if isFormatTag(p) || isStatusTag(p) || isScanGroupTag(p) {
			continue
		}
		if len([]rune(p)) > len([]rune(bestPart)) {
			bestPart = p
		}
	}
	if bestPart != "" {
		return bestPart
	}

	// 最终兜底：返回原始名称
	return name
}

// isFormatTag 判断字符串是否只是"格式/类型"标签（如 PDF、ZIP、漫画、电子书），
// 这类字符串本身没有作品名信息，不适合作为组名主体。
func isFormatTag(s string) bool {
	s = strings.ToLower(strings.TrimSpace(s))
	switch s {
	case "pdf", "epub", "mobi", "azw3", "azw", "cbz", "cbr", "zip", "rar", "7z", "tar", "txt", "html", "htm",
		"漫画", "漫畫", "小说", "小說", "电子书", "電子書", "书籍", "書籍",
		"comic", "manga", "novel", "book", "books", "ebook", "ebooks":
		return true
	}
	return false
}

// isStatusTag 判断字符串是否是"状态/进度"标签（如 已完结、连载中、完结）。
// 这类字符串本身不含作品名信息，不适合作为组名主体。
func isStatusTag(s string) bool {
	s = strings.TrimSpace(s)
	switch s {
	case "已完结", "已完結", "完结", "完結", "完", "完本", "完整版",
		"连载", "連載", "连载中", "連載中", "未完", "未完结", "未完結",
		"百度", "百度网盘", "百度雲", "度盘", "度盤":
		return true
	}
	lower := strings.ToLower(s)
	switch lower {
	case "complete", "completed", "finished", "end", "ended",
		"ongoing", "serializing", "serialized":
		return true
	}
	return false
}

// scanGroupSuffixes 是常见"扫图组/汉化组"标记后缀的小写形式，
// 出现这些后缀的方括号内容通常是制作组名而非作品名。
var scanGroupSuffixes = []string{
	"汉化组", "漢化組", "汉化版", "漢化版", "汉化", "漢化",
	"扫图组", "掃圖組", "扫图", "掃圖", "扫图版", "掃圖版",
	"嵌字组", "嵌字組", "嵌字",
	"翻译组", "翻譯組", "翻译社", "翻譯社", "翻译", "翻譯",
	"汉译组", "漢譯組",
	"在乎版", // "誰在乎版" 这类自造扫图版署名
	"个人汉化", "個人漢化", "個人翻譯", "个人翻译",
	"重嵌", "重嵌版", "修正版", "重制版", "重製版",
}

// scanGroupKeywords 是包含即视为扫图组的关键词（小写）。
var scanGroupKeywords = []string{
	"scanlation", "scanlations", "scanlator", "scan-team", "scanteam", "scan group",
	"fansub", "fansubs", "sub group", "subteam",
}

// isScanGroupTag 判断方括号内的字符串是否是"扫图组/汉化组/翻译组"标签。
// 例如：[誰在乎版]、[XX汉化组]、[XX scan team]、[百度] 等。
// 注意：作者名、出版社名（如 [黃玉郎]、[東販]）不应被误判，因此只匹配明确的组别后缀/关键词。
func isScanGroupTag(s string) bool {
	s = strings.TrimSpace(s)
	if s == "" {
		return false
	}
	lower := strings.ToLower(s)
	for _, kw := range scanGroupKeywords {
		if strings.Contains(lower, kw) {
			return true
		}
	}
	for _, suf := range scanGroupSuffixes {
		if strings.HasSuffix(s, suf) {
			return true
		}
	}
	// "XX组" / "XX社" 但排除 "出版社" 这类常规词、且要求长度合理
	if strings.HasSuffix(s, "组") || strings.HasSuffix(s, "組") {
		runes := []rune(s)
		if len(runes) >= 2 && len(runes) <= 8 {
			return true
		}
	}
	return false
}

// stripScanGroupPrefix 去掉文件名/标题前缀里的扫图组署名。
// 例如："誰在乎版 YongBing-000" → "YongBing-000"
//
//	"[誰在乎版] 海贼王 第1卷" → "海贼王 第1卷"（方括号包裹的扫图组）
//
// 仅去掉"开头"的扫图组前缀，避免误删作品名内的合法字符。
func stripScanGroupPrefix(s string) string {
	orig := s
	s = strings.TrimSpace(s)
	if s == "" {
		return orig
	}

	// 形式 1：方括号包裹的前缀，如 "[誰在乎版] xxx" / "【誰在乎版】xxx"
	for _, pair := range [][2]rune{{'[', ']'}, {'【', '】'}, {'「', '」'}, {'『', '』'}} {
		if r := []rune(s); len(r) > 0 && r[0] == pair[0] {
			runes := r
			closeIdx := -1
			for i := 1; i < len(runes); i++ {
				if runes[i] == pair[1] {
					closeIdx = i
					break
				}
			}
			if closeIdx > 1 {
				inside := strings.TrimSpace(string(runes[1:closeIdx]))
				if isScanGroupTag(inside) {
					rest := strings.TrimSpace(string(runes[closeIdx+1:]))
					if rest != "" {
						return rest
					}
				}
			}
		}
	}

	// 形式 2：以扫图组词开头 + 空白 + 其余内容，如 "誰在乎版 YongBing-000"
	// 找首个空白分隔符，前缀如果命中扫图组规则，则剥掉。
	runes := []rune(s)
	for i, r := range runes {
		if r == ' ' || r == '\t' || r == '_' || r == '-' {
			prefix := strings.TrimSpace(string(runes[:i]))
			if prefix != "" && isScanGroupTag(prefix) {
				rest := strings.TrimSpace(string(runes[i+1:]))
				if rest != "" {
					return rest
				}
			}
			// 只检查首个分隔符前缀，再往后无意义
			break
		}
	}
	return orig
}

// StripScanGroupPrefix 是 stripScanGroupPrefix 的导出版本，供其他包复用。
func StripScanGroupPrefix(s string) string { return stripScanGroupPrefix(s) }

// IsScanGroupTag 是 isScanGroupTag 的导出版本，供其他包复用。
func IsScanGroupTag(s string) bool { return isScanGroupTag(s) }

// isNumericTitle 判断标题是否为纯数字命名（如 "1"、"02"、"123"）。
// 用于辅助路径分组：如果文件名是纯数字，说明系列信息只在文件夹名中。
func isNumericTitle(title string) bool {
	title = strings.TrimSpace(title)
	if title == "" {
		return false
	}
	for _, r := range title {
		if !unicode.IsDigit(r) && r != ' ' && r != '_' && r != '-' && r != '.' {
			return false
		}
	}
	return true
}

// volumePartPatterns 用于识别"分卷词"——即仅表示分卷/分册位置、本身不含作品名信息的目录或文件名。
// 这类名字单独存在时无法表达系列含义，需要借助上级目录或同级目录补全上下文。
var volumePartPatterns = []*regexp.Regexp{
	// 中文分卷：第一部、第二卷、第3集、第十二话、第二十回、上篇、中篇、下篇、上、中、下、前篇、后篇、外传、番外
	regexp.MustCompile(`^第\s*[一二三四五六七八九十百零〇两\d]+\s*[部卷集册篇話话章回本辑輯季]$`),
	regexp.MustCompile(`^[上中下前后]篇$`),
	regexp.MustCompile(`^[上中下]卷?$`),
	regexp.MustCompile(`^(外传|番外|特别篇|特典|附录|附錄|完结篇|完結篇)$`),
	// 英文分卷：Vol.1、Volume 2、Part 3、Book 4、Chapter 5、Season 6
	regexp.MustCompile(`(?i)^(vol|volume|part|book|chapter|ch|season|s|ep|episode)\s*\.?\s*\d+$`),
	// 纯数字（如目录直接叫 "1"、"02"）
	regexp.MustCompile(`^\d{1,4}$`),
}

// isVolumePartName 判断给定名称是否是单纯的"分卷词"。
// 用于：
//  1. 路径分组时识别最后一级是分卷词，需要与上级拼接组名。
//  2. 智能标题构建时识别文件名只是分卷序号，需要从父目录补全标题。
//  3. 搜索查询构建时识别父目录是分卷词，需要继续向上查找真正的作品名。
func isVolumePartName(name string) bool {
	name = strings.TrimSpace(name)
	if name == "" {
		return false
	}
	for _, re := range volumePartPatterns {
		if re.MatchString(name) {
			return true
		}
	}
	return false
}

// IsVolumePartNameForQuery 是 isVolumePartName 的导出版本，
// 供其他包（如 service 层构建搜索查询时）共享同一份分卷词识别规则。
func IsVolumePartNameForQuery(name string) bool {
	return isVolumePartName(name)
}
