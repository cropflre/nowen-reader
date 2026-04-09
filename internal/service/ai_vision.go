package service

import (
	"encoding/json"
	"fmt"
	"strings"
)

// ============================================================
// Phase 4-2: 漫画页面翻译
// ============================================================

// PageTranslation 漫画页面翻译结果
type PageTranslation struct {
	Bubbles []TranslatedBubble `json:"bubbles"` // 识别到的气泡/文字区域及翻译
	RawText string             `json:"rawText"` // 页面上所有文字的原文
	Summary string             `json:"summary"` // 整页内容简述
}

// TranslatedBubble 单个气泡/文字区域的翻译
type TranslatedBubble struct {
	Original   string `json:"original"`   // 原文
	Translated string `json:"translated"` // 译文
	Position   string `json:"position"`   // 位置描述（如 "top-left", "center", "bottom-right"）
	Type       string `json:"type"`       // 类型: "dialog", "narration", "sfx", "sign", "thought"
	Speaker    string `json:"speaker"`    // 说话人（如果能识别）
}

// TranslatePageImage 使用 Vision LLM 识别漫画页面上的文字并翻译。
// imageData: 页面图片的原始字节数据
// sourceLang: 原文语言（如 "ja", "en", "ko"），空则自动检测
// targetLang: 目标语言（如 "zh", "en"）
func TranslatePageImage(cfg AIConfig, imageData []byte, sourceLang, targetLang string) (*PageTranslation, error) {
	if !cfg.EnableCloudAI || cfg.CloudAPIKey == "" {
		return nil, fmt.Errorf("cloud AI not configured")
	}

	// 检查 provider 是否支持 Vision
	if preset, ok := ProviderPresets[cfg.CloudProvider]; ok {
		if !preset.SupportsVision {
			return nil, fmt.Errorf("current AI provider does not support vision/image analysis")
		}
	}

	targetLangName := "Chinese (简体中文)"
	if targetLang == "en" {
		targetLangName = "English"
	}

	sourceHint := "auto-detect the language"
	if sourceLang != "" {
		langMap := map[string]string{"ja": "Japanese", "en": "English", "ko": "Korean", "zh": "Chinese"}
		if name, ok := langMap[sourceLang]; ok {
			sourceHint = "the source language is " + name
		}
	}

	systemPrompt := fmt.Sprintf(`You are an expert manga/comic translator. Analyze the given comic page image and:
1. Identify all text regions (dialog bubbles, narration boxes, sound effects, signs, thought bubbles)
2. Extract the original text from each region
3. Translate each text to %s
4. Note the approximate position and type of each text region

Return ONLY a valid JSON object with this structure:
{
  "bubbles": [
    {
      "original": "original text",
      "translated": "translated text",
      "position": "top-left|top-center|top-right|center-left|center|center-right|bottom-left|bottom-center|bottom-right",
      "type": "dialog|narration|sfx|sign|thought",
      "speaker": "character name or empty string"
    }
  ],
  "rawText": "all original text concatenated",
  "summary": "brief description of what's happening on this page in %s"
}

Rules:
- %s
- Preserve the reading order (right-to-left for Japanese manga, left-to-right for Western comics)
- For sound effects (SFX), provide both transliteration and meaning (e.g. "ドドド → Dododo (rumbling)")
- Keep character names consistent
- If no text is found, return empty bubbles array with a summary of the visual content`, targetLangName, targetLangName, sourceHint)

	userPrompt := "Analyze this comic page, extract and translate all text. Return a JSON object."

	// base64 编码图片
	base64Data := encodeBase64(imageData)
	mimeType := "image/jpeg"
	if len(imageData) > 8 && string(imageData[:8]) == "\x89PNG\r\n\x1a\n" {
		mimeType = "image/png"
	} else if len(imageData) > 4 && string(imageData[:4]) == "\x89PNG" {
		mimeType = "image/png"
	}

	content, err := CallCloudLLM(cfg, systemPrompt, userPrompt, &LLMCallOptions{
		Scenario:  "page_translate",
		MaxTokens: 1500,
		Images: []ImageContent{
			{Base64: base64Data, MimeType: mimeType},
		},
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

	var result PageTranslation
	if err := json.Unmarshal([]byte(content), &result); err != nil {
		// 如果 JSON 解析失败，将整个响应作为 rawText 返回
		return &PageTranslation{
			RawText: content,
			Summary: "Failed to parse structured response",
		}, nil
	}

	return &result, nil
}
