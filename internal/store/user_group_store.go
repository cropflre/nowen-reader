package store

import (
	"database/sql"
	"fmt"
	"time"

	"github.com/nowen-reader/nowen-reader/internal/model"
)

// ============================================================
// UserGroup CRUD Operations
// ============================================================

// GetAllUserGroups 获取所有用户组（包含成员数量）
func GetAllUserGroups() ([]model.UserGroup, error) {
	rows, err := db.Query(`
		SELECT g."id", g."name", g."description", g."createdAt", g."updatedAt",
		       COUNT(m."userId") AS memberCount
		FROM "UserGroup" g
		LEFT JOIN "UserGroupMember" m ON m."groupId" = g."id"
		GROUP BY g."id"
		ORDER BY g."name" ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var groups []model.UserGroup
	for rows.Next() {
		var g model.UserGroup
		if err := rows.Scan(&g.ID, &g.Name, &g.Description, &g.CreatedAt, &g.UpdatedAt, &g.MemberCount); err != nil {
			continue
		}
		groups = append(groups, g)
	}
	return groups, nil
}

// GetUserGroupByID 根据ID获取用户组
func GetUserGroupByID(id string) (*model.UserGroup, error) {
	var g model.UserGroup
	err := db.QueryRow(`
		SELECT "id", "name", "description", "createdAt", "updatedAt"
		FROM "UserGroup" WHERE "id" = ?
	`, id).Scan(&g.ID, &g.Name, &g.Description, &g.CreatedAt, &g.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &g, nil
}

// CreateUserGroup 创建新用户组
func CreateUserGroup(g *model.UserGroup) error {
	if g.ID == "" {
		g.ID = fmt.Sprintf("group_%d", time.Now().UnixNano())
	}
	now := time.Now().UTC()
	g.CreatedAt = now
	g.UpdatedAt = now

	_, err := db.Exec(`
		INSERT INTO "UserGroup" ("id", "name", "description", "createdAt", "updatedAt")
		VALUES (?, ?, ?, ?, ?)
	`, g.ID, g.Name, g.Description, g.CreatedAt, g.UpdatedAt)
	return err
}

// UpdateUserGroup 更新用户组信息
func UpdateUserGroup(g *model.UserGroup) error {
	g.UpdatedAt = time.Now().UTC()
	_, err := db.Exec(`
		UPDATE "UserGroup" SET "name" = ?, "description" = ?, "updatedAt" = ?
		WHERE "id" = ?
	`, g.Name, g.Description, g.UpdatedAt, g.ID)
	return err
}

// DeleteUserGroup 删除用户组（级联删除成员和书库权限）
func DeleteUserGroup(id string) error {
	_, err := db.Exec(`DELETE FROM "UserGroup" WHERE "id" = ?`, id)
	return err
}

// ============================================================
// UserGroupMember Operations
// ============================================================

// GetGroupMembers 获取用户组的所有成员
func GetGroupMembers(groupID string) ([]model.AuthUser, error) {
	rows, err := db.Query(`
		SELECT u."id", u."username", u."nickname", u."role", u."aiEnabled"
		FROM "User" u
		JOIN "UserGroupMember" m ON m."userId" = u."id"
		WHERE m."groupId" = ?
		ORDER BY u."username" ASC
	`, groupID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var users []model.AuthUser
	for rows.Next() {
		var u model.AuthUser
		if err := rows.Scan(&u.ID, &u.Username, &u.Nickname, &u.Role, &u.AiEnabled); err != nil {
			continue
		}
		users = append(users, u)
	}
	return users, nil
}

// SetGroupMembers 设置用户组的成员（替换全部）
func SetGroupMembers(groupID string, userIDs []string) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// 删除现有成员
	if _, err := tx.Exec(`DELETE FROM "UserGroupMember" WHERE "groupId" = ?`, groupID); err != nil {
		return err
	}

	// 插入新成员
	stmt, err := tx.Prepare(`INSERT INTO "UserGroupMember" ("groupId", "userId", "createdAt") VALUES (?, ?, ?)`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	now := time.Now().UTC()
	for _, uid := range userIDs {
		if _, err := stmt.Exec(groupID, uid, now); err != nil {
			return err
		}
	}

	return tx.Commit()
}

// GetUserGroups 获取用户所属的所有用户组
func GetUserGroups(userID string) ([]model.UserGroup, error) {
	rows, err := db.Query(`
		SELECT g."id", g."name", g."description", g."createdAt", g."updatedAt"
		FROM "UserGroup" g
		JOIN "UserGroupMember" m ON m."groupId" = g."id"
		WHERE m."userId" = ?
		ORDER BY g."name" ASC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var groups []model.UserGroup
	for rows.Next() {
		var g model.UserGroup
		if err := rows.Scan(&g.ID, &g.Name, &g.Description, &g.CreatedAt, &g.UpdatedAt); err != nil {
			continue
		}
		groups = append(groups, g)
	}
	return groups, nil
}

// ============================================================
// GroupLibraryAccess Operations
// ============================================================

// GetGroupLibraryAccess 获取用户组的书库权限列表
func GetGroupLibraryAccess(groupID string) ([]model.GroupLibraryAccess, error) {
	rows, err := db.Query(`
		SELECT "groupId", "libraryId", "canView", "canDownload", "canManage", "createdAt"
		FROM "GroupLibraryAccess"
		WHERE "groupId" = ?
	`, groupID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var accesses []model.GroupLibraryAccess
	for rows.Next() {
		var a model.GroupLibraryAccess
		if err := rows.Scan(&a.GroupID, &a.LibraryID, &a.CanView, &a.CanDownload, &a.CanManage, &a.CreatedAt); err != nil {
			continue
		}
		accesses = append(accesses, a)
	}
	return accesses, nil
}

// SetGroupLibraryAccess 设置用户组的书库权限（替换全部，向后兼容旧接口）。
// 旧接口只传 libraryIDs，全部设置为 canView=true。
func SetGroupLibraryAccess(groupID string, libraryIDs []string) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// 删除现有权限
	if _, err := tx.Exec(`DELETE FROM "GroupLibraryAccess" WHERE "groupId" = ?`, groupID); err != nil {
		return err
	}

	// 插入新权限
	stmt, err := tx.Prepare(`INSERT INTO "GroupLibraryAccess" ("groupId", "libraryId", "canView", "createdAt") VALUES (?, ?, 1, ?)`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	now := time.Now().UTC()
	for _, libID := range libraryIDs {
		if _, err := stmt.Exec(groupID, libID, now); err != nil {
			return err
		}
	}

	return tx.Commit()
}

// GroupLibraryPermission 表示用户组对单个书库的权限。
type GroupLibraryPermission struct {
	LibraryID   string
	CanView     bool
	CanDownload bool
	CanManage   bool
}

// SetGroupLibraryAccessFull 设置用户组的书库权限（支持三列权限矩阵）。
// 替换指定用户组的所有书库权限。
func SetGroupLibraryAccessFull(groupID string, permissions []GroupLibraryPermission) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// 删除现有权限
	if _, err := tx.Exec(`DELETE FROM "GroupLibraryAccess" WHERE "groupId" = ?`, groupID); err != nil {
		return err
	}

	// 插入新权限
	stmt, err := tx.Prepare(`INSERT INTO "GroupLibraryAccess" ("groupId", "libraryId", "canView", "canDownload", "canManage", "createdAt") VALUES (?, ?, ?, ?, ?, ?)`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	now := time.Now().UTC()
	for _, p := range permissions {
		if _, err := stmt.Exec(groupID, p.LibraryID, p.CanView, p.CanDownload, p.CanManage, now); err != nil {
			return err
		}
	}

	return tx.Commit()
}

// GetUserAccessibleLibraryIDsV2 获取用户可访问的书库ID列表（支持用户组继承）。
// 返回的 ID 列表合并了：直接分配 + 用户组继承。
// 管理员始终返回所有启用书库。
func GetUserAccessibleLibraryIDsV2(userID string) ([]string, error) {
	// 管理员可以访问所有书库
	var role string
	err := db.QueryRow(`SELECT "role" FROM "User" WHERE "id" = ?`, userID).Scan(&role)
	if err != nil {
		return nil, err
	}
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

	// 合并直接分配 + 用户组继承的书库ID
	idSet := make(map[string]bool)

	// 1. 直接分配
	rows, err := db.Query(`SELECT "libraryId" FROM "UserLibraryAccess" WHERE "userId" = ? AND "canView" = 1`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err == nil {
			idSet[id] = true
		}
	}

	// 2. 用户组继承
	rows2, err := db.Query(`
		SELECT DISTINCT gla."libraryId"
		FROM "GroupLibraryAccess" gla
		JOIN "UserGroupMember" ugm ON ugm."groupId" = gla."groupId"
		WHERE ugm."userId" = ? AND gla."canView" = 1
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows2.Close()
	for rows2.Next() {
		var id string
		if err := rows2.Scan(&id); err == nil {
			idSet[id] = true
		}
	}

	ids := make([]string, 0, len(idSet))
	for id := range idSet {
		ids = append(ids, id)
	}
	return ids, nil
}
