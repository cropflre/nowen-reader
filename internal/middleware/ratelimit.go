package middleware

import (
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// rateLimiter implements a token bucket rate limiter per client IP.
type rateLimiter struct {
	mu       sync.Mutex
	visitors map[string]*visitor
	rate     int           // tokens per interval
	interval time.Duration // refill interval
	burst    int           // max tokens (bucket size)
}

type visitor struct {
	tokens   int
	lastSeen time.Time
}

// newRateLimiter creates a rate limiter.
//
//	rate: number of requests allowed per interval
//	interval: the time window
//	burst: maximum burst size
func newRateLimiter(rate int, interval time.Duration, burst int) *rateLimiter {
	rl := &rateLimiter{
		visitors: make(map[string]*visitor),
		rate:     rate,
		interval: interval,
		burst:    burst,
	}

	// Start cleanup goroutine — remove stale visitors every minute
	go func() {
		ticker := time.NewTicker(1 * time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			rl.cleanup()
		}
	}()

	return rl
}

// allow checks if a request from the given key is allowed.
func (rl *rateLimiter) allow(key string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	v, exists := rl.visitors[key]
	now := time.Now()

	if !exists {
		rl.visitors[key] = &visitor{
			tokens:   rl.burst - 1,
			lastSeen: now,
		}
		return true
	}

	// Refill tokens based on elapsed time
	elapsed := now.Sub(v.lastSeen)
	refill := int(elapsed / rl.interval) * rl.rate
	if refill > 0 {
		v.tokens += refill
		if v.tokens > rl.burst {
			v.tokens = rl.burst
		}
		v.lastSeen = now
	}

	if v.tokens <= 0 {
		return false
	}

	v.tokens--
	return true
}

// cleanup removes visitors not seen in the last 5 minutes.
func (rl *rateLimiter) cleanup() {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	cutoff := time.Now().Add(-5 * time.Minute)
	for key, v := range rl.visitors {
		if v.lastSeen.Before(cutoff) {
			delete(rl.visitors, key)
		}
	}
}

// getClientIP extracts the client IP for rate limiting.
func getClientIP(c *gin.Context) string {
	ip := c.ClientIP()
	if ip == "" {
		ip = c.RemoteIP()
	}
	return ip
}

// ============================================================
// Exported middleware constructors
// ============================================================

// RateLimit returns a general-purpose rate limit middleware.
// Default: 100 requests per second with a burst of 200.
func RateLimit() gin.HandlerFunc {
	limiter := newRateLimiter(100, time.Second, 200)
	return func(c *gin.Context) {
		if !limiter.allow(getClientIP(c)) {
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
				"error": "Too many requests. Please try again later.",
			})
			return
		}
		c.Next()
	}
}

// RateLimitStrict returns a stricter rate limiter for sensitive endpoints.
// Default: 10 requests per minute with a burst of 20.
func RateLimitStrict() gin.HandlerFunc {
	limiter := newRateLimiter(10, time.Minute, 20)
	return func(c *gin.Context) {
		if !limiter.allow(getClientIP(c)) {
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
				"error": "Too many requests. Please try again later.",
			})
			return
		}
		c.Next()
	}
}

// RateLimitAuth returns a rate limiter for auth endpoints (login/register).
// Default: 5 requests per minute with a burst of 10.
func RateLimitAuth() gin.HandlerFunc {
	limiter := newRateLimiter(5, time.Minute, 10)
	return func(c *gin.Context) {
		if !limiter.allow(getClientIP(c)) {
			c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{
				"error": "Too many login attempts. Please wait a moment.",
			})
			return
		}
		c.Next()
	}
}
