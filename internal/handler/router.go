package handler

import (
	"runtime"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/config"
	"github.com/nowen-reader/nowen-reader/internal/middleware"
)

// Build info — set by main package
var (
	AppVersion = "dev"
	startTime  = time.Now()
)

// SetupRoutes registers all API routes on the given Gin engine.
func SetupRoutes(r *gin.Engine) {
	api := r.Group(config.JoinBasePath("/api"))

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
	api.HEAD("/health", func(c *gin.Context) {
		c.Header("Content-Type", "application/json; charset=utf-8")
		c.Status(200)
	})

	// System diagnostic endpoints — require auth
	sysGroup := api.Group("/system")
	sysGroup.Use(middleware.AuthRequired())
	{
		sysGroup.GET("/pdf-renderer", GetPdfRendererStatus)
		sysGroup.GET("/diagnostics", GetDiagnostics)
	}

	registerAuthRoutes(api)
	registerComicRoutes(api)
	registerSeriesRoutes(api)
	registerContentRoutes(api)
	registerMetadataRoutes(api)
	registerLibraryRoutes(api)
	registerUserGroupRoutes(api)
}
