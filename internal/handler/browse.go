package handler

import (
	"fmt"
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

// permissionHint 返回权限不足时的解决提示。
func permissionHint(path string) string {
	return fmt.Sprintf(
		"没有权限访问: %s\n"+
			"请尝试以下方式获取权限:\n"+
			"1. SSH 到服务器执行: chmod -R 755 %s\n"+
			"2. 或更改目录所有者: chown -R 1000:1000 %s\n"+
			"3. Docker 用户请在 docker-compose.yml 中添加 volumes 挂载, 并确保容器有读取权限 (如: user: \"0:0\" 以 root 运行)\n"+
			"4. 绿联/群晖 NAS 请在 Docker 管理界面的存储空间/卷挂载中添加该路径, 并设置为读写模式",
		path, path, path,
	)
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
			c.JSON(http.StatusNotFound, gin.H{"error": "路径不存在: " + requestPath})
		} else if os.IsPermission(err) {
			c.JSON(http.StatusForbidden, gin.H{
				"error": "没有权限访问此路径",
				"hint":  permissionHint(requestPath),
			})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "无法访问路径: " + err.Error()})
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
			c.JSON(http.StatusForbidden, gin.H{
				"error": "没有权限读取此目录",
				"hint":  permissionHint(requestPath),
			})
		} else {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "无法读取目录内容: " + err.Error()})
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
