package handler

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/middleware"
	"github.com/nowen-reader/nowen-reader/internal/model"
	"github.com/nowen-reader/nowen-reader/internal/service"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

const (
	contextKeyExpandedDeleteComicIDs  = "expanded_delete_comic_ids"
	contextKeyExpandedDeleteSeriesIDs = "expanded_delete_series_ids"
)

func requireGlobalAdminForDelete(c *gin.Context) (*model.AuthUser, bool) {
	user := middleware.GetCurrentUser(c)
	if user == nil {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
		return nil, false
	}
	if user.Role != "admin" {
		c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "Forbidden: Admin permission required to delete content"})
		return nil, false
	}
	return user, true
}

func deletePhysicalFilesOrAbort(c *gin.Context, comicIDs []string) ([]string, bool) {
	deletedIDs := make([]string, 0, len(comicIDs))
	var failures []string
	var hasReadOnlyErr bool
	for _, cid := range comicIDs {
		resolved, resolveErr := service.GlobalFileResolver.ResolveContentPath(cid)
		if resolveErr != nil || resolved.AbsolutePath == "" {
			// A missing file is already in the desired state; DB cleanup still proceeds.
			deletedIDs = append(deletedIDs, cid)
			continue
		}
		if err := service.RemoveContentFileAndPruneDirs(cid, resolved.AbsolutePath, resolved.RootPath); err != nil {
			failures = append(failures, fmt.Sprintf("%s: %v", resolved.AbsolutePath, err))
			if strings.Contains(err.Error(), "只读") || service.IsReadOnlyOrPermissionError(err) {
				hasReadOnlyErr = true
			}
			continue
		}
		deletedIDs = append(deletedIDs, cid)
	}

	if len(failures) > 0 {
		if len(deletedIDs) > 0 {
			if _, err := store.BatchDeleteComics(deletedIDs); err != nil {
				c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{
					"error": "Some files were removed, but database cleanup failed: " + err.Error(),
				})
				return nil, false
			}
		}
		errMsg := fmt.Sprintf("已移除 %d 项，但有 %d 个物理文件无法删除（如 %s）", len(deletedIDs), len(failures), failures[0])
		if hasReadOnlyErr {
			errMsg = fmt.Sprintf("书库目录为只读挂载或无写入权限，无法删除 %d 个磁盘源文件（如 %s）", len(failures), failures[0])
		}
		c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{
			"error":        errMsg,
			"failedFiles":  failures,
			"deletedCount": len(deletedIDs),
			"failedCount":  len(failures),
		})
		return nil, false
	}
	return deletedIDs, true
}

// recordOnlySingleDeleteGuard enforces global admin permission, expands optional
// edition siblings, removes physical files (and empty parent dirs) or records
// tombstones before DeleteComic removes database rows.
func recordOnlySingleDeleteGuard() gin.HandlerFunc {
	return func(c *gin.Context) {
		if _, ok := requireGlobalAdminForDelete(c); !ok {
			return
		}

		comicID := c.Param("id")
		existing, err := store.GetComicByID(comicID)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": "Failed to lookup comic"})
			return
		}
		if existing == nil {
			c.AbortWithStatusJSON(http.StatusNotFound, gin.H{"error": "Comic not found"})
			return
		}

		includeEditions := c.Query("deleteEditions") == "true"
		targetIDs, _, err := store.ExpandDeleteTargetComicIDs([]string{comicID}, includeEditions)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": "Failed to expand delete targets: " + err.Error()})
			return
		}
		if len(targetIDs) == 0 {
			targetIDs = []string{comicID}
		}
		c.Set(contextKeyExpandedDeleteComicIDs, targetIDs)

		if c.Query("deleteFiles") == "true" {
			if _, ok := deletePhysicalFilesOrAbort(c, targetIDs); !ok {
				return
			}
			// Physical files are already deleted safely. Proceed to DB row removal.
			c.Next()
			return
		}

		identities, err := store.GetComicSourceIdentities(targetIDs)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": "Failed to preserve record-only deletion"})
			return
		}
		if err := store.AddIgnoredLibraryContents(identities); err != nil {
			c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": "Failed to preserve record-only deletion"})
			return
		}

		c.Next()
		if c.Writer.Status() >= http.StatusBadRequest {
			if err := store.RemoveIgnoredLibraryContents(identities); err != nil {
				log.Printf("[delete-guard] failed to roll back single delete tombstone: %v", err)
			}
		}
	}
}

// recordOnlyBatchDeleteGuard enforces global admin permission for batch deletes,
// expands series-<id> and multi-format edition groups, and handles physical
// removal (+ empty directory pruning) or tombstone insertion.
func recordOnlyBatchDeleteGuard() gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.Request.Body == nil {
			c.Next()
			return
		}

		body, err := io.ReadAll(c.Request.Body)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
			return
		}
		c.Request.Body = io.NopCloser(bytes.NewReader(body))

		var payload struct {
			Action         string   `json:"action"`
			ComicIDs       []string `json:"comicIds"`
			DeleteFiles    bool     `json:"deleteFiles"`
			DeleteEditions *bool    `json:"deleteEditions"`
		}
		if json.Unmarshal(body, &payload) != nil || payload.Action != "delete" || len(payload.ComicIDs) == 0 {
			c.Next()
			return
		}

		if _, ok := requireGlobalAdminForDelete(c); !ok {
			return
		}

		includeEditions := true
		if payload.DeleteEditions != nil {
			includeEditions = *payload.DeleteEditions
		}

		expandedIDs, seriesIDs, err := store.ExpandDeleteTargetComicIDs(payload.ComicIDs, includeEditions)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": "Failed to expand delete targets: " + err.Error()})
			return
		}
		c.Set(contextKeyExpandedDeleteSeriesIDs, seriesIDs)

		if payload.DeleteFiles {
			if _, ok := deletePhysicalFilesOrAbort(c, expandedIDs); !ok {
				return
			}
			var rawPayload map[string]interface{}
			if err := json.Unmarshal(body, &rawPayload); err != nil {
				c.AbortWithStatusJSON(http.StatusBadRequest, gin.H{"error": "Invalid request body"})
				return
			}
			rawPayload["comicIds"] = expandedIDs
			rawPayload["deleteFiles"] = false
			rewritten, err := json.Marshal(rawPayload)
			if err != nil {
				c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": "Failed to prepare database deletion"})
				return
			}
			c.Request.Body = io.NopCloser(bytes.NewReader(rewritten))
			c.Request.ContentLength = int64(len(rewritten))
			c.Next()
			return
		}

		// Re-package expanded comicIds for DB batch delete when record-only
		var rawPayload map[string]interface{}
		if err := json.Unmarshal(body, &rawPayload); err == nil {
			rawPayload["comicIds"] = expandedIDs
			if rewritten, mErr := json.Marshal(rawPayload); mErr == nil {
				c.Request.Body = io.NopCloser(bytes.NewReader(rewritten))
				c.Request.ContentLength = int64(len(rewritten))
			}
		}

		identities, err := store.GetComicSourceIdentities(expandedIDs)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": "Failed to preserve record-only deletion"})
			return
		}
		if err := store.AddIgnoredLibraryContents(identities); err != nil {
			c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": "Failed to preserve record-only deletion"})
			return
		}

		c.Next()
		if c.Writer.Status() >= http.StatusBadRequest {
			if err := store.RemoveIgnoredLibraryContents(identities); err != nil {
				log.Printf("[delete-guard] failed to roll back batch delete tombstones: %v", err)
			}
		}
	}
}
