package service

import (
	"log"
	"time"

	"github.com/nowen-reader/nowen-reader/internal/store"
)

// StartSessionCleanup 定期清理过期的用户 Session（每 6 小时执行一次）。
func StartSessionCleanup() {
	// 首次启动时立即清理一次
	go func() {
		cleanExpiredSessions()

		ticker := time.NewTicker(6 * time.Hour)
		defer ticker.Stop()

		for range ticker.C {
			cleanExpiredSessions()
		}
	}()
	log.Println("[session-cleanup] Session cleanup scheduler started (interval: 6h)")
}

func cleanExpiredSessions() {
	count, err := store.CleanExpiredSessions()
	if err != nil {
		log.Printf("[session-cleanup] Error cleaning sessions: %v", err)
		return
	}
	if count > 0 {
		log.Printf("[session-cleanup] Cleaned %d expired sessions", count)
	}
}
