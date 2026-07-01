package service

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/nowen-reader/nowen-reader/internal/config"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

// ResolvedFile 代表一个已经解析出绝对路径的文件实体
type ResolvedFile struct {
	ContentID    string
	LibraryID    string
	RootPath     string
	RelativePath string
	AbsolutePath string
	IsFolder     bool
}

// FileResolver 接口定义文件路径解析服务
type FileResolver interface {
	ResolveContentPath(contentID string) (ResolvedFile, error)
}

// defaultFileResolver 默认实现
type defaultFileResolver struct{}

// NewFileResolver 创建一个新的文件解析器
func NewFileResolver() FileResolver {
	return &defaultFileResolver{}
}

var GlobalFileResolver = NewFileResolver()

// ResolveContentPath 根据 contentID (comicID) 解析出文件的真实绝对路径
// 强制依赖于 Library 的 RootPaths，不再回退到旧的全局目录遍历
func (r *defaultFileResolver) ResolveContentPath(contentID string) (ResolvedFile, error) {
	// 1. 获取书籍记录
	comic, err := store.GetComicByID(contentID)
	if err != nil || comic == nil {
		return ResolvedFile{}, fmt.Errorf("content not found: %s", contentID)
	}

	isFolder := strings.HasSuffix(comic.Filename, "/")

	// 2. 必须存在 LibraryID，强制基于书库解析
	if comic.LibraryID == "" {
		// 临时兼容：如果库 ID 为空，则退回到全局目录查找（以平滑过渡历史数据）
		return fallbackResolve(contentID, comic.Filename, isFolder)
	}

	lib, libErr := store.GetLibraryByID(comic.LibraryID)
	if libErr != nil || lib == nil {
		return ResolvedFile{}, fmt.Errorf("library %s not found for content %s", comic.LibraryID, contentID)
	}

	// 3. 获取书库的所有根路径（主路径 + 额外路径）
	allRootPaths := []string{lib.RootPath}
	extraPaths, epErr := store.GetLibraryRootPaths(lib.ID)
	if epErr == nil {
		allRootPaths = append(allRootPaths, extraPaths...)
	}

	// 4. 遍历所有根路径，寻找物理文件
	for _, dir := range allRootPaths {
		if dir == "" {
			continue
		}
		
		// 强化检测：防止路径逃逸 (cross-library deletion attack)
		cleanDir := filepath.Clean(dir)
		cleanFile := filepath.Clean(comic.Filename)
		if filepath.IsAbs(cleanFile) {
			continue // 拒绝绝对路径
		}
		
		fp := filepath.Join(cleanDir, cleanFile)
		
		rel, err := filepath.Rel(cleanDir, fp)
		if err != nil || strings.HasPrefix(rel, "..") || rel == "." {
			continue
		}

		if isFolder {
			fp = filepath.Join(dir, strings.TrimSuffix(comic.Filename, "/"))
			if info, statErr := os.Stat(fp); statErr == nil && info.IsDir() {
				return ResolvedFile{
					ContentID:    contentID,
					LibraryID:    comic.LibraryID,
					RootPath:     dir,
					RelativePath: comic.Filename,
					AbsolutePath: fp,
					IsFolder:     true,
				}, nil
			}
		} else {
			if _, statErr := os.Stat(fp); statErr == nil {
				return ResolvedFile{
					ContentID:    contentID,
					LibraryID:    comic.LibraryID,
					RootPath:     dir,
					RelativePath: comic.Filename,
					AbsolutePath: fp,
					IsFolder:     false,
				}, nil
			}
		}
	}

	return ResolvedFile{}, fmt.Errorf("file not found in library %s for content %s (%s)", comic.LibraryID, contentID, comic.Filename)
}

// fallbackResolve 兼容历史遗留的没有 LibraryID 的数据
func fallbackResolve(contentID, filename string, isFolder bool) (ResolvedFile, error) {
	for _, dir := range config.GetAllScanDirs() {
		fp := filepath.Join(dir, filename)
		if isFolder {
			fp = filepath.Join(dir, strings.TrimSuffix(filename, "/"))
			if info, statErr := os.Stat(fp); statErr == nil && info.IsDir() {
				return ResolvedFile{
					ContentID:    contentID,
					RelativePath: filename,
					AbsolutePath: fp,
					IsFolder:     true,
				}, nil
			}
		} else {
			if _, statErr := os.Stat(fp); statErr == nil {
				return ResolvedFile{
					ContentID:    contentID,
					RelativePath: filename,
					AbsolutePath: fp,
					IsFolder:     false,
				}, nil
			}
		}
	}
	return ResolvedFile{}, fmt.Errorf("file not found in global search for content %s (%s)", contentID, filename)
}
