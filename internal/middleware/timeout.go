package middleware

import (
	"context"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

// RequestTimeout 返回一个全局请求超时中间件。
// 对于大多数API请求设置超时，防止远程调用（如元数据抓取、AI分析）挂起占用 goroutine。
// 排除下载、上传、SSE等需要长连接的路径。
//
// 注意：不在独立 goroutine 中调用 c.Next()，避免 Gin Context 并发写入冲突。
// 仅通过 context.WithTimeout 传递 deadline，让下游 handler 自行响应 ctx.Done()。
func RequestTimeout(timeout time.Duration) gin.HandlerFunc {
	return func(c *gin.Context) {
		// 跳过不需要超时的长连接路径
		path := c.Request.URL.Path
		if isLongRunningPath(path) {
			c.Next()
			return
		}

		ctx, cancel := context.WithTimeout(c.Request.Context(), timeout)
		defer cancel()

		c.Request = c.Request.WithContext(ctx)

		c.Next()

		// 如果 context 已超时且还没写过 response，返回 504
		if ctx.Err() != nil && !c.Writer.Written() {
			c.Abort()
			c.JSON(http.StatusGatewayTimeout, gin.H{
				"error":   "Request timeout",
				"message": "请求处理超时，请稍后重试",
			})
		}
	}
}

// isLongRunningPath 判断是否是需要长连接的路径
func isLongRunningPath(path string) bool {
	longRunningPrefixes := []string{
		"/api/upload",
		"/api/opds/download",
		"/api/export",
		"/api/sync",
		"/api/comics/batch",
		"/api/metadata/batch",
		"/api/metadata/scan",
	}
	for _, prefix := range longRunningPrefixes {
		if len(path) >= len(prefix) && path[:len(prefix)] == prefix {
			return true
		}
	}
	return false
}
