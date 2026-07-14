package handler

import (
	"errors"
	"strings"
	"testing"
)

func TestSelectActivePdfRendererMatchesRenderOrder(t *testing.T) {
	tools := map[string]string{
		"pdftoppm": "/tools/pdftoppm",
		"mutool":   "/tools/mutool",
		"convert":  "/tools/convert",
	}
	if active := selectActivePdfRenderer(tools); active != "pdftoppm" {
		t.Fatalf("active renderer = %q, want pdftoppm", active)
	}

	tools["pdftoppm"] = ""
	if active := selectActivePdfRenderer(tools); active != "mutool" {
		t.Fatalf("fallback renderer = %q, want mutool", active)
	}

	tools["mutool"] = ""
	if active := selectActivePdfRenderer(tools); active != "convert" {
		t.Fatalf("last renderer = %q, want convert", active)
	}
}

func TestThumbnailDiagnosticsMatchActualEncoders(t *testing.T) {
	lookup := func(name string) (string, error) {
		if name == "cwebp" || name == "vips" || name == "convert" {
			return "/tools/" + name, nil
		}
		return "", errors.New("not found")
	}

	items := checkThumbnailToolsWithLookup(lookup)
	if len(items) != 1 || items[0].Status != "ok" {
		t.Fatalf("unexpected thumbnail diagnostic: %+v", items)
	}
	if !strings.Contains(items[0].Message, "cwebp") {
		t.Fatalf("diagnostic did not report cwebp: %q", items[0].Message)
	}
	if strings.Contains(items[0].Message, "vips") || strings.Contains(items[0].Message, "convert") {
		t.Fatalf("diagnostic reported unused encoders: %q", items[0].Message)
	}
}

func TestThumbnailDiagnosticsDescribeNativeFallback(t *testing.T) {
	lookup := func(string) (string, error) {
		return "", errors.New("not found")
	}

	items := checkThumbnailToolsWithLookup(lookup)
	if len(items) != 1 || items[0].Status != "ok" {
		t.Fatalf("unexpected thumbnail fallback diagnostic: %+v", items)
	}
	if !strings.Contains(items[0].Message, "Go 原生 JPEG 兜底") || !strings.Contains(items[0].Hint, "cwebp") {
		t.Fatalf("fallback was not explained accurately: %+v", items[0])
	}
}
