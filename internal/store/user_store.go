package store

import (
	"database/sql"
	"time"

	"github.com/nowen-reader/nowen-reader/internal/model"
)

// CreateUser inserts a new user into the database.
func CreateUser(user *model.User) error {
	now := time.Now()
	user.CreatedAt = now
	user.UpdatedAt = now

	_, err := db.Exec(
		`INSERT INTO "User" ("id", "username", "password", "nickname", "role", "createdAt", "updatedAt")
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		user.ID, user.Username, user.Password, user.Nickname, user.Role, now, now,
	)
	return err
}

// GetUserByUsername finds a user by username.
func GetUserByUsername(username string) (*model.User, error) {
	user := &model.User{}
	err := db.QueryRow(
		`SELECT "id", "username", "password", "nickname", "role", "createdAt", "updatedAt"
		 FROM "User" WHERE "username" = ?`,
		username,
	).Scan(&user.ID, &user.Username, &user.Password, &user.Nickname, &user.Role, &user.CreatedAt, &user.UpdatedAt)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	return user, err
}

// GetUserByID finds a user by ID.
func GetUserByID(id string) (*model.User, error) {
	user := &model.User{}
	err := db.QueryRow(
		`SELECT "id", "username", "password", "nickname", "role", "createdAt", "updatedAt"
		 FROM "User" WHERE "id" = ?`,
		id,
	).Scan(&user.ID, &user.Username, &user.Password, &user.Nickname, &user.Role, &user.CreatedAt, &user.UpdatedAt)

	if err == sql.ErrNoRows {
		return nil, nil
	}
	return user, err
}

// CountUsers returns the total number of users.
func CountUsers() (int, error) {
	var count int
	err := db.QueryRow(`SELECT COUNT(*) FROM "User"`).Scan(&count)
	return count, err
}

// ListUsers returns all users (without password), ordered by creation time.
func ListUsers() ([]model.AuthUser, error) {
	rows, err := db.Query(
		`SELECT "id", "username", "nickname", "role"
		 FROM "User" ORDER BY "createdAt" ASC`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var users []model.AuthUser
	for rows.Next() {
		var u model.AuthUser
		if err := rows.Scan(&u.ID, &u.Username, &u.Nickname, &u.Role); err != nil {
			return nil, err
		}
		users = append(users, u)
	}
	return users, rows.Err()
}

// UpdateUserPassword updates a user's password hash.
func UpdateUserPassword(userID, hashedPassword string) error {
	_, err := db.Exec(
		`UPDATE "User" SET "password" = ?, "updatedAt" = ? WHERE "id" = ?`,
		hashedPassword, time.Now(), userID,
	)
	return err
}

// UpdateUserProfile updates a user's nickname.
func UpdateUserProfile(userID, nickname string) error {
	_, err := db.Exec(
		`UPDATE "User" SET "nickname" = ?, "updatedAt" = ? WHERE "id" = ?`,
		nickname, time.Now(), userID,
	)
	return err
}

// DeleteUser removes a user by ID (cascade deletes sessions).
func DeleteUser(userID string) error {
	_, err := db.Exec(`DELETE FROM "User" WHERE "id" = ?`, userID)
	return err
}

// ============================================================
// Session operations
// ============================================================

// CreateSession inserts a new user session.
func CreateSession(session *model.UserSession) error {
	_, err := db.Exec(
		`INSERT INTO "UserSession" ("id", "userId", "expiresAt", "createdAt")
		 VALUES (?, ?, ?, ?)`,
		session.ID, session.UserID, session.ExpiresAt, time.Now(),
	)
	return err
}

// GetSessionWithUser retrieves a session and its associated user.
// Returns nil, nil if not found.
func GetSessionWithUser(token string) (*model.UserSession, *model.User, error) {
	session := &model.UserSession{}
	user := &model.User{}

	err := db.QueryRow(
		`SELECT s."id", s."userId", s."expiresAt", s."createdAt",
		        u."id", u."username", u."password", u."nickname", u."role", u."createdAt", u."updatedAt"
		 FROM "UserSession" s
		 JOIN "User" u ON u."id" = s."userId"
		 WHERE s."id" = ?`,
		token,
	).Scan(
		&session.ID, &session.UserID, &session.ExpiresAt, &session.CreatedAt,
		&user.ID, &user.Username, &user.Password, &user.Nickname, &user.Role, &user.CreatedAt, &user.UpdatedAt,
	)

	if err == sql.ErrNoRows {
		return nil, nil, nil
	}
	if err != nil {
		return nil, nil, err
	}
	return session, user, nil
}

// DeleteSession removes a session by token.
func DeleteSession(token string) error {
	_, err := db.Exec(`DELETE FROM "UserSession" WHERE "id" = ?`, token)
	return err
}

// CleanExpiredSessions removes all expired sessions.
func CleanExpiredSessions() (int64, error) {
	result, err := db.Exec(
		`DELETE FROM "UserSession" WHERE "expiresAt" < ?`,
		time.Now(),
	)
	if err != nil {
		return 0, err
	}
	return result.RowsAffected()
}
