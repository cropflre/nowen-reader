package store

import (
	"database/sql"
	"fmt"
	"time"

	"path/filepath"

	"github.com/nowen-reader/nowen-reader/internal/model"
)

// ============================================================
// Library CRUD Operations
// ============================================================

// GetAllLibraries 获取所有书库
func GetAllLibraries() ([]model.Library, error) {
	rows, err := db.Query(`SELECT "id", "name", "type", "rootPath", "enabled", "sortOrder", COALESCE("defaultAccess", "private"), "lastScanAt", "lastScanAdded", "lastScanTotal", "scanEnabled", "createdAt", "updatedAt" FROM "Library" ORDER BY "sortOrder", "name"`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var libraries []model.Library
	for rows.Next() {
		var lib model.Library
		var createdAt, updatedAt time.Time
		if err := rows.Scan(&lib.ID, &lib.Name, &lib.Type, &lib.RootPath, &lib.Enabled, &lib.SortOrder, &lib.DefaultAccess, &lib.LastScanAt, &lib.LastScanAdded, &lib.LastScanTotal, &lib.ScanEnabled, &createdAt, &updatedAt); err != nil {
			continue
		}
		lib.CreatedAt = createdAt
		lib.UpdatedAt = updatedAt
		libraries = append(libraries, lib)
	}
	return libraries, nil
}

// GetLibraryByID 根据ID获取书库
func GetLibraryByID(id string) (*model.Library, error) {
	var lib model.Library
	var createdAt, updatedAt time.Time
	err := db.QueryRow(`SELECT "id", "name", "type", "rootPath", "enabled", "sortOrder", COALESCE("defaultAccess", "private"), "lastScanAt", "lastScanAdded", "lastScanTotal", "scanEnabled", "createdAt", "updatedAt" FROM "Library" WHERE "id" = ?`, id).Scan(
		&lib.ID, &lib.Name, &lib.Type, &lib.RootPath, &lib.Enabled, &lib.SortOrder, &lib.DefaultAccess, &lib.LastScanAt, &lib.LastScanAdded, &lib.LastScanTotal, &lib.ScanEnabled, &createdAt, &updatedAt,
	)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	lib.CreatedAt = createdAt
	lib.UpdatedAt = updatedAt
	return &lib, nil
}

// CreateLibrary 创建新书库
func CreateLibrary(lib *model.Library) error {
	if lib.ID == "" {
		lib.ID = fmt.Sprintf("lib_%d", time.Now().UnixNano())
	}
	now := time.Now().UTC()
	lib.CreatedAt = now
	lib.UpdatedAt = now

	_, err := db.Exec(`INSERT INTO "Library" ("id", "name", "type", "rootPath", "enabled", "sortOrder", "defaultAccess", "lastScanAt", "lastScanAdded", "lastScanTotal", "scanEnabled", "createdAt", "updatedAt")
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		lib.ID, lib.Name, lib.Type, lib.RootPath, lib.Enabled, lib.SortOrder, lib.DefaultAccess, lib.LastScanAt, lib.LastScanAdded, lib.LastScanTotal, lib.ScanEnabled, lib.CreatedAt, lib.UpdatedAt)
	return err
}

// UpdateLibrary 更新书库信息
func UpdateLibrary(lib *model.Library) error {
	lib.UpdatedAt = time.Now().UTC()
	_, err := db.Exec(`UPDATE "Library" SET "name" = ?, "type" = ?, "rootPath" = ?, "enabled" = ?, "sortOrder" = ?, "defaultAccess" = ?, "lastScanAt" = ?, "lastScanAdded" = ?, "lastScanTotal" = ?, "scanEnabled" = ?, "updatedAt" = ?
		WHERE "id" = ?`,
		lib.Name, lib.Type, lib.RootPath, lib.Enabled, lib.SortOrder, lib.DefaultAccess, lib.LastScanAt, lib.LastScanAdded, lib.LastScanTotal, lib.ScanEnabled, lib.UpdatedAt, lib.ID)
	return err
}

// UpdateLibraryScanStatus 更新书库的扫描状态信息
func UpdateLibraryScanStatus(libraryID string, added int, total int) error {
	_, err := db.Exec(`UPDATE "Library" SET "lastScanAt" = CURRENT_TIMESTAMP, "lastScanAdded" = ?, "lastScanTotal" = ?, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = ?`,
		added, total, libraryID)
	return err
}

// DeleteLibrary 删除书库
func DeleteLibrary(id string) error {
	// 首先检查是否有漫画关联到此书库
	var count int
	err := db.QueryRow(`SELECT COUNT(*) FROM "Comic" WHERE "libraryId" = ?`, id).Scan(&count)
	if err != nil {
		return err
	}
	if count > 0 {
		return fmt.Errorf("cannot delete library with %d comics. Move or delete comics first", count)
	}

	// 删除书库（级联删除 UserLibraryAccess）
	_, err = db.Exec(`DELETE FROM "Library" WHERE "id" = ?`, id)
	return err
}

// ============================================================
// FindOrCreateLibrary 根据rootPath查找书库，不存在则自动创建。
// 用于扫描器自动为每个扫描目录创建对应的书库。
func FindOrCreateLibrary(rootPath string, libType string) (*model.Library, error) {
	// 先按rootPath查找
	var lib model.Library
	err := db.QueryRow(`SELECT "id", "name", "type", "rootPath", "enabled", "sortOrder", COALESCE("defaultAccess", "private"), "lastScanAt", "lastScanAdded", "lastScanTotal", "scanEnabled", "createdAt", "updatedAt" FROM "Library" WHERE "rootPath" = ?`, rootPath).Scan(
		&lib.ID, &lib.Name, &lib.Type, &lib.RootPath, &lib.Enabled, &lib.SortOrder, &lib.DefaultAccess, &lib.LastScanAt, &lib.LastScanAdded, &lib.LastScanTotal, &lib.ScanEnabled, &lib.CreatedAt, &lib.UpdatedAt)
	if err == nil {
		return &lib, nil
	}
	if err != sql.ErrNoRows {
		return nil, err
	}

	// 不存在，自动创建
	name := filepath.Base(rootPath)
	if name == "" || name == "." || name == "/" {
		name = rootPath
	}
	lib = model.Library{
		ID:            fmt.Sprintf("lib_%d", time.Now().UnixNano()),
		Name:          name,
		Type:          libType,
		RootPath:      rootPath,
		Enabled:       true,
		DefaultAccess: "private",
		ScanEnabled:   true,
	}
	if err := CreateLibrary(&lib); err != nil {
		return nil, err
	}
	return &lib, nil
}

// UserLibraryAccess CRUD
// ============================================================

// GetUserLibraryAccess 获取用户的所有书库访问权限
func GetUserLibraryAccess(userID string) ([]model.UserLibraryAccess, error) {
	rows, err := db.Query(`SELECT "userId", "libraryId", "canView", "canDownload", "canManage", "createdAt"
		FROM "UserLibraryAccess" WHERE "userId" = ?`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var accesses []model.UserLibraryAccess
	for rows.Next() {
		var access model.UserLibraryAccess
		var createdAt time.Time
		if err := rows.Scan(&access.UserID, &access.LibraryID, &access.CanView, &access.CanDownload, &access.CanManage, &createdAt); err != nil {
			continue
		}
		access.CreatedAt = createdAt
		accesses = append(accesses, access)
	}
	return accesses, nil
}

// GetUserAccessibleLibraryIDs 获取用户可访问的书库ID列表
func GetUserAccessibleLibraryIDs(userID string) ([]string, error) {
	// 首先检查用户是否是管理员
	var role string
	err := db.QueryRow(`SELECT "role" FROM "User" WHERE "id" = ?`, userID).Scan(&role)
	if err != nil {
		return nil, err
	}

	// 管理员可以访问所有书库
	if role == "admin" {
		var ids []string
		rows, err := db.Query(`SELECT "id" FROM "Library" WHERE "enabled" = 1`)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err == nil {
				ids = append(ids, id)
			}
		}
		return ids, nil
	}

	// 普通用户可以访问：公开书库 + 直接授权 + 用户组继承
	rows, err := db.Query(`SELECT DISTINCT "id" FROM "Library" WHERE "enabled" = 1 AND (
		"defaultAccess" = 'public'
		OR "id" IN (SELECT "libraryId" FROM "UserLibraryAccess" WHERE "userId" = ? AND "canView" = 1)
		OR "id" IN (
			SELECT gla."libraryId" FROM "GroupLibraryAccess" gla
			JOIN "UserGroupMember" ugm ON ugm."groupId" = gla."groupId"
			WHERE ugm."userId" = ? AND gla."canView" = 1
		)
	)`, userID, userID)
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err == nil {
			ids = append(ids, id)
		}
	}
	return ids, nil
}

// SetUserLibraryAccess 设置用户的书库访问权限
func SetUserLibraryAccess(userID string, libraryIDs []string) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// 删除现有权限
	_, err = tx.Exec(`DELETE FROM "UserLibraryAccess" WHERE "userId" = ?`, userID)
	if err != nil {
		return err
	}

	// 插入新权限
	stmt, err := tx.Prepare(`INSERT INTO "UserLibraryAccess" ("userId", "libraryId", "canView", "createdAt") VALUES (?, ?, 1, ?)`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	now := time.Now().UTC()
	for _, libID := range libraryIDs {
		if _, err := stmt.Exec(userID, libID, now); err != nil {
			return err
		}
	}

	return tx.Commit()
}

// UserCanViewLibrary 检查用户是否有权访问指定书库。
// 语义与 GetUserAccessibleLibraryIDs 完全一致：
//   - admin 可访问所有 enabled 书库
//   - enabled=0 的书库普通用户不可访问
//   - defaultAccess='public' 的 enabled 书库普通用户可访问
//   - UserLibraryAccess.canView=1 可访问
//   - 用户所在 UserGroup 的 GroupLibraryAccess.canView=1 可访问
func UserCanViewLibrary(userID, libraryID string) (bool, error) {
	// 管理员可以访问所有 enabled 书库
	var role string
	err := db.QueryRow(`SELECT "role" FROM "User" WHERE "id" = ?`, userID).Scan(&role)
	if err != nil {
		return false, err
	}
	if role == "admin" {
		var enabled bool
		err := db.QueryRow(`SELECT "enabled" FROM "Library" WHERE "id" = ?`, libraryID).Scan(&enabled)
		if err == sql.ErrNoRows {
			return false, nil
		}
		if err != nil {
			return false, err
		}
		return enabled, nil
	}

	// 普通用户：检查书库是否 enabled 且满足任一授权条件
	var count int
	err = db.QueryRow(`SELECT COUNT(*) FROM "Library" WHERE "id" = ? AND "enabled" = 1 AND (
		"defaultAccess" = 'public'
		OR "id" IN (SELECT "libraryId" FROM "UserLibraryAccess" WHERE "userId" = ? AND "canView" = 1)
		OR "id" IN (
			SELECT gla."libraryId" FROM "GroupLibraryAccess" gla
			JOIN "UserGroupMember" ugm ON ugm."groupId" = gla."groupId"
			WHERE ugm."userId" = ? AND gla."canView" = 1
		)
	)`, libraryID, userID, userID).Scan(&count)
	if err != nil {
		return false, err
	}
	return count > 0, nil
}

// UserCanViewComic 检查用户是否有权访问指定漫画
func UserCanViewComic(userID, comicID string) (bool, error) {
	// 获取漫画的书库ID
	var libraryID string
	err := db.QueryRow(`SELECT "libraryId" FROM "Comic" WHERE "id" = ?`, comicID).Scan(&libraryID)
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, err
	}

	// 如果漫画没有书库ID（旧数据），默认允许访问
	if libraryID == "" {
		return true, nil
	}

	return UserCanViewLibrary(userID, libraryID)
}

// GetLibraryComicCount 获取书库中的漫画数量
func GetLibraryComicCount(libraryID string) (int, error) {
	var count int
	err := db.QueryRow(`SELECT COUNT(*) FROM "Comic" WHERE "libraryId" = ?`, libraryID).Scan(&count)
	return count, err
}
