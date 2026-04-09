package service

import (
	"sync"
	"time"
)

// ============================================================
// AI Status
// ============================================================

type AIStatus struct {
	CloudAI struct {
		Configured bool   `json:"configured"`
		Provider   string `json:"provider"`
		Model      string `json:"model"`
	} `json:"cloudAI"`
}

func GetAIStatus() AIStatus {
	cfg := LoadAIConfig()

	var status AIStatus
	status.CloudAI.Configured = cfg.EnableCloudAI && cfg.CloudAPIKey != ""
	status.CloudAI.Provider = cfg.CloudProvider
	status.CloudAI.Model = cfg.CloudModel
	return status
}

// ============================================================
// Token Usage Tracking (0-5)
// ============================================================

// AIUsageRecord 记录单次 AI 调用的 token 使用量
type AIUsageRecord struct {
	Timestamp    time.Time `json:"timestamp"`
	Provider     string    `json:"provider"`
	Model        string    `json:"model"`
	PromptTokens int       `json:"promptTokens"`
	OutputTokens int       `json:"outputTokens"`
	TotalTokens  int       `json:"totalTokens"`
	Scenario     string    `json:"scenario"` // translate, summary, tag, chat 等
	Success      bool      `json:"success"`
	DurationMs   int64     `json:"durationMs"`
}

// AIUsageStats AI 使用量统计汇总
type AIUsageStats struct {
	TotalCalls        int             `json:"totalCalls"`
	SuccessCalls      int             `json:"successCalls"`
	FailedCalls       int             `json:"failedCalls"`
	TotalPromptTokens int             `json:"totalPromptTokens"`
	TotalOutputTokens int             `json:"totalOutputTokens"`
	TotalTokens       int             `json:"totalTokens"`
	AvgDurationMs     int64           `json:"avgDurationMs"`
	ByScenario        map[string]int  `json:"byScenario"`
	ByProvider        map[string]int  `json:"byProvider"`
	Records           []AIUsageRecord `json:"records"` // 最近 N 条记录
}

var (
	usageMu      sync.Mutex
	usageRecords []AIUsageRecord
	maxRecords   = 500 // 保留最近 500 条记录
)

// recordUsage 记录一次 AI 调用
func recordUsage(record AIUsageRecord) {
	usageMu.Lock()
	defer usageMu.Unlock()
	usageRecords = append(usageRecords, record)
	// 滑动窗口：只保留最近 maxRecords 条
	if len(usageRecords) > maxRecords {
		usageRecords = usageRecords[len(usageRecords)-maxRecords:]
	}
}

// GetAIUsageStats 获取 AI 使用量统计
func GetAIUsageStats() AIUsageStats {
	usageMu.Lock()
	defer usageMu.Unlock()

	stats := AIUsageStats{
		ByScenario: make(map[string]int),
		ByProvider: make(map[string]int),
	}

	var totalDuration int64
	for _, r := range usageRecords {
		stats.TotalCalls++
		if r.Success {
			stats.SuccessCalls++
		} else {
			stats.FailedCalls++
		}
		stats.TotalPromptTokens += r.PromptTokens
		stats.TotalOutputTokens += r.OutputTokens
		stats.TotalTokens += r.TotalTokens
		totalDuration += r.DurationMs
		stats.ByScenario[r.Scenario]++
		stats.ByProvider[r.Provider]++
	}

	if stats.TotalCalls > 0 {
		stats.AvgDurationMs = totalDuration / int64(stats.TotalCalls)
	}

	// 返回最近 50 条记录
	recentCount := 50
	if len(usageRecords) < recentCount {
		recentCount = len(usageRecords)
	}
	stats.Records = make([]AIUsageRecord, recentCount)
	copy(stats.Records, usageRecords[len(usageRecords)-recentCount:])

	return stats
}

// ResetAIUsageStats 重置统计数据
func ResetAIUsageStats() {
	usageMu.Lock()
	defer usageMu.Unlock()
	usageRecords = nil
}
