package service

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// ============================================================
// SSE Streaming Support (0-4)
// ============================================================

// StreamChunk SSE 流式返回的单个数据块
type StreamChunk struct {
	Content string `json:"content"` // 增量文本
	Done    bool   `json:"done"`    // 是否结束
	Error   string `json:"error,omitempty"`
}

// StreamCallback 流式回调函数，返回 false 可中止流
type StreamCallback func(chunk StreamChunk) bool

// CallCloudLLMStream 流式调用云端 LLM（SSE），通过回调逐块返回内容。
// 注意：流式模式不支持重试，也不支持多模态（可后续扩展）。
func CallCloudLLMStream(cfg AIConfig, systemPrompt, userPrompt string, opts *LLMCallOptions, callback StreamCallback) error {
	if !cfg.EnableCloudAI || cfg.CloudAPIKey == "" {
		return fmt.Errorf("cloud AI not configured")
	}
	if opts == nil {
		opts = &LLMCallOptions{}
	}

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

	start := time.Now()
	var err error

	switch provider {
	case "anthropic":
		err = streamAnthropic(cfg, apiURL, systemPrompt, userPrompt, maxTokens, temp, callback)
	case "google":
		err = streamGemini(cfg, apiURL, systemPrompt, userPrompt, maxTokens, temp, callback)
	default:
		err = streamOpenAICompatible(cfg, apiURL, systemPrompt, userPrompt, maxTokens, temp, callback)
	}

	// 记录使用量（流式模式 token 数量设为 0，因为不一定能拿到）
	duration := time.Since(start).Milliseconds()
	record := AIUsageRecord{
		Timestamp:  time.Now(),
		Provider:   cfg.CloudProvider,
		Model:      cfg.CloudModel,
		Scenario:   opts.Scenario,
		Success:    err == nil,
		DurationMs: duration,
	}
	recordUsage(record)

	return err
}

// streamOpenAICompatible OpenAI 兼容的 SSE 流式调用
func streamOpenAICompatible(cfg AIConfig, apiURL, systemPrompt, userPrompt string, maxTokens int, temperature float64, callback StreamCallback) error {
	reqURL := apiURL + "/chat/completions"

	body, _ := json.Marshal(map[string]interface{}{
		"model": cfg.CloudModel,
		"messages": []map[string]string{
			{"role": "system", "content": systemPrompt},
			{"role": "user", "content": userPrompt},
		},
		"max_tokens":  maxTokens,
		"temperature": temperature,
		"stream":      true,
	})

	client := &http.Client{Timeout: 300 * time.Second}
	req, _ := http.NewRequest("POST", reqURL, strings.NewReader(string(body)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+cfg.CloudAPIKey)

	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		respBody, _ := io.ReadAll(resp.Body)
		errMsg := string(respBody)
		if len(errMsg) > 500 {
			errMsg = errMsg[:500]
		}
		return fmt.Errorf("OpenAI stream API error %d: %s", resp.StatusCode, errMsg)
	}

	scanner := bufio.NewScanner(resp.Body)
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		data := strings.TrimPrefix(line, "data: ")
		if data == "[DONE]" {
			callback(StreamChunk{Done: true})
			return nil
		}

		var chunk struct {
			Choices []struct {
				Delta struct {
					Content string `json:"content"`
				} `json:"delta"`
			} `json:"choices"`
		}
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			continue
		}
		if len(chunk.Choices) > 0 && chunk.Choices[0].Delta.Content != "" {
			if !callback(StreamChunk{Content: chunk.Choices[0].Delta.Content}) {
				return nil // 客户端中止
			}
		}
	}

	callback(StreamChunk{Done: true})
	return scanner.Err()
}

// streamAnthropic Anthropic 的 SSE 流式调用
func streamAnthropic(cfg AIConfig, apiURL, systemPrompt, userPrompt string, maxTokens int, temperature float64, callback StreamCallback) error {
	reqURL := apiURL + "/v1/messages"

	body, _ := json.Marshal(map[string]interface{}{
		"model":       cfg.CloudModel,
		"max_tokens":  maxTokens,
		"temperature": temperature,
		"system":      systemPrompt,
		"messages":    []map[string]interface{}{{"role": "user", "content": userPrompt}},
		"stream":      true,
	})

	client := &http.Client{Timeout: 300 * time.Second}
	req, _ := http.NewRequest("POST", reqURL, strings.NewReader(string(body)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", cfg.CloudAPIKey)
	req.Header.Set("anthropic-version", "2023-06-01")

	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		respBody, _ := io.ReadAll(resp.Body)
		errMsg := string(respBody)
		if len(errMsg) > 500 {
			errMsg = errMsg[:500]
		}
		return fmt.Errorf("Anthropic stream API error %d: %s", resp.StatusCode, errMsg)
	}

	scanner := bufio.NewScanner(resp.Body)
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		data := strings.TrimPrefix(line, "data: ")

		var event struct {
			Type  string `json:"type"`
			Delta struct {
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"delta"`
		}
		if err := json.Unmarshal([]byte(data), &event); err != nil {
			continue
		}

		switch event.Type {
		case "content_block_delta":
			if event.Delta.Text != "" {
				if !callback(StreamChunk{Content: event.Delta.Text}) {
					return nil
				}
			}
		case "message_stop":
			callback(StreamChunk{Done: true})
			return nil
		}
	}

	callback(StreamChunk{Done: true})
	return scanner.Err()
}

// streamGemini Google Gemini 的 SSE 流式调用
func streamGemini(cfg AIConfig, apiURL, systemPrompt, userPrompt string, maxTokens int, temperature float64, callback StreamCallback) error {
	model := cfg.CloudModel
	if model == "" {
		model = "gemini-2.0-flash"
	}
	reqURL := fmt.Sprintf("%s/models/%s:streamGenerateContent?alt=sse&key=%s", apiURL, model, cfg.CloudAPIKey)

	body, _ := json.Marshal(map[string]interface{}{
		"contents": []map[string]interface{}{
			{"parts": []map[string]string{{"text": systemPrompt + "\n\n" + userPrompt}}},
		},
		"generationConfig": map[string]interface{}{
			"temperature":     temperature,
			"maxOutputTokens": maxTokens,
		},
	})

	client := &http.Client{Timeout: 300 * time.Second}
	req, _ := http.NewRequest("POST", reqURL, strings.NewReader(string(body)))
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		respBody, _ := io.ReadAll(resp.Body)
		errMsg := string(respBody)
		if len(errMsg) > 500 {
			errMsg = errMsg[:500]
		}
		return fmt.Errorf("Gemini stream API error %d: %s", resp.StatusCode, errMsg)
	}

	scanner := bufio.NewScanner(resp.Body)
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		data := strings.TrimPrefix(line, "data: ")

		var chunk struct {
			Candidates []struct {
				Content struct {
					Parts []struct {
						Text string `json:"text"`
					} `json:"parts"`
				} `json:"content"`
			} `json:"candidates"`
		}
		if err := json.Unmarshal([]byte(data), &chunk); err != nil {
			continue
		}
		if len(chunk.Candidates) > 0 && len(chunk.Candidates[0].Content.Parts) > 0 {
			text := chunk.Candidates[0].Content.Parts[0].Text
			if text != "" {
				if !callback(StreamChunk{Content: text}) {
					return nil
				}
			}
		}
	}

	callback(StreamChunk{Done: true})
	return scanner.Err()
}
