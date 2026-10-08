package service

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/nowen-reader/nowen-reader/internal/archive"
)

// GetPageFile coalesces cold requests and returns a versioned cached file.
// Cache hits perform an indexed lookup and stat; image bytes are not read here.
func GetPageFile(comicID string, page int) (*PageFile, error) {
	if page < 0 {
		return nil, fmt.Errorf("invalid page index")
	}
	fp, _, err := FindComicFilePath(comicID)
	if err != nil {
		return nil, err
	}
	info, err := os.Stat(fp)
	if err != nil {
		return nil, err
	}
	if info.IsDir() {
		pages, err := GetComicPagesEx(comicID)
		if err != nil || page >= len(pages.Entries) {
			return nil, fmt.Errorf("image folder page %d not found: %v", page, err)
		}
		path := filepath.Join(fp, filepath.FromSlash(pages.Entries[page]))
		rel, err := filepath.Rel(fp, path)
		if err != nil || !filepath.IsLocal(rel) {
			return nil, fmt.Errorf("invalid image folder page path")
		}
		return describePageFile(path)
	}
	dir := readerCacheDir(comicID, fp, info)
	if file := cachedPageFile(dir, page); file != nil {
		return file, nil
	}
	key := pageFileKey(dir, page)
	call, owner := reservePageFile(key)
	if !owner {
		<-call.done
		return call.file, call.err
	}
	var file *PageFile
	defer func() { finishPageFile(key, call, file, err) }()
	pageExtractSlots <- struct{}{}
	defer func() { <-pageExtractSlots }()
	// A background batch may have finished between the lookup and reservation.
	if file = cachedPageFile(dir, page); file != nil {
		return file, nil
	}
	file, err = extractReaderPage(comicID, fp, dir, page)
	return file, err
}

func extractReaderPage(comicID, fp, dir string, page int) (*PageFile, error) {
	pages, err := GetComicPagesEx(comicID)
	if err != nil {
		return nil, err
	}
	if pages.IsNovel || page >= len(pages.Entries) {
		return nil, fmt.Errorf("page index %d out of range", page)
	}
	kind := archive.DetectType(fp)
	var data []byte
	ext := strings.ToLower(filepath.Ext(pages.Entries[page]))
	if kind == archive.TypePdf {
		dpi := 200
		if width, _, sizeErr := archive.GetPdfPageSize(fp, page); sizeErr == nil && width > 0 {
			dpi = archive.CalcReadingDPI(width, 1920)
		}
		data, ext, err = archive.RenderPdfPage(fp, page, dpi)
	} else {
		reader, openErr := getPooledReader(fp)
		if openErr != nil {
			return nil, openErr
		}
		var mime string
		switch kind {
		case archive.TypeMobi, archive.TypeAzw3:
			data, mime, err = archive.GetMobiEmbeddedImageData(reader, page)
			ext = imageExtension(mime)
		case archive.TypeEpub:
			data, mime, err = archive.GetEpubEmbeddedImageData(reader, pages.Entries[page])
		default:
			data, err = reader.ExtractEntry(pages.Entries[page])
		}
	}
	if err != nil {
		return nil, fmt.Errorf("extract page %d: %w", page, err)
	}
	return writePageFile(dir, page, ext, data)
}

func imageExtension(mime string) string {
	switch mime {
	case "image/png":
		return ".png"
	case "image/gif":
		return ".gif"
	case "image/webp":
		return ".webp"
	case "image/avif":
		return ".avif"
	case "image/svg+xml":
		return ".svg"
	case "image/bmp":
		return ".bmp"
	default:
		return ".jpg"
	}
}
