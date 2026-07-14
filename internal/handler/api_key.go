package handler

import (
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/middleware"
	"github.com/nowen-reader/nowen-reader/internal/store"
	"golang.org/x/crypto/bcrypt"
)

type APIKeyHandler struct{}

func NewAPIKeyHandler() *APIKeyHandler {
	return &APIKeyHandler{}
}

// List handles GET /api/auth/api-keys.
func (h *APIKeyHandler) List(c *gin.Context) {
	user := middleware.GetCurrentUser(c)
	keys, err := store.ListAPIKeysByUser(user.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to list API keys"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"apiKeys": keys})
}

// Create handles POST /api/auth/api-keys.
func (h *APIKeyHandler) Create(c *gin.Context) {
	var req struct {
		Name            string `json:"name"`
		CurrentPassword string `json:"currentPassword"`
		ExpiresInDays   *int   `json:"expiresInDays"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
		return
	}

	req.Name = strings.TrimSpace(req.Name)
	if utf8.RuneCountInString(req.Name) < 1 || utf8.RuneCountInString(req.Name) > 64 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Name must be 1-64 characters"})
		return
	}
	if req.CurrentPassword == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Current password is required"})
		return
	}

	days := 365
	if req.ExpiresInDays != nil {
		days = *req.ExpiresInDays
	}
	if days < 0 || days > 3650 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "expiresInDays must be 0-3650"})
		return
	}

	currentUser := middleware.GetCurrentUser(c)
	user, err := store.GetUserByID(currentUser.ID)
	if err != nil || user == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load user"})
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(req.CurrentPassword)) != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Current password is incorrect"})
		return
	}

	var expiresAt *time.Time
	if days > 0 {
		expiry := time.Now().UTC().Add(time.Duration(days) * 24 * time.Hour)
		expiresAt = &expiry
	}
	key, plaintext, err := store.CreateAPIKey(user.ID, req.Name, expiresAt)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create API key"})
		return
	}

	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusCreated, gin.H{"apiKey": key, "key": plaintext})
}

// Revoke handles DELETE /api/auth/api-keys/:id.
func (h *APIKeyHandler) Revoke(c *gin.Context) {
	user := middleware.GetCurrentUser(c)
	revoked, err := store.RevokeAPIKey(user.ID, c.Param("id"))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to revoke API key"})
		return
	}
	if !revoked {
		c.JSON(http.StatusNotFound, gin.H{"error": "API key not found or already revoked"})
		return
	}
	c.Status(http.StatusNoContent)
}

// RevokeAll handles DELETE /api/auth/api-keys.
func (h *APIKeyHandler) RevokeAll(c *gin.Context) {
	var req struct {
		CurrentPassword string `json:"currentPassword"`
	}
	if err := c.ShouldBindJSON(&req); err != nil || req.CurrentPassword == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Current password is required"})
		return
	}

	currentUser := middleware.GetCurrentUser(c)
	user, err := store.GetUserByID(currentUser.ID)
	if err != nil || user == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load user"})
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(req.CurrentPassword)) != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Current password is incorrect"})
		return
	}

	count, err := store.RevokeAllAPIKeys(user.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to revoke API keys"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"revokedCount": count})
}

// AdminList handles GET /api/admin/users/:id/api-keys.
func (h *APIKeyHandler) AdminList(c *gin.Context) {
	userID := c.Param("id")
	if user, err := store.GetUserByID(userID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load user"})
		return
	} else if user == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	keys, err := store.ListAPIKeysByUser(userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to list API keys"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"apiKeys": keys})
}

// AdminRevokeAll handles DELETE /api/admin/users/:id/api-keys.
func (h *APIKeyHandler) AdminRevokeAll(c *gin.Context) {
	userID := c.Param("id")
	if user, err := store.GetUserByID(userID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load user"})
		return
	} else if user == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found"})
		return
	}

	count, err := store.RevokeAllAPIKeys(userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to revoke API keys"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"revokedCount": count})
}
