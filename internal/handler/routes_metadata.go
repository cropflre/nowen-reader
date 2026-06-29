package handler

import (
	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/middleware"
)

func registerMetadataRoutes(api *gin.RouterGroup) {
	// Phase 4: Metadata, AI, OPDS, Recommendations, etc.
	// ============================================================

	// Metadata scraping — requires admin + scraper enabled
	meta := NewMetadataHandler()
	metadataGroup := api.Group("/metadata")
	metadataGroup.Use(middleware.AdminRequired(), middleware.ScraperRequired())
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
		aiAdmin.GET("/prompts", ai.GetPromptTemplates)
		aiAdmin.PUT("/prompts", ai.UpdatePromptTemplates)
		aiAdmin.DELETE("/prompts", ai.ResetPromptTemplates)
	}

	// 本地模型管理（仅管理员）
	localAI := &LocalAIHandler{}
	localAIGroup := api.Group("/ai/local")
	localAIGroup.Use(middleware.AdminRequired())
	{
		localAIGroup.GET("/status", localAI.GetStatus)
		localAIGroup.POST("/start", localAI.Start)
		localAIGroup.POST("/stop", localAI.Stop)
		localAIGroup.POST("/test", localAI.TestConnection)
		localAIGroup.GET("/models", localAI.ScanModels)
		localAIGroup.PUT("/config", localAI.SaveConfig)
	}

	// AI 使用功能（需要 AI 权限）
	aiUse := api.Group("/ai")
	aiUse.Use(middleware.AIRequired())
	{
		aiUse.POST("/chat", ai.Chat)
		aiUse.POST("/semantic-search", ai.SemanticSearch)
		aiUse.POST("/reading-insight", ai.GenerateReadingInsight)
		aiUse.POST("/batch-suggest-tags", ai.BatchSuggestTags)
		aiUse.POST("/enhance-group-detect", ai.EnhanceGroupDetect)
		aiUse.POST("/suggest-category", ai.SuggestCategory)
		aiUse.POST("/batch-suggest-category", ai.BatchSuggestCategory)
		aiUse.POST("/verify-duplicates", ai.VerifyDuplicates)
		aiUse.POST("/recommend-goal", ai.RecommendGoal)
	}

	// AI per-comic features — require AI access
	comicByIDAI := api.Group("/comics/:id")
	comicByIDAI.Use(middleware.AIRequired())
	{
		comicByIDAI.POST("/ai-summary", ai.GenerateSummary)
		comicByIDAI.POST("/ai-parse-filename", ai.ParseFilename)
		comicByIDAI.POST("/ai-infer-title", ai.InferTitle)
		comicByIDAI.POST("/ai-suggest-tags", ai.SuggestTags)
		comicByIDAI.POST("/ai-analyze-cover", ai.AnalyzeCover)
		comicByIDAI.POST("/ai-complete-metadata", ai.CompleteMetadata)
		comicByIDAI.POST("/ai-chapter-recap", ai.ChapterRecap)
		comicByIDAI.POST("/ai-chapter-summary", ai.ChapterSummary)
		comicByIDAI.POST("/ai-chapter-summaries", ai.BatchChapterSummaries)
		comicByIDAI.POST("/ai-translate-page", ai.TranslatePage)
	}

	// OPDS protocol — require auth (cookie or query token)
	opds := NewOPDSHandler()
	opdsGroup := api.Group("/opds")
	opdsGroup.Use(middleware.AuthRequired())
	{
		opdsGroup.GET("", opds.Root)
		opdsGroup.GET("/all", opds.All)
		opdsGroup.GET("/recent", opds.Recent)
		opdsGroup.GET("/favorites", opds.Favorites)
		opdsGroup.GET("/search", opds.Search)
		opdsGroup.GET("/download/:id", opds.Download)
	}

	// Recommendations — require auth
	rec := NewRecommendationHandler()
	recRead := api.Group("/recommendations")
	recRead.Use(middleware.AuthRequired())
	{
		recRead.GET("", rec.GetRecommendations)
		recRead.GET("/similar/:id", rec.GetSimilar)
	}

	// AI recommendation reasons — require AI access
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

	// 翻译引擎管理 API — read requires auth
	translateRead := api.Group("/translate")
	translateRead.Use(middleware.AuthRequired())
	{
		translateRead.GET("/engines", tagTranslate.GetEngines)
		translateRead.GET("/config", tagTranslate.GetTranslateConfig)
		translateRead.GET("/health", tagTranslate.GetEngineHealth)
		translateRead.GET("/cache/stats", tagTranslate.GetCacheStats)
	}

	translateWrite := api.Group("/translate")
	translateWrite.Use(middleware.AdminRequired())
	{
		translateWrite.PUT("/config", tagTranslate.UpdateTranslateConfig)
		translateWrite.DELETE("/cache", tagTranslate.ClearCache)
		translateWrite.POST("/test", tagTranslate.TestEngine)
	}

	// ============================================================
	// Comic Groups
	// ============================================================
	group := NewGroupHandler()

	// Group read — require auth
	groupRead := api.Group("/groups")
	groupRead.Use(middleware.AuthRequired())
	{
		groupRead.GET("", group.ListGroups)
		groupRead.GET("/comic-map", group.GetComicMap)
		groupRead.GET("/:id", group.GetGroup)
	}

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
		groupWrite.GET("/:id/tags", group.GetGroupTags)
		groupWrite.PUT("/:id/tags", group.SetGroupTags)
		groupWrite.POST("/:id/sync-tags", group.SyncGroupTags)
		groupWrite.POST("/:id/override-tags", group.OverrideGroupTags)
		groupWrite.POST("/:id/ai-suggest-tags", group.AISuggestTags)
		groupWrite.GET("/:id/categories", group.GetGroupCategories)
		groupWrite.PUT("/:id/categories", group.SetGroupCategories)
		groupWrite.POST("/:id/sync-categories", group.SyncGroupCategories)
		groupWrite.POST("/:id/ai-suggest-categories", group.AISuggestCategories)
		groupWrite.POST("/:id/scrape-metadata", middleware.ScraperRequired(), group.ScrapeMetadata)
		groupWrite.POST("/:id/apply-metadata", middleware.ScraperRequired(), group.ApplyScrapedMetadata)
		groupWrite.POST("/:id/ai-recognize", middleware.ScraperRequired(), group.AIRecognize)
		groupWrite.POST("/auto-group-by-dir", group.AutoGroupByDirectory)
		groupWrite.POST("/auto-detect", group.AutoDetect)
		groupWrite.POST("/batch-create", group.BatchCreate)
		groupWrite.POST("/batch-delete", group.BatchDelete)
		groupWrite.POST("/batch-scrape", middleware.ScraperRequired(), group.BatchScrape)
		groupWrite.POST("/merge", group.MergeGroups)
		groupWrite.POST("/export", group.ExportGroups)
		groupWrite.POST("/detect-dirty", group.DetectDirty)
		groupWrite.POST("/cleanup", group.Cleanup)
		groupWrite.POST("/fix-name", group.FixName)
	}

	// ============================================================
	// Error Logs — requires admin
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

	// ============================================================
	// Metadata Sync — requires admin
	// ============================================================
	syncH := NewSyncHandler()
	syncGroup := api.Group("/sync")
	syncGroup.Use(middleware.AdminRequired())
	{
		syncGroup.GET("/status", syncH.Status)
		syncGroup.GET("/history", syncH.History)
		syncGroup.GET("/diff/:id", syncH.Diff)
		syncGroup.POST("/push", syncH.Push)
		syncGroup.POST("/revert", syncH.Revert)
	}
}