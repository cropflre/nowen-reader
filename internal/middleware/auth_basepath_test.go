package middleware

import (
	"net/http/httptest"
	"os"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestSessionCookieUsesBasePath(t *testing.T) {
	original := os.Getenv("BASE_PATH")
	t.Cleanup(func() { _ = os.Setenv("BASE_PATH", original) })
	if err := os.Setenv("BASE_PATH", "/reader/"); err != nil {
		t.Fatal(err)
	}

	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)

	SetSessionCookie(context, "session-token")

	cookies := recorder.Result().Cookies()
	if len(cookies) != 1 {
		t.Fatalf("session cookies = %d, want 1", len(cookies))
	}
	if cookies[0].Path != "/reader" {
		t.Fatalf("session cookie path = %q, want /reader", cookies[0].Path)
	}
	if !cookies[0].HttpOnly {
		t.Fatal("session cookie must remain HttpOnly")
	}
}

func TestClearSessionCookieRemovesScopedAndLegacyCookies(t *testing.T) {
	original := os.Getenv("BASE_PATH")
	t.Cleanup(func() { _ = os.Setenv("BASE_PATH", original) })
	if err := os.Setenv("BASE_PATH", "/reader"); err != nil {
		t.Fatal(err)
	}

	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	context, _ := gin.CreateTestContext(recorder)

	ClearSessionCookie(context)

	paths := make(map[string]bool)
	for _, cookie := range recorder.Result().Cookies() {
		if cookie.Name == SessionCookie && cookie.MaxAge < 0 {
			paths[cookie.Path] = true
		}
	}
	if !paths["/reader"] || !paths["/"] {
		t.Fatalf("cleared cookie paths = %#v, want /reader and /", paths)
	}
}
