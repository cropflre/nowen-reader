package service

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/nowen-reader/nowen-reader/internal/config"
)

// ============================================================
// AI Configuration
// ============================================================

type CloudProvider = string

type ProviderPreset struct {
	Name           string   `json:"name"`
	APIURL         string   `json:"apiUrl"`
	DefaultModel   string   `json:"defaultModel"`
	Models         []string `json:"models"`
	SupportsVision bool     `json:"supportsVision"`
	Region         string   `json:"region"`
}

var ProviderPresets = map[string]ProviderPreset{
	"openai":     {Name: "OpenAI", APIURL: "https://api.openai.com/v1", DefaultModel: "gpt-4o-mini", Models: []string{"gpt-4o", "gpt-4o-mini", "gpt-4.5-preview", "o1", "o1-mini", "o3-mini"}, SupportsVision: true, Region: "international"},
	"anthropic":  {Name: "Anthropic (Claude)", APIURL: "https://api.anthropic.com", DefaultModel: "claude-sonnet-4-20250514", Models: []string{"claude-sonnet-4-20250514", "claude-3-5-haiku-20241022"}, SupportsVision: true, Region: "international"},
	"google":     {Name: "Google Gemini", APIURL: "https://generativelanguage.googleapis.com/v1beta", DefaultModel: "gemini-2.0-flash", Models: []string{"gemini-2.0-flash", "gemini-2.0-flash-lite", "gemini-1.5-pro"}, SupportsVision: true, Region: "international"},
	"groq":       {Name: "Groq", APIURL: "https://api.groq.com/openai/v1", DefaultModel: "llama-3.3-70b-versatile", Models: []string{"llama-3.3-70b-versatile", "llama-3.1-8b-instant"}, SupportsVision: false, Region: "international"},
	"mistral":    {Name: "Mistral AI", APIURL: "https://api.mistral.ai/v1", DefaultModel: "mistral-small-latest", Models: []string{"mistral-large-latest", "mistral-small-latest"}, SupportsVision: true, Region: "international"},
	"cohere":     {Name: "Cohere", APIURL: "https://api.cohere.com/v2", DefaultModel: "command-r-plus", Models: []string{"command-r-plus", "command-r"}, SupportsVision: false, Region: "international"},
	"deepseek":   {Name: "DeepSeek (深度求索)", APIURL: "https://api.deepseek.com", DefaultModel: "deepseek-chat", Models: []string{"deepseek-chat", "deepseek-reasoner"}, SupportsVision: false, Region: "china"},
	"zhipu":      {Name: "Zhipu AI (智谱清言)", APIURL: "https://open.bigmodel.cn/api/paas/v4", DefaultModel: "glm-4v-flash", Models: []string{"glm-4v-flash", "glm-4-flash", "glm-4-plus"}, SupportsVision: true, Region: "china"},
	"qwen":       {Name: "Alibaba Qwen (通义千问)", APIURL: "https://dashscope.aliyuncs.com/compatible-mode/v1", DefaultModel: "qwen-vl-plus", Models: []string{"qwen-turbo", "qwen-plus", "qwen-max", "qwen-vl-plus"}, SupportsVision: true, Region: "china"},
	"doubao":     {Name: "Doubao (豆包/字节跳动)", APIURL: "https://ark.cn-beijing.volces.com/api/v3", DefaultModel: "doubao-1.5-pro-32k", Models: []string{"doubao-1.5-pro-32k", "doubao-1.5-lite-32k"}, SupportsVision: true, Region: "china"},
	"moonshot":   {Name: "Moonshot AI (月之暗面)", APIURL: "https://api.moonshot.cn/v1", DefaultModel: "moonshot-v1-8k", Models: []string{"moonshot-v1-8k", "moonshot-v1-32k"}, SupportsVision: false, Region: "china"},
	"baichuan":   {Name: "Baichuan (百川智能)", APIURL: "https://api.baichuan-ai.com/v1", DefaultModel: "Baichuan4", Models: []string{"Baichuan4", "Baichuan3-Turbo"}, SupportsVision: false, Region: "china"},
	"minimax":    {Name: "MiniMax", APIURL: "https://api.minimax.chat/v1", DefaultModel: "MiniMax-Text-01", Models: []string{"MiniMax-Text-01"}, SupportsVision: false, Region: "china"},
	"stepfun":    {Name: "StepFun (阶跃星辰)", APIURL: "https://api.stepfun.com/v1", DefaultModel: "step-1v-8k", Models: []string{"step-2-16k", "step-1v-8k"}, SupportsVision: true, Region: "china"},
	"yi":         {Name: "Yi (零一万物)", APIURL: "https://api.lingyiwanwu.com/v1", DefaultModel: "yi-vision", Models: []string{"yi-large", "yi-medium", "yi-vision"}, SupportsVision: true, Region: "china"},
	"compatible": {Name: "Custom (OpenAI Compatible)", APIURL: "", DefaultModel: "", Models: nil, SupportsVision: true, Region: "international"},
}

type AIConfig struct {
	EnableCloudAI bool   `json:"enableCloudAI"`
	CloudProvider string `json:"cloudProvider"`
	CloudAPIKey   string `json:"cloudApiKey"`
	CloudAPIURL   string `json:"cloudApiUrl"`
	CloudModel    string `json:"cloudModel"`
	MaxTokens     int    `json:"maxTokens"`  // 0-1: 最大输出 token 数，0 表示使用默认值
	MaxRetries    int    `json:"maxRetries"` // 0-2: 最大重试次数，0 表示不重试
}

var defaultAIConfig = AIConfig{
	EnableCloudAI: false,
	CloudProvider: "openai",
	CloudAPIKey:   "",
	CloudAPIURL:   "https://api.openai.com/v1",
	CloudModel:    "gpt-4o-mini",
	MaxTokens:     2000,
	MaxRetries:    2,
}

func aiConfigPath() string {
	return filepath.Join(config.DataDir(), "ai-config.json")
}

func LoadAIConfig() AIConfig {
	cfg := defaultAIConfig
	data, err := os.ReadFile(aiConfigPath())
	if err != nil {
		return cfg
	}
	_ = json.Unmarshal(data, &cfg)
	// 兼容旧配置：如果 maxTokens 为 0，使用默认值
	if cfg.MaxTokens <= 0 {
		cfg.MaxTokens = defaultAIConfig.MaxTokens
	}
	if cfg.MaxRetries < 0 {
		cfg.MaxRetries = 0
	}
	return cfg
}

func SaveAIConfig(cfg AIConfig) error {
	dir := filepath.Dir(aiConfigPath())
	os.MkdirAll(dir, 0755)
	data, _ := json.MarshalIndent(cfg, "", "  ")
	return os.WriteFile(aiConfigPath(), data, 0644)
}

// ============================================================
// AI Status
// ============================================================

type AIStatus struct {
	CloudAI struct {
		Configured bool   `json:"configured"`
		Provider   string `json:"provider"`
		Model      string `json:"model"`
	} `json:"cloudAI"`
}

func GetAIStatus() AIStatus {
	cfg := LoadAIConfig()

	var status AIStatus
	status.CloudAI.Configured = cfg.EnableCloudAI && cfg.CloudAPIKey != ""
	status.CloudAI.Provider = cfg.CloudProvider
	status.CloudAI.Model = cfg.CloudModel
	return status
}

// ============================================================
// Token Usage Tracking (0-5)
// ============================================================

// AIUsageRecord 记录单次 AI 调用的 token 使用量
type AIUsageRecord struct {
	Timestamp    time.Time `json:"timestamp"`
	Provider     string    `json:"provider"`
	Model        string    `json:"model"`
	PromptTokens int       `json:"promptTokens"`
	OutputTokens int       `json:"outputTokens"`
	TotalTokens  int       `json:"totalTokens"`
	Scenario     string    `json:"scenario"` // translate, summary, tag, chat 等
	Success      bool      `json:"success"`
	DurationMs   int64     `json:"durationMs"`
}

// AIUsageStats AI 使用量统计汇总
type AIUsageStats struct {
	TotalCalls        int             `json:"totalCalls"`
	SuccessCalls      int             `json:"successCalls"`
	FailedCalls       int             `json:"failedCalls"`
	TotalPromptTokens int             `json:"totalPromptTokens"`
	TotalOutputTokens int             `json:"totalOutputTokens"`
	TotalTokens       int             `json:"totalTokens"`
	AvgDurationMs     int64           `json:"avgDurationMs"`
	ByScenario        map[string]int  `json:"byScenario"`
	ByProvider        map[string]int  `json:"byProvider"`
	Records           []AIUsageRecord `json:"records"` // 最近 N 条记录
}

var (
	usageMu      sync.Mutex
	usageRecords []AIUsageRecord
	maxRecords   = 500 // 保留最近 500 条记录
)

// recordUsage 记录一次 AI 调用
func recordUsage(record AIUsageRecord) {
	usageMu.Lock()
	defer usageMu.Unlock()
	usageRecords = append(usageRecords, record)
	// 滑动窗口：只保留最近 maxRecords 条
	if len(usageRecords) > maxRecords {
		usageRecords = usageRecords[len(usageRecords)-maxRecords:]
	}
}

// GetAIUsageStats 获取 AI 使用量统计
func GetAIUsageStats() AIUsageStats {
	usageMu.Lock()
	defer usageMu.Unlock()

	stats := AIUsageStats{
		ByScenario: make(map[string]int),
		ByProvider: make(map[string]int),
	}

	var totalDuration int64
	for _, r := range usageRecords {
		stats.TotalCalls++
		if r.Success {
			stats.SuccessCalls++
		} else {
			stats.FailedCalls++
		}
		stats.TotalPromptTokens += r.PromptTokens
		stats.TotalOutputTokens += r.OutputTokens
		stats.TotalTokens += r.TotalTokens
		totalDuration += r.DurationMs
		stats.ByScenario[r.Scenario]++
		stats.ByProvider[r.Provider]++
	}

	if stats.TotalCalls > 0 {
		stats.AvgDurationMs = totalDuration / int64(stats.TotalCalls)
	}

	// 返回最近 50 条记录
	recentCount := 50
	if len(usageRecords) < recentCount {
		recentCount = len(usageRecords)
	}
	stats.Records = make([]AIUsageRecord, recentCount)
	copy(stats.Records, usageRecords[len(usageRecords)-recentCount:])

	return stats
}

// ResetAIUsageStats 重置统计数据
func ResetAIUsageStats() {
	usageMu.Lock()
	defer usageMu.Unlock()
	usageRecords = nil
}

// ============================================================
// Multimodal Image Content (0-3)
// ============================================================

// ImageContent 用于传入图片（支持 base64 或 URL）
type ImageContent struct {
	// Base64 编码的图片数据（不含 data:image/xxx;base64, 前缀）
	Base64 string `json:"base64,omitempty"`
	// 图片 URL
	URL string `json:"url,omitempty"`
	// MIME 类型，如 image/jpeg, image/png
	MimeType string `json:"mimeType,omitempty"`
}

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
			strings.Contains(errStr, "invalid") || strings.Contains(errStr, "not configured") {
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
		return "", tokenUsage{}, err
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

// ============================================================
// Translate metadata fields via Cloud LLM
// ============================================================

// TranslateMetadataFields translates metadata fields to the target language.
func TranslateMetadataFields(cfg AIConfig, fields map[string]string, targetLang string) (map[string]string, error) {
	if !cfg.EnableCloudAI || cfg.CloudAPIKey == "" {
		return nil, fmt.Errorf("cloud AI not configured")
	}

	if len(fields) == 0 {
		return nil, nil
	}

	langName := "English"
	if strings.HasPrefix(targetLang, "zh") {
		langName = "Chinese (简体中文)"
	}

	systemPrompt := fmt.Sprintf(`You are a professional translator specializing in manga/comic metadata. Translate the given fields to %s. Keep proper nouns in their commonly known form. For genre/tag terms, use standard localized terms.
Respond ONLY with a valid JSON object containing the translated fields.`, langName)

	fieldsJSON, _ := json.MarshalIndent(fields, "", "  ")
	userPrompt := fmt.Sprintf("Translate these metadata fields to %s:\n\n%s\n\nReturn a JSON object with the same keys and translated values.", langName, string(fieldsJSON))

	content, err := CallCloudLLM(cfg, systemPrompt, userPrompt, &LLMCallOptions{
		Scenario:  "translate",
		MaxTokens: 1000,
	})
	if err != nil {
		return nil, err
	}

	// Clean markdown code blocks
	content = strings.ReplaceAll(content, "```json", "")
	content = strings.ReplaceAll(content, "```", "")
	content = strings.TrimSpace(content)

	var result map[string]string
	if err := json.Unmarshal([]byte(content), &result); err != nil {
		// Try to extract JSON object
		start := strings.Index(content, "{")
		end := strings.LastIndex(content, "}")
		if start >= 0 && end > start {
			content = content[start : end+1]
			if err := json.Unmarshal([]byte(content), &result); err != nil {
				return nil, fmt.Errorf("failed to parse AI response: %w", err)
			}
		} else {
			return nil, fmt.Errorf("failed to parse AI response: %w", err)
		}
	}
	return result, nil
}

// ============================================================
// Phase 1-1: AI 智能摘要生成
// ============================================================

// GenerateSummary 根据漫画/小说的元数据信息，让 AI 生成中文简介。
func GenerateSummary(cfg AIConfig, title, author, genre, seriesName, existingDesc, contentType, targetLang string) (string, error) {
	if !cfg.EnableCloudAI || cfg.CloudAPIKey == "" {
		return "", fmt.Errorf("cloud AI not configured")
	}

	langName := "Chinese (简体中文)"
	if targetLang == "en" {
		langName = "English"
	}

	systemPrompt := fmt.Sprintf(`You are a professional %s reviewer and librarian. Based on the given metadata, write an engaging and informative summary/description in %s.

Requirements:
- Write 2-4 sentences (80-200 characters for Chinese, 100-300 words for English)
- Be descriptive and engaging, like a bookstore blurb
- If the existing description exists, improve and localize it rather than creating from scratch
- Include genre context and appeal points
- Do NOT add any prefixes, labels, or markdown — return only the pure summary text`, contentType, langName)

	// 构建元数据上下文
	var parts []string
	if title != "" {
		parts = append(parts, fmt.Sprintf("Title: %s", title))
	}
	if author != "" {
		parts = append(parts, fmt.Sprintf("Author: %s", author))
	}
	if genre != "" {
		parts = append(parts, fmt.Sprintf("Genre: %s", genre))
	}
	if seriesName != "" && seriesName != title {
		parts = append(parts, fmt.Sprintf("Series: %s", seriesName))
	}
	if existingDesc != "" {
		parts = append(parts, fmt.Sprintf("Existing description: %s", existingDesc))
	}
	parts = append(parts, fmt.Sprintf("Content type: %s", contentType))

	userPrompt := fmt.Sprintf("Generate a %s summary for this %s based on the following metadata:\n\n%s", langName, contentType, strings.Join(parts, "\n"))

	return CallCloudLLM(cfg, systemPrompt, userPrompt, &LLMCallOptions{
		Scenario:  "summary",
		MaxTokens: 500,
	})
}

// ============================================================
// Phase 1-2: AI 文件名智能解析
// ============================================================

// ParsedFilename AI 从文件名解析出的结构化元数据
type ParsedFilename struct {
	Title       string `json:"title,omitempty"`
	Author      string `json:"author,omitempty"`
	Group       string `json:"group,omitempty"` // 汉化组/扫图组
	SeriesName  string `json:"seriesName,omitempty"`
	SeriesIndex *int   `json:"seriesIndex,omitempty"`
	Language    string `json:"language,omitempty"`
	Genre       string `json:"genre,omitempty"`
	Year        *int   `json:"year,omitempty"`
	Tags        string `json:"tags,omitempty"` // 逗号分隔的额外标签
}

// AIParseFilename 使用 AI 智能解析复杂文件名，提取结构化元数据。
func AIParseFilename(cfg AIConfig, filename string) (*ParsedFilename, error) {
	if !cfg.EnableCloudAI || cfg.CloudAPIKey == "" {
		return nil, fmt.Errorf("cloud AI not configured")
	}

	systemPrompt := `You are an expert at parsing manga/comic/novel filenames. These filenames often follow complex conventions like:
- [Group] Title Vol.01 [Author]
- (C99) [Author] Title (Language)
- [汉化组] 作品名 第01卷 [作者]
- Title_v01_[Author]_(Year)

Extract as much structured metadata as possible from the filename.

Rules:
- "Group" refers to scan/translation groups (e.g. 汉化组, scanlation group)
- Remove file extensions before parsing
- Volume/chapter numbers map to seriesIndex
- Return ONLY a valid JSON object, no extra text or markdown`

	userPrompt := fmt.Sprintf(`Parse this filename and extract structured metadata:

"%s"

Return a JSON object with these fields (omit empty ones):
{
  "title": "the main title/work name",
  "author": "author/artist name",
  "group": "scan/translation group name",
  "seriesName": "series name if different from title",
  "seriesIndex": 1,
  "language": "language code like zh, en, ja",
  "genre": "comma-separated genres if identifiable",
  "year": 2024,
  "tags": "comma-separated extra tags"
}`, filename)

	content, err := CallCloudLLM(cfg, systemPrompt, userPrompt, &LLMCallOptions{
		Scenario:  "parse_filename",
		MaxTokens: 300,
	})
	if err != nil {
		return nil, err
	}

	// 清理 markdown 代码块
	content = strings.ReplaceAll(content, "```json", "")
	content = strings.ReplaceAll(content, "```", "")
	content = strings.TrimSpace(content)

	// 提取 JSON
	start := strings.Index(content, "{")
	end := strings.LastIndex(content, "}")
	if start >= 0 && end > start {
		content = content[start : end+1]
	}

	var parsed ParsedFilename
	if err := json.Unmarshal([]byte(content), &parsed); err != nil {
		return nil, fmt.Errorf("failed to parse AI response: %w", err)
	}
	return &parsed, nil
}

// ============================================================
// Phase 1-3: AI 智能标签建议
// ============================================================

// SuggestTags 根据漫画/小说的元数据，让 AI 推荐合适的标签。
func SuggestTags(cfg AIConfig, title, author, genre, description, contentType, targetLang string, existingTags []string) ([]string, error) {
	if !cfg.EnableCloudAI || cfg.CloudAPIKey == "" {
		return nil, fmt.Errorf("cloud AI not configured")
	}

	langName := "Chinese (简体中文)"
	if targetLang == "en" {
		langName = "English"
	}

	systemPrompt := fmt.Sprintf(`You are an expert %s librarian and tagger. Based on the given metadata, suggest relevant tags in %s.

Requirements:
- Suggest 5-10 tags that would help users discover and categorize this work
- Tags should be concise (1-4 words each)
- Include genre tags, theme tags, and mood/style tags
- If existing tags are provided, suggest NEW tags that complement them (don't repeat existing ones)
- Return ONLY a JSON array of tag strings, no extra text or markdown
- Tags should be in %s`, contentType, langName, langName)

	// 构建上下文
	var parts []string
	if title != "" {
		parts = append(parts, fmt.Sprintf("Title: %s", title))
	}
	if author != "" {
		parts = append(parts, fmt.Sprintf("Author: %s", author))
	}
	if genre != "" {
		parts = append(parts, fmt.Sprintf("Genre: %s", genre))
	}
	if description != "" {
		// 截断过长的描述
		desc := description
		if len(desc) > 500 {
			desc = desc[:500] + "..."
		}
		parts = append(parts, fmt.Sprintf("Description: %s", desc))
	}
	if len(existingTags) > 0 {
		parts = append(parts, fmt.Sprintf("Existing tags (do NOT repeat): %s", strings.Join(existingTags, ", ")))
	}

	userPrompt := fmt.Sprintf("Suggest tags for this %s:\n\n%s\n\nReturn a JSON array of tag strings.", contentType, strings.Join(parts, "\n"))

	content, err := CallCloudLLM(cfg, systemPrompt, userPrompt, &LLMCallOptions{
		Scenario:  "suggest_tags",
		MaxTokens: 300,
	})
	if err != nil {
		return nil, err
	}

	// 清理
	content = strings.ReplaceAll(content, "```json", "")
	content = strings.ReplaceAll(content, "```", "")
	content = strings.TrimSpace(content)

	// 提取 JSON 数组
	start := strings.Index(content, "[")
	end := strings.LastIndex(content, "]")
	if start >= 0 && end > start {
		content = content[start : end+1]
	}

	var tags []string
	if err := json.Unmarshal([]byte(content), &tags); err != nil {
		return nil, fmt.Errorf("failed to parse AI response: %w", err)
	}

	// 过滤掉已有标签
	existingSet := make(map[string]bool)
	for _, t := range existingTags {
		existingSet[strings.ToLower(strings.TrimSpace(t))] = true
	}
	var newTags []string
	for _, t := range tags {
		t = strings.TrimSpace(t)
		if t != "" && !existingSet[strings.ToLower(t)] {
			newTags = append(newTags, t)
		}
	}

	return newTags, nil
}
