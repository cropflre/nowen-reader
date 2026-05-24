package handler

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/config"
	"github.com/nowen-reader/nowen-reader/internal/service"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

// ScanRulesHandler 处理 /api/scan-rules 系列接口。
type ScanRulesHandler struct{}

func NewScanRulesHandler() *ScanRulesHandler {
	return &ScanRulesHandler{}
}

// GET /api/scan-rules — 获取当前扫描规则配置（以默认值填充）。
func (h *ScanRulesHandler) Get(c *gin.Context) {
	cfg := config.GetSiteConfig()
	rules := cfg.ResolvedScanRules()
	c.JSON(http.StatusOK, gin.H{
		"rules":   rules,
		"running": service.IsScanRulesRunning(),
	})
}

// GET /api/scan-rules/progress — 返回最近一次（或正在执行的）批次进度，供前端轮询。
func (h *ScanRulesHandler) Progress(c *gin.Context) {
	c.JSON(http.StatusOK, service.GetScanRulesProgress())
}

// PUT /api/scan-rules — 保存扫描规则配置。
func (h *ScanRulesHandler) Update(c *gin.Context) {
	var body config.ScanRulesConfig
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}
	current := config.GetSiteConfig()
	current.ScanRules = &body
	if err := config.SaveSiteConfig(&current); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"rules":   current.ResolvedScanRules(),
	})
}

// POST /api/scan-rules/apply — 手动触发规则引擎。
//
//	Body:
//	{
//	  "comicIds": ["..."],   // 可选；为空则按 applyOn 配置
//	  "dryRun": false,        // 试运行
//	  "scope": "all" | "newOnly"  // 临时覆盖 applyOn
//	}
func (h *ScanRulesHandler) Apply(c *gin.Context) {
	var body struct {
		ComicIDs []string `json:"comicIds"`
		DryRun   bool     `json:"dryRun"`
		Scope    string   `json:"scope"`
	}
	_ = c.ShouldBindJSON(&body)

	cfg := config.GetSiteConfig()
	rules := cfg.ResolvedScanRules()
	if rules == nil || !rules.Enabled {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Scan rules are disabled in settings"})
		return
	}

	// 如果指定了 scope，临时覆盖 ApplyOn 决定取数策略
	override := *rules
	if body.Scope != "" {
		override.ApplyOn = body.Scope
	}

	result, err := service.RunScanRules(service.ScanRuleRunOptions{
		ComicIDs:      body.ComicIDs,
		DryRun:        body.DryRun,
		Manual:        true,
		OverrideRules: &override,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"result":  result,
	})
}

// POST /api/scan-rules/preview — 等价于 Apply 的 dryRun=true 快捷方式。
func (h *ScanRulesHandler) Preview(c *gin.Context) {
	var body struct {
		ComicIDs []string `json:"comicIds"`
		Scope    string   `json:"scope"`
	}
	_ = c.ShouldBindJSON(&body)

	cfg := config.GetSiteConfig()
	rules := cfg.ResolvedScanRules()
	if rules == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Scan rules not configured"})
		return
	}
	override := *rules
	override.Enabled = true // 预览时即便用户尚未保存启用，也强制按当前表单跑
	if body.Scope != "" {
		override.ApplyOn = body.Scope
	}
	result, err := service.RunScanRules(service.ScanRuleRunOptions{
		ComicIDs:      body.ComicIDs,
		DryRun:        true,
		Manual:        true,
		OverrideRules: &override,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"result":  result,
	})
}

// POST /api/scan-rules/restore-titles — 紧急还原：把 Title 字段重置为基于 Filename 的智能派生。
//
//	Body:
//	{
//	  "comicIds": ["..."],         // 可选；为空则全表扫描
//	  "dryRun": true,               // 试运行，强烈建议先 dryRun 看预览（默认 true）
//	  "onlyDuplicates": true        // 只处理"同一标题被多本共用"的污染数据（默认 true，更安全）
//	}
func (h *ScanRulesHandler) RestoreTitles(c *gin.Context) {
	var body struct {
		ComicIDs        []string `json:"comicIds"`
		DryRun          *bool    `json:"dryRun"`
		OnlyDuplicates  *bool    `json:"onlyDuplicates"`
		MetadataSources []string `json:"metadataSources"`
	}
	_ = c.ShouldBindJSON(&body)

	// 默认值：dryRun=true、onlyDuplicates=true，二者都明确避免一键全库覆盖
	dryRun := true
	if body.DryRun != nil {
		dryRun = *body.DryRun
	}
	onlyDup := true
	if body.OnlyDuplicates != nil {
		onlyDup = *body.OnlyDuplicates
	}

	result, err := service.RestoreTitlesFromFilename(service.RestoreTitlesOptions{
		ComicIDs:        body.ComicIDs,
		DryRun:          dryRun,
		OnlyDuplicates:  onlyDup,
		MetadataSources: body.MetadataSources,
	})
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"result":  result,
	})
}

// GET /api/scan-rules/logs — 列出规则操作日志。
//
//	Query: batchId, limit
func (h *ScanRulesHandler) Logs(c *gin.Context) {
	batchID := c.Query("batchId")
	limit := 100
	if v := c.Query("limit"); v != "" {
		// 简单解析；非法值用默认
		var n int
		_, _ = fmtSscan(v, &n)
		if n > 0 {
			limit = n
		}
	}
	logs, err := store.ListScanRuleOpLogs(batchID, limit)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if logs == nil {
		logs = []store.ScanRuleOpLog{}
	}
	total, _ := store.CountScanRuleOpLogs()
	c.JSON(http.StatusOK, gin.H{
		"logs":  logs,
		"total": total,
	})
}

// 局部辅助：避免引入额外 strconv 包，但保留可读性
func fmtSscan(s string, p *int) (int, error) {
	n := 0
	for _, ch := range s {
		if ch < '0' || ch > '9' {
			break
		}
		n = n*10 + int(ch-'0')
	}
	*p = n
	return n, nil
}
