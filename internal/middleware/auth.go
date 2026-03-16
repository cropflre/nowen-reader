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
		ID:       user.ID,
		Username: user.Username,
		Nickname: user.Nickname,
		Role:     user.Role,
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
func SetSessionCookie(c *gin.Context, token string) {
	secure := IsRequestSecure(c)
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(SessionCookie, token, SessionMaxAge, "/", "", secure, true)
}

// ClearSessionCookie removes the session cookie.
func ClearSessionCookie(c *gin.Context) {
	secure := IsRequestSecure(c)
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(SessionCookie, "", -1, "/", "", secure, true)
}
