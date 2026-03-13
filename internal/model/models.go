package model

import "time"

// ============================================================
// User System
// ============================================================

type User struct {
	ID        string    `json:"id"`
	Username  string    `json:"username"`
	Password  string    `json:"-"` // never expose in JSON
	Nickname  string    `json:"nickname"`
	Role      string    `json:"role"` // "admin" | "user"
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// AuthUser is the safe user representation returned to clients.
type AuthUser struct {
	ID       string `json:"id"`
	Username string `json:"username"`
	Nickname string `json:"nickname"`
	Role     string `json:"role"`
}

type UserSession struct {
	ID        string    `json:"id"` // uuid token
	UserID    string    `json:"userId"`
	ExpiresAt time.Time `json:"expiresAt"`
	CreatedAt time.Time `json:"createdAt"`
}

// ============================================================
// Comics
// ============================================================

type Comic struct {
	ID        string    `json:"id"` // md5 hash from filename
	Filename  string    `json:"filename"`
	Title     string    `json:"title"`
	PageCount int       `json:"pageCount"`
	FileSize  int64     `json:"fileSize"`
	AddedAt   time.Time `json:"addedAt"`
	UpdatedAt time.Time `json:"updatedAt"`

	// Reading progress
	LastReadPage int        `json:"lastReadPage"`
	LastReadAt   *time.Time `json:"lastReadAt"`

	// Favorite & Rating
	IsFavorite bool `json:"isFavorite"`
	Rating     *int `json:"rating"` // 1-5, nullable

	// Custom sort order
	SortOrder int `json:"sortOrder"`

	// Total reading duration in seconds
	TotalReadTime int `json:"totalReadTime"`

	// Metadata (from scraping)
	Author         string `json:"author"`
	Publisher      string `json:"publisher"`
	Year           *int   `json:"year"`
	Description    string `json:"description"`
	Language       string `json:"language"`
	SeriesName     string `json:"seriesName"`
	SeriesIndex    *int   `json:"seriesIndex"`
	Genre          string `json:"genre"`          // comma-separated
	MetadataSource string `json:"metadataSource"` // "comicvine" | "anilist" | "manual"
	CoverImageURL  string `json:"coverImageUrl"`  // external cover URL

	// Relations (populated by queries)
	Tags       []Tag      `json:"tags,omitempty"`
	Categories []Category `json:"categories,omitempty"`
}

// ============================================================
// Tags
// ============================================================

type Tag struct {
	ID         int    `json:"id"`
	Name       string `json:"name"`
	Color      string `json:"color"`
	ComicCount int    `json:"comicCount,omitempty"` // populated by queries with COUNT
}

type ComicTag struct {
	ComicID string `json:"comicId"`
	TagID   int    `json:"tagId"`
}

// ============================================================
// Categories
// ============================================================

type Category struct {
	ID         int       `json:"id"`
	Name       string    `json:"name"`
	Slug       string    `json:"slug"`
	Icon       string    `json:"icon"`
	SortOrder  int       `json:"sortOrder"`
	CreatedAt  time.Time `json:"createdAt"`
	ComicCount int       `json:"comicCount,omitempty"` // populated by queries with COUNT
}

type ComicCategory struct {
	ComicID    string `json:"comicId"`
	CategoryID int    `json:"categoryId"`
}

// ============================================================
// Reading Sessions
// ============================================================

type ReadingSession struct {
	ID        int        `json:"id"`
	ComicID   string     `json:"comicId"`
	StartedAt time.Time  `json:"startedAt"`
	EndedAt   *time.Time `json:"endedAt"`
	Duration  int        `json:"duration"` // seconds
	StartPage int        `json:"startPage"`
	EndPage   int        `json:"endPage"`
}
