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
	libraryGroup.Use(middleware.LibraryTypeGuard())
	{
		libraryGroup.GET("", reconcileOwnershipBeforeList(), library.ListLibraries)
		libraryGroup.POST("", library.CreateLibrary)
		libraryGroup.GET("/ownership-preview", library.OwnershipPreview)
		libraryGroup.POST("/ownership-reconcile", library.ReconcileOwnership)
		libraryGroup.GET("/scan-jobs", library.ListScannerJobs)
		libraryGroup.GET("/scan-jobs/:jobId", library.GetScannerJob)
		libraryGroup.PUT("/:id", library.UpdateLibrary)
		libraryGroup.DELETE("/:id", library.DeleteLibrary)
		libraryGroup.POST("/:id/scan", library.ScanLibraryQueued)
		libraryGroup.POST("/:id/delete-preview", library.DeletePreview)
	}

	// Accessible libraries for the current user (any logged-in user)
	accessibleGroup := api.Group("/libraries")
	accessibleGroup.Use(middleware.AuthRequired())
	{
		accessibleGroup.GET("/accessible", reconcileOwnershipBeforeList(), library.ListAccessibleLibraries)
		accessibleGroup.GET("/scan-jobs/:jobId", library.GetScannerJob)
		accessibleGroup.POST("/:id/scan", library.ScanLibraryQueued)
	}

	// User library access management (admin only)
	userLibraryGroup := api.Group("/admin/users")
	userLibraryGroup.Use(middleware.AdminRequired())
	{
		userLibraryGroup.GET("/:id/library-access", library.GetUserLibraryAccess)
		userLibraryGroup.PUT("/:id/library-access", library.SetUserLibraryAccess)
	}
}
