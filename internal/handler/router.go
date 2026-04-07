package handler

import (
	"runtime"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/middleware"
)

// Build info — set by main package
var (
	AppVersion = "dev"
	startTime  = time.Now()
)

// SetupRoutes registers all API routes on the given Gin engine.
// CORS and other global middleware should be applied before calling this.
func SetupRoutes(r *gin.Engine) {
	api := r.Group("/api")

	// ============================================================
	// Auth routes (Phase 1)
	// ============================================================
	auth := NewAuthHandler()

	authGroup := api.Group("/auth")
	{
		// Login/register use strict rate limiting to prevent brute-force
		authGroup.POST("/register", middleware.RateLimitAuth(), auth.Register)
		authGroup.POST("/login", middleware.RateLimitAuth(), auth.Login)
		// Logout and session check don't need strict limiting
		authGroup.POST("/logout", auth.Logout)
		authGroup.GET("/me", auth.Me)
	}

	usersGroup := api.Group("/auth/users")
	usersGroup.Use(middleware.AdminRequired())
	{
		usersGroup.GET("", auth.ListUsers)
		usersGroup.POST("", auth.CreateUserByAdmin)
		usersGroup.PUT("", auth.UpdateUser)
		usersGroup.DELETE("", auth.DeleteUserHandler)
	}

	// ============================================================
	// Health check & version info
	// ============================================================
	api.GET("/health", func(c *gin.Context) {
		var memStats runtime.MemStats
		runtime.ReadMemStats(&memStats)

		c.JSON(200, gin.H{
			"status":  "ok",
			"version": AppVersion,
			"uptime":  time.Since(startTime).String(),
			"runtime": gin.H{
				"go":         runtime.Version(),
				"os":         runtime.GOOS,
				"arch":       runtime.GOARCH,
				"cpus":       runtime.NumCPU(),
				"goroutines": runtime.NumGoroutine(),
				"memoryMB":   memStats.Alloc / 1024 / 1024,
			},
		})
	})

	// ============================================================
	// Comics CRUD (Phase 2)
	// ============================================================
	comic := NewComicHandler()

	// Comics listing (read-only, no auth needed for browsing)
	api.GET("/comics", comic.ListComics)
	api.GET("/comics/duplicates", comic.DetectDuplicates)

	// Comics write ops (require admin — 非管理员只读)
	comicsWrite := api.Group("/comics")
	comicsWrite.Use(middleware.AdminRequired())
	{
		comicsWrite.POST("/batch", comic.BatchOperation)
		comicsWrite.PUT("/reorder", comic.Reorder)
	}

	// Comics admin ops (require admin)
	comicsAdmin := api.Group("/comics")
	comicsAdmin.Use(middleware.AdminRequired())
	{
		comicsAdmin.POST("/cleanup", comic.CleanupInvalid)
		comicsAdmin.POST("/redetect-types", comic.RedetectTypes)
	}

	// Single comic read operations (no auth)
	comicByID := api.Group("/comics/:id")
	{
		comicByID.GET("", comic.GetComic)
	}

	// Single comic write operations (require admin — 非管理员只读)
	comicByIDWrite := api.Group("/comics/:id")
	comicByIDWrite.Use(middleware.AdminRequired())
	{
		comicByIDWrite.PUT("/favorite", comic.ToggleFavorite)
		comicByIDWrite.PUT("/rating", comic.UpdateRating)

		// Tags per comic
		comicByIDWrite.POST("/tags", comic.AddTags)
		comicByIDWrite.DELETE("/tags", comic.RemoveTag)
		comicByIDWrite.DELETE("/tags/clear-all", comic.ClearAllTags)

		// Categories per comic
		comicByIDWrite.POST("/categories", comic.AddCategories)
		comicByIDWrite.PUT("/categories", comic.SetCategories)
		comicByIDWrite.DELETE("/categories", comic.RemoveCategory)

		// Metadata editing
		comicByIDWrite.PUT("/metadata", comic.UpdateMetadata)
	}

	// 阅读进度和状态（所有登录用户可用，非管理员也需要保存阅读进度）
	comicByIDAuth := api.Group("/comics/:id")
	comicByIDAuth.Use(middleware.AuthRequired())
	{
		comicByIDAuth.PUT("/progress", comic.UpdateProgress)
		comicByIDAuth.PUT("/reading-status", comic.SetReadingStatus)
	}

	// 单本漫画管理员操作（删除等危险操作需要管理员权限）
	comicByIDAdmin := api.Group("/comics/:id")
	comicByIDAdmin.Use(middleware.AdminRequired())
	{
		comicByIDAdmin.DELETE("/delete", comic.DeleteComic)
	}

	// ============================================================
	// Tags (Phase 2)
	// ============================================================
	tag := NewTagHandler()
	api.GET("/tags", tag.ListTags)

	tagAdmin := api.Group("/tags")
	tagAdmin.Use(middleware.AdminRequired())
	{
		tagAdmin.PUT("/color", tag.UpdateTagColor)
		tagAdmin.PUT("/rename", tag.RenameTag)
		tagAdmin.DELETE("", tag.DeleteTag)
		tagAdmin.POST("/merge", tag.MergeTags)
	}

	// ============================================================
	// Categories (Phase 2)
	// ============================================================
	cat := NewCategoryHandler()
	api.GET("/categories", cat.ListCategories)

	catAdmin := api.Group("/categories")
	catAdmin.Use(middleware.AdminRequired())
	{
		catAdmin.POST("", cat.InitCategories)
		catAdmin.PUT("/:slug", cat.UpdateCategory)
		catAdmin.DELETE("/:slug", cat.DeleteCategory)
	}

	// ============================================================
	// Reading Stats (Phase 2)
	// ============================================================
	// 阅读统计会话（所有登录用户可用，非管理员也需要记录阅读时长）
	stats := NewStatsHandler()
	api.GET("/stats", stats.GetStats)
	api.GET("/stats/yearly", stats.GetYearlyReport)
	api.GET("/stats/enhanced", stats.GetEnhancedStats)
	api.GET("/stats/files", stats.GetFileStats)
	api.GET("/stats/folder-tree", stats.GetFolderTreeStats)

	statsAuth := api.Group("/stats")
	statsAuth.Use(middleware.AuthRequired())
	{
		statsAuth.POST("/session", stats.StartSession)
		statsAuth.PUT("/session", stats.EndSession)
		statsAuth.POST("/session/end", stats.EndSession) // sendBeacon 兆底（sendBeacon 只支持 POST）
	}
	// ============================================================
	// Upload (Phase 2) — requires admin
	// ============================================================
	upload := NewUploadHandler()
	uploadGroup := api.Group("")
	uploadGroup.Use(middleware.AdminRequired())
	{
		uploadGroup.POST("/upload", upload.Upload)
	}

	// ============================================================
	// Site Settings (Phase 2) — read public, write requires admin
	// ============================================================
	settings := NewSettingsHandler()
	api.GET("/site-settings", settings.GetSettings)
	settingsWrite := api.Group("")
	settingsWrite.Use(middleware.AdminRequired())
	{
		settingsWrite.PUT("/site-settings", settings.UpdateSettings)
	}

	// ============================================================
	// Directory Browser (文件夹浏览) — requires admin
	// ============================================================
	browse := NewBrowseHandler()
	browseGroup := api.Group("")
	browseGroup.Use(middleware.AdminRequired())
	{
		browseGroup.GET("/browse-dirs", browse.BrowseDirs)
	}

	// ============================================================
	// Sync trigger (Phase 2) — requires admin
	// ============================================================
	syncTrigger := api.Group("")
	syncTrigger.Use(middleware.AdminRequired())
	{
		syncTrigger.POST("/sync", comic.TriggerSync)
	}

	// ============================================================
	// Image serving (Phase 3)
	// ============================================================
	img := NewImageHandler()

	comicByID.GET("/pages", img.GetPages)
	comicByID.GET("/thumbnail", img.GetThumbnail)
	comicByIDWrite.POST("/cover", img.UpdateCover)

	// Page image uses a different path pattern: /api/comics/:id/page/:pageIndex
	api.GET("/comics/:id/page/:pageIndex", img.GetPageImage)

	// PDF file streaming (for frontend PDF.js rendering)
	api.GET("/comics/:id/pdf", img.GetPdfFile)

	// Chapter content for novel formats: /api/comics/:id/chapter/:chapterIndex
	api.GET("/comics/:id/chapter/:chapterIndex", img.GetChapterContent)

	// EPUB resource (images, etc.): /api/comics/:id/epub-resource/*resourcePath
	api.GET("/comics/:id/epub-resource/*resourcePath", img.GetEpubResource)

	// 页面预热 API（减少阅读时冷启动延迟）
	api.POST("/comics/:id/warmup", img.WarmupPages)
	api.POST("/comics/:id/warmup-done", img.WarmupDone)

	// ============================================================
	// Cache management (Phase 3) — requires admin
	// ============================================================
	cache := NewCacheHandler()
	cacheGroup := api.Group("")
	cacheGroup.Use(middleware.AdminRequired())
	{
		cacheGroup.POST("/cache", cache.ClearCache)
	}

	// ============================================================
	// Thumbnail management (Phase 3) — requires admin
	// ============================================================
	thumb := NewThumbnailHandler()
	thumbGroup := api.Group("")
	thumbGroup.Use(middleware.AdminRequired())
	{
		thumbGroup.POST("/thumbnails/manage", thumb.ManageThumbnails)
	}

	// ============================================================
	// Reading Goals (阅读目标)
	// ============================================================
	goal := NewGoalHandler()
	api.GET("/goals", goal.GetGoalProgress)
	goalWrite := api.Group("")
	goalWrite.Use(middleware.AdminRequired())
	{
		goalWrite.POST("/goals", goal.SetGoal)
		goalWrite.DELETE("/goals", goal.DeleteGoal)
	}

	// ============================================================
	// Data Export (数据导出)
	// ============================================================
	export := NewExportHandler()
	api.GET("/export/json", export.ExportJSON)
	api.GET("/export/csv/sessions", export.ExportCSV)
	api.GET("/export/csv/comics", export.ExportComicsCSV)

	// ============================================================
	// Phase 4: Metadata, AI, OPDS, WebDAV, Recommendations, etc.
	// ============================================================

	// Metadata scraping — requires admin
	meta := NewMetadataHandler()
	metadataGroup := api.Group("/metadata")
	metadataGroup.Use(middleware.AdminRequired())
	{
		metadataGroup.GET("/search", meta.Search)
		metadataGroup.POST("/search", meta.Search)
		metadataGroup.POST("/apply", meta.Apply)
		metadataGroup.POST("/scan", meta.Scan)
		metadataGroup.POST("/novel-scan", meta.NovelScan)
		metadataGroup.POST("/batch", meta.Batch)
		metadataGroup.POST("/translate-batch", meta.TranslateBatch)
		metadataGroup.GET("/stats", meta.Stats)
		metadataGroup.POST("/ai-batch", meta.AIBatch)
		metadataGroup.GET("/library", meta.Library)
		metadataGroup.POST("/batch-selected", meta.BatchSelected)
		metadataGroup.POST("/clear", meta.ClearMetadata)
		metadataGroup.POST("/batch-rename", meta.BatchRename)
		metadataGroup.POST("/ai-rename", meta.AIRename)
		metadataGroup.POST("/ai-chat", meta.AIChat)
		metadataGroup.GET("/folder-tree", meta.FolderTree)
		metadataGroup.POST("/batch-folder", meta.BatchFolder)
	}

	// AI services
	ai := NewAIHandler()

	// AI 状态查询（所有登录用户可查看）
	aiStatus := api.Group("/ai")
	aiStatus.Use(middleware.AuthRequired())
	{
		aiStatus.GET("/status", ai.Status)
		aiStatus.GET("/usage", ai.GetUsageStats)
	}

	// AI 配置管理（仅管理员）
	aiAdmin := api.Group("/ai")
	aiAdmin.Use(middleware.AdminRequired())
	{
		aiAdmin.GET("/settings", ai.GetSettings)
		aiAdmin.PUT("/settings", ai.UpdateSettings)
		aiAdmin.GET("/models", ai.Models)
		aiAdmin.DELETE("/usage", ai.ResetUsageStats)
		aiAdmin.POST("/test", ai.TestConnection)
		// AI prompt templates (Phase 2) — 管理员管理
		aiAdmin.GET("/prompts", ai.GetPromptTemplates)
		aiAdmin.PUT("/prompts", ai.UpdatePromptTemplates)
		aiAdmin.DELETE("/prompts", ai.ResetPromptTemplates)
	}

	// AI 使用功能（需要 AI 权限）
	aiUse := api.Group("/ai")
	aiUse.Use(middleware.AIRequired())
	{
		// AI Chat (Phase 3)
		aiUse.POST("/chat", ai.Chat)
		// AI semantic search (Phase 4)
		aiUse.POST("/semantic-search", ai.SemanticSearch)
		// AI reading insight (Phase 5)
		aiUse.POST("/reading-insight", ai.GenerateReadingInsight)
		// AI batch suggest tags (Phase 5)
		aiUse.POST("/batch-suggest-tags", ai.BatchSuggestTags)
		// AI enhanced group detection (Phase 6)
		aiUse.POST("/enhance-group-detect", ai.EnhanceGroupDetect)
		// AI suggest category (Phase 6)
		aiUse.POST("/suggest-category", ai.SuggestCategory)
		// AI batch suggest category (Phase 6)
		aiUse.POST("/batch-suggest-category", ai.BatchSuggestCategory)
		// AI verify duplicates (Phase 7)
		aiUse.POST("/verify-duplicates", ai.VerifyDuplicates)
		// AI recommend goal (Phase 7)
		aiUse.POST("/recommend-goal", ai.RecommendGoal)
	}

	// AI per-comic features (Phase 1) — 需要 AI 权限
	comicByIDAI := api.Group("/comics/:id")
	comicByIDAI.Use(middleware.AIRequired())
	{
		comicByIDAI.POST("/ai-summary", ai.GenerateSummary)
		comicByIDAI.POST("/ai-parse-filename", ai.ParseFilename)
		comicByIDAI.POST("/ai-suggest-tags", ai.SuggestTags)
		// Phase 2
		comicByIDAI.POST("/ai-analyze-cover", ai.AnalyzeCover)
		// Phase 6
		comicByIDAI.POST("/ai-complete-metadata", ai.CompleteMetadata)
		// Phase 7
		comicByIDAI.POST("/ai-chapter-recap", ai.ChapterRecap)
		// AI chapter summary (Phase 3)
		comicByIDAI.POST("/ai-chapter-summary", ai.ChapterSummary)
		comicByIDAI.POST("/ai-chapter-summaries", ai.BatchChapterSummaries)
		// AI page translation (Phase 4)
		comicByIDAI.POST("/ai-translate-page", ai.TranslatePage)
	}

	// OPDS protocol
	opds := NewOPDSHandler()
	opdsGroup := api.Group("/opds")
	{
		opdsGroup.GET("", opds.Root)
		opdsGroup.GET("/all", opds.All)
		opdsGroup.GET("/recent", opds.Recent)
		opdsGroup.GET("/favorites", opds.Favorites)
		opdsGroup.GET("/search", opds.Search)
		opdsGroup.GET("/download/:id", opds.Download)
	}

	// Recommendations
	rec := NewRecommendationHandler()
	api.GET("/recommendations", rec.GetRecommendations)
	api.GET("/recommendations/similar/:id", rec.GetSimilar)

	// AI recommendation reasons (需要 AI 权限)
	aiRecGroup := api.Group("")
	aiRecGroup.Use(middleware.AIRequired())
	{
		aiRecGroup.POST("/recommendations/ai-reasons", ai.GenerateRecommendationReasons)
	}

	// Tag translation — requires admin
	tagTranslate := NewTagTranslateHandler()
	tagTranslateAdmin := api.Group("")
	tagTranslateAdmin.Use(middleware.AdminRequired())
	{
		tagTranslateAdmin.POST("/tags/translate", tagTranslate.TranslateTags)
	}

	// Per-comic metadata translation (requires auth)
	comicByIDWrite.POST("/translate-metadata", tagTranslate.TranslateMetadata)

	// ============================================================
	// 翻译引擎管理 API
	// ============================================================
	api.GET("/translate/engines", tagTranslate.GetEngines)
	api.GET("/translate/config", tagTranslate.GetTranslateConfig)
	api.GET("/translate/health", tagTranslate.GetEngineHealth)
	api.GET("/translate/cache/stats", tagTranslate.GetCacheStats)

	translateWrite := api.Group("/translate")
	translateWrite.Use(middleware.AdminRequired())
	{
		translateWrite.PUT("/config", tagTranslate.UpdateTranslateConfig)
		translateWrite.DELETE("/cache", tagTranslate.ClearCache)
		translateWrite.POST("/test", tagTranslate.TestEngine)
	}

	// ============================================================
	// Comic Groups (自定义合并分组)
	// ============================================================
	group := NewGroupHandler()
	api.GET("/groups", group.ListGroups)
	api.GET("/groups/comic-map", group.GetComicMap)
	api.GET("/groups/:id", group.GetGroup)

	groupWrite := api.Group("/groups")
	groupWrite.Use(middleware.AdminRequired())
	{
		groupWrite.POST("", group.CreateGroup)
		groupWrite.PUT("/:id", group.UpdateGroup)
		groupWrite.DELETE("/:id", group.DeleteGroup)
		groupWrite.POST("/:id/comics", group.AddComics)
		groupWrite.DELETE("/:id/comics/:comicId", group.RemoveComic)
		groupWrite.PUT("/:id/reorder", group.ReorderComics)
		groupWrite.PUT("/:id/metadata", group.UpdateMetadata)
		groupWrite.POST("/:id/inherit-metadata", group.InheritMetadata)
		groupWrite.POST("/:id/preview-inherit", group.PreviewInherit)
		groupWrite.POST("/:id/inherit-to-volumes", group.InheritToVolumes)
		// P2: 系列级标签管理
		groupWrite.GET("/:id/tags", group.GetGroupTags)
		groupWrite.PUT("/:id/tags", group.SetGroupTags)
		groupWrite.POST("/:id/sync-tags", group.SyncGroupTags)
		groupWrite.POST("/:id/ai-suggest-tags", group.AISuggestTags)
		// P4: 系列级元数据刮削 & AI 识别
		groupWrite.POST("/:id/scrape-metadata", group.ScrapeMetadata)
		groupWrite.POST("/:id/apply-metadata", group.ApplyScrapedMetadata)
		groupWrite.POST("/:id/ai-recognize", group.AIRecognize)
		// P3: 按话/卷自动分组
		groupWrite.POST("/auto-group-by-dir", group.AutoGroupByDirectory)
		groupWrite.POST("/auto-detect", group.AutoDetect)
		groupWrite.POST("/batch-create", group.BatchCreate)
		groupWrite.POST("/batch-delete", group.BatchDelete)
		groupWrite.POST("/merge", group.MergeGroups)
		groupWrite.POST("/export", group.ExportGroups)
	}

	// ============================================================
	// Error Logs (错误日志查看) — requires admin
	// ============================================================
	logH := NewLogHandler()
	logGroup := api.Group("/logs")
	logGroup.Use(middleware.AdminRequired())
	{
		logGroup.GET("", logH.GetErrorLogs)
		logGroup.GET("/stats", logH.GetErrorLogStats)
		logGroup.GET("/export", logH.ExportErrorLogs)
		logGroup.DELETE("", logH.ClearErrorLogs)
	}
}
