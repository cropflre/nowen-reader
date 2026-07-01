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
	ContextKeyUser = "auth_user"
)

// AuthRequired is a middleware that requires a valid session.
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

// GetCurrentUser extracts and validates the session from the request cookie.
// Returns nil if no valid session found.
func GetCurrentUser(c *gin.Context) *model.AuthUser {
	// Check if already resolved in this request
	if u, exists := c.Get(ContextKeyUser); exists {
		if user, ok := u.(*model.AuthUser); ok {
			return user
		}
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

	authUser := &model.AuthUser{
		ID:        user.ID,
		Username:  user.Username,
		Nickname:  user.Nickname,
		Role:      user.Role,
		AiEnabled: user.AiEnabled,
	}
	return authUser
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
