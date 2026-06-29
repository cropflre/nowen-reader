package service

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

// ============================================================
// 本地模型服务管理 (llama.cpp)
// ============================================================

// LocalAIService 管理本地模型进程
type LocalAIService struct {
	mu      sync.RWMutex
	cmd     *exec.Cmd
	running bool
	cancel  context.CancelFunc
}

var LocalAI = &LocalAIService{}

// LocalAIStatus 本地模型状态
type LocalAIStatus struct {
	Running    bool   `json:"running"`
	PID        int    `json:"pid,omitempty"`
	Port       int    `json:"port"`
	ModelPath  string `json:"modelPath"`
	Engine     string `json:"engine"`
	Error      string `json:"error,omitempty"`
	Uptime     string `json:"uptime,omitempty"`
}

var localAIStartTime time.Time

// Start 启动本地模型服务
func (s *LocalAIService) Start() error {
	cfg := LoadAIConfig()

	if !cfg.EnableLocalAI {
		return fmt.Errorf("本地模型未启用")
	}

	if cfg.LocalBinaryPath == "" {
		return fmt.Errorf("未配置 llama-server 路径")
	}

	if cfg.LocalModelPath == "" {
		return fmt.Errorf("未配置模型文件路径")
	}

	// 检查文件是否存在
	if _, err := os.Stat(cfg.LocalBinaryPath); os.IsNotExist(err) {
		return fmt.Errorf("llama-server 不存在: %s", cfg.LocalBinaryPath)
	}

	if _, err := os.Stat(cfg.LocalModelPath); os.IsNotExist(err) {
		return fmt.Errorf("模型文件不存在: %s", cfg.LocalModelPath)
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	// 如果已经在运行，先停止
	if s.running && s.cmd != nil {
		s.stopLocked()
	}

	// 构建启动参数
	args := s.buildArgs(cfg)

	log.Printf("[local-ai] 启动 llama-server: %s %s", cfg.LocalBinaryPath, strings.Join(args, " "))

	ctx, cancel := context.WithCancel(context.Background())
	s.cancel = cancel

	s.cmd = exec.CommandContext(ctx, cfg.LocalBinaryPath, args...)
	s.cmd.Stdout = os.Stdout
	s.cmd.Stderr = os.Stderr

	// Windows 隐藏窗口
	s.cmd.SysProcAttr = getSysProcAttr()

	if err := s.cmd.Start(); err != nil {
		cancel()
		return fmt.Errorf("启动失败: %v", err)
	}

	s.running = true
	localAIStartTime = time.Now()

	// 等待服务就绪
	go func() {
		if err := s.waitForReady(cfg.LocalPort, 30*time.Second); err != nil {
			log.Printf("[local-ai] 服务启动超时: %v", err)
			s.mu.Lock()
			s.running = false
			s.mu.Unlock()
			return
		}
		log.Printf("[local-ai] 服务已就绪，端口: %d", cfg.LocalPort)
	}()

	// 监听进程退出
	go func() {
		err := s.cmd.Wait()
		s.mu.Lock()
		s.running = false
		s.cmd = nil
		s.mu.Unlock()
		if err != nil {
			log.Printf("[local-ai] 进程退出: %v", err)
		} else {
			log.Printf("[local-ai] 进程正常退出")
		}
	}()

	return nil
}

// Stop 停止本地模型服务
func (s *LocalAIService) Stop() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.stopLocked()
}

func (s *LocalAIService) stopLocked() error {
	if s.cancel != nil {
		s.cancel()
		s.cancel = nil
	}
	if s.cmd != nil && s.cmd.Process != nil {
		if err := s.cmd.Process.Kill(); err != nil {
			log.Printf("[local-ai] 停止进程失败: %v", err)
		}
	}
	s.running = false
	s.cmd = nil
	return nil
}

// Status 获取服务状态
func (s *LocalAIService) Status() LocalAIStatus {
	s.mu.RLock()
	defer s.mu.RUnlock()

	cfg := LoadAIConfig()
	status := LocalAIStatus{
		Running:   s.running,
		Port:      cfg.LocalPort,
		ModelPath: cfg.LocalModelPath,
		Engine:    cfg.LocalEngine,
	}

	if s.cmd != nil && s.cmd.Process != nil {
		status.PID = s.cmd.Process.Pid
	}

	if s.running && !localAIStartTime.IsZero() {
		status.Uptime = time.Since(localAIStartTime).Round(time.Second).String()
	}

	// 检查健康状态
	if s.running {
		if err := s.HealthCheck(); err != nil {
			status.Error = err.Error()
		}
	}

	return status
}

// HealthCheck 健康检查
func (s *LocalAIService) HealthCheck() error {
	cfg := LoadAIConfig()
	url := fmt.Sprintf("http://%s:%d/health", cfg.LocalHost, cfg.LocalPort)

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Get(url)
	if err != nil {
		return fmt.Errorf("健康检查失败: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("健康检查返回状态码: %d", resp.StatusCode)
	}

	return nil
}

// IsRunning 是否正在运行
func (s *LocalAIService) IsRunning() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.running
}

// GetAPIURL 获取本地 API URL
func (s *LocalAIService) GetAPIURL() string {
	cfg := LoadAIConfig()
	return fmt.Sprintf("http://%s:%d/v1", cfg.LocalHost, cfg.LocalPort)
}

// buildArgs 构建 llama-server 启动参数
func (s *LocalAIService) buildArgs(cfg AIConfig) []string {
	args := []string{
		"-m", cfg.LocalModelPath,
		"--host", cfg.LocalHost,
		"--port", strconv.Itoa(cfg.LocalPort),
		"-c", strconv.Itoa(cfg.ContextSize),
	}

	// 线程数
	if cfg.Threads > 0 {
		args = append(args, "-t", strconv.Itoa(cfg.Threads))
	}

	// GPU 层数
	if cfg.GPULayers != "" {
		if cfg.GPULayers == "auto" {
			args = append(args, "-ngl", "99")
		} else {
			args = append(args, "-ngl", cfg.GPULayers)
		}
	}

	return args
}

// waitForReady 等待服务就绪
func (s *LocalAIService) waitForReady(port int, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	url := fmt.Sprintf("http://127.0.0.1:%d/health", port)

	for time.Now().Before(deadline) {
		select {
		case <-time.After(500 * time.Millisecond):
			client := &http.Client{Timeout: 2 * time.Second}
			resp, err := client.Get(url)
			if err == nil {
				resp.Body.Close()
				if resp.StatusCode == http.StatusOK {
					return nil
				}
			}
		}
	}

	return fmt.Errorf("等待服务就绪超时")
}

// ScanModelFiles 扫描目录下的 GGUF 模型文件
func ScanModelFiles(dir string) ([]string, error) {
	if dir == "" {
		return nil, fmt.Errorf("目录为空")
	}

	var models []string
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("读取目录失败: %v", err)
	}

	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		ext := strings.ToLower(filepath.Ext(entry.Name()))
		if ext == ".gguf" {
			models = append(models, filepath.Join(dir, entry.Name()))
		}
	}

	return models, nil
}
