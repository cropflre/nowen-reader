package handler

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"testing"
)

func createPDFRangeFixture(t *testing.T) (*os.File, os.FileInfo, []byte) {
	t.Helper()
	data := make([]byte, 4096)
	for i := range data {
		data[i] = byte(i % 251)
	}
	path := t.TempDir() + "/large.pdf"
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatal(err)
	}
	file, err := os.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = file.Close() })
	info, err := file.Stat()
	if err != nil {
		t.Fatal(err)
	}
	return file, info, data
}

func TestServePDFRangeContentPartialRequest(t *testing.T) {
	file, info, data := createPDFRangeFixture(t)
	req := httptest.NewRequest(http.MethodGet, "/pdf-range", nil)
	req.Header.Set("Range", "bytes=100-199")
	res := httptest.NewRecorder()

	servePDFRangeContent(res, req, file, info)

	if res.Code != http.StatusPartialContent {
		t.Fatalf("status = %d, want 206", res.Code)
	}
	if got, want := res.Header().Get("Content-Range"), "bytes 100-199/4096"; got != want {
		t.Fatalf("Content-Range = %q, want %q", got, want)
	}
	if got := res.Header().Get("Accept-Ranges"); got != "bytes" {
		t.Fatalf("Accept-Ranges = %q", got)
	}
	if got := res.Header().Get("Content-Length"); got != "100" {
		t.Fatalf("Content-Length = %q, want 100", got)
	}
	if !bytes.Equal(res.Body.Bytes(), data[100:200]) {
		t.Fatal("partial response body mismatch")
	}
}

func TestServePDFRangeContentHeadRequest(t *testing.T) {
	file, info, data := createPDFRangeFixture(t)
	req := httptest.NewRequest(http.MethodHead, "/pdf-range", nil)
	res := httptest.NewRecorder()

	servePDFRangeContent(res, req, file, info)

	if res.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", res.Code)
	}
	if res.Body.Len() != 0 {
		t.Fatalf("HEAD body length = %d, want 0", res.Body.Len())
	}
	if got, want := res.Header().Get("Content-Length"), strconv.Itoa(len(data)); got != want {
		t.Fatalf("Content-Length = %q, want %q", got, want)
	}
	if got := res.Header().Get("X-Accel-Buffering"); got != "no" {
		t.Fatalf("X-Accel-Buffering = %q", got)
	}
}

func TestServePDFRangeContentRejectsInvalidRange(t *testing.T) {
	file, info, _ := createPDFRangeFixture(t)
	req := httptest.NewRequest(http.MethodGet, "/pdf-range", nil)
	req.Header.Set("Range", "bytes=99999-100000")
	res := httptest.NewRecorder()

	servePDFRangeContent(res, req, file, info)

	if res.Code != http.StatusRequestedRangeNotSatisfiable {
		t.Fatalf("status = %d, want 416", res.Code)
	}
	if got, want := res.Header().Get("Content-Range"), "bytes */4096"; got != want {
		t.Fatalf("Content-Range = %q, want %q", got, want)
	}
}
