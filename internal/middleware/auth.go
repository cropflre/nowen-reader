package middleware

import (
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/model"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

const (
	SessionCookie = "nowen_session"
	SessionMaxAge = 30 * 24 * 60 * 60 // 30 days in seconds
)

// contextKey constants
const (
	ContextKeyUser       = "auth_user"
	ContextKeyCredential = "auth_credential"
)

type CredentialType string

const (
	CredentialSession CredentialType = "session"
	CredentialAPIKey  CredentialType = "api_key"
)

type RequestCredential struct {
	Type CredentialType
	ID   string
}

// AuthRequired accepts either a valid browser session or API key.
func AuthRequired() gin.HandlerFunc {
	return func(c *gin.Context) {
		user := GetCurrentUser(c)
		if user == nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
			return
		}
		c.Set(ContextKeyUser, user)
		c.Next()
	}
}

// SessionRequired only accepts a browser session. It protects credential
// management endpoints from being called with an API key.
func SessionRequired() gin.HandlerFunc {
	return func(c *gin.Context) {
		user := getCurrentSessionUser(c)
		if user == nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Browser session required"})
			return
		}
		c.Next()
	}
}

// AdminRequired is a middleware that requires an admin user.
func AdminRequired() gin.HandlerFunc {
	return func(c *gin.Context) {
		user := GetCurrentUser(c)
		if user == nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
			return
		}
		if user.Role != "admin" {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "Forbidden"})
			return
		}
		c.Set(ContextKeyUser, user)
		c.Next()
	}
}

// AIRequired is a middleware that requires the user to have AI access enabled.
// Admin users always have AI access. Non-admin users need explicit aiEnabled flag.
func AIRequired() gin.HandlerFunc {
	return func(c *gin.Context) {
		user := GetCurrentUser(c)
		if user == nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
			return
		}
		if user.Role != "admin" && !user.AiEnabled {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "AI access not enabled for your account"})
			return
		}
		c.Set(ContextKeyUser, user)
		c.Next()
	}
}

// RequireComicManagePermission is a middleware that requires the user to have manage access to the comic's library.
func RequireComicManagePermission() gin.HandlerFunc {
	return func(c *gin.Context) {
		user := GetCurrentUser(c)
		if user == nil {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
			return
		}

		comicID := c.Param("id")
		if comicID == "" {
			c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Comic ID required"})
			return
		}

		// Fast path for admin
		if user.Role == "admin" {
			c.Next()
			return
		}

		comic, err := store.GetComicByID(comicID)
		if err != nil || comic == nil {
			c.AbortWithStatusJSON(http.StatusNotFound, gin.H{"error": "Comic not found"})
			return
		}

		canManage, _ := store.UserCanManageLibrary(user.ID, comic.LibraryID)
		if !canManage {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "Forbidden: No manage permission for this library"})
			return
		}

		c.Next()
	}
}

// GetCurrentUser resolves the explicit Bearer API key first, then falls back to
// the session cookie only when no Authorization header is present.
func GetCurrentUser(c *gin.Context) *model.AuthUser {
	if user := getContextUser(c); user != nil {
		return user
	}

	if authorization := c.GetHeader("Authorization"); authorization != "" {
		parts := strings.Fields(authorization)
		if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
			return nil
		}

		key, user, err := store.AuthenticateAPIKey(parts[1])
		if err != nil || key == nil || user == nil {
			return nil
		}

		authUser := authUserFromModel(user)
		setAuthenticatedUser(c, authUser, RequestCredential{Type: CredentialAPIKey, ID: key.ID})
		return authUser
	}

	return getCurrentSessionUser(c)
}

// GetCurrentCredential returns the credential selected for this request.
func GetCurrentCredential(c *gin.Context) *RequestCredential {
	credential, exists := c.Get(ContextKeyCredential)
	if !exists {
		return nil
	}
	result, ok := credential.(RequestCredential)
	if !ok {
		return nil
	}
	return &result
}

func getCurrentSessionUser(c *gin.Context) *model.AuthUser {
	if user := getContextUser(c); user != nil {
		credential := GetCurrentCredential(c)
		if credential != nil && credential.Type == CredentialSession {
			return user
		}
		return nil
	}

	// An explicit Authorization header always wins and cannot fall back to a
	// browser cookie, even when it is malformed or invalid.
	if c.GetHeader("Authorization") != "" {
		return nil
	}

	token, err := c.Cookie(SessionCookie)
	if err != nil || token == "" {
		return nil
	}

	session, user, err := store.GetSessionWithUser(token)
	if err != nil || session == nil || user == nil {
		return nil
	}

	// Check expiration
	if session.ExpiresAt.Before(time.Now()) {
		// Clean up expired session
		_ = store.DeleteSession(token)
		return nil
	}

	// 自动续期：当 Session 剩余有效期不足 7 天时，自动延长到 30 天
	const renewThreshold = 7 * 24 * time.Hour
	if time.Until(session.ExpiresAt) < renewThreshold {
		newExpiry := time.Now().Add(time.Duration(SessionMaxAge) * time.Second)
		if err := store.RenewSession(token, newExpiry); err == nil {
			SetSessionCookie(c, token)
		}
	}

	authUser := authUserFromModel(user)
	setAuthenticatedUser(c, authUser, RequestCredential{Type: CredentialSession, ID: session.ID})
	return authUser
}

func getContextUser(c *gin.Context) *model.AuthUser {
	if value, exists := c.Get(ContextKeyUser); exists {
		user, _ := value.(*model.AuthUser)
		return user
	}
	return nil
}

func setAuthenticatedUser(c *gin.Context, user *model.AuthUser, credential RequestCredential) {
	c.Set(ContextKeyUser, user)
	c.Set(ContextKeyCredential, credential)
}

func authUserFromModel(user *model.User) *model.AuthUser {
	return &model.AuthUser{
		ID:        user.ID,
		Username:  user.Username,
		Nickname:  user.Nickname,
		Role:      user.Role,
		AiEnabled: user.AiEnabled,
	}
}

// IsRequestSecure determines if the request is over HTTPS.
// Checks X-Forwarded-Proto for reverse proxy scenarios (NAS/LAN).
func IsRequestSecure(c *gin.Context) bool {
	if c.Request.TLS != nil {
		return true
	}
	forwarded := c.GetHeader("X-Forwarded-Proto")
	return strings.Contains(strings.ToLower(forwarded), "https")
}

// SetSessionCookie sets the session cookie on the response.
// 注意：不设置 Secure 标志，因为：
// 1. 本项目主要用于局域网/NAS 环境，很多用户通过 HTTP 访问
// 2. Flutter App (dio_cookie_manager) 在 HTTP 连接时不会发送 Secure Cookie
// 3. httpOnly=true 已经提供了足够的 XSS 防护
func SetSessionCookie(c *gin.Context, token string) {
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(SessionCookie, token, SessionMaxAge, "/", "", false, true)
}

// ClearSessionCookie removes the session cookie.
func ClearSessionCookie(c *gin.Context) {
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(SessionCookie, "", -1, "/", "", false, true)
}
