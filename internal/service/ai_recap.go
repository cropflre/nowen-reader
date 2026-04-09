package service

import (
	"encoding/json"
	"fmt"
	"strings"
)

// ============================================================
// Phase 7-1: AI 章节回顾 / 前情提要
// ============================================================

// ChapterRecap AI 生成的前情提要
type ChapterRecap struct {
	Summary         string `json:"summary"`         // 前情提要文本
	KeyCharacters   string `json:"keyCharacters"`   // 关键角色
	LastCliffhanger string `json:"lastCliffhanger"` // 上一章的悬念/未解问题
}

// GenerateChapterRecap 使用 AI 生成前情提要（回顾之前的章节）。
// previousSummaries: 之前各章节的摘要；currentChapterTitle: 当前章节标题
func GenerateChapterRecap(cfg AIConfig, bookTitle string, previousSummaries []string, currentChapterTitle string, targetLang string) (*ChapterRecap, error) {
	if !cfg.EnableCloudAI || cfg.CloudAPIKey == "" {
		return nil, fmt.Errorf("cloud AI not configured")
	}

	langName := "Chinese (简体中文)"
	if targetLang == "en" {
		langName = "English"
	}

	systemPrompt := fmt.Sprintf(`You are a reading companion helping a reader recall what happened before in a novel. Generate a concise "Previously On" recap in %s.

Requirements:
- Write a cohesive 3-5 sentence recap of the story so far, based on the chapter summaries provided
- Highlight the most important plot points, character developments, and unresolved tensions
- End with a brief mention of what to expect or watch for in the upcoming chapter
- Keep it engaging and spoiler-free for future chapters
- Respond ONLY with a valid JSON object

Response format:
{
  "summary": "A cohesive recap of the story so far...",
  "keyCharacters": "Character A (role), Character B (role)",
  "lastCliffhanger": "The last unresolved tension or question"
}`, langName)

	// 构建之前章节的摘要
	var summaryLines []string
	for i, s := range previousSummaries {
		if s != "" {
			summaryLines = append(summaryLines, fmt.Sprintf("Chapter %d: %s", i+1, s))
		}
	}
	if len(summaryLines) == 0 {
		return nil, fmt.Errorf("no previous chapter summaries available")
	}

	// 限制最多使用最近 20 章的摘要
	if len(summaryLines) > 20 {
		summaryLines = summaryLines[len(summaryLines)-20:]
	}

	userPrompt := fmt.Sprintf("Book: %s\nAbout to read: %s\n\nPrevious chapter summaries:\n%s\n\nGenerate a \"Previously On\" recap in %s. Return a JSON object.",
		bookTitle, currentChapterTitle, strings.Join(summaryLines, "\n"), langName)

	content, err := CallCloudLLM(cfg, systemPrompt, userPrompt, &LLMCallOptions{
		Scenario:  "chapter_recap",
		MaxTokens: 500,
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

	var recap ChapterRecap
	if err := json.Unmarshal([]byte(content), &recap); err != nil {
		// 如果 JSON 解析失败，至少把内容当作纯文本摘要
		return &ChapterRecap{
			Summary: strings.TrimSpace(content),
		}, nil
	}
	return &recap, nil
}
