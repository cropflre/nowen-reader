package service

import (
	"encoding/json"
	"fmt"
	"strings"
)

// ============================================================
// Phase 7-2: AI 重复漫画智能判定
// ============================================================

// AIDuplicateVerification AI 判断两本漫画是否真正重复
type AIDuplicateVerification struct {
	IsDuplicate bool   `json:"isDuplicate"` // AI 判断是否为同一作品
	Confidence  string `json:"confidence"`  // high/medium/low
	Reason      string `json:"reason"`      // AI 判断理由
}

// AIVerifyDuplicates 使用 AI 分析一组疑似重复的漫画，判断是否真正重复。
// 通过元数据 + 可选封面对比来判断。
func AIVerifyDuplicates(cfg AIConfig, candidates []map[string]string, coverDataList [][]byte, targetLang string) ([]AIDuplicateVerification, error) {
	if !cfg.EnableCloudAI || cfg.CloudAPIKey == "" {
		return nil, fmt.Errorf("cloud AI not configured")
	}

	langName := "Chinese (简体中文)"
	if targetLang == "en" {
		langName = "English"
	}

	systemPrompt := fmt.Sprintf(`You are an expert at identifying duplicate manga/comic files. Given metadata of comics in a suspected duplicate group, analyze if they are truly the same work or different works.

Consider:
- Different volume numbers of the SAME series are NOT duplicates
- Same work but different format (CBZ vs PDF vs ZIP) ARE duplicates
- Same work but different resolution/quality ARE duplicates
- Same work with slightly different filenames ARE duplicates
- Different translations of the same title ARE duplicates
- Completely different works that happen to have similar titles are NOT duplicates

Return a JSON array with one verdict per pair comparison in %s:
[
  {"isDuplicate": true/false, "confidence": "high/medium/low", "reason": "brief reason"}
]

The array should have exactly one element representing the overall group verdict.`, langName)

	var lines []string
	for i, c := range candidates {
		line := fmt.Sprintf("Comic %d: filename=%s | title=%s | size=%s | pages=%s",
			i+1, c["filename"], c["title"], c["fileSize"], c["pageCount"])
		lines = append(lines, line)
	}

	userPrompt := fmt.Sprintf("Analyze these comics in a suspected duplicate group:\n\n%s\n\nAre they truly duplicates? Return a JSON array.", strings.Join(lines, "\n"))

	opts := &LLMCallOptions{
		Scenario:  "ai_verify_duplicate",
		MaxTokens: 300,
	}

	// 如果有封面数据且支持 Vision，附加封面图片
	if len(coverDataList) >= 2 {
		if preset, ok := ProviderPresets[cfg.CloudProvider]; ok && preset.SupportsVision {
			var images []ImageContent
			for _, data := range coverDataList {
				if len(data) > 0 {
					mimeType := "image/jpeg"
					if len(data) > 4 && data[0] == 0x89 && data[1] == 0x50 {
						mimeType = "image/png"
					}
					images = append(images, ImageContent{
						Base64:   encodeBase64(data),
						MimeType: mimeType,
					})
				}
				if len(images) >= 2 {
					break // 最多比较 2 张封面
				}
			}
			if len(images) >= 2 {
				opts.Images = images
				userPrompt += "\n\nCover images of the comics are also provided for visual comparison."
			}
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

	start := strings.Index(content, "[")
	end := strings.LastIndex(content, "]")
	if start >= 0 && end > start {
		content = content[start : end+1]
	}

	var results []AIDuplicateVerification
	if err := json.Unmarshal([]byte(content), &results); err != nil {
		return nil, fmt.Errorf("failed to parse AI duplicate verification: %w", err)
	}

	return results, nil
}
