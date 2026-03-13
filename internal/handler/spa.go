package handler

import (
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
)

// SPAHandler serves the embedded or on-disk SPA frontend.
// In production, the frontend is embedded into the binary via go:embed.
// In development, it can serve from a local directory.
type SPAHandler struct {
	fileSystem http.FileSystem
	indexHTML  []byte
}

// NewSPAHandler creates a handler that serves SPA static files.
// fsys should be the frontend build output (e.g., Next.js export or Vite build).
// If fsys is nil, SPA serving is disabled (API-only mode).
func NewSPAHandler(fsys fs.FS) *SPAHandler {
	if fsys == nil {
		return nil
	}

	handler := &SPAHandler{
		fileSystem: http.FS(fsys),
	}

	// Pre-read index.html for SPA fallback
	if data, err := fs.ReadFile(fsys, "index.html"); err == nil {
		handler.indexHTML = data
	}

	return handler
}

// NewSPAHandlerFromDir creates a handler that serves SPA from a local directory.
// Useful for development or when frontend is built separately.
func NewSPAHandlerFromDir(dir string) *SPAHandler {
	if dir == "" {
		return nil
	}

	// Check if directory exists
	info, err := os.Stat(dir)
	if err != nil || !info.IsDir() {
		return nil
	}

	handler := &SPAHandler{
		fileSystem: http.Dir(dir),
	}

	// Pre-read index.html
	indexPath := filepath.Join(dir, "index.html")
	if data, err := os.ReadFile(indexPath); err == nil {
		handler.indexHTML = data
	}

	return handler
}

// RegisterRoutes sets up the SPA serving routes on the Gin engine.
// This should be called AFTER all API routes are registered.
func (h *SPAHandler) RegisterRoutes(r *gin.Engine) {
	if h == nil {
		return
	}

	// Serve static files that exist on disk/embedded FS
	r.NoRoute(h.serveFileOrFallback)
}

// serveFileOrFallback serves a static file if it exists, otherwise falls back to index.html.
// This is the standard SPA routing pattern.
func (h *SPAHandler) serveFileOrFallback(c *gin.Context) {
	path := c.Request.URL.Path

	// Don't serve SPA for API routes — return 404
	if strings.HasPrefix(path, "/api/") {
		c.JSON(http.StatusNotFound, gin.H{"error": "endpoint not found"})
		return
	}

	// Clean path
	cleanPath := strings.TrimPrefix(path, "/")
	if cleanPath == "" {
		cleanPath = "index.html"
	}

	// Try to open the file
	f, err := h.fileSystem.Open(cleanPath)
	if err == nil {
		defer f.Close()

		stat, err := f.Stat()
		if err == nil && !stat.IsDir() {
			// File exists, serve it with appropriate headers
			h.setStaticHeaders(c, cleanPath)
			if rs, ok := f.(io.ReadSeeker); ok {
				http.ServeContent(c.Writer, c.Request, stat.Name(), stat.ModTime(), rs)
			} else {
				// Fallback: read all and write
				data, _ := io.ReadAll(f)
				c.Data(http.StatusOK, "", data)
			}
			return
		}

		// If it's a directory, try index.html inside it
		if stat != nil && stat.IsDir() {
			indexFile, err := h.fileSystem.Open(cleanPath + "/index.html")
			if err == nil {
				defer indexFile.Close()
				indexStat, err := indexFile.Stat()
				if err == nil {
					if rs, ok := indexFile.(io.ReadSeeker); ok {
						http.ServeContent(c.Writer, c.Request, indexStat.Name(), indexStat.ModTime(), rs)
					} else {
						data, _ := io.ReadAll(indexFile)
						c.Data(http.StatusOK, "text/html; charset=utf-8", data)
					}
					return
				}
			}
		}
	}

	// File doesn't exist — serve index.html for SPA client-side routing
	if h.indexHTML != nil {
		c.Header("Content-Type", "text/html; charset=utf-8")
		c.Header("Cache-Control", "no-cache, no-store, must-revalidate")
		c.Data(http.StatusOK, "text/html; charset=utf-8", h.indexHTML)
		return
	}

	// No index.html available
	c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
}

// setStaticHeaders sets appropriate cache headers for static assets.
func (h *SPAHandler) setStaticHeaders(c *gin.Context, path string) {
	// Hashed assets (JS, CSS with content hash) — immutable
	if isHashedAsset(path) {
		c.Header("Cache-Control", "public, max-age=31536000, immutable")
		return
	}

	// Images, fonts — long cache
	ext := strings.ToLower(filepath.Ext(path))
	switch ext {
	case ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico",
		".woff", ".woff2", ".ttf", ".eot":
		c.Header("Cache-Control", "public, max-age=604800") // 7 days
		return
	}

	// manifest.json, sw.js — no cache (need fresh on update)
	if path == "manifest.json" || path == "sw.js" {
		c.Header("Cache-Control", "no-cache, must-revalidate")
		return
	}

	// Everything else — short cache
	c.Header("Cache-Control", "public, max-age=3600") // 1 hour
}

// isHashedAsset detects files with content-hash patterns in the name.
// e.g., "assets/index-abc123.js", "_next/static/chunks/abc123.js"
func isHashedAsset(path string) bool {
	// Next.js static files
	if strings.Contains(path, "_next/static/") {
		return true
	}
	// Vite-style hashed assets
	if strings.Contains(path, "assets/") {
		ext := filepath.Ext(path)
		base := strings.TrimSuffix(filepath.Base(path), ext)
		// Pattern: name-hash or name.hash
		if strings.Contains(base, "-") || strings.Contains(base, ".") {
			parts := strings.Split(base, "-")
			if len(parts) >= 2 {
				hash := parts[len(parts)-1]
				if len(hash) >= 8 {
					return true
				}
			}
		}
	}
	return false
}
