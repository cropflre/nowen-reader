package service

import (
	"encoding/json"
	"fmt"
	"strings"
)

// ============================================================
// Phase 6-3: AI 自动分类
// ============================================================

// SuggestCategory 根据漫画/小说的元数据，AI 推荐最合适的分类 slug 列表。
// availableCategories: 系统中可用的分类 [{slug, name}]
func SuggestCategory(cfg AIConfig, title, author, genre, description, contentType string, tags []string, availableCategories []map[string]string, targetLang string) ([]string, error) {
	if !cfg.EnableCloudAI || cfg.CloudAPIKey == "" {
		return nil, fmt.Errorf("cloud AI not configured")
	}

	systemPrompt := `You are a manga/comic/novel categorization expert. Based on the work's metadata, suggest the most appropriate categories from the available list.

Rules:
- Suggest 1-3 categories that best fit this work
- Only use slugs from the provided available categories list
- Consider title, genre, author style, description, and tags
- Return ONLY a JSON array of category slugs, no extra text
- If unsure, return the single most likely category

Example response: ["action", "shounen", "adventure"]`

	// 构建可用分类列表
	var catLines []string
	for _, c := range availableCategories {
		catLines = append(catLines, fmt.Sprintf("- slug: %s | name: %s", c["slug"], c["name"]))
	}

	// 构建作品元数据
	var metaParts []string
	if title != "" {
		metaParts = append(metaParts, "Title: "+title)
	}
	if author != "" {
		metaParts = append(metaParts, "Author: "+author)
	}
	if genre != "" {
		metaParts = append(metaParts, "Genre: "+genre)
	}
	if description != "" {
		desc := description
		if len(desc) > 300 {
			desc = desc[:300] + "..."
		}
		metaParts = append(metaParts, "Description: "+desc)
	}
	if len(tags) > 0 {
		metaParts = append(metaParts, "Tags: "+strings.Join(tags, ", "))
	}
	metaParts = append(metaParts, "Content type: "+contentType)

	userPrompt := fmt.Sprintf("Available categories:\n%s\n\nWork metadata:\n%s\n\nSuggest categories. Return a JSON array of slugs.",
		strings.Join(catLines, "\n"), strings.Join(metaParts, "\n"))

	content, err := CallCloudLLM(cfg, systemPrompt, userPrompt, &LLMCallOptions{
		Scenario:  "suggest_category",
		MaxTokens: 200,
	})
	if err != nil {
		return nil, err
	}

	// 清理并解析 JSON
	content = strings.ReplaceAll(content, "```json", "")
	content = strings.ReplaceAll(content, "```", "")
	content = strings.TrimSpace(content)

	start := strings.Index(content, "[")
	end := strings.LastIndex(content, "]")
	if start >= 0 && end > start {
		content = content[start : end+1]
	}

	var slugs []string
	if err := json.Unmarshal([]byte(content), &slugs); err != nil {
		return nil, fmt.Errorf("failed to parse AI category suggestion: %w", err)
	}

	// 验证 slugs 是否都在可用列表中
	validSet := make(map[string]bool)
	for _, c := range availableCategories {
		validSet[c["slug"]] = true
	}
	var validSlugs []string
	for _, s := range slugs {
		if validSet[s] {
			validSlugs = append(validSlugs, s)
		}
	}

	return validSlugs, nil
}
