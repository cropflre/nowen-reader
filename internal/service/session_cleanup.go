package service

import (
	"log"
	"time"

	"github.com/nowen-reader/nowen-reader/internal/store"
)

// StartSessionCleanup 定期清理过期的用户 Session（每 6 小时执行一次）。
// 同时启动低频孤儿内容缓存 GC。缓存 GC 延迟执行，给启动时 initial
// quick-sync 留出时间先把已经移出书库的数据库记录清理掉。
func StartSessionCleanup() {
	go func() {
		cleanExpiredSessions()

		ticker := time.NewTicker(6 * time.Hour)
		defer ticker.Stop()

		for range ticker.C {
			cleanExpiredSessions()
		}
	}()

	go func() {
		time.Sleep(30 * time.Second)
		cleanupOrphanContentCaches()

		ticker := time.NewTicker(30 * time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			cleanupOrphanContentCaches()
		}
	}()

	log.Println("[session-cleanup] Session cleanup scheduler started (interval: 6h)")
	log.Println("[cache-gc] Orphan content cache cleanup scheduled (startup delay: 30s, interval: 30m)")
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
