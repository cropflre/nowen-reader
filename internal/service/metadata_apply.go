package service

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/nowen-reader/nowen-reader/internal/archive"
	"github.com/nowen-reader/nowen-reader/internal/config"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

// ============================================================
// Apply metadata to comic
// ============================================================

// ApplyMetadata updates comic fields in DB from metadata.
func ApplyMetadata(comicID string, meta ComicMetadata, lang string, overwrite bool, opts ...ApplyOption) (*store.ComicListItem, error) {
	// 解析可选参数
	opt := ApplyOption{}
	if len(opts) > 0 {
		opt = opts[0]
	}

	existing, err := store.GetComicByID(comicID)
	if err != nil || existing == nil {
		return nil, fmt.Errorf("comic not found: %s", comicID)
	}

	updates := map[string]interface{}{}

	shouldUpdate := func(current string) bool {
		return overwrite || current == ""
	}

	if meta.Title != "" && shouldUpdate(existing.Title) {
		updates["title"] = meta.Title
	}
	if meta.Author != "" && shouldUpdate(existing.Author) {
		updates["author"] = meta.Author
	}
	if meta.Publisher != "" && shouldUpdate(existing.Publisher) {
		updates["publisher"] = meta.Publisher
	}
	if meta.Description != "" && shouldUpdate(existing.Description) {
		updates["description"] = meta.Description
	}
	if meta.Language != "" && shouldUpdate(existing.Language) {
		updates["language"] = meta.Language
	}
	if meta.Genre != "" && shouldUpdate(existing.Genre) {
		updates["genre"] = meta.Genre
	}
	if meta.Year != nil {
		if overwrite || existing.Year == nil {
			updates["year"] = *meta.Year
		}
	}
	if meta.Source != "" {
		updates["metadataSource"] = meta.Source
	}
	// P2-A: 当 skipCover 为 true 时，跳过封面更新
	if meta.CoverURL != "" && !opt.SkipCover {
		updates["coverImageUrl"] = meta.CoverURL
	}

	if len(updates) > 0 {
		if err := store.UpdateComicFields(comicID, updates); err != nil {
			return nil, err
		}
	}

	// Download cover image as thumbnail（仅在不跳过封面时）
	if meta.CoverURL != "" && !opt.SkipCover {
		go downloadCoverAsThumbnail(comicID, meta.CoverURL)
	}

	// Add genres as tags
	if meta.Genre != "" {
		genres := strings.Split(meta.Genre, ",")
		var tagNames []string
		for _, g := range genres {
			g = strings.TrimSpace(g)
			if g != "" {
				tagNames = append(tagNames, g)
			}
		}
		if len(tagNames) > 0 {
			_ = store.AddTagsToComic(comicID, tagNames)
		}
	}

	return store.GetComicByID(comicID)
}

// downloadCoverAsThumbnail fetches a cover URL and saves as WebP thumbnail.
func downloadCoverAsThumbnail(comicID, coverURL string) {
	thumbDir := config.GetThumbnailsDir()
	if err := os.MkdirAll(thumbDir, 0755); err != nil {
		return
	}

	client := &http.Client{Timeout: 30 * time.Second}
	req, err := http.NewRequest("GET", coverURL, nil)
	if err != nil {
		return
	}
	req.Header.Set("User-Agent", "NowenReader/1.0")

	resp, err := client.Do(req)
	if err != nil || resp.StatusCode != 200 {
		return
	}
	defer resp.Body.Close()

	imgData, err := io.ReadAll(resp.Body)
	if err != nil || len(imgData) == 0 {
		return
	}

	// Clear old cache files first, then write to canonical path
	archive.ClearThumbnailCache(comicID)
	thumbPath := filepath.Join(thumbDir, archive.ThumbnailCacheName(comicID))
	webpData, err := archive.ResizeImageToWebP(imgData, config.GetThumbnailWidth(), config.GetThumbnailHeight(), 85)
	if err != nil {
		// Fallback: save raw image data directly
		_ = os.WriteFile(thumbPath, imgData, 0644)
	} else {
		_ = os.WriteFile(thumbPath, webpData, 0644)
	}
	log.Printf("[metadata] Cover cached for %s", comicID)
}

// DownloadGroupCover 下载系列封面图片并保存到系列的 coverUrl 字段。
func DownloadGroupCover(groupID int, coverURL string) {
	if coverURL == "" {
		return
	}

	client := &http.Client{Timeout: 30 * time.Second}
	req, err := http.NewRequest("GET", coverURL, nil)
	if err != nil {
		return
	}
	req.Header.Set("User-Agent", "NowenReader/1.0")

	resp, err := client.Do(req)
	if err != nil || resp.StatusCode != 200 {
		return
	}
	defer resp.Body.Close()

	// 将封面 URL 保存到系列的 coverUrl 字段
	_ = store.UpdateGroupMetadata(groupID, store.GroupMetadataUpdate{
		CoverURL: &coverURL,
	})
	log.Printf("[metadata] Group cover URL saved for group %d", groupID)
}

// ============================================================
// HTTP helpers
// ============================================================

// maxRetries429 是遇到 HTTP 429 时的最大重试次数
const maxRetries429 = 3

// retryAfterFromHeader 从 Retry-After 头中解析等待秒数，默认返回 fallback
