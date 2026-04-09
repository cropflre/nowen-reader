package service

import (
	"encoding/json"
	"fmt"
	"strings"
	"sync"
)

// ============================================================
// Phase 7-3: AI 阅读目标推荐
// ============================================================

// AIGoalRecommendation AI 推荐的阅读目标
type AIGoalRecommendation struct {
	DailyMins     int    `json:"dailyMins"`     // 推荐每日阅读分钟数
	DailyBooks    int    `json:"dailyBooks"`    // 推荐每日阅读本数
	WeeklyMins    int    `json:"weeklyMins"`    // 推荐每周阅读分钟数
	WeeklyBooks   int    `json:"weeklyBooks"`   // 推荐每周阅读本数
	Reasoning     string `json:"reasoning"`     // AI 推荐理由
	Encouragement string `json:"encouragement"` // 鼓励语
}

// AIRecommendGoal 根据用户历史阅读数据，AI 推荐合理的阅读目标。
func AIRecommendGoal(cfg AIConfig, statsData map[string]interface{}, currentGoals []map[string]interface{}, targetLang string) (*AIGoalRecommendation, error) {
	if !cfg.EnableCloudAI || cfg.CloudAPIKey == "" {
		return nil, fmt.Errorf("cloud AI not configured")
	}

	langName := "Chinese (简体中文)"
	if targetLang == "en" {
		langName = "English"
	}

	systemPrompt := fmt.Sprintf(`You are a reading coach. Based on the user's reading history and current habits, suggest optimal daily and weekly reading goals in %s.

Rules:
- Be realistic: base suggestions on their actual reading patterns
- If they read ~30 min/day, suggest 35-40 min (slight stretch)
- If they barely read, suggest a gentle 15-20 min/day start
- Weekly goal should be slightly more ambitious than daily*7 (to encourage weekend reading)
- Book goals: only suggest if they finish books regularly; otherwise set to 0
- Provide encouraging reasoning
- Return ONLY a valid JSON object

Response format:
{
  "dailyMins": 30,
  "dailyBooks": 0,
  "weeklyMins": 240,
  "weeklyBooks": 2,
  "reasoning": "Based on your reading patterns...",
  "encouragement": "A motivating message"
}`, langName)

	statsJSON, _ := json.MarshalIndent(statsData, "", "  ")
	goalsJSON, _ := json.MarshalIndent(currentGoals, "", "  ")

	userPrompt := fmt.Sprintf("User's reading statistics:\n```json\n%s\n```\n\nCurrent goals (if any):\n```json\n%s\n```\n\nRecommend optimal reading goals. Return a JSON object.", string(statsJSON), string(goalsJSON))

	content, err := CallCloudLLM(cfg, systemPrompt, userPrompt, &LLMCallOptions{
		Scenario:  "ai_recommend_goal",
		MaxTokens: 400,
	})
	if err != nil {
		return nil, err
	}

	// 清理并解析 JSON
	content = strings.ReplaceAll(content, "```json", "")
	content = strings.ReplaceAll(content, "```", "")
	content = strings.TrimSpace(content)

	start := strings.Index(content, "{")
	end := strings.LastIndex(content, "}")
	if start >= 0 && end > start {
		content = content[start : end+1]
	}

	var rec AIGoalRecommendation
	if err := json.Unmarshal([]byte(content), &rec); err != nil {
		return nil, fmt.Errorf("failed to parse AI goal recommendation: %w", err)
	}
	return &rec, nil
}

// 页面翻译缓存
var (
	pageTranslateCache   = make(map[string]*PageTranslation)
	pageTranslateCacheMu sync.RWMutex
)

func pageTranslateCacheKey(comicID string, pageIndex int, targetLang string) string {
	return fmt.Sprintf("%s:%d:%s", comicID, pageIndex, targetLang)
}

// GetPageTranslationFromCache 从缓存获取页面翻译
func GetPageTranslationFromCache(comicID string, pageIndex int, targetLang string) *PageTranslation {
	pageTranslateCacheMu.RLock()
	defer pageTranslateCacheMu.RUnlock()
	return pageTranslateCache[pageTranslateCacheKey(comicID, pageIndex, targetLang)]
}

// CachePageTranslation 缓存页面翻译结果
func CachePageTranslation(comicID string, pageIndex int, targetLang string, result *PageTranslation) {
	pageTranslateCacheMu.Lock()
	defer pageTranslateCacheMu.Unlock()
	pageTranslateCache[pageTranslateCacheKey(comicID, pageIndex, targetLang)] = result
}
