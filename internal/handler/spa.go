package handler

import (
	"encoding/json"
	"fmt"
	stdhtml "html"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/config"
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

	// Serve static files that exist on disk/embedded FS & handle SPA fallback
	r.NoRoute(h.serveFileOrFallback)
}

func injectRuntimeConfig(html []byte, basePath string) []byte {
	normBase, _ := config.NormalizeBasePath(basePath)
	if normBase == "/" {
		normBase = ""
	}
	hrefBase := normBase + "/"
	if normBase == "" {
		hrefBase = "/"
	}

	tags := fmt.Sprintf(
		`<base href="%s"><meta name="nowen-base-path" content="%s">`,
		stdhtml.EscapeString(hrefBase),
		stdhtml.EscapeString(normBase),
	)

	htmlStr := string(html)
	if headStart := strings.Index(strings.ToLower(htmlStr), "<head"); headStart != -1 {
		if headEnd := strings.Index(htmlStr[headStart:], ">"); headEnd != -1 {
			insertAt := headStart + headEnd + 1
			return []byte(htmlStr[:insertAt] + tags + htmlStr[insertAt:])
		}
	}
	return append([]byte(tags), html...)
}

func serveDynamicManifest(h *SPAHandler, c *gin.Context, basePath string) bool {
	f, err := h.fileSystem.Open("manifest.json")
	if err != nil {
		return false
	}
	defer f.Close()

	data, readErr := io.ReadAll(f)
	if readErr != nil {
		return false
	}

	var manifest map[string]interface{}
	if err := json.Unmarshal(data, &manifest); err != nil {
		return false
	}

	startURL := "/"
	if basePath != "/" {
		startURL = basePath + "/"
	}
	manifest["start_url"] = startURL
	manifest["scope"] = startURL

	if icons, ok := manifest["icons"].([]interface{}); ok {
		for _, item := range icons {
			if iconMap, ok := item.(map[string]interface{}); ok {
				if src, ok := iconMap["src"].(string); ok {
					iconMap["src"] = config.JoinBasePath(src)
				}
			}
		}
	}

	out, err := json.Marshal(manifest)
	if err != nil {
		return false
	}

	c.Header("Content-Type", "application/json; charset=utf-8")
	c.Header("Cache-Control", "no-cache, no-store, must-revalidate")
	c.Data(http.StatusOK, "application/json; charset=utf-8", out)
	return true
}

// serveFileOrFallback serves a static file if it exists, otherwise falls back to index.html.
// Requests that clearly target static assets must never receive index.html: browsers reject
// HTML returned for an ESM worker/chunk and surface an opaque dynamic-import error.
func (h *SPAHandler) serveFileOrFallback(c *gin.Context) {
	requestPath := c.Request.URL.Path
	basePath := config.BasePath()

	// If BASE_PATH is not "/", handle redirects and boundary checks
	if basePath != "/" {
		// Exact BasePath without trailing slash (e.g. /reader) -> 308 redirect to /reader/
		if requestPath == basePath {
			target := basePath + "/"
			if q := c.Request.URL.RawQuery; q != "" {
				target += "?" + q
			}
			c.Redirect(http.StatusPermanentRedirect, target)
			return
		}

		// Reject requests outside BASE_PATH with 404
		if !strings.HasPrefix(requestPath, basePath+"/") {
			c.String(http.StatusNotFound, "404 page not found")
			return
		}
	}

	// Don't serve SPA for API routes — return JSON 404
	apiPrefix := config.JoinBasePath("/api/")
	if strings.HasPrefix(requestPath, apiPrefix) || strings.HasPrefix(requestPath, "/api/") {
		c.JSON(http.StatusNotFound, gin.H{"error": "endpoint not found"})
		return
	}

	// Clean path relative to BasePath
	relPath := requestPath
	if basePath != "/" {
		relPath = strings.TrimPrefix(requestPath, basePath)
	}
	cleanPath := strings.TrimPrefix(relPath, "/")
	if cleanPath == "" {
		cleanPath = "index.html"
	}

	// Try to open the file
	f, err := h.fileSystem.Open(cleanPath)
	if err == nil {
		defer f.Close()

		stat, statErr := f.Stat()
		if statErr == nil && !stat.IsDir() {
			if cleanPath == "manifest.json" {
				if serveDynamicManifest(h, c, basePath) {
					return
				}
			}

			if cleanPath == "index.html" || strings.HasSuffix(cleanPath, "/index.html") {
				data, readErr := io.ReadAll(f)
				if readErr == nil {
					c.Header("Content-Type", "text/html; charset=utf-8")
					c.Header("Cache-Control", "no-cache, no-store, must-revalidate")
					injectedData := injectRuntimeConfig(data, basePath)
					c.Data(http.StatusOK, "text/html; charset=utf-8", injectedData)
					return
				}
			}

			// File exists, serve it with appropriate headers
			h.setStaticHeaders(c, cleanPath)
			if rs, ok := f.(io.ReadSeeker); ok {
				http.ServeContent(c.Writer, c.Request, stat.Name(), stat.ModTime(), rs)
			} else {
				// Fallback: read all and write
				data, _ := io.ReadAll(f)
				c.Data(http.StatusOK, c.Writer.Header().Get("Content-Type"), data)
			}
			return
		}

		// If it's a directory, try index.html inside it
		if statErr == nil && stat.IsDir() {
			indexFile, indexErr := h.fileSystem.Open(cleanPath + "/index.html")
			if indexErr == nil {
				defer indexFile.Close()
				indexStat, indexStatErr := indexFile.Stat()
				if indexStatErr == nil {
					c.Header("Content-Type", "text/html; charset=utf-8")
					c.Header("Cache-Control", "no-cache, no-store, must-revalidate")
					data, _ := io.ReadAll(indexFile)
					injectedData := injectRuntimeConfig(data, basePath)
					if rs, ok := indexFile.(io.ReadSeeker); ok && len(injectedData) == len(data) {
						http.ServeContent(c.Writer, c.Request, indexStat.Name(), indexStat.ModTime(), rs)
					} else {
						c.Data(http.StatusOK, "text/html; charset=utf-8", injectedData)
					}
					return
				}
			}
		}
	}

	// Missing JS/CSS/worker/image files are real 404s. Returning index.html with 200
	// makes PDF.js report "Failed to fetch dynamically imported module" and also
	// lets a service worker cache the wrong response under an asset URL.
	if isStaticAssetRequest(cleanPath) {
		c.Header("Cache-Control", "no-store")
		c.Status(http.StatusNotFound)
		return
	}

	// File doesn't exist — serve index.html for SPA client-side routing
	if h.indexHTML != nil {
		injectedHTML := injectRuntimeConfig(h.indexHTML, basePath)
		c.Header("Content-Type", "text/html; charset=utf-8")
		c.Header("Cache-Control", "no-cache, no-store, must-revalidate")
		c.Data(http.StatusOK, "text/html; charset=utf-8", injectedHTML)
		return
	}

	// No index.html available
	c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
}

// setStaticHeaders sets appropriate content and cache headers for static assets.
func (h *SPAHandler) setStaticHeaders(c *gin.Context, path string) {
	ext := strings.ToLower(filepath.Ext(path))

	// Go's MIME database can vary by OS. ESM workers must always be JavaScript,
	// otherwise Chromium refuses to start the module worker.
	switch ext {
	case ".js", ".mjs":
		c.Header("Content-Type", "text/javascript; charset=utf-8")
	case ".css":
		c.Header("Content-Type", "text/css; charset=utf-8")
	case ".json":
		c.Header("Content-Type", "application/json; charset=utf-8")
	case ".wasm":
		c.Header("Content-Type", "application/wasm")
	}

	// The PDF worker intentionally has a stable URL. It must be revalidated on
	// every app update so an old worker is never paired with a new pdfjs-dist API.
	if filepath.Base(path) == "pdf.worker.min.mjs" {
		c.Header("Cache-Control", "no-cache, no-store, must-revalidate")
		return
	}

	// Hashed assets (JS, CSS with content hash) — immutable
	if isHashedAsset(path) {
		c.Header("Cache-Control", "public, max-age=31536000, immutable")
		return
	}

	// Images, fonts — long cache
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

func isStaticAssetRequest(path string) bool {
	normalized := strings.ToLower(strings.TrimPrefix(strings.ReplaceAll(path, "\\", "/"), "/"))
	if strings.HasPrefix(normalized, "assets/") || strings.HasPrefix(normalized, "_next/static/") {
		return true
	}

	switch filepath.Ext(normalized) {
	case ".js", ".mjs", ".css", ".map", ".json", ".wasm",
		".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico",
		".woff", ".woff2", ".ttf", ".eot":
		return true
	default:
		return false
	}
}

// isHashedAsset detects files generated into immutable asset directories.
func isHashedAsset(path string) bool {
	normalized := strings.TrimPrefix(strings.ReplaceAll(path, "\\", "/"), "/")

	// Next.js static files are content-addressed.
	if strings.HasPrefix(normalized, "_next/static/") {
		return true
	}

	// Vite emits generated assets under assets/. The one intentionally stable
	// asset (pdf.worker.min.mjs) is handled before this function is called.
	return strings.HasPrefix(normalized, "assets/")
}
