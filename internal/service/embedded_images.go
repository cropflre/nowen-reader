package service

import (
	"fmt"

	"github.com/nowen-reader/nowen-reader/internal/archive"
)

// EmbeddedImageInfo 描述小说内嵌的一张图片资源。
// 对 EPUB：Path 是 zip 内部相对路径；对 MOBI/AZW3：Path 形如 "mobi-image-{index}"。
type EmbeddedImageInfo struct {
	Index int    `json:"index"`
	Path  string `json:"path"`
}

// EmbeddedImageData 是某张内嵌图的二进制内容。
type EmbeddedImageData struct {
	Data     []byte
	MimeType string
}

// ListEmbeddedImages 返回小说类型 (EPUB/MOBI/AZW3) 内嵌图片列表。
// 对漫画/PDF/TXT 返回空列表与 false。
func ListEmbeddedImages(comicID string) ([]EmbeddedImageInfo, bool, error) {
	fp, _, err := FindComicFilePath(comicID)
	if err != nil {
		return nil, false, err
	}

	archiveType := archive.DetectType(fp)
	switch archiveType {
	case archive.TypeEpub:
		reader, err := getPooledReader(fp)
		if err != nil {
			return nil, true, err
		}
		paths := archive.ListEpubEmbeddedImages(reader)
		out := make([]EmbeddedImageInfo, len(paths))
		for i, p := range paths {
			out[i] = EmbeddedImageInfo{Index: i, Path: p}
		}
		return out, true, nil
	case archive.TypeMobi, archive.TypeAzw3:
		reader, err := getPooledReader(fp)
		if err != nil {
			return nil, true, err
		}
		count := archive.CountMobiEmbeddedImages(reader)
		out := make([]EmbeddedImageInfo, count)
		for i := 0; i < count; i++ {
			out[i] = EmbeddedImageInfo{Index: i, Path: fmt.Sprintf("mobi-image-%d", i)}
		}
		return out, true, nil
	default:
		// 不是小说类型
		return nil, false, nil
	}
}

// GetEmbeddedImageData 按索引提取小说内嵌图片。
func GetEmbeddedImageData(comicID string, index int) (*EmbeddedImageData, error) {
	fp, _, err := FindComicFilePath(comicID)
	if err != nil {
		return nil, err
	}

	archiveType := archive.DetectType(fp)
	reader, err := getPooledReader(fp)
	if err != nil {
		return nil, err
	}

	switch archiveType {
	case archive.TypeEpub:
		paths := archive.ListEpubEmbeddedImages(reader)
		if index < 0 || index >= len(paths) {
			return nil, fmt.Errorf("image index %d out of range (0-%d)", index, len(paths)-1)
		}
		data, mime, err := archive.GetEpubEmbeddedImageData(reader, paths[index])
		if err != nil {
			return nil, err
		}
		return &EmbeddedImageData{Data: data, MimeType: mime}, nil
	case archive.TypeMobi, archive.TypeAzw3:
		data, mime, err := archive.GetMobiEmbeddedImageData(reader, index)
		if err != nil {
			return nil, err
		}
		return &EmbeddedImageData{Data: data, MimeType: mime}, nil
	default:
		return nil, fmt.Errorf("file type %s does not support embedded images", archiveType)
	}
}
