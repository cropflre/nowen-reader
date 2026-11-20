package handler

import (
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/middleware"
	"github.com/nowen-reader/nowen-reader/internal/model"
	"github.com/nowen-reader/nowen-reader/internal/service"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

// getUserID 从请求上下文中安全提取当前用户 ID。
// 如果未登录则返回空字符串（兼容单用户模式）。
func getUserID(c *gin.Context) string {
	if u := middleware.GetCurrentUser(c); u != nil {
		return u.ID
	}
	return ""
}

func canManageComicLibrary(c *gin.Context, libraryID string) bool {
	if libraryID == "" {
		return false
	}
	uid := getUserID(c)
	if uid == "" {
		return true
	}
	ok, err := store.UserCanManageLibrary(uid, libraryID)
	return err == nil && ok
}

func canDownloadFromLibrary(c *gin.Context, libraryID string) bool {
	if libraryID == "" {
		return false
	}
	uid := getUserID(c)
	if uid == "" {
		return true
	}
	ok, err := store.UserCanDownloadLibrary(uid, libraryID)
	return err == nil && ok
}

func resolveUserLibraryScope(c *gin.Context) ([]string, bool) {
	uid := getUserID(c)
	if uid == "" {
		return nil, false
	}
	user := middleware.GetCurrentUser(c)
	if user != nil && user.Role == "admin" {
		return nil, false
	}
	ids, err := store.GetUserAccessibleLibraryIDs(uid)
	if err != nil {
		return []string{}, true
	}
	return ids, true
}

func buildComicEditionInfos(c *gin.Context, currentComicID string, rows []store.BookEditionMemberRow) []model.ComicEditionInfo {
	editions := make([]model.ComicEditionInfo, 0, len(rows))
	for _, r := range rows {
		canManage := canManageComicLibrary(c, r.LibraryID)
		canDownload := canDownloadFromLibrary(c, r.LibraryID)
		fmtUpper := strings.ToUpper(r.Format)
		if fmtUpper == "" {
			fmtUpper = strings.ToUpper(store.ExtractFileFormat(r.RelativePath))
		}
		loc := service.BuildComicFileLocation(
			r.ComicID, r.LibraryID, r.LibraryName, r.Filename, r.RelativePath, r.EditionLabel,
			canDownload, canManage,
		)
		downloadURL := ""
		if canDownload && fmtUpper != "FOLDER" {
			downloadURL = "/api/comics/" + r.ComicID + "/download"
		}
		editions = append(editions, model.ComicEditionInfo{
			ComicID:         r.ComicID,
			Title:           r.Title,
			Format:          fmtUpper,
			EditionLabel:    r.EditionLabel,
			IsCurrent:       r.ComicID == currentComicID,
			IsFormatPrimary: r.IsFormatPrimary,
			IsPreferred:     r.IsPreferred,
			DetectionSource: r.DetectionSource,
			FileSize:        r.FileSize,
			PageCount:       r.PageCount,
			LastReadPage:    r.LastReadPage,
			LastReadAt:      r.LastReadAt,
			ReadingStatus:   r.ReadingStatus,
			TotalReadTime:   r.TotalReadTime,
			ReaderURL:       "/reader/" + r.ComicID,
			DownloadURL:     downloadURL,
			FileLocation:    loc,
		})
	}
	return editions
}

func enrichEditionLocations(c *gin.Context, editions []model.ComicEditionInfo) {
	for i := range editions {
		loc := editions[i].FileLocation
		if loc == nil {
			continue
		}
		canManage := canManageComicLibrary(c, loc.LibraryID)
		canDownload := canDownloadFromLibrary(c, loc.LibraryID)
		editions[i].FileLocation = service.BuildComicFileLocation(
			editions[i].ComicID,
			loc.LibraryID,
			loc.LibraryName,
			loc.Filename,
			loc.RelativePath,
			editions[i].EditionLabel,
			canDownload,
			canManage,
		)
		if canDownload && editions[i].Format != "FOLDER" {
			editions[i].DownloadURL = "/api/comics/" + editions[i].ComicID + "/download"
		} else {
			editions[i].DownloadURL = ""
		}
	}
}
