package handler

import (
	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/middleware"
)

func registerLibraryRoutes(api *gin.RouterGroup) {
	// Library management routes (admin only)
	// ============================================================
	library := NewLibraryHandler()

	libraryGroup := api.Group("/admin/libraries")
	libraryGroup.Use(middleware.AdminRequired())
	{
		libraryGroup.GET("", library.ListLibraries)
		libraryGroup.POST("", library.CreateLibrary)
		libraryGroup.PUT("/:id", library.UpdateLibrary)
		libraryGroup.DELETE("/:id", library.DeleteLibrary)
		libraryGroup.POST("/:id/scan", library.ScanLibrary)
		libraryGroup.POST("/:id/delete-preview", library.DeletePreview)
	}

	// User library access management (admin only)
	userLibraryGroup := api.Group("/admin/users")
	userLibraryGroup.Use(middleware.AdminRequired())
	{
		userLibraryGroup.GET("/:id/library-access", library.GetUserLibraryAccess)
		userLibraryGroup.PUT("/:id/library-access", library.SetUserLibraryAccess)
	}
}
