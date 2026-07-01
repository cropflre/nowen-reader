package store

import (
	"testing"

	"github.com/nowen-reader/nowen-reader/internal/model"
)

// helper: 创建测试用户
func createTestUser(t *testing.T, id, username, role string) {
	t.Helper()
	err := CreateUser(&model.User{
		ID:       id,
		Username: username,
		Password: "hashed",
		Role:     role,
	})
	if err != nil {
		t.Fatalf("CreateUser(%s) failed: %v", id, err)
	}
}

// helper: 创建测试书库
func createTestLibrary(t *testing.T, id, name, defaultAccess string, enabled bool) {
	t.Helper()
	lib := &model.Library{
		ID:            id,
		Name:          name,
		Type:          "comic",
		RootPath:      "/test/" + id,
		Enabled:       enabled,
		DefaultAccess: defaultAccess,
		ScanEnabled:   true,
	}
	err := CreateLibrary(lib)
	if err != nil {
		t.Fatalf("CreateLibrary(%s) failed: %v", id, err)
	}
}

// helper: 创建测试漫画并关联书库
func createTestComicWithLibrary(t *testing.T, id, filename, title, libraryID string) {
	t.Helper()
	err := BulkCreateComics([]struct {
		ID       string
		Filename string
		Title    string
		FileSize int64
	}{
		{id, filename, title, 1000},
	})
	if err != nil {
		t.Fatalf("BulkCreateComics(%s) failed: %v", id, err)
	}
	// 设置 libraryId
	_, err = db.Exec(`UPDATE "Comic" SET "libraryId" = ? WHERE "id" = ?`, libraryID, id)
	if err != nil {
		t.Fatalf("Set comic libraryId failed: %v", err)
	}
}

// ============================================================
// TestUserCanViewLibrary_AdminAccess
// ============================================================
func TestUserCanViewLibrary_AdminAccess(t *testing.T) {
	setupTestDB(t)
	if err := RunMigrations(); err != nil {
		t.Fatalf("RunMigrations failed: %v", err)
	}

	createTestUser(t, "admin-1", "admin", "admin")
	createTestLibrary(t, "lib-enabled", "Enabled Lib", "private", true)
	createTestLibrary(t, "lib-disabled", "Disabled Lib", "public", false)
	defer DeleteLibrary("lib-enabled")
	defer DeleteLibrary("lib-disabled")

	// Admin 可访问 enabled 书库
	ok, err := UserCanViewLibrary("admin-1", "lib-enabled")
	if err != nil {
		t.Fatalf("UserCanViewLibrary failed: %v", err)
	}
	if !ok {
		t.Error("Admin should access enabled library")
	}

	// Admin 不能访问 disabled 书库
	ok, err = UserCanViewLibrary("admin-1", "lib-disabled")
	if err != nil {
		t.Fatalf("UserCanViewLibrary failed: %v", err)
	}
	if ok {
		t.Error("Admin should NOT access disabled library")
	}
}

// ============================================================
// TestUserCanViewLibrary_PublicAccess
// ============================================================
func TestUserCanViewLibrary_PublicAccess(t *testing.T) {
	setupTestDB(t)
	if err := RunMigrations(); err != nil {
		t.Fatalf("RunMigrations failed: %v", err)
	}

	createTestUser(t, "user-1", "normaluser", "user")
	createTestLibrary(t, "lib-public", "Public Lib", "public", true)
	createTestLibrary(t, "lib-private", "Private Lib", "private", true)
	defer DeleteLibrary("lib-public")
	defer DeleteLibrary("lib-private")

	// 普通用户可访问 public enabled 书库
	ok, err := UserCanViewLibrary("user-1", "lib-public")
	if err != nil {
		t.Fatalf("UserCanViewLibrary failed: %v", err)
	}
	if !ok {
		t.Error("Normal user should access public library")
	}

	// 普通用户不能访问 private 书库（无授权）
	ok, err = UserCanViewLibrary("user-1", "lib-private")
	if err != nil {
		t.Fatalf("UserCanViewLibrary failed: %v", err)
	}
	if ok {
		t.Error("Normal user should NOT access private library without grant")
	}
}

// ============================================================
// TestUserCanViewLibrary_DirectAccess
// ============================================================
func TestUserCanViewLibrary_DirectAccess(t *testing.T) {
	setupTestDB(t)
	if err := RunMigrations(); err != nil {
		t.Fatalf("RunMigrations failed: %v", err)
	}

	createTestUser(t, "user-2", "directuser", "user")
	createTestLibrary(t, "lib-direct", "Direct Lib", "private", true)
	defer DeleteLibrary("lib-direct")

	// 授权前不能访问
	ok, err := UserCanViewLibrary("user-2", "lib-direct")
	if err != nil {
		t.Fatalf("UserCanViewLibrary failed: %v", err)
	}
	if ok {
		t.Error("User should NOT access private library before grant")
	}

	// 直接授权
	err = SetUserLibraryAccess("user-2", []LibraryAccessReq{{LibraryID: "lib-direct", CanView: true}})
	if err != nil {
		t.Fatalf("SetUserLibraryAccess failed: %v", err)
	}

	// 授权后可以访问
	ok, err = UserCanViewLibrary("user-2", "lib-direct")
	if err != nil {
		t.Fatalf("UserCanViewLibrary failed: %v", err)
	}
	if !ok {
		t.Error("User should access private library after direct grant")
	}
}

// ============================================================
// TestUserCanViewLibrary_GroupAccess
// ============================================================
func TestUserCanViewLibrary_GroupAccess(t *testing.T) {
	setupTestDB(t)
	if err := RunMigrations(); err != nil {
		t.Fatalf("RunMigrations failed: %v", err)
	}

	createTestUser(t, "user-3", "groupuser", "user")
	createTestLibrary(t, "lib-group", "Group Lib", "private", true)
	defer DeleteLibrary("lib-group")

	// 创建用户组
	group := &model.UserGroup{
		ID:   "test-group-1",
		Name: "Test Group",
	}
	err := CreateUserGroup(group)
	if err != nil {
		t.Fatalf("CreateUserGroup failed: %v", err)
	}

	// 添加用户到组
	err = SetGroupMembers("test-group-1", []string{"user-3"})
	if err != nil {
		t.Fatalf("SetGroupMembers failed: %v", err)
	}

	// 组授权前不能访问
	ok, err := UserCanViewLibrary("user-3", "lib-group")
	if err != nil {
		t.Fatalf("UserCanViewLibrary failed: %v", err)
	}
	if ok {
		t.Error("User should NOT access library before group grant")
	}

	// 设置组的书库权限
	err = SetGroupLibraryAccess("test-group-1", []string{"lib-group"})
	if err != nil {
		t.Fatalf("SetGroupLibraryAccess failed: %v", err)
	}

	// 组授权后可以访问
	ok, err = UserCanViewLibrary("user-3", "lib-group")
	if err != nil {
		t.Fatalf("UserCanViewLibrary failed: %v", err)
	}
	if !ok {
		t.Error("User should access library via group grant")
	}
}

// ============================================================
// TestUserCanViewLibrary_DisabledLibrary
// ============================================================
func TestUserCanViewLibrary_DisabledLibrary(t *testing.T) {
	setupTestDB(t)
	if err := RunMigrations(); err != nil {
		t.Fatalf("RunMigrations failed: %v", err)
	}

	createTestUser(t, "user-4", "disableduser", "user")
	createTestLibrary(t, "lib-disabled-2", "Disabled Lib", "public", false)
	defer DeleteLibrary("lib-disabled-2")

	// 即使是 public，disabled 书库普通用户也不能访问
	ok, err := UserCanViewLibrary("user-4", "lib-disabled-2")
	if err != nil {
		t.Fatalf("UserCanViewLibrary failed: %v", err)
	}
	if ok {
		t.Error("User should NOT access disabled public library")
	}

	// 直接授权也不能访问 disabled 书库
	err = SetUserLibraryAccess("user-4", []LibraryAccessReq{{LibraryID: "lib-disabled-2", CanView: true}})
	if err != nil {
		t.Fatalf("SetUserLibraryAccess failed: %v", err)
	}
	ok, err = UserCanViewLibrary("user-4", "lib-disabled-2")
	if err != nil {
		t.Fatalf("UserCanViewLibrary failed: %v", err)
	}
	if ok {
		t.Error("User should NOT access disabled library even with direct grant")
	}
}

// ============================================================
// TestUserCanViewComic
// ============================================================
func TestUserCanViewComic(t *testing.T) {
	setupTestDB(t)
	if err := RunMigrations(); err != nil {
		t.Fatalf("RunMigrations failed: %v", err)
	}

	createTestUser(t, "user-5", "comicuser", "user")
	createTestLibrary(t, "lib-comic-a", "Comic Lib A", "public", true)
	createTestLibrary(t, "lib-comic-b", "Comic Lib B", "private", true)
	defer DeleteLibrary("lib-comic-a")
	defer DeleteLibrary("lib-comic-b")

	createTestComicWithLibrary(t, "comic-a1", "a1.cbz", "Comic A1", "lib-comic-a")
	createTestComicWithLibrary(t, "comic-b1", "b1.cbz", "Comic B1", "lib-comic-b")

	// 普通用户可访问 public 书库的漫画
	ok, err := UserCanViewComic("user-5", "comic-a1")
	if err != nil {
		t.Fatalf("UserCanViewComic failed: %v", err)
	}
	if !ok {
		t.Error("User should access comic in public library")
	}

	// 普通用户不能访问 private 书库的漫画
	ok, err = UserCanViewComic("user-5", "comic-b1")
	if err != nil {
		t.Fatalf("UserCanViewComic failed: %v", err)
	}
	if ok {
		t.Error("User should NOT access comic in private library")
	}

	// 授权后可以访问
	err = SetUserLibraryAccess("user-5", []LibraryAccessReq{{LibraryID: "lib-comic-b", CanView: true}})
	if err != nil {
		t.Fatalf("SetUserLibraryAccess failed: %v", err)
	}
	ok, err = UserCanViewComic("user-5", "comic-b1")
	if err != nil {
		t.Fatalf("UserCanViewComic failed: %v", err)
	}
	if !ok {
		t.Error("User should access comic in private library after grant")
	}
}

// ============================================================
// TestUserCanViewComic_NoLibrary
// ============================================================
func TestUserCanViewComic_NoLibrary(t *testing.T) {
	setupTestDB(t)
	if err := RunMigrations(); err != nil {
		t.Fatalf("RunMigrations failed: %v", err)
	}

	createTestUser(t, "user-6", "nolibuser", "user")
	createTestUser(t, "admin-legacy", "legacyadmin", "admin")

	// 创建没有 libraryId 的漫画（旧数据兼容）
	err := BulkCreateComics([]struct {
		ID       string
		Filename string
		Title    string
		FileSize int64
	}{
		{"comic-nolib", "nolib.cbz", "No Lib Comic", 1000},
	})
	if err != nil {
		t.Fatalf("BulkCreateComics failed: %v", err)
	}

	// 没有 libraryId 的旧数据不能向普通用户默认放行
	ok, err := UserCanViewComic("user-6", "comic-nolib")
	if err != nil {
		t.Fatalf("UserCanViewComic failed: %v", err)
	}
	if ok {
		t.Error("Normal user should NOT access comic without libraryId")
	}

	// 管理员保留处理旧数据的入口
	ok, err = UserCanViewComic("admin-legacy", "comic-nolib")
	if err != nil {
		t.Fatalf("UserCanViewComic(admin) failed: %v", err)
	}
	if !ok {
		t.Error("Admin should access comic without libraryId for cleanup")
	}
}

func TestUserCanViewComic_MissingLibraryDeniedToNormalUser(t *testing.T) {
	setupTestDB(t)
	if err := RunMigrations(); err != nil {
		t.Fatalf("RunMigrations failed: %v", err)
	}

	createTestUser(t, "user-missing-lib", "missinglibuser", "user")
	createTestUser(t, "admin-missing-lib", "missinglibadmin", "admin")
	createTestComicWithLibrary(t, "comic-missing-lib", "missing-lib.cbz", "Missing Lib Comic", "deleted-lib")

	ok, err := UserCanViewComic("user-missing-lib", "comic-missing-lib")
	if err != nil {
		t.Fatalf("UserCanViewComic failed: %v", err)
	}
	if ok {
		t.Error("Normal user should NOT access comic whose library no longer exists")
	}

	ok, err = UserCanViewComic("admin-missing-lib", "comic-missing-lib")
	if err != nil {
		t.Fatalf("UserCanViewComic(admin) failed: %v", err)
	}
	if !ok {
		t.Error("Admin should access comic with missing library for cleanup")
	}
}

func TestLibraryAccessPermissionImplication(t *testing.T) {
	setupTestDB(t)
	if err := RunMigrations(); err != nil {
		t.Fatalf("RunMigrations failed: %v", err)
	}

	createTestUser(t, "user-implied-view", "impliedview", "user")
	createTestLibrary(t, "lib-implied-view", "Implied View", "private", true)

	if err := SetUserLibraryAccess("user-implied-view", []LibraryAccessReq{{
		LibraryID: "lib-implied-view",
		CanManage: true,
	}}); err != nil {
		t.Fatalf("SetUserLibraryAccess failed: %v", err)
	}

	userAccess, err := GetUserLibraryAccess("user-implied-view")
	if err != nil {
		t.Fatalf("GetUserLibraryAccess failed: %v", err)
	}
	if len(userAccess) != 1 || !userAccess[0].CanView || !userAccess[0].CanManage {
		t.Fatalf("manage permission should imply view, got %+v", userAccess)
	}

	group := &model.UserGroup{
		ID:   "group-implied-view",
		Name: "Group Implied View",
	}
	if err := CreateUserGroup(group); err != nil {
		t.Fatalf("CreateUserGroup failed: %v", err)
	}
	if err := SetGroupLibraryAccessFull("group-implied-view", []GroupLibraryPermission{{
		LibraryID:   "lib-implied-view",
		CanDownload: true,
	}}); err != nil {
		t.Fatalf("SetGroupLibraryAccessFull failed: %v", err)
	}

	groupAccess, err := GetGroupLibraryAccess("group-implied-view")
	if err != nil {
		t.Fatalf("GetGroupLibraryAccess failed: %v", err)
	}
	if len(groupAccess) != 1 || !groupAccess[0].CanView || !groupAccess[0].CanDownload {
		t.Fatalf("download permission should imply view, got %+v", groupAccess)
	}
}

// ============================================================
// TestGetUserAccessibleLibraryIDs
// ============================================================
func TestGetUserAccessibleLibraryIDs(t *testing.T) {
	setupTestDB(t)
	if err := RunMigrations(); err != nil {
		t.Fatalf("RunMigrations failed: %v", err)
	}

	createTestUser(t, "admin-2", "admin2", "admin")
	createTestUser(t, "user-7", "accessuser", "user")

	createTestLibrary(t, "lib-acc-pub", "Public", "public", true)
	createTestLibrary(t, "lib-acc-pri", "Private", "private", true)
	createTestLibrary(t, "lib-acc-dis", "Disabled", "public", false)
	defer DeleteLibrary("lib-acc-pub")
	defer DeleteLibrary("lib-acc-pri")
	defer DeleteLibrary("lib-acc-dis")

	// 管理员看到所有 enabled 书库
	adminIDs, err := GetUserAccessibleLibraryIDs("admin-2")
	if err != nil {
		t.Fatalf("GetUserAccessibleLibraryIDs(admin) failed: %v", err)
	}
	adminMap := make(map[string]bool)
	for _, id := range adminIDs {
		adminMap[id] = true
	}
	if !adminMap["lib-acc-pub"] || !adminMap["lib-acc-pri"] {
		t.Error("Admin should see all enabled libraries")
	}
	if adminMap["lib-acc-dis"] {
		t.Error("Admin should NOT see disabled libraries")
	}

	// 普通用户只看到 public
	userIDs, err := GetUserAccessibleLibraryIDs("user-7")
	if err != nil {
		t.Fatalf("GetUserAccessibleLibraryIDs(user) failed: %v", err)
	}
	userMap := make(map[string]bool)
	for _, id := range userIDs {
		userMap[id] = true
	}
	if !userMap["lib-acc-pub"] {
		t.Error("User should see public library")
	}
	if userMap["lib-acc-pri"] {
		t.Error("User should NOT see private library without grant")
	}
	if userMap["lib-acc-dis"] {
		t.Error("User should NOT see disabled library")
	}

	// 授权后可以看到 private
	err = SetUserLibraryAccess("user-7", []LibraryAccessReq{{LibraryID: "lib-acc-pri", CanView: true}})
	if err != nil {
		t.Fatalf("SetUserLibraryAccess failed: %v", err)
	}
	userIDs, _ = GetUserAccessibleLibraryIDs("user-7")
	userMap = make(map[string]bool)
	for _, id := range userIDs {
		userMap[id] = true
	}
	if !userMap["lib-acc-pri"] {
		t.Error("User should see private library after direct grant")
	}
}
