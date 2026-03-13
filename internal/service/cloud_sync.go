package service

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/nowen-reader/nowen-reader/internal/store"
)

// ============================================================
// Types
// ============================================================

type SyncConfig struct {
	Enabled             bool   `json:"enabled"`
	Provider            string `json:"provider"` // "webdav" | "local"
	WebDAVURL           string `json:"webdavUrl"`
	WebDAVUsername       string `json:"webdavUsername"`
	WebDAVPassword       string `json:"webdavPassword"`
	AutoSync            bool   `json:"autoSync"`
	SyncIntervalMinutes int    `json:"syncIntervalMinutes"`
	LastSyncAt          string `json:"lastSyncAt"`
}

type SyncData struct {
	Version    int             `json:"version"`
	ExportedAt string          `json:"exportedAt"`
	DeviceID   string          `json:"deviceId"`
	Comics     []SyncComicData `json:"comics"`
	Settings   map[string]string `json:"settings"`
}

type SyncComicData struct {
	ID           string   `json:"id"`
	Filename     string   `json:"filename"`
	LastReadPage int      `json:"lastReadPage"`
	LastReadAt   *string  `json:"lastReadAt"`
	IsFavorite   bool     `json:"isFavorite"`
	Rating       *int     `json:"rating"`
	Tags         []string `json:"tags"`
}

const syncVersion = 1

// ============================================================
// Export
// ============================================================

// ExportSyncData exports local data for sync.
func ExportSyncData(deviceID string) (*SyncData, error) {
	comics, err := store.GetAllComicsForSync()
	if err != nil {
		return nil, err
	}

	syncComics := make([]SyncComicData, 0, len(comics))
	for _, c := range comics {
		sc := SyncComicData{
			ID:           c.ID,
			Filename:     c.Filename,
			LastReadPage: c.LastReadPage,
			IsFavorite:   c.IsFavorite,
			Rating:       c.Rating,
			Tags:         c.Tags,
		}
		if c.LastReadAt != nil {
			s := c.LastReadAt.UTC().Format(time.RFC3339Nano)
			sc.LastReadAt = &s
		}
		syncComics = append(syncComics, sc)
	}

	return &SyncData{
		Version:    syncVersion,
		ExportedAt: time.Now().UTC().Format(time.RFC3339Nano),
		DeviceID:   deviceID,
		Comics:     syncComics,
		Settings:   map[string]string{},
	}, nil
}

// ============================================================
// Import
// ============================================================

type ImportResult struct {
	Updated   int `json:"updated"`
	Skipped   int `json:"skipped"`
	Conflicts int `json:"conflicts"`
}

// ImportSyncData merges remote data with local (last-write-wins for conflicts).
func ImportSyncData(remote *SyncData) (*ImportResult, error) {
	result := &ImportResult{}

	for _, rc := range remote.Comics {
		localComic, err := store.GetSyncComic(rc.ID)
		if err != nil || localComic == nil {
			result.Skipped++
			continue
		}

		remoteReadAt := int64(0)
		if rc.LastReadAt != nil {
			if t, err := time.Parse(time.RFC3339Nano, *rc.LastReadAt); err == nil {
				remoteReadAt = t.UnixMilli()
			}
		}

		localReadAt := int64(0)
		if localComic.LastReadAt != nil {
			localReadAt = localComic.LastReadAt.UnixMilli()
		}

		if remoteReadAt > localReadAt {
			// Remote wins
			lastReadPage := rc.LastReadPage
			if localComic.LastReadPage > lastReadPage {
				lastReadPage = localComic.LastReadPage
			}
			isFav := rc.IsFavorite || localComic.IsFavorite
			rating := rc.Rating
			if rating == nil {
				rating = localComic.Rating
			}

			var lastReadAtTime *time.Time
			if rc.LastReadAt != nil {
				if t, err := time.Parse(time.RFC3339Nano, *rc.LastReadAt); err == nil {
					lastReadAtTime = &t
				}
			}

			if err := store.UpdateComicSync(rc.ID, lastReadPage, lastReadAtTime, isFav, rating); err != nil {
				log.Printf("[sync] Failed to update comic %s: %v", rc.ID, err)
				result.Skipped++
				continue
			}

			// Merge tags (union)
			localTags := map[string]bool{}
			for _, t := range localComic.Tags {
				localTags[t] = true
			}
			var newTags []string
			for _, t := range rc.Tags {
				if !localTags[t] {
					newTags = append(newTags, t)
				}
			}
			if len(newTags) > 0 {
				_ = store.AddTagsToComic(rc.ID, newTags)
			}

			result.Updated++
		} else if remoteReadAt == localReadAt {
			// Same timestamp: merge favorites and max progress
			lastReadPage := rc.LastReadPage
			if localComic.LastReadPage > lastReadPage {
				lastReadPage = localComic.LastReadPage
			}
			isFav := rc.IsFavorite || localComic.IsFavorite
			rating := rc.Rating
			if rating == nil {
				rating = localComic.Rating
			}

			if err := store.UpdateComicSync(rc.ID, lastReadPage, localComic.LastReadAt, isFav, rating); err != nil {
				log.Printf("[sync] Failed to merge comic %s: %v", rc.ID, err)
			}
			result.Conflicts++
		} else {
			result.Skipped++
		}
	}

	return result, nil
}

// ============================================================
// WebDAV Client
// ============================================================

type WebDAVClient struct {
	url      string
	username string
	password string
}

func NewWebDAVClient(urlStr, username, password string) *WebDAVClient {
	return &WebDAVClient{
		url:      strings.TrimRight(urlStr, "/"),
		username: username,
		password: password,
	}
}

func (w *WebDAVClient) authHeader() string {
	return "Basic " + base64.StdEncoding.EncodeToString([]byte(w.username+":"+w.password))
}

func (w *WebDAVClient) TestConnection() bool {
	client := &http.Client{Timeout: 10 * time.Second}
	req, err := http.NewRequest("PROPFIND", w.url, nil)
	if err != nil {
		return false
	}
	req.Header.Set("Authorization", w.authHeader())
	req.Header.Set("Depth", "0")

	resp, err := client.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode == 207 || resp.StatusCode == 200
}

func (w *WebDAVClient) Upload(path, data string) bool {
	client := &http.Client{Timeout: 30 * time.Second}
	req, err := http.NewRequest("PUT", w.url+"/"+path, strings.NewReader(data))
	if err != nil {
		return false
	}
	req.Header.Set("Authorization", w.authHeader())
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode == 200 || resp.StatusCode == 201 || resp.StatusCode == 204
}

func (w *WebDAVClient) Download(path string) (string, error) {
	client := &http.Client{Timeout: 30 * time.Second}
	req, err := http.NewRequest("GET", w.url+"/"+path, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", w.authHeader())

	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return "", fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}
	return string(body), nil
}

func (w *WebDAVClient) EnsureDirectory(path string) bool {
	client := &http.Client{Timeout: 10 * time.Second}
	req, err := http.NewRequest("MKCOL", w.url+"/"+path+"/", nil)
	if err != nil {
		return false
	}
	req.Header.Set("Authorization", w.authHeader())

	resp, err := client.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	// 405 = already exists
	return resp.StatusCode == 200 || resp.StatusCode == 201 || resp.StatusCode == 405
}

// ============================================================
// Full WebDAV Sync
// ============================================================

type WebDAVSyncResult struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
	Updated int    `json:"updated"`
}

func PerformWebDAVSync(cfg SyncConfig, deviceID string) *WebDAVSyncResult {
	if cfg.WebDAVURL == "" || cfg.WebDAVUsername == "" {
		return &WebDAVSyncResult{Success: false, Message: "WebDAV not configured", Updated: 0}
	}

	client := NewWebDAVClient(cfg.WebDAVURL, cfg.WebDAVUsername, cfg.WebDAVPassword)

	if !client.TestConnection() {
		return &WebDAVSyncResult{Success: false, Message: "Cannot connect to WebDAV server", Updated: 0}
	}

	client.EnsureDirectory("nowen-reader")

	// Download remote data
	totalUpdated := 0
	remoteJSON, err := client.Download("nowen-reader/sync-data.json")
	if err == nil && remoteJSON != "" {
		var remoteData SyncData
		if json.Unmarshal([]byte(remoteJSON), &remoteData) == nil {
			result, err := ImportSyncData(&remoteData)
			if err == nil {
				totalUpdated = result.Updated
			}
		}
	}

	// Export and upload local data
	localData, err := ExportSyncData(deviceID)
	if err != nil {
		return &WebDAVSyncResult{Success: false, Message: "Failed to export local data", Updated: totalUpdated}
	}

	localJSON, _ := json.MarshalIndent(localData, "", "  ")
	if !client.Upload("nowen-reader/sync-data.json", string(localJSON)) {
		return &WebDAVSyncResult{Success: false, Message: "Failed to upload sync data", Updated: totalUpdated}
	}

	return &WebDAVSyncResult{
		Success: true,
		Message: fmt.Sprintf("Sync completed: %d items updated", totalUpdated),
		Updated: totalUpdated,
	}
}
