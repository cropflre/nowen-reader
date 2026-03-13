package web

import (
	"embed"
	"io/fs"
)

// Frontend holds the embedded frontend build output.
// The "dist" directory should contain the built SPA (e.g., from `npm run build`).
//
// In development, this will be empty. Set FRONTEND_DIR env var to serve
// from a local directory instead.
//
// Build steps:
//  1. cd frontend && npm run build
//  2. Copy build output to web/dist/
//  3. go build ./cmd/server
//
//go:embed all:dist
var frontend embed.FS

// FrontendFS returns the embedded frontend filesystem rooted at "dist/".
// Returns nil if no frontend files are embedded (dev mode).
func FrontendFS() fs.FS {
	// Check if dist directory exists and has files
	entries, err := fs.ReadDir(frontend, "dist")
	if err != nil || len(entries) == 0 {
		return nil
	}

	sub, err := fs.Sub(frontend, "dist")
	if err != nil {
		return nil
	}
	return sub
}
