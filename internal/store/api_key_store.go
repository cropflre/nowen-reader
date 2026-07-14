package store

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/nowen-reader/nowen-reader/internal/model"
)

const (
	APIKeyTokenPrefix            = "nwr_"
	apiKeyLastUsedUpdateInterval = 10 * time.Minute
)

var (
	ErrInvalidAPIKey = errors.New("invalid API key")

	apiKeyUseMu    sync.Mutex
	apiKeyLastUses = make(map[string]time.Time)
)

// CreateAPIKey creates a user-owned API key and returns its plaintext value
// once. Only the SHA-256 digest is persisted.
func CreateAPIKey(userID, name string, expiresAt *time.Time) (*model.APIKey, string, error) {
	secretBytes := make([]byte, 32)
	if _, err := rand.Read(secretBytes); err != nil {
		return nil, "", fmt.Errorf("generate API key secret: %w", err)
	}

	id := uuid.New().String()
	secret := base64.RawURLEncoding.EncodeToString(secretBytes)
	token := APIKeyTokenPrefix + id + "_" + secret
	hash := hashAPIKey(token)
	now := time.Now().UTC()
	keyPrefix := APIKeyTokenPrefix + id[:8] + "..."

	key := &model.APIKey{
		ID:         id,
		UserID:     userID,
		Name:       name,
		KeyPrefix:  keyPrefix,
		SecretHash: hash,
		ExpiresAt:  expiresAt,
		CreatedAt:  now,
	}

	_, err := db.Exec(
		`INSERT INTO "ApiKey" ("id", "userId", "name", "keyPrefix", "secretHash", "expiresAt", "createdAt")
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		key.ID, key.UserID, key.Name, key.KeyPrefix, key.SecretHash, key.ExpiresAt, key.CreatedAt,
	)
	if err != nil {
		return nil, "", fmt.Errorf("create API key: %w", err)
	}

	return key, token, nil
}

// ListAPIKeysByUser returns safe key metadata, including revoked keys.
func ListAPIKeysByUser(userID string) ([]model.APIKey, error) {
	rows, err := db.Query(
		`SELECT "id", "userId", "name", "keyPrefix", "expiresAt", "lastUsedAt", "revokedAt", "createdAt"
		 FROM "ApiKey"
		 WHERE "userId" = ?
		 ORDER BY ("revokedAt" IS NOT NULL) ASC, "createdAt" DESC`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	keys := make([]model.APIKey, 0)
	for rows.Next() {
		key, err := scanAPIKey(rows)
		if err != nil {
			return nil, err
		}
		keys = append(keys, *key)
	}
	return keys, rows.Err()
}

// AuthenticateAPIKey validates a plaintext key and returns its current owner.
// User attributes are loaded on every request so role and permissions are never
// copied into the key itself.
func AuthenticateAPIKey(token string) (*model.APIKey, *model.User, error) {
	id, ok := parseAPIKeyToken(token)
	if !ok {
		return nil, nil, ErrInvalidAPIKey
	}

	key := &model.APIKey{}
	user := &model.User{}
	var expiresAt, lastUsedAt, revokedAt sql.NullTime
	err := db.QueryRow(
		`SELECT k."id", k."userId", k."name", k."keyPrefix", k."secretHash",
		        k."expiresAt", k."lastUsedAt", k."revokedAt", k."createdAt",
		        u."id", u."username", u."password", u."nickname", u."role", u."aiEnabled", u."createdAt", u."updatedAt"
		 FROM "ApiKey" k
		 JOIN "User" u ON u."id" = k."userId"
		 WHERE k."id" = ?`,
		id,
	).Scan(
		&key.ID, &key.UserID, &key.Name, &key.KeyPrefix, &key.SecretHash,
		&expiresAt, &lastUsedAt, &revokedAt, &key.CreatedAt,
		&user.ID, &user.Username, &user.Password, &user.Nickname, &user.Role, &user.AiEnabled, &user.CreatedAt, &user.UpdatedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil, ErrInvalidAPIKey
	}
	if err != nil {
		return nil, nil, fmt.Errorf("load API key: %w", err)
	}
	setAPIKeyNullableTimes(key, expiresAt, lastUsedAt, revokedAt)

	expectedHash, err := hex.DecodeString(key.SecretHash)
	if err != nil {
		return nil, nil, ErrInvalidAPIKey
	}
	actualHash := sha256.Sum256([]byte(token))
	if subtle.ConstantTimeCompare(expectedHash, actualHash[:]) != 1 {
		return nil, nil, ErrInvalidAPIKey
	}

	now := time.Now().UTC()
	if key.RevokedAt != nil || (key.ExpiresAt != nil && !key.ExpiresAt.After(now)) {
		return nil, nil, ErrInvalidAPIKey
	}

	if usedAt, err := markAPIKeyUsed(key.ID, now); err == nil && usedAt != nil {
		key.LastUsedAt = usedAt
	}
	return key, user, nil
}

// RevokeAPIKey revokes one active key owned by the specified user.
func RevokeAPIKey(userID, keyID string) (bool, error) {
	now := time.Now().UTC()
	result, err := db.Exec(
		`UPDATE "ApiKey" SET "revokedAt" = ?
		 WHERE "id" = ? AND "userId" = ? AND "revokedAt" IS NULL`,
		now, keyID, userID,
	)
	if err != nil {
		return false, err
	}
	count, err := result.RowsAffected()
	return count > 0, err
}

// RevokeAllAPIKeys revokes all active keys owned by the specified user.
func RevokeAllAPIKeys(userID string) (int64, error) {
	result, err := db.Exec(
		`UPDATE "ApiKey" SET "revokedAt" = ?
		 WHERE "userId" = ? AND "revokedAt" IS NULL`,
		time.Now().UTC(), userID,
	)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}

type apiKeyScanner interface {
	Scan(dest ...any) error
}

func scanAPIKey(scanner apiKeyScanner) (*model.APIKey, error) {
	key := &model.APIKey{}
	var expiresAt, lastUsedAt, revokedAt sql.NullTime
	if err := scanner.Scan(
		&key.ID, &key.UserID, &key.Name, &key.KeyPrefix,
		&expiresAt, &lastUsedAt, &revokedAt, &key.CreatedAt,
	); err != nil {
		return nil, err
	}
	setAPIKeyNullableTimes(key, expiresAt, lastUsedAt, revokedAt)
	return key, nil
}

func setAPIKeyNullableTimes(key *model.APIKey, expiresAt, lastUsedAt, revokedAt sql.NullTime) {
	if expiresAt.Valid {
		key.ExpiresAt = &expiresAt.Time
	}
	if lastUsedAt.Valid {
		key.LastUsedAt = &lastUsedAt.Time
	}
	if revokedAt.Valid {
		key.RevokedAt = &revokedAt.Time
	}
}

func parseAPIKeyToken(token string) (string, bool) {
	if !strings.HasPrefix(token, APIKeyTokenPrefix) || strings.TrimSpace(token) != token {
		return "", false
	}
	parts := strings.SplitN(strings.TrimPrefix(token, APIKeyTokenPrefix), "_", 2)
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return "", false
	}
	if _, err := uuid.Parse(parts[0]); err != nil {
		return "", false
	}
	if secret, err := base64.RawURLEncoding.DecodeString(parts[1]); err != nil || len(secret) != 32 {
		return "", false
	}
	return parts[0], true
}

func hashAPIKey(token string) string {
	digest := sha256.Sum256([]byte(token))
	return hex.EncodeToString(digest[:])
}

func markAPIKeyUsed(keyID string, now time.Time) (*time.Time, error) {
	apiKeyUseMu.Lock()
	lastUpdate := apiKeyLastUses[keyID]
	if !lastUpdate.IsZero() && now.Sub(lastUpdate) < apiKeyLastUsedUpdateInterval {
		apiKeyUseMu.Unlock()
		return nil, nil
	}
	apiKeyLastUses[keyID] = now
	apiKeyUseMu.Unlock()

	if _, err := db.Exec(`UPDATE "ApiKey" SET "lastUsedAt" = ? WHERE "id" = ?`, now, keyID); err != nil {
		apiKeyUseMu.Lock()
		delete(apiKeyLastUses, keyID)
		apiKeyUseMu.Unlock()
		return nil, err
	}
	return &now, nil
}
