package service

import (
	"encoding/json"
	"fmt"
	"strings"
)

// ============================================================

// GenerateRecommendationReasons 使用 AI 为推荐列表生成自然语言推荐理由。
// items: [{title, reasons, genre, author}]
// 批量处理以减少 API 调用次数。
func GenerateRecommendationReasons(cfg AIConfig, items []RecommendationItem, userFavorites []string, targetLang string) (map[string]string, error) {
	if !cfg.EnableCloudAI || cfg.CloudAPIKey == "" {
		return nil, fmt.Errorf("cloud AI not configured")
	}
	if len(items) == 0 {
		return map[string]string{}, nil
	}

	langName := "Chinese (简体中文)"
	if targetLang == "en" {
		langName = "English"
	}

	templates := LoadPromptTemplates()
	systemPrompt := templates.RecommendReason.System
	if systemPrompt == "" {
		systemPrompt = fmt.Sprintf(`You are a friendly %s recommendation curator. Generate short, engaging recommendation reasons for each item.

Rules:
- Each reason should be 1 sentence, max 50 characters for Chinese or 80 characters for English
- Be specific: mention matching tags, similar works, or why the user would enjoy it
- Sound natural, like a friend's recommendation, not a database query
- Return a JSON object: { "id1": "reason text", "id2": "reason text", ... }`, langName)
	}

	// 构建批量数据（一次最多处理 10 个）
	batchSize := 10
	if len(items) > batchSize {
		items = items[:batchSize]
	}

	var itemDescs []string
	for _, item := range items {
		desc := fmt.Sprintf("- ID: %s | Title: %s | Reasons: %s", item.ID, item.Title, strings.Join(item.Reasons, ","))
		if item.Genre != "" {
			desc += fmt.Sprintf(" | Genre: %s", item.Genre)
		}
		if item.Author != "" {
			desc += fmt.Sprintf(" | Author: %s", item.Author)
		}
		itemDescs = append(itemDescs, desc)
	}

	userCtx := ""
	if len(userFavorites) > 0 {
		favs := userFavorites
		if len(favs) > 5 {
			favs = favs[:5]
		}
		userCtx = fmt.Sprintf("\nUser's favorite works: %s", strings.Join(favs, ", "))
	}

	userPrompt := templates.RecommendReason.User
	if userPrompt == "" {
		userPrompt = fmt.Sprintf("Generate a personalized recommendation reason in %s for each item:\n\n%s%s\n\nReturn a JSON object mapping each ID to its reason string.", langName, strings.Join(itemDescs, "\n"), userCtx)
	} else {
		userPrompt = fmt.Sprintf(userPrompt+"\n\n%s%s", strings.Join(itemDescs, "\n"), userCtx)
	}

	content, err := CallCloudLLM(cfg, systemPrompt, userPrompt, &LLMCallOptions{
		Scenario:  "recommend_reason",
		MaxTokens: 800,
	})
	if err != nil {
		return nil, err
	}

	// 解析
	content = strings.ReplaceAll(content, "```json", "")
	content = strings.ReplaceAll(content, "```", "")
	content = strings.TrimSpace(content)

	start := strings.Index(content, "{")
	end := strings.LastIndex(content, "}")
	if start >= 0 && end > start {
		content = content[start : end+1]
	}

	var rawResult map[string]string
	if err := json.Unmarshal([]byte(content), &rawResult); err != nil {
		return nil, fmt.Errorf("failed to parse AI recommendation reasons: %w", err)
	}

	// 构建原始 ID 集合，用于校验 AI 返回的 key
	originalIDs := make(map[string]string) // lowercase -> original
	for _, item := range items {
		originalIDs[strings.ToLower(strings.TrimSpace(item.ID))] = item.ID
	}

	// 校验并修正 AI 返回的 key，确保与原始 ID 一致
	result := make(map[string]string, len(rawResult))
	for key, reason := range rawResult {
		cleanKey := strings.ToLower(strings.TrimSpace(key))
		if origID, ok := originalIDs[cleanKey]; ok {
			result[origID] = reason
		} else {
			// AI 可能修改了 ID，尝试部分匹配
			matched := false
			for lowerID, origID := range originalIDs {
				if strings.Contains(lowerID, cleanKey) || strings.Contains(cleanKey, lowerID) {
					result[origID] = reason
					matched = true
					break
				}
			}
			if !matched {
				// 仍然保留，使用原始 key
				result[key] = reason
			}
		}
	}

	// 如果 AI 用顺序索引(0,1,2...)作为 key，则按顺序映射回原始 ID
	if len(result) == 0 && len(rawResult) > 0 {
		idx := 0
		for _, reason := range rawResult {
			if idx < len(items) {
				result[items[idx].ID] = reason
				idx++
			}
		}
	}

	return result, nil
}

// RecommendationItem 推荐项，用于 AI 生成理由
type RecommendationItem struct {
	ID      string   `json:"id"`
	Title   string   `json:"title"`
	Reasons []string `json:"reasons"`
	Genre   string   `json:"genre"`
	Author  string   `json:"author"`
}
