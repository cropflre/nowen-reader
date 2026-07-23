package handler

import (
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func TestOPDSBasePathDefault(t *testing.T) {
	orig := os.Getenv("BASE_PATH")
	defer os.Setenv("BASE_PATH", orig)
	os.Setenv("BASE_PATH", "")

	router := setupTestRouter(t)
	user, token := createOPDSTestUserAndKey(t, "opds-bp-def", "opds-bp-def")

	req := httptest.NewRequest("GET", "/api/opds", nil)
	req.Host = "example.com"
	req.SetBasicAuth(user.Username, token)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("GET /api/opds status = %d, want 200", w.Code)
	}

	body := w.Body.String()
	if !strings.Contains(body, `href="http://example.com/api/opds"`) {
		t.Errorf("OPDS root feed expected href='http://example.com/api/opds', got: %s", body)
	}
	if !strings.Contains(body, `href="http://example.com/api/opds/all"`) {
		t.Errorf("OPDS all entry expected href='http://example.com/api/opds/all', got: %s", body)
	}
}

func TestOPDSBasePathSubpath(t *testing.T) {
	orig := os.Getenv("BASE_PATH")
	defer os.Setenv("BASE_PATH", orig)
	os.Setenv("BASE_PATH", "/reader/")

	router := setupTestRouter(t)
	user, token := createOPDSTestUserAndKey(t, "opds-bp-sub", "opds-bp-sub")

	req := httptest.NewRequest("GET", "/reader/api/opds", nil)
	req.Host = "example.com"
	req.SetBasicAuth(user.Username, token)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("GET /reader/api/opds status = %d, want 200", w.Code)
	}

	body := w.Body.String()
	if !strings.Contains(body, `href="http://example.com/reader/api/opds"`) {
		t.Errorf("OPDS root feed expected href='http://example.com/reader/api/opds', got: %s", body)
	}
	if !strings.Contains(body, `href="http://example.com/reader/api/opds/all"`) {
		t.Errorf("OPDS all entry expected href='http://example.com/reader/api/opds/all', got: %s", body)
	}
	if strings.Contains(body, "/reader/reader/") {
		t.Errorf("OPDS URLs contain duplicated basepath /reader/reader/")
	}
}

func TestOPDSForwardedPrefixHeader(t *testing.T) {
	orig := os.Getenv("BASE_PATH")
	origTrust := os.Getenv("TRUST_PROXY_HEADERS")
	defer os.Setenv("BASE_PATH", orig)
	defer os.Setenv("TRUST_PROXY_HEADERS", origTrust)
	os.Setenv("BASE_PATH", "")
	os.Setenv("TRUST_PROXY_HEADERS", "true")

	router := setupTestRouter(t)
	user, token := createOPDSTestUserAndKey(t, "opds-bp-fwd", "opds-bp-fwd")

	req := httptest.NewRequest("GET", "/api/opds", nil)
	req.Host = "example.com"
	req.SetBasicAuth(user.Username, token)
	req.Header.Set("X-Forwarded-Prefix", "/proxy-reader")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("GET /api/opds status = %d, want 200", w.Code)
	}

	body := w.Body.String()
	if !strings.Contains(body, `href="http://example.com/proxy-reader/api/opds"`) {
		t.Errorf("OPDS feed with X-Forwarded-Prefix expected href='http://example.com/proxy-reader/api/opds', got: %s", body)
	}
}

func TestOPDSIgnoresForwardedHeadersByDefault(t *testing.T) {
	origBase := os.Getenv("BASE_PATH")
	origTrust := os.Getenv("TRUST_PROXY_HEADERS")
	defer os.Setenv("BASE_PATH", origBase)
	defer os.Setenv("TRUST_PROXY_HEADERS", origTrust)
	os.Setenv("BASE_PATH", "")
	os.Setenv("TRUST_PROXY_HEADERS", "")

	router := setupTestRouter(t)
	user, token := createOPDSTestUserAndKey(t, "opds-bp-untrusted", "opds-bp-untrusted")

	req := httptest.NewRequest("GET", "/api/opds", nil)
	req.Host = "example.com"
	req.SetBasicAuth(user.Username, token)
	req.Header.Set("X-Forwarded-Proto", "https")
	req.Header.Set("X-Forwarded-Host", "attacker.example")
	req.Header.Set("X-Forwarded-Prefix", "/poisoned")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("GET /api/opds status = %d, want 200", w.Code)
	}

	body := w.Body.String()
	if !strings.Contains(body, `href="http://example.com/api/opds"`) {
		t.Errorf("OPDS feed should ignore untrusted forwarding headers, got: %s", body)
	}
	if strings.Contains(body, "attacker.example") || strings.Contains(body, "/poisoned/") {
		t.Errorf("OPDS feed contains untrusted forwarding values: %s", body)
	}
}
