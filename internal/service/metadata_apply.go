package service

import (
	"encoding/base64"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/nowen-reader/nowen-reader/internal/archive"
	"github.com/nowen-reader/nowen-reader/internal/config"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

const maxCoverDownloadBytes = 20 << 20

// 合集封面下载去重：同一 groupID 同时只有一个下载任务，其余等待结果
var groupCoverDownload sync.Map // groupID -> chan struct{}

// ============================================================
// Apply metadata to comic
// ============================================================

// BuildRatingUpdates 构建外部评分的更新字段 map，避免在多处重复相同的逻辑。
// 如果 metadata 中没有评分信息，返回 nil。
func BuildRatingUpdates(meta ComicMetadata) map[string]interface{} {
	if meta.ExternalRating == nil {
		return nil
	}
	updates := map[string]interface{}{
		"externalRating":       *meta.ExternalRating,
		"externalRatingSource": meta.ExternalRatingSource,
	}
	if meta.ExternalRatingMax != nil {
		updates["externalRatingMax"] = *meta.ExternalRatingMax
	}
	if meta.ExternalRatingUpdatedAt != nil {
		updates["externalRatingUpdatedAt"] = *meta.ExternalRatingUpdatedAt
	} else {
		updates["externalRatingUpdatedAt"] = time.Now().UTC()
	}
	return updates
}

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
	// External rating
	for k, v := range BuildRatingUpdates(meta) {
		updates[k] = v
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
	// Bangumi 等源可能返回 http:// URL，Go HTTP 客户端会跟随重定向，
	// 但显式转为 https 更安全
	coverURL = strings.Replace(coverURL, "http://", "https://", 1)

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

	imgData, err := io.ReadAll(io.LimitReader(resp.Body, maxCoverDownloadBytes+1))
	if err != nil || len(imgData) == 0 {
		return
	}
	if len(imgData) > maxCoverDownloadBytes {
		log.Printf("[metadata] Cover download too large for %s", comicID)
		return
	}

	thumbPath := filepath.Join(thumbDir, archive.ThumbnailCacheName(comicID))
	webpData, _, err := archive.ResizeImageToWebP(imgData, config.GetThumbnailWidth(), config.GetThumbnailHeight(), 85)
	if err != nil {
		log.Printf("[metadata] Cover convert failed for %s: %v", comicID, err)
		return
	}
	archive.ClearThumbnailCache(comicID)
	_ = os.WriteFile(thumbPath, webpData, 0644)
	log.Printf("[metadata] Cover cached for %s", comicID)
}

// DownloadGroupCover 保存系列封面 URL 到数据库，并下载到本地缓存。
func DownloadGroupCover(groupID int, coverURL string) {
	if coverURL == "" {
		return
	}
	// Bangumi 等源可能返回 http:// URL，强制转为 https://
	coverURL = strings.Replace(coverURL, "http://", "https://", 1)

	// 保存外部 URL 到数据库
	if err := store.UpdateGroupMetadata(groupID, store.GroupMetadataUpdate{
		CoverURL: &coverURL,
	}); err != nil {
		log.Printf("[metadata] Group cover URL save failed for group %d: %v", groupID, err)
		return
	}
	log.Printf("[metadata] Group cover URL saved for group %d", groupID)

	// 下载封面到本地缓存
	downloadGroupCoverToLocal(groupID, coverURL)
}

// downloadGroupCoverToLocal 下载合集封面图片并保存为本地 WebP 缩略图。
// 使用去重机制确保同一 groupID 同时只有一个下载任务。
func downloadGroupCoverToLocal(groupID int, coverURL string) {
	thumbDir := config.GetThumbnailsDir()
	if err := os.MkdirAll(thumbDir, 0755); err != nil {
		return
	}

	// 快速路径：磁盘缓存命中
	cacheName := archive.GroupCoverCacheName(groupID)
	cachePath := filepath.Join(thumbDir, cacheName)
	if data, err := os.ReadFile(cachePath); err == nil && len(data) > 0 {
		return
	}

	// 去重：如果同一 groupID 正在下载，等待其完成后重新检查缓存
	ch, loaded := groupCoverDownload.LoadOrStore(groupID, make(chan struct{}, 1))
	done := ch.(chan struct{})
	if loaded {
		// 其他 goroutine 正在下载，等待完成
		<-done
		// 重新检查缓存是否被成功写入
		if data, err := os.ReadFile(cachePath); err == nil && len(data) > 0 {
			return
		}
		// 下载失败，等待下次请求时重新尝试
		return
	}

	// 当前 goroutine 负责下载，完成后通知等待者
	defer func() {
		close(done)
		groupCoverDownload.Delete(groupID)
	}()

	downloadGroupCoverToLocalInternal(groupID, coverURL, thumbDir, cachePath)
}

// downloadGroupCoverToLocalInternal 执行实际的封面下载和保存逻辑。
func downloadGroupCoverToLocalInternal(groupID int, coverURL string, thumbDir string, cachePath string) {
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

	imgData, err := io.ReadAll(io.LimitReader(resp.Body, maxCoverDownloadBytes+1))
	if err != nil || len(imgData) == 0 {
		return
	}
	if len(imgData) > maxCoverDownloadBytes {
		log.Printf("[metadata] Group cover download too large for group %d", groupID)
		return
	}

	webpData, _, err := archive.ResizeImageToWebP(imgData, config.GetThumbnailWidth(), config.GetThumbnailHeight(), 85)
	if err != nil {
		// Fallback: 保存原始图片数据
		log.Printf("[metadata] Group cover cache failed for group %d: %v", groupID, err)
		return
	}
	archive.ClearGroupCoverCache(groupID)
	_ = os.WriteFile(cachePath, webpData, 0644)
	log.Printf("[metadata] Group cover cached locally for group %d", groupID)
}

func CacheGroupCoverDataURL(groupID int, coverDataURL string) error {
	comma := strings.Index(coverDataURL, ",")
	if comma <= 0 || !strings.HasPrefix(coverDataURL, "data:image/") {
		return fmt.Errorf("unsupported data URL")
	}
	meta := coverDataURL[:comma]
	if !strings.Contains(meta, ";base64") {
		return fmt.Errorf("unsupported non-base64 data URL")
	}
	imgData, err := base64.StdEncoding.DecodeString(coverDataURL[comma+1:])
	if err != nil {
		return err
	}
	if len(imgData) == 0 || len(imgData) > maxCoverDownloadBytes {
		return fmt.Errorf("invalid image size")
	}

	thumbDir := config.GetThumbnailsDir()
	if err := os.MkdirAll(thumbDir, 0755); err != nil {
		return err
	}
	webpData, _, err := archive.ResizeImageToWebP(imgData, config.GetThumbnailWidth(), config.GetThumbnailHeight(), 85)
	if err != nil {
		return err
	}
	archive.ClearGroupCoverCache(groupID)
	cachePath := filepath.Join(thumbDir, archive.GroupCoverCacheName(groupID))
	if err := os.WriteFile(cachePath, webpData, 0644); err != nil {
		return err
	}
	log.Printf("[metadata] Group cover cached locally for group %d", groupID)
	return nil
}

// ============================================================
// HTTP helpers
// ============================================================

// maxRetries429 是遇到 HTTP 429 时的最大重试次数
const maxRetries429 = 3

// retryAfterFromHeader 从 Retry-After 头中解析等待秒数，默认返回 fallback
