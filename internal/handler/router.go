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

	// Comics write ops (require auth)
	comicsWrite := api.Group("/comics")
	comicsWrite.Use(middleware.AuthRequired())
	{
		comicsWrite.POST("/batch", comic.BatchOperation)
		comicsWrite.PUT("/reorder", comic.Reorder)
	}

	// Single comic read operations (no auth)
	comicByID := api.Group("/comics/:id")
	{
		comicByID.GET("", comic.GetComic)
	}

	// Single comic write operations (require auth)
	comicByIDWrite := api.Group("/comics/:id")
	comicByIDWrite.Use(middleware.AuthRequired())
	{
		comicByIDWrite.PUT("/favorite", comic.ToggleFavorite)
		comicByIDWrite.PUT("/rating", comic.UpdateRating)
		comicByIDWrite.PUT("/progress", comic.UpdateProgress)
		comicByIDWrite.DELETE("/delete", comic.DeleteComic)

		// Tags per comic
		comicByIDWrite.POST("/tags", comic.AddTags)
		comicByIDWrite.DELETE("/tags", comic.RemoveTag)

		// Categories per comic
		comicByIDWrite.POST("/categories", comic.AddCategories)
		comicByIDWrite.PUT("/categories", comic.SetCategories)
		comicByIDWrite.DELETE("/categories", comic.RemoveCategory)

		// Metadata editing
		comicByIDWrite.PUT("/metadata", comic.UpdateMetadata)
	}

	// ============================================================
	// Tags (Phase 2)
	// ============================================================
	tag := NewTagHandler()
	api.GET("/tags", tag.ListTags)
	api.PUT("/tags/color", tag.UpdateTagColor)

	// ============================================================
	// Categories (Phase 2)
	// ============================================================
	cat := NewCategoryHandler()
	api.GET("/categories", cat.ListCategories)
	api.POST("/categories", cat.InitCategories)

	// ============================================================
	// Reading Stats (Phase 2)
	// ============================================================
	stats := NewStatsHandler()
	api.GET("/stats", stats.GetStats)
	api.POST("/stats/session", stats.StartSession)
	api.PUT("/stats/session", stats.EndSession)

	// ============================================================
	// Shelves (书架系统)
	// ============================================================
	shelf := NewShelfHandler()
	api.GET("/shelves", shelf.ListShelves)
	api.POST("/shelves/init", shelf.InitShelves)
	api.GET("/stats/enhanced", shelf.GetEnhancedStats)

	shelfWrite := api.Group("/shelves")
	shelfWrite.Use(middleware.AuthRequired())
	{
		shelfWrite.POST("", shelf.CreateShelf)
		shelfWrite.PUT("/:id", shelf.UpdateShelf)
		shelfWrite.DELETE("/:id", shelf.DeleteShelf)
		shelfWrite.POST("/:id/comics", shelf.AddComic)
		shelfWrite.DELETE("/:id/comics", shelf.RemoveComic)
	}
	// 漫画的书架归属
	comicByID.GET("/shelves", shelf.GetComicShelves)

	// ============================================================
	// Upload (Phase 2) — requires auth
	// ============================================================
	upload := NewUploadHandler()
	uploadGroup := api.Group("")
	uploadGroup.Use(middleware.AuthRequired())
	{
		uploadGroup.POST("/upload", upload.Upload)
	}

	// ============================================================
	// Site Settings (Phase 2) — write requires auth
	// ============================================================
	settings := NewSettingsHandler()
	api.GET("/site-settings", settings.GetSettings)
	settingsWrite := api.Group("")
	settingsWrite.Use(middleware.AuthRequired())
	{
		settingsWrite.PUT("/site-settings", settings.UpdateSettings)
	}

	// ============================================================
	// Sync trigger (Phase 2) — requires auth
	// ============================================================
	syncTrigger := api.Group("")
	syncTrigger.Use(middleware.AuthRequired())
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

	// Chapter content for novel formats: /api/comics/:id/chapter/:chapterIndex
	api.GET("/comics/:id/chapter/:chapterIndex", img.GetChapterContent)

	// EPUB resource (images, etc.): /api/comics/:id/epub-resource/*resourcePath
	api.GET("/comics/:id/epub-resource/*resourcePath", img.GetEpubResource)

	// ============================================================
	// Cache management (Phase 3) — requires auth
	// ============================================================
	cache := NewCacheHandler()
	cacheGroup := api.Group("")
	cacheGroup.Use(middleware.AuthRequired())
	{
		cacheGroup.POST("/cache", cache.ClearCache)
	}

	// ============================================================
	// Thumbnail management (Phase 3) — requires auth
	// ============================================================
	thumb := NewThumbnailHandler()
	thumbGroup := api.Group("")
	thumbGroup.Use(middleware.AuthRequired())
	{
		thumbGroup.POST("/thumbnails/manage", thumb.ManageThumbnails)
	}

	// ============================================================
	// Reading Goals (阅读目标)
	// ============================================================
	goal := NewGoalHandler()
	api.GET("/goals", goal.GetGoalProgress)
	goalWrite := api.Group("")
	goalWrite.Use(middleware.AuthRequired())
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

	// Metadata scraping
	meta := NewMetadataHandler()
	metadataGroup := api.Group("/metadata")
	{
		metadataGroup.GET("/search", meta.Search)
		metadataGroup.POST("/search", meta.Search)
		metadataGroup.POST("/apply", meta.Apply)
		metadataGroup.POST("/scan", meta.Scan)
		metadataGroup.POST("/novel-scan", meta.NovelScan)
		metadataGroup.POST("/batch", meta.Batch)
		metadataGroup.POST("/translate-batch", meta.TranslateBatch)
	}

	// AI services
	ai := NewAIHandler()
	aiGroup := api.Group("/ai")
	{
		aiGroup.GET("/status", ai.Status)
		aiGroup.GET("/settings", ai.GetSettings)
		aiGroup.PUT("/settings", ai.UpdateSettings)
		aiGroup.GET("/search", ai.Search)
		aiGroup.GET("/duplicates", ai.Duplicates)
		aiGroup.GET("/models", ai.Models)
		aiGroup.POST("/analyze", ai.Analyze)
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

	// Cloud sync
	syncH := NewSyncHandler()
	api.GET("/cloud-sync", syncH.Export)
	api.POST("/cloud-sync", syncH.Sync)

	// Recommendations
	rec := NewRecommendationHandler()
	api.GET("/recommendations", rec.GetRecommendations)
	api.GET("/recommendations/similar/:id", rec.GetSimilar)

	// E-Hentai integration
	eh := NewEHentaiHandler()
	ehGroup := api.Group("/ehentai")
	{
		ehGroup.GET("/status", eh.Status)
		ehGroup.GET("/settings", eh.GetSettings)
		ehGroup.PUT("/settings", eh.UpdateSettings)
		ehGroup.DELETE("/settings", eh.DeleteSettings)
		ehGroup.GET("/search", eh.Search)
		ehGroup.GET("/gallery/:gid/:token", eh.GalleryDetail)
		ehGroup.POST("/gallery/:gid/:token", eh.ResolvePageImages)
		ehGroup.GET("/proxy", eh.Proxy)
		ehGroup.GET("/download", eh.Download)
		ehGroup.POST("/download", eh.Download)
	}

	// Tag translation
	tagTranslate := NewTagTranslateHandler()
	api.POST("/tags/translate", tagTranslate.TranslateTags)

	// Per-comic metadata translation (requires auth)
	comicByIDWrite.POST("/translate-metadata", tagTranslate.TranslateMetadata)
}
