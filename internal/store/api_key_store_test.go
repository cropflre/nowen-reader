package store

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/nowen-reader/nowen-reader/internal/model"
)

func TestAPIKeyLifecycleAndStorage(t *testing.T) {
	setupTestDB(t)
	user := &model.User{
		ID:       "api-key-user",
		Username: "api-key-user",
		Password: "hashed",
		Nickname: "API Key User",
		Role:     "user",
	}
	if err := CreateUser(user); err != nil {
		t.Fatalf("CreateUser failed: %v", err)
	}

	expiresAt := time.Now().UTC().Add(time.Hour)
	key, plaintext, err := CreateAPIKey(user.ID, "automation", &expiresAt)
	if err != nil {
		t.Fatalf("CreateAPIKey failed: %v", err)
	}
	if !strings.HasPrefix(plaintext, APIKeyTokenPrefix) {
		t.Fatalf("unexpected key prefix: %q", plaintext)
	}

	var storedHash string
	if err := db.QueryRow(`SELECT "secretHash" FROM "ApiKey" WHERE "id" = ?`, key.ID).Scan(&storedHash); err != nil {
		t.Fatalf("load stored hash: %v", err)
	}
	if storedHash == plaintext || len(storedHash) != 64 {
		t.Fatalf("API key was not stored as a SHA-256 digest")
	}

	authenticatedKey, authenticatedUser, err := AuthenticateAPIKey(plaintext)
	if err != nil {
		t.Fatalf("AuthenticateAPIKey failed: %v", err)
	}
	if authenticatedKey.ID != key.ID || authenticatedUser.ID != user.ID || authenticatedKey.LastUsedAt == nil {
		t.Fatalf("unexpected authentication result: key=%+v user=%+v", authenticatedKey, authenticatedUser)
	}

	replacement := "A"
	if strings.HasSuffix(plaintext, replacement) {
		replacement = "B"
	}
	tampered := plaintext[:len(plaintext)-1] + replacement
	if _, _, err := AuthenticateAPIKey(tampered); !errors.Is(err, ErrInvalidAPIKey) {
		t.Fatalf("tampered key error = %v, want ErrInvalidAPIKey", err)
	}

	revoked, err := RevokeAPIKey(user.ID, key.ID)
	if err != nil || !revoked {
		t.Fatalf("RevokeAPIKey = %v, %v", revoked, err)
	}
	if _, _, err := AuthenticateAPIKey(plaintext); !errors.Is(err, ErrInvalidAPIKey) {
		t.Fatalf("revoked key error = %v, want ErrInvalidAPIKey", err)
	}
}

func TestAPIKeyExpiryAndUserCascade(t *testing.T) {
	setupTestDB(t)
	user := &model.User{ID: "expiring-key-user", Username: "expiring-key-user", Password: "hashed", Role: "user"}
	if err := CreateUser(user); err != nil {
		t.Fatalf("CreateUser failed: %v", err)
	}

	past := time.Now().UTC().Add(-time.Minute)
	_, expiredPlaintext, err := CreateAPIKey(user.ID, "expired", &past)
	if err != nil {
		t.Fatalf("CreateAPIKey expired failed: %v", err)
	}
	if _, _, err := AuthenticateAPIKey(expiredPlaintext); !errors.Is(err, ErrInvalidAPIKey) {
		t.Fatalf("expired key error = %v, want ErrInvalidAPIKey", err)
	}

	if _, _, err := CreateAPIKey(user.ID, "cascade", nil); err != nil {
		t.Fatalf("CreateAPIKey cascade failed: %v", err)
	}
	if err := DeleteUser(user.ID); err != nil {
		t.Fatalf("DeleteUser failed: %v", err)
	}
	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM "ApiKey" WHERE "userId" = ?`, user.ID).Scan(&count); err != nil {
		t.Fatalf("count API keys: %v", err)
	}
	if count != 0 {
		t.Fatalf("API keys remaining after user deletion: %d", count)
	}
}
