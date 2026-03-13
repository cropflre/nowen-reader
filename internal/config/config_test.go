package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSiteConfigPath(t *testing.T) {
	path := SiteConfigPath()
	if path == "" {
		t.Error("SiteConfigPath returned empty string")
	}
	if filepath.Ext(path) != ".json" {
		t.Errorf("Expected .json extension, got %s", filepath.Ext(path))
	}
}

func TestDataDir(t *testing.T) {
	// Default (no env)
	os.Unsetenv("DATA_DIR")
	dir := DataDir()
	if dir == "" {
		t.Error("DataDir returned empty string")
	}

	// With env
	t.Setenv("DATA_DIR", "/custom/data")
	dir = DataDir()
	if dir != "/custom/data" {
		t.Errorf("Expected '/custom/data', got '%s'", dir)
	}
}

func TestGetComicsDir(t *testing.T) {
	// Reset cache
	siteConfigCache = nil

	// Default (no env, no config file)
	os.Unsetenv("COMICS_DIR")
	dir := GetComicsDir()
	if dir == "" {
		t.Error("GetComicsDir returned empty string")
	}

	// With env override
	t.Setenv("COMICS_DIR", "/custom/comics")
	dir = GetComicsDir()
	if dir != "/custom/comics" {
		t.Errorf("Expected '/custom/comics', got '%s'", dir)
	}
}

func TestGetAllComicsDirs(t *testing.T) {
	siteConfigCache = nil
	os.Unsetenv("COMICS_DIR")

	dirs := GetAllComicsDirs()
	if len(dirs) == 0 {
		t.Error("GetAllComicsDirs returned empty slice")
	}

	// First dir should be the main comics dir
	if dirs[0] != GetComicsDir() {
		t.Errorf("First dir should be main comics dir")
	}
}

func TestSaveAndLoadSiteConfig(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("DATA_DIR", tmpDir)

	// Clear cache
	siteConfigCache = nil

	cfg := &SiteConfig{
		SiteName:        "TestReader",
		ComicsDir:       "/test/comics",
		ThumbnailWidth:  300,
		ThumbnailHeight: 420,
		PageSize:        12,
		Language:        "en",
		Theme:           "light",
	}

	if err := SaveSiteConfig(cfg); err != nil {
		t.Fatalf("SaveSiteConfig failed: %v", err)
	}

	// Verify file was created
	cfgPath := SiteConfigPath()
	if _, err := os.Stat(cfgPath); os.IsNotExist(err) {
		t.Fatal("Config file was not created")
	}

	// Clear cache and reload
	siteConfigCache = nil

	loaded := GetSiteConfig()
	if loaded.SiteName != "TestReader" {
		t.Errorf("Expected SiteName 'TestReader', got '%s'", loaded.SiteName)
	}
	if loaded.ThumbnailWidth != 300 {
		t.Errorf("Expected ThumbnailWidth 300, got %d", loaded.ThumbnailWidth)
	}
}

func TestDefaults(t *testing.T) {
	siteConfigCache = nil
	os.Unsetenv("DATA_DIR")

	if GetThumbnailWidth() != 400 {
		t.Errorf("Default ThumbnailWidth should be 400, got %d", GetThumbnailWidth())
	}
	if GetThumbnailHeight() != 560 {
		t.Errorf("Default ThumbnailHeight should be 560, got %d", GetThumbnailHeight())
	}
	if GetPageSize() != 24 {
		t.Errorf("Default PageSize should be 24, got %d", GetPageSize())
	}
	if GetSiteName() != "NowenReader" {
		t.Errorf("Default SiteName should be 'NowenReader', got '%s'", GetSiteName())
	}
}

func TestDatabaseURL(t *testing.T) {
	// Default
	os.Unsetenv("DATABASE_URL")
	url := DatabaseURL()
	if url == "" {
		t.Error("DatabaseURL returned empty string")
	}

	// With env override
	t.Setenv("DATABASE_URL", "/custom/db.sqlite")
	url = DatabaseURL()
	if url != "/custom/db.sqlite" {
		t.Errorf("Expected '/custom/db.sqlite', got '%s'", url)
	}
}

func TestSupportedExtensions(t *testing.T) {
	supported := []string{"test.zip", "test.cbz", "test.cbr", "test.rar", "test.7z", "test.cb7", "test.pdf"}
	for _, f := range supported {
		if !IsSupportedArchive(f) {
			t.Errorf("Expected %s to be supported", f)
		}
	}

	unsupported := []string{"test.txt", "test.jpg", "test.doc", "test.mp4"}
	for _, f := range unsupported {
		if IsSupportedArchive(f) {
			t.Errorf("Expected %s to not be supported", f)
		}
	}
}

func TestImageExtensions(t *testing.T) {
	images := []string{"test.jpg", "test.jpeg", "test.png", "test.gif", "test.webp", "test.bmp", "test.avif"}
	for _, f := range images {
		if !IsImageFile(f) {
			t.Errorf("Expected %s to be an image", f)
		}
	}

	nonImages := []string{"test.txt", "test.zip", "test.html"}
	for _, f := range nonImages {
		if IsImageFile(f) {
			t.Errorf("Expected %s to not be an image", f)
		}
	}
}

func TestExtraComicsDirsDedup(t *testing.T) {
	tmpDir := t.TempDir()
	t.Setenv("DATA_DIR", tmpDir)
	os.Unsetenv("COMICS_DIR")

	siteConfigCache = nil

	cfg := &SiteConfig{
		ComicsDir: "/comics/main",
		ExtraComicsDirs: []string{
			"/comics/extra1",
			"/comics/main", // duplicate of main dir
			"/comics/extra1", // duplicate
			"  ", // empty/whitespace
			"/comics/extra2",
		},
	}
	SaveSiteConfig(cfg)
	siteConfigCache = nil

	dirs := GetAllComicsDirs()

	// Should have 3 unique dirs: /comics/main, /comics/extra1, /comics/extra2
	if len(dirs) != 3 {
		t.Errorf("Expected 3 unique dirs, got %d: %v", len(dirs), dirs)
	}
}
