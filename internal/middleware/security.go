package middleware

import (
	"strings"

	"github.com/gin-gonic/gin"
)

// SecurityHeaders returns a middleware that adds common security headers.
func SecurityHeaders() gin.HandlerFunc {
	return func(c *gin.Context) {
		// Prevent MIME type sniffing
		c.Header("X-Content-Type-Options", "nosniff")

		// Prevent clickjacking
		c.Header("X-Frame-Options", "SAMEORIGIN")

		// XSS protection (for older browsers)
		c.Header("X-XSS-Protection", "1; mode=block")

		// Referrer policy
		c.Header("Referrer-Policy", "strict-origin-when-cross-origin")

		// Permissions policy (disable unnecessary features)
		c.Header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")

		// Content Security Policy — 允许自身和内联样式（Tailwind需要），允许图片代理和blob
		c.Header("Content-Security-Policy",
			"default-src 'self'; "+
				"script-src 'self'; "+
				"style-src 'self' 'unsafe-inline'; "+
				"img-src 'self' data: blob: https:; "+
				"font-src 'self' data:; "+
				"connect-src 'self'; "+
				"frame-ancestors 'self'")

		// HSTS — 仅在 HTTPS 连接时发送
		if c.Request.TLS != nil || strings.Contains(strings.ToLower(c.GetHeader("X-Forwarded-Proto")), "https") {
			c.Header("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		}

		c.Next()
	}
}

// RateLimitHeaders returns a middleware that adds basic rate limiting info headers.
// This is a lightweight implementation; for production use a proper rate limiter.
func RateLimitHeaders() gin.HandlerFunc {
	return func(c *gin.Context) {
		// Placeholder for rate limiting headers
		// In a production system, you'd track request counts per IP
		c.Header("X-RateLimit-Limit", "1000")
		c.Next()
	}
}
