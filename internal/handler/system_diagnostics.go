package handler

import (
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/config"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

// ============================================================
// NAS 诊断中心
// ============================================================

// DiagnosticItem 单项诊断结果
type DiagnosticItem struct {
	ID      string `json:"id"`      // 唯一标识
	Name    string `json:"name"`    // 中文名称
	Status  string `json:"status"`  // "ok" | "warning" | "error"
	Message string `json:"message"` // 状态描述
	Detail  string `json:"detail,omitempty"`
	Hint    string `json:"hint,omitempty"` // 修复建议
}

// DiagnosticReport 完整诊断报告
type DiagnosticReport struct {
	GeneratedAt string           `json:"generatedAt"`
	OS          string           `json:"os"`
	Arch        string           `json:"arch"`
	Items       []DiagnosticItem `json:"items"`
	Summary     struct {
		Total    int `json:"total"`
		OK       int `json:"ok"`
		Warnings int `json:"warnings"`
		Errors   int `json:"errors"`
	} `json:"summary"`
}

// GET /api/system/diagnostics
func GetDiagnostics(c *gin.Context) {
	report := DiagnosticReport{
		GeneratedAt: time.Now().Format(time.RFC3339),
		OS:          runtime.GOOS,
		Arch:        runtime.GOARCH,
	}

	var items []DiagnosticItem

	// 1. 扫描目录检查
	items = append(items, checkScanDirs()...)

	// 2. 数据目录检查
	items = append(items, checkDataDir()...)

	// 3. PDF 渲染工具检查
	items = append(items, checkPdfRenderer()...)

	// 4. 缩略图工具检查
	items = append(items, checkThumbnailTools()...)

	// 5. 数据库检查
	items = append(items, checkDatabase()...)

	// 6. Docker / NAS 环境检测
	items = append(items, checkEnvironment()...)

	// 7. 磁盘空间检查
	items = append(items, checkDiskSpace()...)

	// 汇总
	report.Items = items
	for _, item := range items {
		report.Summary.Total++
		switch item.Status {
		case "ok":
			report.Summary.OK++
		case "warning":
			report.Summary.Warnings++
		case "error":
			report.Summary.Errors++
		}
	}

	c.JSON(http.StatusOK, report)
}

// checkScanDirs 检查所有扫描目录
func checkScanDirs() []DiagnosticItem {
	var items []DiagnosticItem

	libs, _ := store.GetAllLibraries()
	var dirs []string
	for _, lib := range libs {
		if lib.RootPath != "" {
			dirs = append(dirs, lib.RootPath)
		}
		extra, _ := store.GetLibraryRootPaths(lib.ID)
		dirs = append(dirs, extra...)
	}

	if len(dirs) == 0 {
		items = append(items, DiagnosticItem{
			ID:      "scan-dirs-empty",
			Name:    "书库目录配置",
			Status:  "error",
			Message: "未配置任何书库扫描目录",
			Hint:    "请在书库管理中添加有效的书库目录",
		})
		return items
	}

	items = append(items, DiagnosticItem{
		ID:      "scan-dirs-count",
		Name:    "书库目录数量",
		Status:  "ok",
		Message: fmt.Sprintf("已配置 %d 个书库扫描目录", len(dirs)),
	})

	for _, dir := range dirs {
		id := "scan-dir:" + dir
		name := fmt.Sprintf("目录: %s", filepath.Base(dir))

		info, err := os.Stat(dir)
		if err != nil {
			if os.IsNotExist(err) {
				items = append(items, DiagnosticItem{
					ID:      id,
					Name:    name,
					Status:  "error",
					Message: "目录不存在",
					Detail:  dir,
					Hint:    "请确认 Docker 挂载路径是否正确，或在站点设置中修正目录路径",
				})
			} else {
				items = append(items, DiagnosticItem{
					ID:      id,
					Name:    name,
					Status:  "error",
					Message: "无法访问目录",
					Detail:  fmt.Sprintf("%s: %v", dir, err),
					Hint:    "请检查目录权限（PUID/PGID），确认容器有读取权限",
				})
			}
			continue
		}

		if !info.IsDir() {
			items = append(items, DiagnosticItem{
				ID:      id,
				Name:    name,
				Status:  "error",
				Message: "路径不是目录",
				Detail:  dir,
			})
			continue
		}

		// 尝试读取目录
		entries, err := os.ReadDir(dir)
		if err != nil {
			items = append(items, DiagnosticItem{
				ID:      id,
				Name:    name,
				Status:  "error",
				Message: "目录不可读",
				Detail:  fmt.Sprintf("%s: %v", dir, err),
				Hint:    "请检查目录权限，确认容器用户有读取权限",
			})
			continue
		}

		items = append(items, DiagnosticItem{
			ID:      id,
			Name:    name,
			Status:  "ok",
			Message: fmt.Sprintf("可读，包含 %d 个子项", len(entries)),
			Detail:  dir,
		})
	}

	return items
}

// checkDataDir 检查数据目录
func checkDataDir() []DiagnosticItem {
	var items []DiagnosticItem

	dataDir := config.DataDir()
	if dataDir == "" {
		items = append(items, DiagnosticItem{
			ID:      "data-dir",
			Name:    "数据目录",
			Status:  "error",
			Message: "数据目录未配置",
		})
		return items
	}

	info, err := os.Stat(dataDir)
	if err != nil {
		items = append(items, DiagnosticItem{
			ID:      "data-dir",
			Name:    "数据目录",
			Status:  "error",
			Message: "数据目录不可访问",
			Detail:  err.Error(),
		})
		return items
	}

	if !info.IsDir() {
		items = append(items, DiagnosticItem{
			ID:      "data-dir",
			Name:    "数据目录",
			Status:  "error",
			Message: "数据目录路径不是目录",
		})
		return items
	}

	// 检查是否可写
	testFile := filepath.Join(dataDir, ".nowen-write-test")
	if err := os.WriteFile(testFile, []byte("test"), 0644); err != nil {
		items = append(items, DiagnosticItem{
			ID:      "data-dir",
			Name:    "数据目录",
			Status:  "error",
			Message: "数据目录不可写",
			Detail:  fmt.Sprintf("%s: %v", dataDir, err),
			Hint:    "请检查目录写入权限（PUID/PGID），确认容器用户有写入权限",
		})
	} else {
		os.Remove(testFile)
		items = append(items, DiagnosticItem{
			ID:      "data-dir",
			Name:    "数据目录",
			Status:  "ok",
			Message: "可读可写",
			Detail:  dataDir,
		})
	}

	// 检查缓存目录
	cacheDir := config.GetPagesCacheDir()
	if cacheDir != "" {
		if _, err := os.Stat(cacheDir); err != nil {
			items = append(items, DiagnosticItem{
				ID:      "cache-dir",
				Name:    "缓存目录",
				Status:  "warning",
				Message: "缓存目录不存在或不可访问",
				Detail:  cacheDir,
				Hint:    "缓存目录会在首次使用时自动创建",
			})
		} else {
			items = append(items, DiagnosticItem{
				ID:      "cache-dir",
				Name:    "缓存目录",
				Status:  "ok",
				Message: "缓存目录正常",
				Detail:  cacheDir,
			})
		}
	}

	return items
}

// checkPdfRenderer 检查 PDF 渲染工具
func checkPdfRenderer() []DiagnosticItem {
	var items []DiagnosticItem

	tools := []string{"mutool", "pdftoppm", "convert"}
	var found []string
	for _, name := range tools {
		if p, ok := config.LookPdfTool(name, exec.LookPath); ok && p != "" {
			found = append(found, name)
		}
	}

	if len(found) > 0 {
		items = append(items, DiagnosticItem{
			ID:      "pdf-renderer",
			Name:    "PDF 渲染工具",
			Status:  "ok",
			Message: fmt.Sprintf("已安装: %v", found),
		})
	} else {
		hint := ""
		switch runtime.GOOS {
		case "windows":
			hint = "请下载 mutool（MuPDF）并放入 PATH，或在站点设置中配置 PdfRendererPath"
		case "darwin":
			hint = "建议执行: brew install mupdf-tools 或 brew install poppler"
		default:
			hint = "Docker 镜像已内置。如非 Docker 部署: apt install mupdf-tools 或 apk add mupdf-tools"
		}
		items = append(items, DiagnosticItem{
			ID:      "pdf-renderer",
			Name:    "PDF 渲染工具",
			Status:  "warning",
			Message: "未检测到 PDF 渲染工具",
			Hint:    hint,
		})
	}

	return items
}

// checkThumbnailTools 检查缩略图生成工具
func checkThumbnailTools() []DiagnosticItem {
	var items []DiagnosticItem

	// 检查 vips（libvips）- Go 项目常用的图片处理库
	// 也检查 ImageMagick 的 convert
	thumbnailTools := []struct {
		name string
		cmd  string
	}{
		{"vips", "vips"},
		{"convert (ImageMagick)", "convert"},
		{"ffmpeg", "ffmpeg"},
	}

	var found []string
	for _, tool := range thumbnailTools {
		if _, err := exec.LookPath(tool.cmd); err == nil {
			found = append(found, tool.name)
		}
	}

	if len(found) > 0 {
		items = append(items, DiagnosticItem{
			ID:      "thumbnail-tools",
			Name:    "缩略图工具",
			Status:  "ok",
			Message: fmt.Sprintf("可用工具: %v", found),
		})
	} else {
		items = append(items, DiagnosticItem{
			ID:      "thumbnail-tools",
			Name:    "缩略图工具",
			Status:  "warning",
			Message: "未检测到缩略图生成工具",
			Hint:    "缩略图功能可能受限。建议安装 vips 或 ImageMagick",
		})
	}

	return items
}

// checkDatabase 检查数据库状态
func checkDatabase() []DiagnosticItem {
	var items []DiagnosticItem

	// 检查数据库连接
	stats := store.GetDBStats()
	if stats == nil {
		items = append(items, DiagnosticItem{
			ID:      "database",
			Name:    "数据库连接",
			Status:  "error",
			Message: "无法获取数据库状态",
		})
		return items
	}

	items = append(items, DiagnosticItem{
		ID:      "database",
		Name:    "数据库",
		Status:  "ok",
		Message: "数据库连接正常",
		Detail:  stats.Path,
	})

	// 检查漫画数量
	comicCount, err := store.CountComics()
	if err == nil {
		items = append(items, DiagnosticItem{
			ID:      "comic-count",
			Name:    "漫画/小说数量",
			Status:  "ok",
			Message: fmt.Sprintf("共 %d 部", comicCount),
		})
	}

	return items
}

// checkEnvironment 检查运行环境
func checkEnvironment() []DiagnosticItem {
	var items []DiagnosticItem

	// Docker 检测
	isDocker := false
	if _, err := os.Stat("/.dockerenv"); err == nil {
		isDocker = true
	}
	if data, err := os.ReadFile("/proc/1/cgroup"); err == nil {
		if strings.Contains(string(data), "docker") || strings.Contains(string(data), "kubepods") {
			isDocker = true
		}
	}

	if isDocker {
		items = append(items, DiagnosticItem{
			ID:      "docker",
			Name:    "Docker 环境",
			Status:  "ok",
			Message: "检测到 Docker 环境",
		})

		// 检查 PUID/PGID
		puid := os.Getenv("PUID")
		pgid := os.Getenv("PGID")
		if puid != "" || pgid != "" {
			items = append(items, DiagnosticItem{
				ID:      "docker-puid-pgid",
				Name:    "PUID/PGID",
				Status:  "ok",
				Message: fmt.Sprintf("PUID=%s, PGID=%s", puid, pgid),
			})
		} else {
			items = append(items, DiagnosticItem{
				ID:      "docker-puid-pgid",
				Name:    "PUID/PGID",
				Status:  "warning",
				Message: "未设置 PUID/PGID 环境变量",
				Hint:    "建议在 Docker 配置中设置 PUID 和 PGID，确保文件权限正确。示例: -e PUID=1000 -e PGID=1000",
			})
		}
	} else {
		items = append(items, DiagnosticItem{
			ID:      "environment",
			Name:    "运行环境",
			Status:  "ok",
			Message: "非 Docker 环境",
		})
	}

	// Go 版本
	items = append(items, DiagnosticItem{
		ID:      "go-version",
		Name:    "Go 版本",
		Status:  "ok",
		Message: runtime.Version(),
	})

	return items
}

// checkDiskSpace 检查磁盘空间
func checkDiskSpace() []DiagnosticItem {
	return checkDiskSpacePlatform()
}

// formatBytes 格式化字节数为人类可读格式
func formatBytes(bytes int64) string {
	const (
		KB = 1024
		MB = KB * 1024
		GB = MB * 1024
		TB = GB * 1024
	)
	switch {
	case bytes >= TB:
		return fmt.Sprintf("%.1f TB", float64(bytes)/float64(TB))
	case bytes >= GB:
		return fmt.Sprintf("%.1f GB", float64(bytes)/float64(GB))
	case bytes >= MB:
		return fmt.Sprintf("%.1f MB", float64(bytes)/float64(MB))
	case bytes >= KB:
		return fmt.Sprintf("%.1f KB", float64(bytes)/float64(KB))
	default:
		return fmt.Sprintf("%d B", bytes)
	}
}
