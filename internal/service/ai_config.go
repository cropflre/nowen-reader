package service

import (
	"encoding/json"
	"os"
	"path/filepath"

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

	// 本地模型配置
	EnableLocalAI   bool   `json:"enableLocalAI"`
	LocalEngine     string `json:"localEngine"`     // llama.cpp / vllm / custom
	LocalBinaryPath string `json:"localBinaryPath"` // llama-server 可执行文件路径
	LocalModelPath  string `json:"localModelPath"`  // GGUF 模型文件路径
	LocalHost       string `json:"localHost"`        // 绑定地址，默认 127.0.0.1
	LocalPort       int    `json:"localPort"`        // 端口，默认 11435
	ContextSize     int    `json:"contextSize"`      // 上下文大小，默认 8192
	Threads         int    `json:"threads"`          // CPU 线程数，默认 0 (自动)
	GPULayers       string `json:"gpuLayers"`        // GPU 层数，"auto" 或数字
}

var defaultAIConfig = AIConfig{
	EnableCloudAI: false,
	CloudProvider: "openai",
	CloudAPIKey:   "",
	CloudAPIURL:   "https://api.openai.com/v1",
	CloudModel:    "gpt-4o-mini",
	MaxTokens:     2000,
	MaxRetries:    2,

	// 本地模型默认值
	EnableLocalAI:   false,
	LocalEngine:     "llama.cpp",
	LocalBinaryPath: "",
	LocalModelPath:  "",
	LocalHost:       "127.0.0.1",
	LocalPort:       11435,
	ContextSize:     8192,
	Threads:         0,
	GPULayers:       "auto",
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
