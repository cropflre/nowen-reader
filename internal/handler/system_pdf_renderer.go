package handler

import (
	"net/http"
	"os/exec"
	"runtime"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/archive"
	"github.com/nowen-reader/nowen-reader/internal/config"
)

// pdfRendererStatus 描述当前服务器 PDF 渲染工具的可用情况，用于前端提前感知。
type pdfRendererStatus struct {
	Available bool              `json:"available"`        // 是否至少安装了一个可用工具
	Tools     map[string]string `json:"tools"`            // 工具名 -> 路径（未找到为空字符串）
	Active    string            `json:"active,omitempty"` // 实际会被使用的工具（按优先级 pdftoppm > mutool > convert）
	OS        string            `json:"os"`               // 运行操作系统，便于前端给出针对性安装提示
	Hint      string            `json:"hint,omitempty"`   // 安装提示文案
}

// GetPdfRendererStatus 返回 PDF 渲染工具的安装情况。
// 前端在打开 PDF 阅读器、内页选封面对话框时调用，以决定是否展示醒目的安装提示。
//
// GET /api/system/pdf-renderer
func GetPdfRendererStatus(c *gin.Context) {
	tools, active := detectPdfRenderers(exec.LookPath)

	available := active != ""

	hint := ""
	if !available {
		switch runtime.GOOS {
		case "windows":
			hint = "未检测到 PDF 渲染工具。请下载 mutool（MuPDF）单文件可执行程序，放入 PATH 或在站点设置 → 高级 中填写 PdfRendererPath。"
		case "darwin":
			hint = "未检测到 PDF 渲染工具。建议执行：brew install poppler（优先）或 brew install mupdf-tools。"
		default:
			hint = "未检测到 PDF 渲染工具。优先安装 poppler-utils，也可安装 mupdf-tools 或 ImageMagick。"
		}
	}

	c.JSON(http.StatusOK, pdfRendererStatus{
		Available: available,
		Tools:     tools,
		Active:    active,
		OS:        runtime.GOOS,
		Hint:      hint,
	})
}

type executableLookup func(string) (string, error)

func detectPdfRenderers(lookPath executableLookup) (map[string]string, string) {
	tools := make(map[string]string)
	for _, name := range archive.PDFRendererPriority() {
		tools[name] = ""
		if path, ok := config.LookPdfTool(name, lookPath); ok {
			tools[name] = path
		}
	}
	return tools, selectActivePdfRenderer(tools)
}

func selectActivePdfRenderer(tools map[string]string) string {
	for _, name := range archive.PDFRendererPriority() {
		if tools[name] != "" {
			return name
		}
	}
	return ""
}
