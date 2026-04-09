package service

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"strings"
	"time"
)

// ============================================================
// Cloud LLM Unified Caller (增强版)
// ============================================================

// LLMCallOptions 调用选项
type LLMCallOptions struct {
	// 场景标识，用于统计（如 translate, summary, tag, chat）
	Scenario string
	// 覆盖 config 的 MaxTokens（0 表示使用 config 的值）
	MaxTokens int
	// 覆盖 config 的 Temperature（nil 表示使用默认 0.3）
	Temperature *float64
	// 图片列表（多模态）
	Images []ImageContent
}

// CallCloudLLM 调用云端 LLM，支持重试和 token 统计。
// opts 可传 nil 使用默认选项。
func CallCloudLLM(cfg AIConfig, systemPrompt, userPrompt string, opts *LLMCallOptions) (string, error) {
	if !cfg.EnableCloudAI || cfg.CloudAPIKey == "" {
		return "", fmt.Errorf("cloud AI not configured")
	}

	if opts == nil {
		opts = &LLMCallOptions{}
	}

	maxRetries := cfg.MaxRetries
	if maxRetries < 0 {
		maxRetries = 0
	}

	var lastErr error
	for attempt := 0; attempt <= maxRetries; attempt++ {
		if attempt > 0 {
			// 指数退避：1s, 2s, 4s...
			backoff := time.Duration(math.Pow(2, float64(attempt-1))) * time.Second
			log.Printf("[AI] Retry %d/%d after %v (error: %v)", attempt, maxRetries, backoff, lastErr)
			time.Sleep(backoff)
		}

		start := time.Now()
		result, usage, err := callCloudLLMOnce(cfg, systemPrompt, userPrompt, opts)
		duration := time.Since(start).Milliseconds()

		// 记录使用量
		record := AIUsageRecord{
			Timestamp:    time.Now(),
			Provider:     cfg.CloudProvider,
			Model:        cfg.CloudModel,
			PromptTokens: usage.PromptTokens,
			OutputTokens: usage.OutputTokens,
			TotalTokens:  usage.TotalTokens,
			Scenario:     opts.Scenario,
			Success:      err == nil,
			DurationMs:   duration,
		}
		recordUsage(record)

		if err == nil {
			return result, nil
		}

		lastErr = err

		// 某些错误不需要重试（如认证失败、请求无效）
		errStr := err.Error()
		if strings.Contains(errStr, "401") || strings.Contains(errStr, "403") ||
			strings.Contains(errStr, "invalid_api_key") || strings.Contains(errStr, "not configured") ||
			strings.Contains(errStr, "does not support vision") {
			return "", err
		}
	}

	return "", fmt.Errorf("after %d retries: %w", maxRetries, lastErr)
}

// tokenUsage 从 API 响应中提取的 token 使用量
type tokenUsage struct {
	PromptTokens int
	OutputTokens int
	TotalTokens  int
}

// callCloudLLMOnce 单次调用（不重试）
func callCloudLLMOnce(cfg AIConfig, systemPrompt, userPrompt string, opts *LLMCallOptions) (string, tokenUsage, error) {
	provider := cfg.CloudProvider
	apiURL := cfg.CloudAPIURL
	if apiURL == "" {
		if p, ok := ProviderPresets[provider]; ok {
			apiURL = p.APIURL
		}
	}

	maxTokens := cfg.MaxTokens
	if opts.MaxTokens > 0 {
		maxTokens = opts.MaxTokens
	}
	if maxTokens <= 0 {
		maxTokens = 2000
	}

	temp := 0.3
	if opts.Temperature != nil {
		temp = *opts.Temperature
	}

	switch provider {
	case "anthropic":
		return callAnthropic(cfg, apiURL, systemPrompt, userPrompt, maxTokens, temp, opts.Images)
	case "google":
		return callGemini(cfg, apiURL, systemPrompt, userPrompt, maxTokens, temp, opts.Images)
	default:
		return callOpenAICompatible(cfg, apiURL, systemPrompt, userPrompt, maxTokens, temp, opts.Images)
	}
}

// ============================================================
// OpenAI Compatible Provider (含多模态)
// ============================================================

func callOpenAICompatible(cfg AIConfig, apiURL, systemPrompt, userPrompt string, maxTokens int, temperature float64, images []ImageContent) (string, tokenUsage, error) {
	reqURL := apiURL + "/chat/completions"

	// 构建 messages
	messages := []interface{}{
		map[string]string{"role": "system", "content": systemPrompt},
	}

	// 用户消息：如果有图片，使用多模态格式
	if len(images) > 0 {
		contentParts := []interface{}{
			map[string]string{"type": "text", "text": userPrompt},
		}
		for _, img := range images {
			imageURL := ""
			if img.Base64 != "" {
				mimeType := img.MimeType
				if mimeType == "" {
					mimeType = "image/jpeg"
				}
				imageURL = fmt.Sprintf("data:%s;base64,%s", mimeType, img.Base64)
			} else if img.URL != "" {
				imageURL = img.URL
			}
			if imageURL != "" {
				contentParts = append(contentParts, map[string]interface{}{
					"type": "image_url",
					"image_url": map[string]string{
						"url": imageURL,
					},
				})
			}
		}
		messages = append(messages, map[string]interface{}{
			"role":    "user",
			"content": contentParts,
		})
	} else {
		messages = append(messages, map[string]string{
			"role":    "user",
			"content": userPrompt,
		})
	}

	body, _ := json.Marshal(map[string]interface{}{
		"model":       cfg.CloudModel,
		"messages":    messages,
		"max_tokens":  maxTokens,
		"temperature": temperature,
	})

	client := &http.Client{Timeout: 120 * time.Second}
	req, _ := http.NewRequest("POST", reqURL, strings.NewReader(string(body)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+cfg.CloudAPIKey)

	resp, err := client.Do(req)
	if err != nil {
		return "", tokenUsage{}, err
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		errMsg := string(respBody)
		if len(errMsg) > 500 {
			errMsg = errMsg[:500]
		}
		return "", tokenUsage{}, fmt.Errorf("OpenAI API error %d: %s", resp.StatusCode, errMsg)
	}

	var data struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
		Usage struct {
			PromptTokens     int `json:"prompt_tokens"`
			CompletionTokens int `json:"completion_tokens"`
			TotalTokens      int `json:"total_tokens"`
		} `json:"usage"`
	}
	if err := json.Unmarshal(respBody, &data); err != nil {
		preview := string(respBody)
		if len(preview) > 500 {
			preview = preview[:500]
		}
		return "", tokenUsage{}, fmt.Errorf("failed to parse OpenAI API response: %w\nResponse body: %s", err, preview)
	}
	if len(data.Choices) == 0 {
		return "", tokenUsage{}, fmt.Errorf("no response from LLM")
	}

	usage := tokenUsage{
		PromptTokens: data.Usage.PromptTokens,
		OutputTokens: data.Usage.CompletionTokens,
		TotalTokens:  data.Usage.TotalTokens,
	}
	return data.Choices[0].Message.Content, usage, nil
}

// ============================================================
// Anthropic Provider (含多模态)
// ============================================================

func callAnthropic(cfg AIConfig, apiURL, systemPrompt, userPrompt string, maxTokens int, temperature float64, images []ImageContent) (string, tokenUsage, error) {
	reqURL := apiURL + "/v1/messages"

	// 构建 content
	var content []interface{}
	if len(images) > 0 {
		for _, img := range images {
			if img.Base64 != "" {
				mimeType := img.MimeType
				if mimeType == "" {
					mimeType = "image/jpeg"
				}
				content = append(content, map[string]interface{}{
					"type": "image",
					"source": map[string]string{
						"type":       "base64",
						"media_type": mimeType,
						"data":       img.Base64,
					},
				})
			}
		}
	}
	content = append(content, map[string]interface{}{
		"type": "text",
		"text": userPrompt,
	})

	body, _ := json.Marshal(map[string]interface{}{
		"model":       cfg.CloudModel,
		"max_tokens":  maxTokens,
		"temperature": temperature,
		"system":      systemPrompt,
		"messages":    []map[string]interface{}{{"role": "user", "content": content}},
	})

	client := &http.Client{Timeout: 120 * time.Second}
	req, _ := http.NewRequest("POST", reqURL, strings.NewReader(string(body)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", cfg.CloudAPIKey)
	req.Header.Set("anthropic-version", "2023-06-01")

	resp, err := client.Do(req)
	if err != nil {
		return "", tokenUsage{}, err
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		errMsg := string(respBody)
		if len(errMsg) > 500 {
			errMsg = errMsg[:500]
		}
		return "", tokenUsage{}, fmt.Errorf("Anthropic API error %d: %s", resp.StatusCode, errMsg)
	}

	var data struct {
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
		Usage struct {
			InputTokens  int `json:"input_tokens"`
			OutputTokens int `json:"output_tokens"`
		} `json:"usage"`
	}
	if err := json.Unmarshal(respBody, &data); err != nil {
		return "", tokenUsage{}, err
	}

	usage := tokenUsage{
		PromptTokens: data.Usage.InputTokens,
		OutputTokens: data.Usage.OutputTokens,
		TotalTokens:  data.Usage.InputTokens + data.Usage.OutputTokens,
	}

	for _, c := range data.Content {
		if c.Type == "text" {
			return c.Text, usage, nil
		}
	}
	return "", usage, fmt.Errorf("no text in Anthropic response")
}

// ============================================================
// Google Gemini Provider (含多模态)
// ============================================================

func callGemini(cfg AIConfig, apiURL, systemPrompt, userPrompt string, maxTokens int, temperature float64, images []ImageContent) (string, tokenUsage, error) {
	model := cfg.CloudModel
	if model == "" {
		model = "gemini-2.0-flash"
	}
	reqURL := fmt.Sprintf("%s/models/%s:generateContent?key=%s", apiURL, model, cfg.CloudAPIKey)

	// 构建 parts
	parts := []interface{}{
		map[string]string{"text": systemPrompt + "\n\n" + userPrompt},
	}
	for _, img := range images {
		if img.Base64 != "" {
			mimeType := img.MimeType
			if mimeType == "" {
				mimeType = "image/jpeg"
			}
			parts = append(parts, map[string]interface{}{
				"inline_data": map[string]string{
					"mime_type": mimeType,
					"data":      img.Base64,
				},
			})
		}
	}

	body, _ := json.Marshal(map[string]interface{}{
		"contents": []map[string]interface{}{
			{"parts": parts},
		},
		"generationConfig": map[string]interface{}{
			"temperature":     temperature,
			"maxOutputTokens": maxTokens,
		},
	})

	client := &http.Client{Timeout: 120 * time.Second}
	req, _ := http.NewRequest("POST", reqURL, strings.NewReader(string(body)))
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return "", tokenUsage{}, err
	}
	defer resp.Body.Close()

	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		errMsg := string(respBody)
		if len(errMsg) > 500 {
			errMsg = errMsg[:500]
		}
		return "", tokenUsage{}, fmt.Errorf("Gemini API error %d: %s", resp.StatusCode, errMsg)
	}

	var data struct {
		Candidates []struct {
			Content struct {
				Parts []struct {
					Text string `json:"text"`
				} `json:"parts"`
			} `json:"content"`
		} `json:"candidates"`
		UsageMetadata struct {
			PromptTokenCount     int `json:"promptTokenCount"`
			CandidatesTokenCount int `json:"candidatesTokenCount"`
			TotalTokenCount      int `json:"totalTokenCount"`
		} `json:"usageMetadata"`
	}
	if err := json.Unmarshal(respBody, &data); err != nil {
		return "", tokenUsage{}, err
	}

	usage := tokenUsage{
		PromptTokens: data.UsageMetadata.PromptTokenCount,
		OutputTokens: data.UsageMetadata.CandidatesTokenCount,
		TotalTokens:  data.UsageMetadata.TotalTokenCount,
	}

	if len(data.Candidates) > 0 && len(data.Candidates[0].Content.Parts) > 0 {
		return data.Candidates[0].Content.Parts[0].Text, usage, nil
	}
	return "", usage, fmt.Errorf("no response from Gemini")
}
