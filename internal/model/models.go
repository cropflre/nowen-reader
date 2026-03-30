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
	AiEnabled bool      `json:"aiEnabled"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

// AuthUser is the safe user representation returned to clients.
type AuthUser struct {
	ID        string `json:"id"`
	Username  string `json:"username"`
	Nickname  string `json:"nickname"`
	Role      string `json:"role"`
	AiEnabled bool   `json:"aiEnabled"`
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
	Genre          string `json:"genre"`          // comma-separated
	MetadataSource string `json:"metadataSource"` // "comicvine" | "anilist" | "manual"
	CoverImageURL    string  `json:"coverImageUrl"`    // external cover URL
	CoverAspectRatio float64 `json:"coverAspectRatio"` // width/height ratio (>1 = landscape)

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
// User-specific Comic State (用户个人漫画状态)
// ============================================================

// UserComicState 保存每个用户对每部漫画的个人状态。
// Comic 表中仍保留 lastReadPage/isFavorite 等字段作为全局默认值（单用户兼容）。
type UserComicState struct {
	UserID        string     `json:"userId"`
	ComicID       string     `json:"comicId"`
	LastReadPage  int        `json:"lastReadPage"`
	LastReadAt    *time.Time `json:"lastReadAt"`
	IsFavorite    bool       `json:"isFavorite"`
	Rating        *int       `json:"rating"`
	TotalReadTime int        `json:"totalReadTime"`
	ReadingStatus string     `json:"readingStatus"`
}

// ============================================================
// Reading Sessions
// ============================================================

type ReadingSession struct {
	ID        int        `json:"id"`
	ComicID   string     `json:"comicId"`
	UserID    string     `json:"userId"`
	StartedAt time.Time  `json:"startedAt"`
	EndedAt   *time.Time `json:"endedAt"`
	Duration  int        `json:"duration"` // seconds
	StartPage int        `json:"startPage"`
	EndPage   int        `json:"endPage"`
}

// ============================================================
// Comic Groups (自定义合并分组)
// ============================================================

type ComicGroup struct {
	ID        int       `json:"id"`
	Name      string    `json:"name"`
	UserID    string    `json:"userId"`
	CoverURL  string    `json:"coverUrl"`
	SortOrder int       `json:"sortOrder"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
	// 查询时填充
	ComicCount int `json:"comicCount,omitempty"`
}

type ComicGroupItem struct {
	GroupID   int    `json:"groupId"`
	ComicID   string `json:"comicId"`
	SortIndex int    `json:"sortIndex"`
}
