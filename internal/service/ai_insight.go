package service

import (
	"encoding/json"
	"fmt"
)

// ============================================================
// Phase 5-1: AI 阅读统计洞察报告
// ============================================================

// GenerateReadingInsight 使用 AI 分析用户阅读数据，生成个性化洞察报告（流式）。
func GenerateReadingInsight(cfg AIConfig, statsData map[string]interface{}, targetLang string, callback StreamCallback) error {
	if !cfg.EnableCloudAI || cfg.CloudAPIKey == "" {
		return fmt.Errorf("cloud AI not configured")
	}

	langName := "Chinese (简体中文)"
	if targetLang == "en" {
		langName = "English"
	}

	systemPrompt := fmt.Sprintf(`You are a friendly and insightful reading analyst. Based on the user's reading statistics data, generate a personalized reading insight report in %s.

Requirements:
- Write in a warm, encouraging tone, like a reading companion
- Include 3-5 key insights/observations about the user's reading habits
- Provide specific, data-driven observations (mention actual numbers)
- Suggest improvements or new reading directions based on patterns
- Use appropriate emoji for visual appeal
- Structure your response with clear sections using markdown headings (##)
- Keep total length around 300-500 characters for Chinese, 400-800 characters for English
- If the data shows very little reading activity, be encouraging rather than critical

Sections to cover (pick the most relevant):
1. 📊 Overall Summary - Brief overview of reading activity
2. 🔥 Reading Habits - Patterns, streaks, time preferences
3. 📚 Genre Insights - Reading preferences and diversity
4. ⏱️ Reading Speed & Efficiency - Pages per hour analysis
5. 🎯 Recommendations - Personalized suggestions
6. 🏆 Achievements - Celebrate milestones`, langName)

	// 序列化统计数据
	statsJSON, _ := json.MarshalIndent(statsData, "", "  ")

	userPrompt := fmt.Sprintf("Analyze this user's reading statistics and generate a personalized insight report in %s:\n\n```json\n%s\n```\n\nGenerate an engaging, data-driven insight report.", langName, string(statsJSON))

	return CallCloudLLMStream(cfg, systemPrompt, userPrompt, &LLMCallOptions{
		Scenario:  "reading_insight",
		MaxTokens: 1200,
	}, callback)
}
