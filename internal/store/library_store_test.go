package store

import (
	"testing"

	"github.com/nowen-reader/nowen-reader/internal/model"
)

func TestLibraryCRUD(t *testing.T) {
	setupTestDB(t)
	
	// Run migrations to create tables
	if err := RunMigrations(); err != nil {
		t.Fatalf("RunMigrations failed: %v", err)
	}
	
	// Test Create Library
	lib := &model.Library{
		Name:     "Test Library",
		Type:     "comic",
		RootPath: "/test/path",
		Enabled:  true,
	}
	
	err := CreateLibrary(lib)
	if err != nil {
		t.Fatalf("Failed to create library: %v", err)
	}
	
	if lib.ID == "" {
		t.Fatal("Library ID should not be empty after creation")
	}
	
	// Test Get Library by ID
	fetched, err := GetLibraryByID(lib.ID)
	if err != nil {
		t.Fatalf("Failed to get library: %v", err)
	}
	if fetched == nil {
		t.Fatal("Library should exist")
	}
	if fetched.Name != "Test Library" {
		t.Errorf("Expected name 'Test Library', got '%s'", fetched.Name)
	}
	
	// Test Update Library
	fetched.Name = "Updated Library"
	err = UpdateLibrary(fetched)
	if err != nil {
		t.Fatalf("Failed to update library: %v", err)
	}
	
	updated, err := GetLibraryByID(lib.ID)
	if err != nil {
		t.Fatalf("Failed to get updated library: %v", err)
	}
	if updated.Name != "Updated Library" {
		t.Errorf("Expected name 'Updated Library', got '%s'", updated.Name)
	}
	
	// Test Get All Libraries
	libraries, err := GetAllLibraries()
	if err != nil {
		t.Fatalf("Failed to get all libraries: %v", err)
	}
	if len(libraries) == 0 {
		t.Fatal("Should have at least one library")
	}
	
	// Test Delete Library
	err = DeleteLibrary(lib.ID)
	if err != nil {
		t.Fatalf("Failed to delete library: %v", err)
	}
	
	deleted, err := GetLibraryByID(lib.ID)
	if err != nil {
		t.Fatalf("Failed to check deleted library: %v", err)
	}
	if deleted != nil {
		t.Fatal("Library should be deleted")
	}
}

func TestUserLibraryAccess(t *testing.T) {
	setupTestDB(t)
	
	// Run migrations to create tables
	if err := RunMigrations(); err != nil {
		t.Fatalf("RunMigrations failed: %v", err)
	}
	
	// First create a test user
	testUser := &model.User{
		ID:       "test-user-123",
		Username: "testuser",
		Password: "hashedpassword",
		Role:     "user",
	}
	
	err := CreateUser(testUser)
	if err != nil {
		t.Fatalf("Failed to create test user: %v", err)
	}
	
	// Create a test library
	lib := &model.Library{
		Name:     "Access Test Library",
		Type:     "comic",
		RootPath: "/test/access",
		Enabled:  true,
	}
	
	err = CreateLibrary(lib)
	if err != nil {
		t.Fatalf("Failed to create library: %v", err)
	}
	defer DeleteLibrary(lib.ID)
	
	// Test Set User Library Access
	err = SetUserLibraryAccess(testUser.ID, []LibraryAccessReq{{LibraryID: lib.ID, CanView: true}})
	if err != nil {
		t.Fatalf("Failed to set user library access: %v", err)
	}
	
	// Test Get User Library Access
	accesses, err := GetUserLibraryAccess(testUser.ID)
	if err != nil {
		t.Fatalf("Failed to get user library access: %v", err)
	}
	
	if len(accesses) != 1 {
		t.Errorf("Expected 1 access record, got %d", len(accesses))
	}
	
	if accesses[0].LibraryID != lib.ID {
		t.Errorf("Expected library ID '%s', got '%s'", lib.ID, accesses[0].LibraryID)
	}
	
	// Test User Can View Library
	canView, err := UserCanViewLibrary(testUser.ID, lib.ID)
	if err != nil {
		t.Fatalf("Failed to check user can view library: %v", err)
	}
	if !canView {
		t.Error("User should be able to view the library")
	}
	
	// Test User Cannot View Other Library
	canViewOther, err := UserCanViewLibrary(testUser.ID, "non-existent-library")
	if err != nil {
		t.Fatalf("Failed to check user can view other library: %v", err)
	}
	if canViewOther {
		t.Error("User should not be able to view non-existent library")
	}
}

func TestAdminLibraryAccess(t *testing.T) {
	setupTestDB(t)
	
	// Run migrations to create tables
	if err := RunMigrations(); err != nil {
		t.Fatalf("RunMigrations failed: %v", err)
	}
	
	// Create admin user
	adminUser := &model.User{
		ID:       "admin-user-123",
		Username: "adminuser",
		Password: "hashedpassword",
		Role:     "admin",
	}
	
	err := CreateUser(adminUser)
	if err != nil {
		t.Fatalf("Failed to create admin user: %v", err)
	}
	
	// Create a test library
	lib := &model.Library{
		Name:     "Admin Test Library",
		Type:     "comic",
		RootPath: "/test/admin",
		Enabled:  true,
	}
	
	err = CreateLibrary(lib)
	if err != nil {
		t.Fatalf("Failed to create library: %v", err)
	}
	defer DeleteLibrary(lib.ID)
	
	// Admin should be able to view any library without explicit access
	canView, err := UserCanViewLibrary(adminUser.ID, lib.ID)
	if err != nil {
		t.Fatalf("Failed to check admin can view library: %v", err)
	}
	if !canView {
		t.Error("Admin should be able to view any library")
	}
	
	// Admin should get all enabled libraries
	libraryIDs, err := GetUserAccessibleLibraryIDs(adminUser.ID)
	if err != nil {
		t.Fatalf("Failed to get admin accessible libraries: %v", err)
	}
	
	found := false
	for _, id := range libraryIDs {
		if id == lib.ID {
			found = true
			break
		}
	}
	if !found {
		t.Error("Admin should have access to all enabled libraries")
	}
}



