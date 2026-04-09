package service

import (
	"fmt"
	"strings"
	"sync"
	"time"
)

// ============================================================
// Phase 3-2: 小说章节 AI 总结
// ============================================================

// ChapterSummary 章节摘要缓存
type ChapterSummary struct {
	ChapterIndex int       `json:"chapterIndex"`
	Title        string    `json:"title"`
	Summary      string    `json:"summary"`
	GeneratedAt  time.Time `json:"generatedAt"`
}

// 章节摘要缓存（内存缓存，key = comicID:chapterIndex）
var (
	chapterSummaryCache   = make(map[string]*ChapterSummary)
	chapterSummaryCacheMu sync.RWMutex
)

func chapterSummaryCacheKey(comicID string, chapterIndex int) string {
	return fmt.Sprintf("%s:%d", comicID, chapterIndex)
}

// GetChapterSummaryFromCache 从缓存获取章节摘要
func GetChapterSummaryFromCache(comicID string, chapterIndex int) *ChapterSummary {
	chapterSummaryCacheMu.RLock()
	defer chapterSummaryCacheMu.RUnlock()
	return chapterSummaryCache[chapterSummaryCacheKey(comicID, chapterIndex)]
}

// SummarizeChapter 使用 AI 为小说章节生成摘要。
// chapterText: 章节文本内容
// chapterTitle: 章节标题
func SummarizeChapter(cfg AIConfig, comicID string, chapterIndex int, chapterTitle, chapterText, bookTitle, targetLang string) (*ChapterSummary, error) {
	// 先检查缓存
	if cached := GetChapterSummaryFromCache(comicID, chapterIndex); cached != nil {
		return cached, nil
	}

	if !cfg.EnableCloudAI || cfg.CloudAPIKey == "" {
		return nil, fmt.Errorf("cloud AI not configured")
	}

	langName := "Chinese (简体中文)"
	if targetLang == "en" {
		langName = "English"
	}

	systemPrompt := fmt.Sprintf(`You are a concise book summarizer. Summarize the given novel chapter in %s.

Requirements:
- Write 2-3 sentences (60-150 characters for Chinese, 80-200 characters for English)
- Capture the key events, character actions, and emotional tone
- Avoid spoiling future events — summarize only what happens in THIS chapter
- Do NOT include any prefixes, labels, or markdown — return only the summary text
- If the text appears to be non-content (e.g. copyright, table of contents), say "（非正文内容）" or "(Non-content page)"`, langName)

	// 截断过长的章节文本
	text := chapterText
	if len(text) > 4000 {
		text = text[:4000] + "\n...[text truncated]..."
	}

	userPrompt := fmt.Sprintf("Book: %s\nChapter: %s\n\nChapter text:\n%s\n\nSummarize this chapter in %s.",
		bookTitle, chapterTitle, text, langName)

	summary, err := CallCloudLLM(cfg, systemPrompt, userPrompt, &LLMCallOptions{
		Scenario:  "chapter_summary",
		MaxTokens: 300,
	})
	if err != nil {
		return nil, err
	}

	result := &ChapterSummary{
		ChapterIndex: chapterIndex,
		Title:        chapterTitle,
		Summary:      strings.TrimSpace(summary),
		GeneratedAt:  time.Now(),
	}

	// 写入缓存
	chapterSummaryCacheMu.Lock()
	chapterSummaryCache[chapterSummaryCacheKey(comicID, chapterIndex)] = result
	chapterSummaryCacheMu.Unlock()

	return result, nil
}

// BatchSummarizeChapters 批量生成章节摘要（用于 TOC 展示）
// chapters: [{index, title, text}]
func BatchSummarizeChapters(cfg AIConfig, comicID, bookTitle, targetLang string, chapters []struct {
	Index int
	Title string
	Text  string
}) ([]*ChapterSummary, error) {
	if !cfg.EnableCloudAI || cfg.CloudAPIKey == "" {
		return nil, fmt.Errorf("cloud AI not configured")
	}

	var results []*ChapterSummary
	for _, ch := range chapters {
		summary, err := SummarizeChapter(cfg, comicID, ch.Index, ch.Title, ch.Text, bookTitle, targetLang)
		if err != nil {
			// 某章失败不影响其他章，记录空摘要
			results = append(results, &ChapterSummary{
				ChapterIndex: ch.Index,
				Title:        ch.Title,
				Summary:      "",
			})
			continue
		}
		results = append(results, summary)
	}
	return results, nil
}

// ClearChapterSummaryCache 清除指定作品的章节摘要缓存
func ClearChapterSummaryCache(comicID string) {
	chapterSummaryCacheMu.Lock()
	defer chapterSummaryCacheMu.Unlock()
	for key := range chapterSummaryCache {
		if strings.HasPrefix(key, comicID+":") {
			delete(chapterSummaryCache, key)
		}
	}
}
