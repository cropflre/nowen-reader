package middleware

import (
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// ErrorLogEntry 表示一条错误日志记录
type ErrorLogEntry struct {
	Time      string `json:"time"`
	Status    int    `json:"status"`
	Method    string `json:"method"`
	Path      string `json:"path"`
	ClientIP  string `json:"clientIP"`
	Latency   string `json:"latency"`
	LatencyMs int64  `json:"latencyMs"`
	BodySize  int    `json:"bodySize"`
	Error     string `json:"error,omitempty"`
}

// ErrorLogBuffer 是线程安全的环形缓冲区，用于存储最近的错误日志
type ErrorLogBuffer struct {
	mu      sync.RWMutex
	entries []ErrorLogEntry
	maxSize int
}

var errorLogBuffer = &ErrorLogBuffer{
	entries: make([]ErrorLogEntry, 0, 200),
	maxSize: 200, // 最多保留最近200条错误日志
}

// GetErrorLogBuffer 返回全局错误日志缓冲区
func GetErrorLogBuffer() *ErrorLogBuffer {
	return errorLogBuffer
}

// Add 向缓冲区添加一条日志
func (b *ErrorLogBuffer) Add(entry ErrorLogEntry) {
	b.mu.Lock()
	defer b.mu.Unlock()

	if len(b.entries) >= b.maxSize {
		// 移除最旧的一条
		b.entries = b.entries[1:]
	}
	b.entries = append(b.entries, entry)
}

// GetAll 返回所有日志条目（从最新到最旧）
func (b *ErrorLogBuffer) GetAll() []ErrorLogEntry {
	b.mu.RLock()
	defer b.mu.RUnlock()

	result := make([]ErrorLogEntry, len(b.entries))
	// 反转顺序，最新的在前面
	for i, j := 0, len(b.entries)-1; j >= 0; i, j = i+1, j-1 {
		result[i] = b.entries[j]
	}
	return result
}

// Clear 清空所有日志
func (b *ErrorLogBuffer) Clear() {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.entries = b.entries[:0]
}

// Count 返回当前日志数量
func (b *ErrorLogBuffer) Count() int {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return len(b.entries)
}

// ErrorLogCapture 返回一个中间件，捕获所有 4xx/5xx 响应并记录到内存缓冲区
func ErrorLogCapture() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()

		// 处理请求
		c.Next()

		status := c.Writer.Status()
		// 只记录 4xx 和 5xx 错误（排除 404 静态资源请求以减少噪音）
		if status >= 400 {
			path := c.Request.URL.Path
			raw := c.Request.URL.RawQuery
			if raw != "" {
				path = path + "?" + raw
			}

			latency := time.Since(start)

			// 尝试获取错误信息
			errMsg := ""
			if len(c.Errors) > 0 {
				errMsg = c.Errors.String()
			}

			entry := ErrorLogEntry{
				Time:      time.Now().Format("2006-01-02 15:04:05"),
				Status:    status,
				Method:    c.Request.Method,
				Path:      path,
				ClientIP:  c.ClientIP(),
				Latency:   latency.String(),
				LatencyMs: latency.Milliseconds(),
				BodySize:  c.Writer.Size(),
				Error:     errMsg,
			}

			errorLogBuffer.Add(entry)
		}
	}
}
