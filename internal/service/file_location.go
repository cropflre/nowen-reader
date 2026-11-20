package service

import (
	"path"
	"path/filepath"
	"strings"

	"github.com/nowen-reader/nowen-reader/internal/model"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

// BuildComicFileLocation constructs relative and (when canManage is true) physical
// filesystem location metadata for a comic/book file.
func BuildComicFileLocation(
	comicID, libraryID, libraryName, filename, relativePath, editionLabel string,
	canDownload, canManage bool,
) *model.ComicFileLocation {
	relPath := strings.TrimSpace(strings.ReplaceAll(relativePath, "\\", "/"))
	if relPath == "" {
		relPath = strings.TrimSpace(strings.ReplaceAll(filename, "\\", "/"))
	}
	trimmed := strings.TrimSuffix(relPath, "/")
	relDir := path.Dir(trimmed)
	if relDir == "." || relDir == "/" {
		relDir = ""
	}
	baseName := path.Base(trimmed)
	if baseName == "." || baseName == "/" {
		baseName = ""
	}
	if editionLabel == "" {
		editionLabel = store.ExtractEditionLabel(relPath)
	}

	var lib *model.Library
	if libraryID != "" && (libraryName == "" || canManage) {
		lib, _ = store.GetLibraryByID(libraryID)
		if libraryName == "" && lib != nil {
			libraryName = lib.Name
		}
	}

	loc := &model.ComicFileLocation{
		LibraryID:    libraryID,
		LibraryName:  libraryName,
		Filename:     filename,
		RelativePath: relPath,
		RelativeDir:  relDir,
		BaseName:     baseName,
		Format:       strings.ToUpper(store.ExtractFileFormat(relPath)),
		EditionLabel: editionLabel,
		CanDownload:  canDownload,
		CanManage:    canManage,
	}

	if canManage {
		if resolved, err := GlobalFileResolver.ResolveContentPath(comicID); err == nil && resolved.AbsolutePath != "" {
			exists := true
			loc.RootPath = resolved.RootPath
			loc.AbsolutePath = resolved.AbsolutePath
			if resolved.IsFolder {
				loc.RealDirPath = resolved.AbsolutePath
			} else {
				loc.RealDirPath = filepath.Dir(resolved.AbsolutePath)
			}
			loc.ExistsOnDisk = &exists
		} else {
			exists := false
			loc.ExistsOnDisk = &exists
			if lib != nil && lib.RootPath != "" && trimmed != "" {
				loc.RootPath = lib.RootPath
				abs := filepath.Join(filepath.Clean(lib.RootPath), filepath.FromSlash(trimmed))
				loc.AbsolutePath = abs
				if strings.HasSuffix(relPath, "/") {
					loc.RealDirPath = abs
				} else {
					loc.RealDirPath = filepath.Dir(abs)
				}
			}
		}
	}

	return loc
}
