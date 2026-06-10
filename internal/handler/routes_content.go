package handler

import (
	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/middleware"
)

func registerContentRoutes(api *gin.RouterGroup) {
	// Tags (Phase 2)
	// ============================================================
	tag := NewTagHandler()
	tagsRead := api.Group("/tags")
	tagsRead.Use(middleware.AuthRequired())
	{
		tagsRead.GET("", tag.ListTags)
	}

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
	catsRead := api.Group("/categories")
	catsRead.Use(middleware.AuthRequired())
	{
		catsRead.GET("", cat.ListCategories)
	}

	catAdmin := api.Group("/categories")
	catAdmin.Use(middleware.AdminRequired())
	{
		catAdmin.POST("", cat.InitCategories)
		catAdmin.POST("/create", cat.CreateCategory)
		catAdmin.PUT("/reorder", cat.ReorderCategories)
		catAdmin.PUT("/:slug", cat.UpdateCategory)
		catAdmin.DELETE("/:slug", cat.DeleteCategory)
	}

	// ============================================================
	// Reading Stats (Phase 2)
	// ============================================================
	stats := NewStatsHandler()
	statsRead := api.Group("/stats")
	statsRead.Use(middleware.AuthRequired())
	{
		statsRead.GET("", stats.GetStats)
		statsRead.GET("/yearly", stats.GetYearlyReport)
		statsRead.GET("/enhanced", stats.GetEnhancedStats)
		statsRead.GET("/files", stats.GetFileStats)
		statsRead.GET("/folder-tree", stats.GetFolderTreeStats)
		statsRead.POST("/session", stats.StartSession)
		statsRead.PUT("/session", stats.EndSession)
		statsRead.POST("/session/end", stats.EndSession) // sendBeacon 兆底
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
	// Site Settings — public read (前端登录前需要显示站点名/logo)
	// ============================================================
	settings := NewSettingsHandler()
	api.GET("/site-settings", settings.GetSettings)
	api.GET("/site-settings/icon", settings.GetIcon)

	settingsWrite := api.Group("")
	settingsWrite.Use(middleware.AdminRequired())
	{
		settingsWrite.PUT("/site-settings", settings.UpdateSettings)
		settingsWrite.POST("/site-settings/icon", settings.UploadIcon)
		settingsWrite.DELETE("/site-settings/icon", settings.DeleteIcon)
	}

	// ============================================================
	// Scan Rules — requires admin
	// ============================================================
	scanRules := NewScanRulesHandler()
	scanRulesGroup := api.Group("/scan-rules")
	scanRulesGroup.Use(middleware.AdminRequired())
	{
		scanRulesGroup.GET("", scanRules.Get)
		scanRulesGroup.PUT("", scanRules.Update)
		scanRulesGroup.POST("/apply", scanRules.Apply)
		scanRulesGroup.POST("/preview", scanRules.Preview)
		scanRulesGroup.POST("/restore-titles", scanRules.RestoreTitles)
		scanRulesGroup.GET("/logs", scanRules.Logs)
		scanRulesGroup.GET("/progress", scanRules.Progress)
	}

	// ============================================================
	// Directory Browser — requires admin
	// ============================================================
	browse := NewBrowseHandler()
	browseGroup := api.Group("")
	browseGroup.Use(middleware.AdminRequired())
	{
		browseGroup.GET("/browse-dirs", browse.BrowseDirs)
	}

	// ============================================================
	// Cache management — requires admin
	// ============================================================
	cache := NewCacheHandler()
	cacheGroup := api.Group("")
	cacheGroup.Use(middleware.AdminRequired())
	{
		cacheGroup.POST("/cache", cache.ClearCache)
	}

	// ============================================================
	// 数据管理 — requires admin
	// ============================================================
	dataAdmin := NewDataAdminHandler()
	dataAdminGroup := api.Group("/admin/storage")
	dataAdminGroup.Use(middleware.AdminRequired())
	{
		dataAdminGroup.GET("", dataAdmin.GetOverview)
		dataAdminGroup.GET("/database", dataAdmin.GetDatabaseInfo)
		dataAdminGroup.GET("/history", dataAdmin.GetHistory)
		dataAdminGroup.POST("/cache/clear", dataAdmin.ClearCache)
		dataAdminGroup.POST("/db/checkpoint", dataAdmin.DBCheckpoint)
		dataAdminGroup.POST("/db/analyze", dataAdmin.DBAnalyze)
		dataAdminGroup.POST("/db/vacuum", dataAdmin.DBVacuum)
		dataAdminGroup.POST("/db/integrity", dataAdmin.DBIntegrity)
		dataAdminGroup.PUT("/threshold", dataAdmin.UpdateThreshold)
	}

	// ============================================================
	// Thumbnail management — requires admin
	// ============================================================
	thumb := NewThumbnailHandler()
	thumbGroup := api.Group("")
	thumbGroup.Use(middleware.AdminRequired())
	{
		thumbGroup.POST("/thumbnails/manage", thumb.ManageThumbnails)
	}

	// ============================================================
	// Reading Goals
	// ============================================================
	goal := NewGoalHandler()
	goalsRead := api.Group("/goals")
	goalsRead.Use(middleware.AuthRequired())
	{
		goalsRead.GET("", goal.GetGoalProgress)
	}

	goalWrite := api.Group("")
	goalWrite.Use(middleware.AdminRequired())
	{
		goalWrite.POST("/goals", goal.SetGoal)
		goalWrite.DELETE("/goals", goal.DeleteGoal)
	}

	// ============================================================
	// Data Export — require auth
	// ============================================================
	export := NewExportHandler()
	exportRead := api.Group("/export")
	exportRead.Use(middleware.AuthRequired())
	{
		exportRead.GET("/json", export.ExportJSON)
		exportRead.GET("/csv/sessions", export.ExportCSV)
		exportRead.GET("/csv/comics", export.ExportComicsCSV)
	}
}