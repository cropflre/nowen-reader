package service

import (
	"encoding/json"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"io"
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
	EnableLocalAI        bool   `json:"enableLocalAI"`
	EnableAutoTag        bool   `json:"enableAutoTag"`
	EnableSemanticSearch bool   `json:"enableSemanticSearch"`
	EnablePerceptualHash bool   `json:"enablePerceptualHash"`
	AutoTagConfidence    float64 `json:"autoTagConfidence"`

	EnableCloudAI bool   `json:"enableCloudAI"`
	CloudProvider string `json:"cloudProvider"`
	CloudAPIKey   string `json:"cloudApiKey"`
	CloudAPIURL   string `json:"cloudApiUrl"`
	CloudModel    string `json:"cloudModel"`
}

var defaultAIConfig = AIConfig{
	EnableLocalAI:        true,
	EnableAutoTag:        true,
	EnableSemanticSearch: true,
	EnablePerceptualHash: true,
	AutoTagConfidence:    0.3,
	EnableCloudAI:        false,
	CloudProvider:        "openai",
	CloudAPIKey:          "",
	CloudAPIURL:          "https://api.openai.com/v1",
	CloudModel:           "gpt-4o-mini",
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
	return cfg
}

func SaveAIConfig(cfg AIConfig) error {
	dir := filepath.Dir(aiConfigPath())
	os.MkdirAll(dir, 0755)
	data, _ := json.MarshalIndent(cfg, "", "  ")
	return os.WriteFile(aiConfigPath(), data, 0644)
}

// ============================================================
// Perceptual Hash (pHash)
// ============================================================

// GeneratePerceptualHash creates a perceptual hash from image bytes.
// Uses 8x8 grayscale resize → compare to mean → 64-bit hash → hex.
func GeneratePerceptualHash(imgData []byte) (string, error) {
	img, _, err := image.Decode(strings.NewReader(string(imgData)))
	if err != nil {
		return "", err
	}

	// Resize to 8x8 grayscale
	bounds := img.Bounds()
	w, h := bounds.Dx(), bounds.Dy()

	var pixels [64]float64
	for row := 0; row < 8; row++ {
		for col := 0; col < 8; col++ {
			srcX := bounds.Min.X + col*w/8
			srcY := bounds.Min.Y + row*h/8
			r, g, b, _ := img.At(srcX, srcY).RGBA()
			// Convert to grayscale
			gray := 0.299*float64(r>>8) + 0.587*float64(g>>8) + 0.114*float64(b>>8)
			pixels[row*8+col] = gray
		}
	}

	// Calculate mean
	var sum float64
	for _, v := range pixels {
		sum += v
	}
	mean := sum / 64

	// Build hash
	var hash uint64
	for i, v := range pixels {
		if v > mean {
			hash |= 1 << uint(63-i)
		}
	}

	return fmt.Sprintf("%016x", hash), nil
}

// HammingDistance returns the number of differing bits between two hex hashes.
func HammingDistance(hash1, hash2 string) int {
	if len(hash1) != len(hash2) {
		if len(hash1) > len(hash2) {
			return len(hash1) * 4
		}
		return len(hash2) * 4
	}

	distance := 0
	for i := 0; i < len(hash1); i++ {
		n1 := hexVal(hash1[i])
		n2 := hexVal(hash2[i])
		xor := n1 ^ n2
		for xor > 0 {
			distance += int(xor & 1)
			xor >>= 1
		}
	}
	return distance
}

func hexVal(c byte) int {
	switch {
	case c >= '0' && c <= '9':
		return int(c - '0')
	case c >= 'a' && c <= 'f':
		return int(c - 'a' + 10)
	case c >= 'A' && c <= 'F':
		return int(c - 'A' + 10)
	}
	return 0
}

// ============================================================
// pHash Cache
// ============================================================

var (
	pHashCache   map[string]string
	pHashCacheMu sync.RWMutex
)

func pHashCachePath() string {
	return filepath.Join(config.DataDir(), "phash-cache.json")
}

func LoadPHashCache() map[string]string {
	pHashCacheMu.Lock()
	defer pHashCacheMu.Unlock()

	if pHashCache != nil {
		return pHashCache
	}

	pHashCache = make(map[string]string)
	data, err := os.ReadFile(pHashCachePath())
	if err != nil {
		return pHashCache
	}
	_ = json.Unmarshal(data, &pHashCache)
	return pHashCache
}

func SavePHashCache() {
	pHashCacheMu.RLock()
	defer pHashCacheMu.RUnlock()

	if pHashCache == nil {
		return
	}
	dir := filepath.Dir(pHashCachePath())
	os.MkdirAll(dir, 0755)
	data, _ := json.Marshal(pHashCache)
	_ = os.WriteFile(pHashCachePath(), data, 0644)
}

// FindVisuallySimilarCovers finds comics with similar cover thumbnails.
func FindVisuallySimilarCovers(comics []struct {
	ID       string
	Filename string
	Title    string
}, thumbDir string, threshold int) []struct {
	Reason string   `json:"reason"`
	Comics []string `json:"comics"`
} {
	cache := LoadPHashCache()
	cacheUpdated := false

	type hashItem struct {
		ID   string
		Hash string
	}
	var hashes []hashItem

	for _, comic := range comics {
		pHashCacheMu.RLock()
		if h, ok := cache[comic.ID]; ok {
			hashes = append(hashes, hashItem{comic.ID, h})
			pHashCacheMu.RUnlock()
			continue
		}
		pHashCacheMu.RUnlock()

		thumbPath := filepath.Join(thumbDir, comic.ID+".webp")
		imgData, err := os.ReadFile(thumbPath)
		if err != nil {
			continue
		}

		hash, err := GeneratePerceptualHash(imgData)
		if err != nil {
			continue
		}

		hashes = append(hashes, hashItem{comic.ID, hash})
		pHashCacheMu.Lock()
		cache[comic.ID] = hash
		pHashCacheMu.Unlock()
		cacheUpdated = true
	}

	if cacheUpdated {
		SavePHashCache()
	}

	// Find similar pairs
	groups := make(map[string]map[string]bool)
	for i := 0; i < len(hashes); i++ {
		for j := i + 1; j < len(hashes); j++ {
			dist := HammingDistance(hashes[i].Hash, hashes[j].Hash)
			if dist <= threshold {
				key := hashes[i].ID
				if groups[key] == nil {
					groups[key] = map[string]bool{hashes[i].ID: true}
				}
				groups[key][hashes[j].ID] = true
			}
		}
	}

	var result []struct {
		Reason string   `json:"reason"`
		Comics []string `json:"comics"`
	}
	for _, members := range groups {
		if len(members) > 1 {
			var ids []string
			for id := range members {
				ids = append(ids, id)
			}
			result = append(result, struct {
				Reason string   `json:"reason"`
				Comics []string `json:"comics"`
			}{Reason: "similarCover", Comics: ids})
		}
	}
	return result
}

// ============================================================
// AI Status
// ============================================================

type AIStatus struct {
	LocalAI struct {
		Available      bool `json:"available"`
		PerceptualHash bool `json:"perceptualHash"`
		SemanticSearch bool `json:"semanticSearch"`
		AutoTag        bool `json:"autoTag"`
	} `json:"localAI"`
	CloudAI struct {
		Configured bool   `json:"configured"`
		Provider   string `json:"provider"`
		Model      string `json:"model"`
	} `json:"cloudAI"`
	Stats struct {
		PHashCacheSize int `json:"pHashCacheSize"`
	} `json:"stats"`
}

func GetAIStatus() AIStatus {
	cfg := LoadAIConfig()
	cache := LoadPHashCache()

	var status AIStatus
	status.LocalAI.Available = true
	status.LocalAI.PerceptualHash = cfg.EnablePerceptualHash
	status.LocalAI.SemanticSearch = cfg.EnableSemanticSearch
	status.LocalAI.AutoTag = cfg.EnableAutoTag
	status.CloudAI.Configured = cfg.EnableCloudAI && cfg.CloudAPIKey != ""
	status.CloudAI.Provider = cfg.CloudProvider
	status.CloudAI.Model = cfg.CloudModel
	status.Stats.PHashCacheSize = len(cache)
	return status
}

// ============================================================
// Cloud LLM Unified Caller
// ============================================================

// CallCloudLLM calls a cloud LLM provider with unified interface.
func CallCloudLLM(cfg AIConfig, systemPrompt, userPrompt string) (string, error) {
	if !cfg.EnableCloudAI || cfg.CloudAPIKey == "" {
		return "", fmt.Errorf("cloud AI not configured")
	}

	provider := cfg.CloudProvider
	apiURL := cfg.CloudAPIURL
	if apiURL == "" {
		if p, ok := ProviderPresets[provider]; ok {
			apiURL = p.APIURL
		}
	}

	switch provider {
	case "anthropic":
		return callAnthropic(cfg, apiURL, systemPrompt, userPrompt)
	case "google":
		return callGemini(cfg, apiURL, systemPrompt, userPrompt)
	default:
		return callOpenAICompatible(cfg, apiURL, systemPrompt, userPrompt)
	}
}

func callOpenAICompatible(cfg AIConfig, apiURL, systemPrompt, userPrompt string) (string, error) {
	reqURL := apiURL + "/chat/completions"
	body, _ := json.Marshal(map[string]interface{}{
		"model": cfg.CloudModel,
		"messages": []map[string]string{
			{"role": "system", "content": systemPrompt},
			{"role": "user", "content": userPrompt},
		},
		"max_tokens":  500,
		"temperature": 0.3,
	})

	client := &http.Client{Timeout: 60 * time.Second}
	req, _ := http.NewRequest("POST", reqURL, strings.NewReader(string(body)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+cfg.CloudAPIKey)

	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		respBody, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("OpenAI API error %d: %s", resp.StatusCode, string(respBody)[:200])
	}

	var data struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return "", err
	}
	if len(data.Choices) == 0 {
		return "", fmt.Errorf("no response from LLM")
	}
	return data.Choices[0].Message.Content, nil
}

func callAnthropic(cfg AIConfig, apiURL, systemPrompt, userPrompt string) (string, error) {
	reqURL := apiURL + "/v1/messages"
	body, _ := json.Marshal(map[string]interface{}{
		"model":      cfg.CloudModel,
		"max_tokens": 500,
		"system":     systemPrompt,
		"messages":   []map[string]interface{}{{"role": "user", "content": userPrompt}},
	})

	client := &http.Client{Timeout: 60 * time.Second}
	req, _ := http.NewRequest("POST", reqURL, strings.NewReader(string(body)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", cfg.CloudAPIKey)
	req.Header.Set("anthropic-version", "2023-06-01")

	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		respBody, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("Anthropic API error %d: %s", resp.StatusCode, string(respBody)[:200])
	}

	var data struct {
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return "", err
	}
	for _, c := range data.Content {
		if c.Type == "text" {
			return c.Text, nil
		}
	}
	return "", fmt.Errorf("no text in Anthropic response")
}

func callGemini(cfg AIConfig, apiURL, systemPrompt, userPrompt string) (string, error) {
	model := cfg.CloudModel
	if model == "" {
		model = "gemini-2.0-flash"
	}
	reqURL := fmt.Sprintf("%s/models/%s:generateContent?key=%s", apiURL, model, cfg.CloudAPIKey)

	body, _ := json.Marshal(map[string]interface{}{
		"contents": []map[string]interface{}{
			{"parts": []map[string]string{{"text": systemPrompt + "\n\n" + userPrompt}}},
		},
		"generationConfig": map[string]interface{}{
			"temperature":    0.3,
			"maxOutputTokens": 500,
		},
	})

	client := &http.Client{Timeout: 60 * time.Second}
	req, _ := http.NewRequest("POST", reqURL, strings.NewReader(string(body)))
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		respBody, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("Gemini API error %d: %s", resp.StatusCode, string(respBody)[:200])
	}

	var data struct {
		Candidates []struct {
			Content struct {
				Parts []struct {
					Text string `json:"text"`
				} `json:"parts"`
			} `json:"content"`
		} `json:"candidates"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return "", err
	}
	if len(data.Candidates) > 0 && len(data.Candidates[0].Content.Parts) > 0 {
		return data.Candidates[0].Content.Parts[0].Text, nil
	}
	return "", fmt.Errorf("no response from Gemini")
}

// ============================================================
// Semantic Search (TF-IDF n-gram, no external model)
// ============================================================

type TextVector map[string]float64

func tokenize(text string) []string {
	text = strings.ToLower(text)
	// Replace non-word chars (keep CJK)
	var b strings.Builder
	for _, r := range text {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '_' ||
			(r >= 0x4e00 && r <= 0x9fff) || (r >= 0x3040 && r <= 0x30ff) || r == ' ' {
			b.WriteRune(r)
		} else {
			b.WriteRune(' ')
		}
	}
	parts := strings.Fields(b.String())
	var result []string
	for _, p := range parts {
		if len(p) > 1 {
			result = append(result, p)
		}
	}
	return result
}

func BuildTextVector(title string, tags []string, genre, author, description string) TextVector {
	v := make(TextVector)
	for _, t := range tokenize(title) {
		v["t:"+t] += 3
	}
	for _, tag := range tags {
		v["tag:"+strings.ToLower(tag)] += 5
	}
	for _, g := range tokenize(genre) {
		v["g:"+g] += 4
	}
	if author != "" {
		v["a:"+strings.ToLower(author)] = 3
	}
	for _, d := range tokenize(description) {
		v["d:"+d] += 1
	}
	return v
}

func CosineSimilarity(v1, v2 TextVector) float64 {
	var dot, norm1, norm2 float64
	for k, val := range v1 {
		norm1 += val * val
		if other, ok := v2[k]; ok {
			dot += val * other
		}
	}
	for _, val := range v2 {
		norm2 += val * val
	}
	if norm1 == 0 || norm2 == 0 {
		return 0
	}
	return dot / (math.Sqrt(norm1) * math.Sqrt(norm2))
}

// SemanticSearch finds comics similar to a query.
func SemanticSearch(query string, comics []struct {
	ID          string
	Title       string
	Tags        []string
	Genre       string
	Author      string
	Description string
}, limit int) []struct {
	ID    string  `json:"id"`
	Score float64 `json:"score"`
} {
	queryTokens := tokenize(query)
	queryVector := make(TextVector)
	for _, t := range queryTokens {
		queryVector["t:"+t] = 3
		queryVector["tag:"+t] = 5
		queryVector["g:"+t] = 4
		queryVector["a:"+t] = 3
		queryVector["d:"+t] = 1
	}

	type scored struct {
		ID    string
		Score float64
	}
	var results []scored

	for _, comic := range comics {
		cv := BuildTextVector(comic.Title, comic.Tags, comic.Genre, comic.Author, comic.Description)
		score := CosineSimilarity(queryVector, cv)
		if score > 0.01 {
			results = append(results, scored{comic.ID, score})
		}
	}

	// Sort by score desc
	for i := 0; i < len(results); i++ {
		for j := i + 1; j < len(results); j++ {
			if results[j].Score > results[i].Score {
				results[i], results[j] = results[j], results[i]
			}
		}
	}

	if limit > 0 && len(results) > limit {
		results = results[:limit]
	}

	var out []struct {
		ID    string  `json:"id"`
		Score float64 `json:"score"`
	}
	for _, r := range results {
		out = append(out, struct {
			ID    string  `json:"id"`
			Score float64 `json:"score"`
		}{r.ID, r.Score})
	}
	return out
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

	content, err := CallCloudLLM(cfg, systemPrompt, userPrompt)
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
