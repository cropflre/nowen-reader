package config

import (
	"os"
	"testing"
)

func TestNormalizeBasePath(t *testing.T) {
	tests := []struct {
		name      string
		input     string
		want      string
		expectErr bool
	}{
		{name: "empty string", input: "", want: "/"},
		{name: "root slash", input: "/", want: "/"},
		{name: "simple path no leading slash", input: "reader", want: "/reader"},
		{name: "simple path with leading slash", input: "/reader", want: "/reader"},
		{name: "simple path with trailing slash", input: "/reader/", want: "/reader"},
		{name: "multi-segment path", input: "/apps/reader/", want: "/apps/reader"},
		{name: "redundant slashes", input: "//apps///reader//", want: "/apps/reader"},
		{name: "with spaces", input: "  /reader/  ", want: "/reader"},
		{name: "invalid http protocol", input: "http://example.com/reader", expectErr: true},
		{name: "invalid https protocol", input: "https://example.com/reader", expectErr: true},
		{name: "invalid query parameter", input: "/reader?foo=bar", expectErr: true},
		{name: "invalid hash fragment", input: "/reader#section", expectErr: true},
		{name: "invalid backslash", input: "/reader\\sub", expectErr: true},
		{name: "invalid path traversal", input: "/reader/../app", expectErr: true},
		{name: "invalid control char", input: "/reader\x07app", expectErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := NormalizeBasePath(tt.input)
			if tt.expectErr {
				if err == nil {
					t.Errorf("NormalizeBasePath(%q) expected error, got nil", tt.input)
				}
			} else {
				if err != nil {
					t.Errorf("NormalizeBasePath(%q) unexpected error: %v", tt.input, err)
				}
				if got != tt.want {
					t.Errorf("NormalizeBasePath(%q) = %q, want %q", tt.input, got, tt.want)
				}
			}
		})
	}
}

func TestBasePathAndJoin(t *testing.T) {
	orig := os.Getenv("BASE_PATH")
	defer os.Setenv("BASE_PATH", orig)

	// Test default "/"
	os.Setenv("BASE_PATH", "")
	if got := BasePath(); got != "/" {
		t.Errorf("BasePath() with empty env = %q, want %q", got, "/")
	}
	if got := JoinBasePath("/api/health"); got != "/api/health" {
		t.Errorf("JoinBasePath(/api/health) = %q, want /api/health", got)
	}

	// Test subpath "/reader"
	os.Setenv("BASE_PATH", "/reader/")
	if got := BasePath(); got != "/reader" {
		t.Errorf("BasePath() = %q, want /reader", got)
	}
	if got := JoinBasePath("/api/health"); got != "/reader/api/health" {
		t.Errorf("JoinBasePath(/api/health) = %q, want /reader/api/health", got)
	}
	if got := JoinBasePath("api/health"); got != "/reader/api/health" {
		t.Errorf("JoinBasePath(api/health) = %q, want /reader/api/health", got)
	}
	if got := JoinBasePath("/"); got != "/reader" {
		t.Errorf("JoinBasePath(/) = %q, want /reader", got)
	}
	if got := JoinBasePath(""); got != "/reader" {
		t.Errorf("JoinBasePath(\"\") = %q, want /reader", got)
	}
}
