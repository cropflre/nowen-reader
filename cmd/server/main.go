package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"runtime"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/config"
	"github.com/nowen-reader/nowen-reader/internal/handler"
	"github.com/nowen-reader/nowen-reader/internal/middleware"
	"github.com/nowen-reader/nowen-reader/internal/service"
	"github.com/nowen-reader/nowen-reader/internal/store"
	"github.com/nowen-reader/nowen-reader/web"
)

// Version info — injected via ldflags at build time
var (
	Version   = "dev"
	BuildTime = "unknown"
	GitCommit = "unknown"
)

func main() {
	log.SetFlags(log.Ldate | log.Ltime | log.Lshortfile)
	startTime := time.Now()

	// ============================================================
	// Banner
	// ============================================================
	fmt.Println("┌─────────────────────────────────────────┐")
	fmt.Println("│         NowenReader v" + Version + padRight(Version, 19) + "│")
	fmt.Println("│     高性能自托管漫画管理平台              │")
	fmt.Println("└─────────────────────────────────────────┘")
	log.Printf("[Main] Version: %s, Build: %s, Commit: %s", Version, BuildTime, GitCommit)
	log.Printf("[Main] Go: %s, OS: %s/%s, CPUs: %d",
		runtime.Version(), runtime.GOOS, runtime.GOARCH, runtime.NumCPU())

	// ============================================================
	// Initialize database
	// ============================================================
	dbPath := config.DatabaseURL()
	log.Printf("[Main] Database path: %s", dbPath)

	if err := store.InitDB(dbPath); err != nil {
		log.Fatalf("[Main] Failed to initialize database: %v", err)
	}
	defer store.CloseDB()

	// Run schema migrations
	if err := store.RunMigrations(); err != nil {
		log.Printf("[Main] Warning: schema migration failed: %v", err)
	}

	// ============================================================
	// Ensure required directories exist
	// ============================================================
	dirs := []string{
		config.GetComicsDir(),
		config.GetThumbnailsDir(),
		config.GetPagesCacheDir(),
	}
	for _, dir := range dirs {
		if err := os.MkdirAll(dir, 0755); err != nil {
			log.Printf("[Main] Warning: failed to create directory %s: %v", dir, err)
		}
	}
	log.Printf("[Main] Comics dir: %s", config.GetComicsDir())
	log.Printf("[Main] Data dir: %s", config.DataDir())

	// ============================================================
	// Start session cleanup ticker (every hour)
	// ============================================================
	go func() {
		ticker := time.NewTicker(1 * time.Hour)
		defer ticker.Stop()
		for range ticker.C {
			if n, err := store.CleanExpiredSessions(); err != nil {
				log.Printf("[Auth] Failed to clean expired sessions: %v", err)
			} else if n > 0 {
				log.Printf("[Auth] Cleaned %d expired sessions", n)
			}
		}
	}()

	// ============================================================
	// Start background comic sync
	// ============================================================
	service.StartBackgroundSync()

	// ============================================================
	// Start session cleanup scheduler
	// ============================================================
	service.StartSessionCleanup()

	// ============================================================
	// Setup Gin router
	// ============================================================
	mode := os.Getenv("GIN_MODE")
	if mode == "" {
		mode = gin.DebugMode
	}
	gin.SetMode(mode)

	r := gin.New() // Use gin.New() instead of gin.Default() for custom middleware

	// Global middleware stack
	r.Use(middleware.Recovery())
	if mode == gin.ReleaseMode {
		r.Use(middleware.QuietLogger())
	} else {
		r.Use(middleware.RequestLogger())
	}
	r.Use(middleware.ErrorLogCapture()) // 捕获错误请求到内存缓冲区
	r.Use(middleware.CORS())
	r.Use(middleware.SecurityHeaders())
	r.Use(middleware.RequestTimeout(30 * time.Second))
	r.Use(middleware.Gzip())

	// Register all API routes
	handler.AppVersion = Version
	handler.SetupRoutes(r)

	// ============================================================
	// SPA frontend serving
	// ============================================================
	setupFrontend(r)

	// ============================================================
	// Determine listen address
	// ============================================================
	port := os.Getenv("PORT")
	if port == "" {
		port = "3000"
	}
	addr := fmt.Sprintf(":%s", port)

	// ============================================================
	// HTTP Server with timeouts
	// ============================================================
	srv := &http.Server{
		Addr:              addr,
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       60 * time.Second,
		WriteTimeout:      300 * time.Second, // Large for streaming/SSE/downloads
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    1 << 20, // 1MB
	}

	// ============================================================
	// Graceful shutdown
	// ============================================================
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)

	go func() {
		startupDuration := time.Since(startTime)
		log.Printf("[Main] Server started on http://localhost%s (startup: %v)", addr, startupDuration)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("[Main] Server failed: %v", err)
		}
	}()

	sig := <-quit
	log.Printf("[Main] Received signal %v, shutting down gracefully...", sig)

	// Give outstanding requests 30 seconds to complete
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		log.Printf("[Main] Server forced shutdown: %v", err)
	}

	store.CloseDB()
	log.Println("[Main] Server stopped.")
}

// setupFrontend configures the SPA frontend serving.
func setupFrontend(r *gin.Engine) {
	// Priority 1: FRONTEND_DIR env variable (for development)
	frontendDir := os.Getenv("FRONTEND_DIR")
	if frontendDir != "" {
		spa := handler.NewSPAHandlerFromDir(frontendDir)
		if spa != nil {
			log.Printf("[Main] Serving frontend from directory: %s", frontendDir)
			spa.RegisterRoutes(r)
			return
		}
		log.Printf("[Main] Warning: FRONTEND_DIR=%s not found, trying embedded", frontendDir)
	}

	// Priority 2: Embedded frontend (production)
	frontendFS := web.FrontendFS()
	if frontendFS != nil {
		spa := handler.NewSPAHandler(frontendFS)
		if spa != nil {
			log.Println("[Main] Serving embedded frontend")
			spa.RegisterRoutes(r)
			return
		}
	}

	// Priority 3: No frontend — API-only mode
	log.Println("[Main] No frontend found — running in API-only mode")
	log.Println("[Main] Set FRONTEND_DIR to serve a local frontend build")
}

// padRight pads a string with spaces to reach the desired total width.
func padRight(s string, width int) string {
	if len(s) >= width {
		return " "
	}
	padding := width - len(s)
	result := make([]byte, padding)
	for i := range result {
		result[i] = ' '
	}
	return string(result)
}
