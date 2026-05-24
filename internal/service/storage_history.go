package service

import (
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/nowen-reader/nowen-reader/internal/config"
)

// StorageSample 存储用量采样点
type StorageSample struct {
	Ts         int64 `json:"ts"`         // unix sec
	CacheBytes int64 `json:"cacheBytes"` // 缓存目录总字节
	DBBytes    int64 `json:"dbBytes"`    // 数据库总字节（含 wal/shm）
	DiskFree   int64 `json:"diskFree"`   // 磁盘剩余字节
}

const (
	storageHistoryMaxDays = 90
	storageHistorySubDir  = "storage-history.json"
	// 同一小时内只保留最新一条采样，避免文件膨胀
	storageHistoryMinInterval = 30 * time.Minute
)

var (
	storageHistoryMu   sync.Mutex
	storageHistoryMem  []StorageSample
	storageHistoryInit bool
)

// historyFile 历史文件路径
func historyFile() string {
	return filepath.Join(config.DataDir(), storageHistorySubDir)
}

// loadStorageHistory 从磁盘读取（带内存缓存）
func loadStorageHistory() []StorageSample {
	storageHistoryMu.Lock()
	defer storageHistoryMu.Unlock()
	if storageHistoryInit {
		return storageHistoryMem
	}
	storageHistoryInit = true
	data, err := os.ReadFile(historyFile())
	if err != nil {
		return nil
	}
	var samples []StorageSample
	if err := json.Unmarshal(data, &samples); err != nil {
		return nil
	}
	storageHistoryMem = samples
	return samples
}

// saveStorageHistoryLocked 持久化（必须在锁内调用）
func saveStorageHistoryLocked() {
	data, err := json.Marshal(storageHistoryMem)
	if err != nil {
		return
	}
	dir := filepath.Dir(historyFile())
	if err := os.MkdirAll(dir, 0755); err == nil {
		_ = os.WriteFile(historyFile(), data, 0644)
	}
}

// RecordStorageSample 追加一条采样（同一时间窗口内仅保留最新）
func RecordStorageSample(cacheBytes, dbBytes int64, diskFreeBytes uint64) {
	loadStorageHistory()

	storageHistoryMu.Lock()
	defer storageHistoryMu.Unlock()

	now := time.Now()
	sample := StorageSample{
		Ts:         now.Unix(),
		CacheBytes: cacheBytes,
		DBBytes:    dbBytes,
		DiskFree:   int64(diskFreeBytes),
	}

	// 同一时间窗口内仅保留最新值
	if n := len(storageHistoryMem); n > 0 {
		last := storageHistoryMem[n-1]
		if now.Sub(time.Unix(last.Ts, 0)) < storageHistoryMinInterval {
			storageHistoryMem[n-1] = sample
			saveStorageHistoryLocked()
			return
		}
	}

	storageHistoryMem = append(storageHistoryMem, sample)

	// 修剪：保留最近 N 天
	cutoff := now.AddDate(0, 0, -storageHistoryMaxDays).Unix()
	pruned := storageHistoryMem[:0]
	for _, s := range storageHistoryMem {
		if s.Ts >= cutoff {
			pruned = append(pruned, s)
		}
	}
	storageHistoryMem = pruned

	saveStorageHistoryLocked()
}

// GetStorageHistory 返回最近 N 天的采样
func GetStorageHistory(days int) []StorageSample {
	if days <= 0 {
		days = 30
	}
	all := loadStorageHistory()
	cutoff := time.Now().AddDate(0, 0, -days).Unix()

	storageHistoryMu.Lock()
	defer storageHistoryMu.Unlock()

	out := make([]StorageSample, 0, len(all))
	for _, s := range storageHistoryMem {
		if s.Ts >= cutoff {
			out = append(out, s)
		}
	}
	return out
}

// StartStorageSampler 启动后台采样（每小时一次）
// sampler 由调用方提供，避免 service 包反向依赖 handler
func StartStorageSampler(sampler func() (cacheBytes int64, dbBytes int64, diskFree uint64)) {
	go func() {
		// 启动 30 秒后采一次
		time.Sleep(30 * time.Second)
		if sampler != nil {
			c, d, f := sampler()
			RecordStorageSample(c, d, f)
		}

		ticker := time.NewTicker(1 * time.Hour)
		defer ticker.Stop()
		for range ticker.C {
			if sampler == nil {
				continue
			}
			func() {
				defer func() {
					if r := recover(); r != nil {
						log.Printf("[StorageSampler] panic: %v", r)
					}
				}()
				c, d, f := sampler()
				RecordStorageSample(c, d, f)
			}()
		}
	}()
}
