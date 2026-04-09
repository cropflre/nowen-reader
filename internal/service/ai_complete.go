package service

import (
	"encoding/json"
	"fmt"
	"strings"
)

// ============================================================
// Phase 6-2: AI 智能元数据补全
// ============================================================

// AICompletedMetadata AI 补全后的元数据
type AICompletedMetadata struct {
	Title       string `json:"title,omitempty"`
	Author      string `json:"author,omitempty"`
	Genre       string `json:"genre,omitempty"`
	Description string `json:"description,omitempty"`
	Language    string `json:"language,omitempty"`
	Year        *int   `json:"year,omitempty"`
	Tags        string `json:"tags,omitempty"` // 逗号分隔
}

// AICompleteMetadata 当外部元数据源搜索不到时，使用 AI 根据文件名和封面推断元数据。
func AICompleteMetadata(cfg AIConfig, filename, title string, coverData []byte, targetLang string) (*AICompletedMetadata, error) {
	if !cfg.EnableCloudAI || cfg.CloudAPIKey == "" {
		return nil, fmt.Errorf("cloud AI not configured")
	}

	langName := "Chinese (简体中文)"
	if targetLang == "en" {
		langName = "English"
	}

	systemPrompt := fmt.Sprintf(`You are an expert manga/comic/novel metadata specialist. Infer metadata primarily from the cover image (if provided), supplemented by the title and filename as secondary references.

Prioritize visual analysis:
- Examine cover image for title text, author name, publisher logo, art style, genre cues
- Use your knowledge of manga, comics, light novels to identify well-known series
- Only fall back to filename/title analysis when no image is available

Extract:
- The likely title (clean, without volume numbers or group tags)
- The author/artist if recognizable
- Genre(s) based on visual and textual cues
- A brief description in %s
- Language (auto-detect from visual text or filename)
- Estimated year if possible
- Relevant tags (comma-separated)

Return ONLY a valid JSON object:
{
  "title": "clean title",
  "author": "author name or empty",
  "genre": "genre1, genre2",
  "description": "2-3 sentence description in %s",
  "language": "language code (zh/ja/en/ko)",
  "year": 2024 or null,
  "tags": "tag1, tag2, tag3"
}

If you cannot determine a field with reasonable confidence, omit it.`, langName, langName)

	userPrompt := fmt.Sprintf("Infer metadata for this file:\n\nFilename: %s\nCurrent title: %s\n\nReturn a JSON object.", filename, title)

	opts := &LLMCallOptions{
		Scenario:  "ai_metadata_complete",
		MaxTokens: 600,
	}

	// 如果有封面数据且 provider 支持 Vision，附加封面图片
	if len(coverData) > 0 {
		if preset, ok := ProviderPresets[cfg.CloudProvider]; ok && preset.SupportsVision {
			mimeType := "image/jpeg"
			if len(coverData) > 4 && coverData[0] == 0x89 && coverData[1] == 0x50 {
				mimeType = "image/png"
			}
			b64 := encodeBase64(coverData)
			opts.Images = []ImageContent{{Base64: b64, MimeType: mimeType}}
			userPrompt += "\n\nA cover image is also provided for visual analysis."
		}
	}

	content, err := CallCloudLLM(cfg, systemPrompt, userPrompt, opts)
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

	var meta AICompletedMetadata
	if err := json.Unmarshal([]byte(content), &meta); err != nil {
		return nil, fmt.Errorf("failed to parse AI metadata: %w", err)
	}
	return &meta, nil
}
