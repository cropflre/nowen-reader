package handler

import (
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/gin-gonic/gin"
)

// BrowseHandler 处理文件系统目录浏览请求。
type BrowseHandler struct{}

// NewBrowseHandler 创建新的 BrowseHandler。
func NewBrowseHandler() *BrowseHandler {
	return &BrowseHandler{}
}

// DirEntry 表示一个目录条目。
type DirEntry struct {
	Name string `json:"name"`
	Path string `json:"path"`
}

// GET /api/browse-dirs?path=/some/path
// 浏览服务器文件系统目录，返回指定路径下的子目录列表。
func (h *BrowseHandler) BrowseDirs(c *gin.Context) {
	requestPath := c.Query("path")

	// 默认根路径：根据操作系统不同
	if requestPath == "" {
		requestPath = "/"
	}

	// 清理路径
	requestPath = filepath.Clean(requestPath)

	// 检查路径是否存在
	info, err := os.Stat(requestPath)
	if err != nil {
		if os.IsNotExist(err) {
			c.JSON(http.StatusNotFound, gin.H{"error": "路径不存在"})
		} else if os.IsPermission(err) {
			c.JSON(http.StatusForbidden, gin.H{"error": "没有权限访问此路径"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "无法访问路径"})
		}
		return
	}

	if !info.IsDir() {
		c.JSON(http.StatusBadRequest, gin.H{"error": "指定路径不是目录"})
		return
	}

	// 读取子目录
	entries, err := os.ReadDir(requestPath)
	if err != nil {
		if os.IsPermission(err) {
			c.JSON(http.StatusForbidden, gin.H{"error": "没有权限读取此目录"})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "无法读取目录内容"})
		}
		return
	}

	// 只返回目录（不返回文件），并过滤隐藏目录
	dirs := make([]DirEntry, 0)
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		name := entry.Name()
		// 跳过隐藏目录（以 . 开头）
		if strings.HasPrefix(name, ".") {
			continue
		}
		dirs = append(dirs, DirEntry{
			Name: name,
			Path: filepath.Join(requestPath, name),
		})
	}

	// 按名称排序
	sort.Slice(dirs, func(i, j int) bool {
		return strings.ToLower(dirs[i].Name) < strings.ToLower(dirs[j].Name)
	})

	// 计算父目录
	parent := ""
	if requestPath != "/" {
		parent = filepath.Dir(requestPath)
	}

	c.JSON(http.StatusOK, gin.H{
		"current": requestPath,
		"parent":  parent,
		"dirs":    dirs,
	})
}
