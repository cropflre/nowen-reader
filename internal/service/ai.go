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

// ============================================================
// Phase 2-1: Vision 封面分析
// ============================================================

// CoverAnalysis AI 分析封面后返回的结构化数据
type CoverAnalysis struct {
	Style       string   `json:"style"`       // 画风：写实/卡通/少女漫/少年漫/美漫/韩漫等
	Mood        string   `json:"mood"`        // 氛围：热血/温馨/黑暗/搞笑/恐怖等
	Theme       string   `json:"theme"`       // 主题：冒险/恋爱/校园/异世界/科幻等
	AgeRating   string   `json:"ageRating"`   // 年龄分级估计：全年龄/青年/成人
	ColorTone   string   `json:"colorTone"`   // 色调：明亮/暗沉/彩色/黑白
	Characters  string   `json:"characters"`  // 角色描述
	Tags        []string `json:"tags"`        // 建议标签
	Description string   `json:"description"` // 一句话描述封面内容
	Confidence  string   `json:"confidence"`  // 分析置信度：high/medium/low
}

// AnalyzeCoverWithVision 使用多模态 LLM 分析漫画/小说封面图片。
// coverData 为封面图片的原始字节数据（JPEG/PNG/WebP）。
func AnalyzeCoverWithVision(cfg AIConfig, coverData []byte, title, contentType, targetLang string) (*CoverAnalysis, error) {
	if !cfg.EnableCloudAI || cfg.CloudAPIKey == "" {
		return nil, fmt.Errorf("cloud AI not configured")
	}

	// 检查 provider 是否支持 Vision
	if preset, ok := ProviderPresets[cfg.CloudProvider]; ok {
		if !preset.SupportsVision {
			return nil, fmt.Errorf("provider %s does not support vision/image analysis", cfg.CloudProvider)
		}
	}

	langName := "Chinese (简体中文)"
	if targetLang == "en" {
		langName = "English"
	}

	// 加载 prompt 模板
	templates := LoadPromptTemplates()
	systemPrompt := templates.CoverAnalysis.System
	if systemPrompt == "" {
		systemPrompt = fmt.Sprintf(`You are an expert %s cover analyst and librarian. Analyze the given cover image and extract structured information in %s.

Return ONLY a valid JSON object with these fields:
{
  "style": "art style (e.g. realistic, cartoon, shoujo manga, seinen, manhwa, etc.)",
  "mood": "atmosphere/mood (e.g. action, warm, dark, comedy, horror, etc.)",
  "theme": "main theme (e.g. adventure, romance, school, isekai, sci-fi, etc.)",
  "ageRating": "estimated age rating (all-ages / teen / mature)",
  "colorTone": "color characteristics (bright / dark / colorful / monochrome)",
  "characters": "brief character description visible on cover",
  "tags": ["tag1", "tag2", "tag3"],
  "description": "one-sentence description of the cover in %s",
  "confidence": "high/medium/low"
}`, contentType, langName, langName)
	}

	userPrompt := templates.CoverAnalysis.User
	if userPrompt == "" {
		userPrompt = fmt.Sprintf("Analyze this %s cover image", contentType)
	}
	if title != "" {
		userPrompt += fmt.Sprintf(" (title: %s)", title)
	}
	userPrompt += ". Return a JSON object with style, mood, theme, ageRating, colorTone, characters, tags, description, confidence."

	// 检测 MIME 类型
	mimeType := "image/jpeg"
	if len(coverData) > 4 {
		if coverData[0] == 0x89 && coverData[1] == 0x50 {
			mimeType = "image/png"
		} else if coverData[0] == 0x52 && coverData[1] == 0x49 {
			mimeType = "image/webp"
		}
	}

	// 编码为 base64
	b64 := encodeBase64(coverData)

	content, err := CallCloudLLM(cfg, systemPrompt, userPrompt, &LLMCallOptions{
		Scenario:  "cover_analysis",
		MaxTokens: 500,
		Images: []ImageContent{
			{Base64: b64, MimeType: mimeType},
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

	var analysis CoverAnalysis
	if err := json.Unmarshal([]byte(content), &analysis); err != nil {
		return nil, fmt.Errorf("failed to parse AI vision response: %w", err)
	}
	return &analysis, nil
}

// encodeBase64 将字节数组编码为 base64 字符串
func encodeBase64(data []byte) string {
	const base64chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
	var result strings.Builder
	result.Grow((len(data)/3 + 1) * 4)
	for i := 0; i < len(data); i += 3 {
		var b0, b1, b2 byte
		b0 = data[i]
		if i+1 < len(data) {
			b1 = data[i+1]
		}
		if i+2 < len(data) {
			b2 = data[i+2]
		}
		result.WriteByte(base64chars[b0>>2])
		result.WriteByte(base64chars[((b0&0x03)<<4)|(b1>>4)])
		if i+1 < len(data) {
			result.WriteByte(base64chars[((b1&0x0F)<<2)|(b2>>6)])
		} else {
			result.WriteByte('=')
		}
		if i+2 < len(data) {
			result.WriteByte(base64chars[b2&0x3F])
		} else {
			result.WriteByte('=')
		}
	}
	return result.String()
}

// ============================================================
// Phase 2-2: AI 推荐理由生成
// ============================================================

// GenerateRecommendationReasons 使用 AI 为推荐列表生成自然语言推荐理由。
// items: [{title, reasons, genre, author}]
// 批量处理以减少 API 调用次数。
func GenerateRecommendationReasons(cfg AIConfig, items []RecommendationItem, userFavorites []string, targetLang string) (map[string]string, error) {
	if !cfg.EnableCloudAI || cfg.CloudAPIKey == "" {
		return nil, fmt.Errorf("cloud AI not configured")
	}
	if len(items) == 0 {
		return map[string]string{}, nil
	}

	langName := "Chinese (简体中文)"
	if targetLang == "en" {
		langName = "English"
	}

	templates := LoadPromptTemplates()
	systemPrompt := templates.RecommendReason.System
	if systemPrompt == "" {
		systemPrompt = fmt.Sprintf(`You are a friendly %s recommendation curator. Generate short, engaging recommendation reasons for each item.

Rules:
- Each reason should be 1 sentence, max 50 characters for Chinese or 80 characters for English
- Be specific: mention matching tags, similar works, or why the user would enjoy it
- Sound natural, like a friend's recommendation, not a database query
- Return a JSON object: { "id1": "reason text", "id2": "reason text", ... }`, langName)
	}

	// 构建批量数据（一次最多处理 10 个）
	batchSize := 10
	if len(items) > batchSize {
		items = items[:batchSize]
	}

	var itemDescs []string
	for _, item := range items {
		desc := fmt.Sprintf("- ID: %s | Title: %s | Reasons: %s", item.ID, item.Title, strings.Join(item.Reasons, ","))
		if item.Genre != "" {
			desc += fmt.Sprintf(" | Genre: %s", item.Genre)
		}
		if item.Author != "" {
			desc += fmt.Sprintf(" | Author: %s", item.Author)
		}
		itemDescs = append(itemDescs, desc)
	}

	userCtx := ""
	if len(userFavorites) > 0 {
		favs := userFavorites
		if len(favs) > 5 {
			favs = favs[:5]
		}
		userCtx = fmt.Sprintf("\nUser's favorite works: %s", strings.Join(favs, ", "))
	}

	userPrompt := templates.RecommendReason.User
	if userPrompt == "" {
		userPrompt = fmt.Sprintf("Generate a personalized recommendation reason in %s for each item:\n\n%s%s\n\nReturn a JSON object mapping each ID to its reason string.", langName, strings.Join(itemDescs, "\n"), userCtx)
	} else {
		userPrompt = fmt.Sprintf(userPrompt+"\n\n%s%s", strings.Join(itemDescs, "\n"), userCtx)
	}

	content, err := CallCloudLLM(cfg, systemPrompt, userPrompt, &LLMCallOptions{
		Scenario:  "recommend_reason",
		MaxTokens: 800,
	})
	if err != nil {
		return nil, err
	}

	// 解析
	content = strings.ReplaceAll(content, "```json", "")
	content = strings.ReplaceAll(content, "```", "")
	content = strings.TrimSpace(content)

	start := strings.Index(content, "{")
	end := strings.LastIndex(content, "}")
	if start >= 0 && end > start {
		content = content[start : end+1]
	}

	var result map[string]string
	if err := json.Unmarshal([]byte(content), &result); err != nil {
		return nil, fmt.Errorf("failed to parse AI recommendation reasons: %w", err)
	}
	return result, nil
}

// RecommendationItem 推荐项，用于 AI 生成理由
type RecommendationItem struct {
	ID      string   `json:"id"`
	Title   string   `json:"title"`
	Reasons []string `json:"reasons"`
	Genre   string   `json:"genre"`
	Author  string   `json:"author"`
}

// ============================================================
// Phase 2-3: Prompt 模板管理
// ============================================================

// PromptPair 一对 system + user prompt 模板
type PromptPair struct {
	System string `json:"system"`
	User   string `json:"user"`
}

// PromptTemplates 所有可自定义的 prompt 模板
type PromptTemplates struct {
	Summary         PromptPair `json:"summary"`         // AI 摘要生成
	ParseFilename   PromptPair `json:"parseFilename"`   // AI 文件名解析
	SuggestTags     PromptPair `json:"suggestTags"`     // AI 标签建议
	CoverAnalysis   PromptPair `json:"coverAnalysis"`   // Vision 封面分析
	RecommendReason PromptPair `json:"recommendReason"` // 推荐理由生成
	Translate       PromptPair `json:"translate"`       // 元数据翻译
}

func promptTemplatesPath() string {
	return filepath.Join(config.DataDir(), "prompt-templates.json")
}

// LoadPromptTemplates 加载自定义 prompt 模板（为空则使用代码内置默认值）
func LoadPromptTemplates() PromptTemplates {
	var templates PromptTemplates
	data, err := os.ReadFile(promptTemplatesPath())
	if err != nil {
		return templates // 返回空模板，各功能将使用内置默认值
	}
	_ = json.Unmarshal(data, &templates)
	return templates
}

// SavePromptTemplates 保存自定义 prompt 模板
func SavePromptTemplates(templates PromptTemplates) error {
	dir := filepath.Dir(promptTemplatesPath())
	os.MkdirAll(dir, 0755)
	data, _ := json.MarshalIndent(templates, "", "  ")
	return os.WriteFile(promptTemplatesPath(), data, 0644)
}

// ResetPromptTemplates 重置为默认模板（删除自定义文件）
func ResetPromptTemplates() error {
	return os.Remove(promptTemplatesPath())
}

// GetDefaultPromptTemplates 返回内置的默认 prompt 模板（供前端展示参考）
func GetDefaultPromptTemplates() PromptTemplates {
	return PromptTemplates{
		Summary: PromptPair{
			System: "You are a professional {contentType} reviewer and librarian. Based on the given metadata, write an engaging and informative summary/description in {language}.\n\nRequirements:\n- Write 2-4 sentences (80-200 characters for Chinese, 100-300 words for English)\n- Be descriptive and engaging, like a bookstore blurb\n- If the existing description exists, improve and localize it\n- Do NOT add any prefixes, labels, or markdown — return only the pure summary text",
			User:   "Generate a {language} summary for this {contentType} based on the following metadata:\n\n{metadata}",
		},
		ParseFilename: PromptPair{
			System: "You are an expert at parsing manga/comic/novel filenames. Extract structured metadata from complex filename conventions.\n\nRules:\n- \"Group\" refers to scan/translation groups\n- Remove file extensions before parsing\n- Volume/chapter numbers map to seriesIndex\n- Return ONLY a valid JSON object",
			User:   "Parse this filename and extract structured metadata:\n\n\"{filename}\"\n\nReturn a JSON object with fields: title, author, group, seriesName, seriesIndex, language, genre, year, tags",
		},
		SuggestTags: PromptPair{
			System: "You are an expert {contentType} librarian and tagger. Suggest 5-10 relevant tags in {language}.\n\nRequirements:\n- Tags should be concise (1-4 words)\n- Include genre, theme, and mood/style tags\n- Don't repeat existing tags\n- Return ONLY a JSON array of tag strings",
			User:   "Suggest tags for this {contentType}:\n\n{metadata}\n\nReturn a JSON array of tag strings.",
		},
		CoverAnalysis: PromptPair{
			System: "You are an expert cover analyst. Analyze the cover image and return a JSON object with: style, mood, theme, ageRating, colorTone, characters, tags, description, confidence.",
			User:   "Analyze this {contentType} cover image. Return a JSON object.",
		},
		RecommendReason: PromptPair{
			System: "You are a friendly recommendation curator. Generate short, engaging recommendation reasons (1 sentence, max 50 chars for Chinese / 80 chars for English). Return a JSON object mapping IDs to reason strings.",
			User:   "Generate personalized recommendation reasons in {language} for each item:",
		},
		Translate: PromptPair{
			System: "You are a professional translator specializing in manga/comic metadata. Translate the given fields to {language}. Keep proper nouns in their commonly known form.\nRespond ONLY with a valid JSON object.",
			User:   "Translate these metadata fields to {language}:\n\n{fields}\n\nReturn a JSON object with the same keys and translated values.",
		},
	}
}

// ============================================================
// Phase 3-1: AI 阅读助手 (Chat)
// ============================================================

// ChatMessage 聊天消息
type ChatMessage struct {
	Role    string `json:"role"` // "user" 或 "assistant"
	Content string `json:"content"`
}

// ChatWithContextStream 带上下文的 AI 阅读助手，流式返回。
// context: 当前阅读内容（漫画页图片 base64 或小说文本）
// history: 对话历史
// question: 用户当前问题
func ChatWithContextStream(cfg AIConfig, title, contentType, targetLang string,
	contextText string, contextImage *ImageContent,
	history []ChatMessage, question string, callback StreamCallback) error {

	if !cfg.EnableCloudAI || cfg.CloudAPIKey == "" {
		return fmt.Errorf("cloud AI not configured")
	}

	langName := "Chinese (简体中文)"
	if targetLang == "en" {
		langName = "English"
	}

	systemPrompt := fmt.Sprintf(`You are a helpful reading assistant for a %s titled "%s". The user is currently reading this work and may ask about characters, plot, vocabulary, cultural references, or request translations.

Rules:
- Answer in %s
- Be concise but helpful (1-3 sentences unless more detail is needed)
- If you're given the current page/chapter content, use it to provide context-aware answers
- If the user asks about something not in the current context, answer based on general knowledge
- For manga/comics: you may receive the current page image — describe what you see if asked
- For novels: you may receive the current chapter text — help with comprehension if asked
- Be friendly and conversational, like a knowledgeable reading companion`, contentType, title, langName)

	// 构建完整的用户消息（包含上下文）
	fullUserMsg := question
	if contextText != "" {
		// 截断过长的文本上下文（避免超出 token 限制）
		ctx := contextText
		if len(ctx) > 3000 {
			ctx = ctx[:3000] + "\n...[text truncated]..."
		}
		fullUserMsg = fmt.Sprintf("[Current reading content]\n%s\n\n[User question]\n%s", ctx, question)
	} else if contextImage == nil {
		fullUserMsg = fmt.Sprintf("[User question]\n%s", question)
	}

	// 构建对话历史为 prompt（简化实现：将历史拼接到 user prompt 中）
	if len(history) > 0 {
		// 只保留最近 6 轮对话
		recent := history
		if len(recent) > 12 {
			recent = recent[len(recent)-12:]
		}
		var historyText strings.Builder
		historyText.WriteString("[Conversation history]\n")
		for _, msg := range recent {
			if msg.Role == "user" {
				historyText.WriteString(fmt.Sprintf("User: %s\n", msg.Content))
			} else {
				historyText.WriteString(fmt.Sprintf("Assistant: %s\n", msg.Content))
			}
		}
		historyText.WriteString("\n")
		fullUserMsg = historyText.String() + fullUserMsg
	}

	// 使用流式调用
	opts := &LLMCallOptions{
		Scenario:  "chat",
		MaxTokens: cfg.MaxTokens,
	}

	// 如果有图片上下文（漫画当前页），使用多模态
	if contextImage != nil {
		// 多模态流式尚不支持，回退到非流式调用后逐字模拟
		opts.Images = []ImageContent{*contextImage}
		result, err := CallCloudLLM(cfg, systemPrompt, fullUserMsg, opts)
		if err != nil {
			return err
		}
		// 逐段返回（模拟流式体验）
		chunkSize := 20 // 每次返回约 20 字符
		for i := 0; i < len(result); i += chunkSize {
			end := i + chunkSize
			if end > len(result) {
				end = len(result)
			}
			if !callback(StreamChunk{Content: result[i:end]}) {
				return nil
			}
		}
		callback(StreamChunk{Done: true})
		return nil
	}

	return CallCloudLLMStream(cfg, systemPrompt, fullUserMsg, opts, callback)
}

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

// 页面翻译缓存
var (
	pageTranslateCache   = make(map[string]*PageTranslation)
	pageTranslateCacheMu sync.RWMutex
)

func pageTranslateCacheKey(comicID string, pageIndex int, targetLang string) string {
	return fmt.Sprintf("%s:%d:%s", comicID, pageIndex, targetLang)
}

// GetPageTranslationFromCache 从缓存获取页面翻译
func GetPageTranslationFromCache(comicID string, pageIndex int, targetLang string) *PageTranslation {
	pageTranslateCacheMu.RLock()
	defer pageTranslateCacheMu.RUnlock()
	return pageTranslateCache[pageTranslateCacheKey(comicID, pageIndex, targetLang)]
}

// CachePageTranslation 缓存页面翻译结果
func CachePageTranslation(comicID string, pageIndex int, targetLang string, result *PageTranslation) {
	pageTranslateCacheMu.Lock()
	defer pageTranslateCacheMu.Unlock()
	pageTranslateCache[pageTranslateCacheKey(comicID, pageIndex, targetLang)] = result
}
