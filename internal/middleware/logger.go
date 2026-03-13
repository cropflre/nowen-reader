package middleware

import (
	"fmt"
	"log"
	"time"

	"github.com/gin-gonic/gin"
)

// RequestLogger returns a middleware that logs each request with timing info.
// It replaces Gin's default logger with a more concise format.
func RequestLogger() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		path := c.Request.URL.Path
		raw := c.Request.URL.RawQuery

		// Process request
		c.Next()

		// Calculate latency
		latency := time.Since(start)
		status := c.Writer.Status()
		method := c.Request.Method
		clientIP := c.ClientIP()
		size := c.Writer.Size()

		if raw != "" {
			path = path + "?" + raw
		}

		// Color-code status
		statusColor := colorForStatus(status)
		methodColor := colorForMethod(method)

		log.Printf("%s %3d %s| %13v | %15s | %s %-7s %s %s | %d bytes",
			statusColor, status, resetColor,
			latency,
			clientIP,
			methodColor, method, resetColor,
			path,
			size,
		)
	}
}

// ANSI color codes
const (
	green   = "\033[97;42m"
	white   = "\033[90;47m"
	yellow  = "\033[90;43m"
	red     = "\033[97;41m"
	blue    = "\033[97;44m"
	magenta = "\033[97;45m"
	cyan    = "\033[97;46m"

	resetColor = "\033[0m"
)

func colorForStatus(code int) string {
	switch {
	case code >= 200 && code < 300:
		return green
	case code >= 300 && code < 400:
		return white
	case code >= 400 && code < 500:
		return yellow
	default:
		return red
	}
}

func colorForMethod(method string) string {
	switch method {
	case "GET":
		return blue
	case "POST":
		return cyan
	case "PUT":
		return yellow
	case "DELETE":
		return red
	case "PATCH":
		return green
	case "HEAD":
		return magenta
	case "OPTIONS":
		return white
	default:
		return resetColor
	}
}

// QuietLogger returns a middleware that only logs errors (4xx/5xx).
// Useful for production to reduce log noise.
func QuietLogger() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		path := c.Request.URL.Path

		c.Next()

		status := c.Writer.Status()
		if status >= 400 {
			latency := time.Since(start)
			log.Printf("[ERROR] %d | %v | %s %s | %s",
				status, latency, c.Request.Method, path, c.ClientIP())
		}
	}
}

// Recovery returns a middleware that recovers from panics and logs the error.
func Recovery() gin.HandlerFunc {
	return func(c *gin.Context) {
		defer func() {
			if err := recover(); err != nil {
				log.Printf("[PANIC] %s %s: %v", c.Request.Method, c.Request.URL.Path, err)
				c.AbortWithStatusJSON(500, gin.H{
					"error": fmt.Sprintf("internal server error: %v", err),
				})
			}
		}()
		c.Next()
	}
}
