package handler

import (
	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/middleware"
)

func registerComicRoutes(api *gin.RouterGroup) {
	// Comics CRUD (Phase 2)
	// ============================================================
	comic := NewComicHandler()

	// Comics read operations — require auth
	comicsRead := api.Group("/comics")
	comicsRead.Use(middleware.AuthRequired())
	{
		comicsRead.GET("", comic.ListComics)
		comicsRead.GET("/duplicates", comic.DetectDuplicates)
	}

	// Comics write ops (require admin)
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

	// Single comic read — require auth
	comicByID := api.Group("/comics/:id")
	comicByID.Use(middleware.AuthRequired())
	{
		comicByID.GET("", comic.GetComic)
	}

	// Single comic write operations (require admin)
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

	// 阅读进度和状态（所有登录用户可用）
	comicByIDAuth := api.Group("/comics/:id")
	comicByIDAuth.Use(middleware.AuthRequired())
	{
		comicByIDAuth.PUT("/progress", comic.UpdateProgress)
		comicByIDAuth.PUT("/reading-status", comic.SetReadingStatus)
	}

	// 单本漫画管理员操作（删除等危险操作）
	comicByIDAdmin := api.Group("/comics/:id")
	comicByIDAdmin.Use(middleware.AdminRequired())
	{
		comicByIDAdmin.DELETE("/delete", comic.DeleteComic)
	}

	// ============================================================

	// Sync trigger — requires admin
	syncTrigger := api.Group("")
	syncTrigger.Use(middleware.AdminRequired())
	{
		syncTrigger.POST("/sync", comic.TriggerSync)
	}

	// Image serving (Phase 3) — all require auth
	img := NewImageHandler()

	comicByID.GET("/pages", img.GetPages)
	comicByID.GET("/thumbnail", img.GetThumbnail)
	comicByIDWrite.POST("/cover", img.UpdateCover)

	// Resource serving — require auth (registered on a dedicated group)
	imgRead := api.Group("/comics/:id")
	imgRead.Use(middleware.AuthRequired())
	{
		imgRead.GET("/page/:pageIndex", img.GetPageImage)
		imgRead.GET("/pdf", img.GetPdfFile)
		imgRead.GET("/chapter/:chapterIndex", img.GetChapterContent)
		imgRead.GET("/epub-resource/*resourcePath", img.GetEpubResource)
		imgRead.GET("/embedded-images", img.GetEmbeddedImages)
		imgRead.GET("/embedded-image/:index", img.GetEmbeddedImage)
		imgRead.POST("/warmup", img.WarmupPages)
		imgRead.POST("/warmup-done", img.WarmupDone)
	}

	// Per-comic metadata translation (requires admin)
	tagTranslate := NewTagTranslateHandler()
	comicByIDWrite.POST("/translate-metadata", tagTranslate.TranslateMetadata)
}