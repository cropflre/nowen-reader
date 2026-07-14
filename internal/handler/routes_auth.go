package handler

import (
	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/middleware"
)

func registerAuthRoutes(api *gin.RouterGroup) {
	// Auth routes (Phase 1)
	// ============================================================
	auth := NewAuthHandler()
	apiKeys := NewAPIKeyHandler()

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

	apiKeyGroup := api.Group("/auth/api-keys")
	apiKeyGroup.Use(middleware.SessionRequired())
	{
		apiKeyGroup.GET("", apiKeys.List)
		apiKeyGroup.POST("", middleware.RateLimitAuth(), apiKeys.Create)
		apiKeyGroup.DELETE("/:id", apiKeys.Revoke)
		apiKeyGroup.DELETE("", middleware.RateLimitAuth(), apiKeys.RevokeAll)
	}

	adminAPIKeyGroup := api.Group("/admin/users/:id/api-keys")
	adminAPIKeyGroup.Use(middleware.SessionRequired(), middleware.AdminRequired())
	{
		adminAPIKeyGroup.GET("", apiKeys.AdminList)
		adminAPIKeyGroup.DELETE("", apiKeys.AdminRevokeAll)
	}

}
