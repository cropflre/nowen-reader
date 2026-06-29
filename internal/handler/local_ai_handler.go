package handler

import (
	"net/http"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/service"
)

// ============================================================
// 本地模型管理 API
// ============================================================

// LocalAIHandler 本地模型 handler
type LocalAIHandler struct{}

// GetStatus 获取本地模型状态
func (h *LocalAIHandler) GetStatus(c *gin.Context) {
	status := service.LocalAI.Status()
	c.JSON(http.StatusOK, status)
}

// Start 启动本地模型服务
func (h *LocalAIHandler) Start(c *gin.Context) {
	if err := service.LocalAI.Start(); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "启动中，请等待服务就绪"})
}

// Stop 停止本地模型服务
func (h *LocalAIHandler) Stop(c *gin.Context) {
	if err := service.LocalAI.Stop(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "已停止"})
}

// TestConnection 测试本地模型连接
func (h *LocalAIHandler) TestConnection(c *gin.Context) {
	if !service.LocalAI.IsRunning() {
		c.JSON(http.StatusBadRequest, gin.H{"error": "本地模型服务未运行"})
		return
	}

	if err := service.LocalAI.HealthCheck(); err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "连接成功",
		"url":     service.LocalAI.GetAPIURL(),
	})
}

// ScanModels 扫描模型文件
func (h *LocalAIHandler) ScanModels(c *gin.Context) {
	dir := c.Query("dir")
	if dir == "" {
		// 返回配置中的模型目录
		cfg := service.LoadAIConfig()
		if cfg.LocalModelPath != "" {
			dir = filepath.Dir(cfg.LocalModelPath)
		} else {
			c.JSON(http.StatusBadRequest, gin.H{"error": "未指定目录"})
			return
		}
	}

	// 安全检查：只允许扫描绝对路径
	if !filepath.IsAbs(dir) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "必须使用绝对路径"})
		return
	}

	models, err := service.ScanModelFiles(dir)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"dir":     dir,
		"models":  models,
		"count":   len(models),
	})
}

// SaveConfig 保存本地模型配置
func (h *LocalAIHandler) SaveConfig(c *gin.Context) {
	var req struct {
		EnableLocalAI   *bool   `json:"enableLocalAI"`
		LocalEngine     *string `json:"localEngine"`
		LocalBinaryPath *string `json:"localBinaryPath"`
		LocalModelPath  *string `json:"localModelPath"`
		LocalHost       *string `json:"localHost"`
		LocalPort       *int    `json:"localPort"`
		ContextSize     *int    `json:"contextSize"`
		Threads         *int    `json:"threads"`
		GPULayers       *string `json:"gpuLayers"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的请求"})
		return
	}

	cfg := service.LoadAIConfig()

	if req.EnableLocalAI != nil {
		cfg.EnableLocalAI = *req.EnableLocalAI
	}
	if req.LocalEngine != nil {
		cfg.LocalEngine = *req.LocalEngine
	}
	if req.LocalBinaryPath != nil {
		// 安全检查：只允许 .exe 文件
		path := *req.LocalBinaryPath
		if path != "" && !strings.HasSuffix(strings.ToLower(path), ".exe") && !strings.HasSuffix(strings.ToLower(path), "llama-server") {
			c.JSON(http.StatusBadRequest, gin.H{"error": "只允许 llama-server 可执行文件"})
			return
		}
		cfg.LocalBinaryPath = path
	}
	if req.LocalModelPath != nil {
		// 安全检查：只允许 .gguf 文件
		path := *req.LocalModelPath
		if path != "" && !strings.HasSuffix(strings.ToLower(path), ".gguf") {
			c.JSON(http.StatusBadRequest, gin.H{"error": "只允许 .gguf 模型文件"})
			return
		}
		cfg.LocalModelPath = path
	}
	if req.LocalHost != nil {
		// 安全检查：只允许 127.0.0.1 或 localhost
		host := *req.LocalHost
		if host != "127.0.0.1" && host != "localhost" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "只允许绑定 127.0.0.1 或 localhost"})
			return
		}
		cfg.LocalHost = host
	}
	if req.LocalPort != nil {
		port := *req.LocalPort
		if port < 1024 || port > 65535 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "端口必须在 1024-65535 之间"})
			return
		}
		cfg.LocalPort = port
	}
	if req.ContextSize != nil {
		cfg.ContextSize = *req.ContextSize
	}
	if req.Threads != nil {
		cfg.Threads = *req.Threads
	}
	if req.GPULayers != nil {
		cfg.GPULayers = *req.GPULayers
	}

	if err := service.SaveAIConfig(cfg); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "保存配置失败"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "配置已保存"})
}
