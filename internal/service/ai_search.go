package service

import (
	"encoding/json"
	"fmt"
	"strings"
)

// ============================================================
// Phase 4-1: AI 语义搜索
// ============================================================

// SemanticSearchResult AI 语义搜索结果
type SemanticSearchResult struct {
	ComicID   string   `json:"comicId"`
	Title     string   `json:"title"`
	Score     float64  `json:"score"`     // 0-100 相关度
	Reason    string   `json:"reason"`    // AI 给出的匹配理由
	MatchedOn []string `json:"matchedOn"` // 匹配维度: title, genre, author, description, tags
}

// SemanticSearch 使用 AI 理解自然语言搜索意图，在库中查找最相关的作品。
// query: 用户自然语言查询（如"那个关于巨人的漫画"、"最近看的悬疑类"）
// candidates: 库中所有作品的基本信息 [{id, title, author, genre, description, tags}]
func SemanticSearch(cfg AIConfig, query string, candidates []map[string]string, targetLang string) ([]SemanticSearchResult, error) {
	if !cfg.EnableCloudAI || cfg.CloudAPIKey == "" {
		return nil, fmt.Errorf("cloud AI not configured")
	}

	langName := "Chinese (简体中文)"
	if targetLang == "en" {
		langName = "English"
	}

	systemPrompt := fmt.Sprintf(`You are a smart library search assistant. The user is searching their personal comic/novel library using natural language.

Your task:
1. Understand the user's search intent (they may describe a work by plot, character, theme, mood, genre, author, or partial title)
2. From the provided candidate list, find the most relevant works
3. Score each match 0-100 based on relevance
4. Provide a brief reason for each match in %s

Return ONLY a JSON array of matches, sorted by score descending. Return at most 10 results.
Each element: {"index": <candidate_index>, "score": <0-100>, "reason": "<brief reason>", "matchedOn": ["title","genre",...]}

If no candidates match, return an empty array: []`, langName)

	// 构建候选列表文本（限制数量避免超出 token）
	maxCandidates := 80
	if len(candidates) > maxCandidates {
		candidates = candidates[:maxCandidates]
	}
	var candidateLines []string
	for i, c := range candidates {
		parts := []string{fmt.Sprintf("[%d]", i)}
		if t, ok := c["title"]; ok && t != "" {
			parts = append(parts, "title:"+t)
		}
		if a, ok := c["author"]; ok && a != "" {
			parts = append(parts, "author:"+a)
		}
		if g, ok := c["genre"]; ok && g != "" {
			parts = append(parts, "genre:"+g)
		}
		if d, ok := c["description"]; ok && d != "" {
			desc := d
			if len(desc) > 100 {
				desc = desc[:100] + "..."
			}
			parts = append(parts, "desc:"+desc)
		}
		if tags, ok := c["tags"]; ok && tags != "" {
			parts = append(parts, "tags:"+tags)
		}
		candidateLines = append(candidateLines, strings.Join(parts, " | "))
	}

	userPrompt := fmt.Sprintf("User search query: \"%s\"\n\nCandidate works in library:\n%s\n\nFind the most relevant matches. Return a JSON array.",
		query, strings.Join(candidateLines, "\n"))

	content, err := CallCloudLLM(cfg, systemPrompt, userPrompt, &LLMCallOptions{
		Scenario:  "semantic_search",
		MaxTokens: 800,
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

	var rawResults []struct {
		Index     int      `json:"index"`
		Score     float64  `json:"score"`
		Reason    string   `json:"reason"`
		MatchedOn []string `json:"matchedOn"`
	}
	if err := json.Unmarshal([]byte(content), &rawResults); err != nil {
		return nil, fmt.Errorf("failed to parse AI response: %w", err)
	}

	// 映射回候选列表
	var results []SemanticSearchResult
	for _, r := range rawResults {
		if r.Index < 0 || r.Index >= len(candidates) {
			continue
		}
		c := candidates[r.Index]
		results = append(results, SemanticSearchResult{
			ComicID:   c["id"],
			Title:     c["title"],
			Score:     r.Score,
			Reason:    r.Reason,
			MatchedOn: r.MatchedOn,
		})
	}

	return results, nil
}
