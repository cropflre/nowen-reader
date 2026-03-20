package service

import (
	"crypto/md5"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"math/rand"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/nowen-reader/nowen-reader/internal/config"
)

// ============================================================
// 翻译引擎类型定义
// ============================================================

// TranslateEngine 翻译引擎标识
type TranslateEngine string

const (
	EngineAI     TranslateEngine = "ai"     // Cloud LLM (原有)
	EngineGoogle TranslateEngine = "google" // Google Translate
	EngineBaidu  TranslateEngine = "baidu"  // 百度翻译
	EngineDeepL  TranslateEngine = "deepl"  // DeepL
	EngineLocal  TranslateEngine = "local"  // 本地词典 (离线)
)

// TranslateConfig 翻译配置
type TranslateConfig struct {
	// 首选引擎（用户偏好）
	PreferredEngine TranslateEngine `json:"preferredEngine"`
	// 引擎优先级列表（自动切换顺序）
	EnginePriority []TranslateEngine `json:"enginePriority"`
	// 是否启用翻译缓存
	EnableCache bool `json:"enableCache"`
	// 缓存过期时间（天），0=永不过期
	CacheExpireDays int `json:"cacheExpireDays"`
	// 最大并发翻译数
	MaxConcurrency int `json:"maxConcurrency"`
	// 每个引擎的API配置
	GoogleAPIKey string `json:"googleApiKey,omitempty"`
	BaiduAppID   string `json:"baiduAppId,omitempty"`
	BaiduSecret  string `json:"baiduSecret,omitempty"`
	DeepLAPIKey  string `json:"deeplApiKey,omitempty"`
	DeepLFreeAPI bool   `json:"deeplFreeApi"` // 是否使用 DeepL Free API
}

// TranslateResult 翻译结果
type TranslateResult struct {
	Text       string          `json:"text"`
	Engine     TranslateEngine `json:"engine"`
	FromCache  bool            `json:"fromCache"`
	SourceLang string          `json:"sourceLang,omitempty"`
}

// TranslateFieldsResult 批量字段翻译结果
type TranslateFieldsResult struct {
	Fields map[string]string `json:"fields"`
	Engine TranslateEngine   `json:"engine"`
	Cached bool              `json:"cached"`
}

// ============================================================
// 翻译缓存
// ============================================================

type translateCacheEntry struct {
	Text       string    `json:"text"`
	Engine     string    `json:"engine"`
	TargetLang string    `json:"targetLang"`
	Result     string    `json:"result"`
	CreatedAt  time.Time `json:"createdAt"`
}

var (
	translateCache   = map[string]*translateCacheEntry{}
	translateCacheMu sync.RWMutex
	cacheLoaded      bool
)

func translateCacheKey(text, targetLang string) string {
	h := sha256.Sum256([]byte(text + "|" + targetLang))
	return hex.EncodeToString(h[:16])
}

func translateCachePath() string {
	return filepath.Join(config.DataDir(), "translate-cache.json")
}

func loadTranslateCache() {
	translateCacheMu.Lock()
	defer translateCacheMu.Unlock()
	if cacheLoaded {
		return
	}
	cacheLoaded = true

	data, err := os.ReadFile(translateCachePath())
	if err != nil {
		return
	}
	var entries map[string]*translateCacheEntry
	if err := json.Unmarshal(data, &entries); err == nil {
		translateCache = entries
	}
}

func saveTranslateCache() {
	translateCacheMu.RLock()
	data, err := json.MarshalIndent(translateCache, "", "  ")
	translateCacheMu.RUnlock()
	if err != nil {
		return
	}
	dir := filepath.Dir(translateCachePath())
	_ = os.MkdirAll(dir, 0755)
	_ = os.WriteFile(translateCachePath(), data, 0644)
}

func getCachedTranslation(text, targetLang string, expireDays int) *translateCacheEntry {
	loadTranslateCache()
	translateCacheMu.RLock()
	defer translateCacheMu.RUnlock()

	key := translateCacheKey(text, targetLang)
	entry, ok := translateCache[key]
	if !ok {
		return nil
	}
	// 检查过期
	if expireDays > 0 && time.Since(entry.CreatedAt) > time.Duration(expireDays)*24*time.Hour {
		return nil
	}
	return entry
}

func setCachedTranslation(text, targetLang, result, engine string) {
	loadTranslateCache()
	translateCacheMu.Lock()
	key := translateCacheKey(text, targetLang)
	translateCache[key] = &translateCacheEntry{
		Text:       text,
		Engine:     engine,
		TargetLang: targetLang,
		Result:     result,
		CreatedAt:  time.Now(),
	}
	translateCacheMu.Unlock()

	// 异步持久化
	go saveTranslateCache()
}

// ClearTranslateCache 清空翻译缓存
func ClearTranslateCache() {
	translateCacheMu.Lock()
	translateCache = map[string]*translateCacheEntry{}
	translateCacheMu.Unlock()
	_ = os.Remove(translateCachePath())
}

// GetTranslateCacheStats 获取缓存统计信息
func GetTranslateCacheStats() map[string]interface{} {
	loadTranslateCache()
	translateCacheMu.RLock()
	defer translateCacheMu.RUnlock()

	engineCounts := map[string]int{}
	for _, entry := range translateCache {
		engineCounts[entry.Engine]++
	}
	return map[string]interface{}{
		"totalEntries": len(translateCache),
		"engineCounts": engineCounts,
	}
}

// ============================================================
// 翻译配置管理
// ============================================================

var (
	translateConfigCache   *TranslateConfig
	translateConfigCacheMu sync.RWMutex
)

func translateConfigPath() string {
	return filepath.Join(config.DataDir(), "translate-config.json")
}

// LoadTranslateConfig 加载翻译配置
func LoadTranslateConfig() TranslateConfig {
	translateConfigCacheMu.RLock()
	if translateConfigCache != nil {
		defer translateConfigCacheMu.RUnlock()
		return *translateConfigCache
	}
	translateConfigCacheMu.RUnlock()

	translateConfigCacheMu.Lock()
	defer translateConfigCacheMu.Unlock()

	cfg := defaultTranslateConfig()
	data, err := os.ReadFile(translateConfigPath())
	if err == nil {
		_ = json.Unmarshal(data, &cfg)
	}
	// 确保有默认值
	if len(cfg.EnginePriority) == 0 {
		cfg.EnginePriority = defaultTranslateConfig().EnginePriority
	}
	if cfg.MaxConcurrency <= 0 {
		cfg.MaxConcurrency = 3
	}
	translateConfigCache = &cfg
	return cfg
}

// SaveTranslateConfig 保存翻译配置
func SaveTranslateConfig(cfg *TranslateConfig) error {
	dir := filepath.Dir(translateConfigPath())
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	translateConfigCacheMu.Lock()
	translateConfigCache = cfg
	translateConfigCacheMu.Unlock()
	return os.WriteFile(translateConfigPath(), data, 0644)
}

func defaultTranslateConfig() TranslateConfig {
	return TranslateConfig{
		PreferredEngine: EngineLocal,
		EnginePriority:  []TranslateEngine{EngineLocal, EngineGoogle, EngineBaidu, EngineDeepL, EngineAI},
		EnableCache:     true,
		CacheExpireDays: 0, // 永不过期
		MaxConcurrency:  3,
	}
}

// GetAvailableEngines 获取当前可用的翻译引擎列表（已配置API Key的）
func GetAvailableEngines() []map[string]interface{} {
	cfg := LoadTranslateConfig()
	aiCfg := LoadAIConfig()

	engines := []map[string]interface{}{
		{
			"id":          string(EngineLocal),
			"name":        "本地词典",
			"description": "内置英中双向标签词典，速度最快，无需API Key",
			"available":   true,
			"speed":       "instant",
			"quality":     "medium",
			"needsKey":    false,
		},
	}

	// Google Translate
	engines = append(engines, map[string]interface{}{
		"id":          string(EngineGoogle),
		"name":        "Google Translate",
		"description": "Google 翻译API，速度快质量高",
		"available":   cfg.GoogleAPIKey != "",
		"speed":       "fast",
		"quality":     "high",
		"needsKey":    true,
		"configured":  cfg.GoogleAPIKey != "",
	})

	// 百度翻译
	engines = append(engines, map[string]interface{}{
		"id":          string(EngineBaidu),
		"name":        "百度翻译",
		"description": "百度翻译API，国内访问快，支持免费额度",
		"available":   cfg.BaiduAppID != "" && cfg.BaiduSecret != "",
		"speed":       "fast",
		"quality":     "high",
		"needsKey":    true,
		"configured":  cfg.BaiduAppID != "" && cfg.BaiduSecret != "",
	})

	// DeepL
	engines = append(engines, map[string]interface{}{
		"id":          string(EngineDeepL),
		"name":        "DeepL",
		"description": "DeepL翻译，翻译质量顶级，支持Free API",
		"available":   cfg.DeepLAPIKey != "",
		"speed":       "fast",
		"quality":     "highest",
		"needsKey":    true,
		"configured":  cfg.DeepLAPIKey != "",
	})

	// AI (Cloud LLM)
	engines = append(engines, map[string]interface{}{
		"id":          string(EngineAI),
		"name":        "AI 翻译",
		"description": "使用Cloud LLM翻译，最灵活但速度较慢",
		"available":   aiCfg.EnableCloudAI && aiCfg.CloudAPIKey != "",
		"speed":       "slow",
		"quality":     "high",
		"needsKey":    true,
		"configured":  aiCfg.EnableCloudAI && aiCfg.CloudAPIKey != "",
	})

	return engines
}

// ============================================================
// 核心翻译函数
// ============================================================

// TranslateText 翻译单个文本（自动选择引擎，支持缓存和降级）
func TranslateText(text, targetLang string, preferredEngine TranslateEngine) (*TranslateResult, error) {
	if text == "" {
		return &TranslateResult{Text: ""}, nil
	}

	cfg := LoadTranslateConfig()

	// 1. 先查缓存
	if cfg.EnableCache {
		if cached := getCachedTranslation(text, targetLang, cfg.CacheExpireDays); cached != nil {
			return &TranslateResult{
				Text:      cached.Result,
				Engine:    TranslateEngine(cached.Engine),
				FromCache: true,
			}, nil
		}
	}

	// 2. 确定引擎优先级
	engines := buildEnginePriority(cfg, preferredEngine)

	// 3. 按优先级尝试各引擎
	var lastErr error
	for _, engine := range engines {
		if !isEngineAvailable(cfg, engine) {
			continue
		}

		result, err := callTranslateEngine(cfg, engine, text, targetLang)
		if err != nil {
			log.Printf("[Translate] Engine %s failed: %v", engine, err)
			lastErr = err
			continue
		}

		// 缓存结果
		if cfg.EnableCache && result != "" {
			setCachedTranslation(text, targetLang, result, string(engine))
		}

		return &TranslateResult{
			Text:   result,
			Engine: engine,
		}, nil
	}

	if lastErr != nil {
		return nil, fmt.Errorf("all translation engines failed, last error: %w", lastErr)
	}
	return nil, fmt.Errorf("no available translation engine")
}

// TranslateMetadataFieldsMultiEngine 多引擎翻译元数据字段（替代原有的AI-only翻译）
func TranslateMetadataFieldsMultiEngine(fields map[string]string, targetLang string, preferredEngine TranslateEngine) (*TranslateFieldsResult, error) {
	if len(fields) == 0 {
		return nil, nil
	}

	cfg := LoadTranslateConfig()

	// 对 genre 字段优先使用本地词典
	result := &TranslateFieldsResult{
		Fields: make(map[string]string),
	}

	// 将需要翻译的字段分类
	localFields := map[string]string{}  // 可以本地翻译的
	remoteFields := map[string]string{} // 需要远程翻译的

	for k, v := range fields {
		if k == "genre" {
			// genre 先尝试本地翻译
			translated := TranslateGenre(v, targetLang)
			if translated != v {
				result.Fields[k] = translated
				localFields[k] = translated
			} else {
				remoteFields[k] = v
			}
		} else {
			remoteFields[k] = v
		}
	}

	// 远程翻译
	if len(remoteFields) > 0 {
		engines := buildEnginePriority(cfg, preferredEngine)
		var lastErr error

		for _, engine := range engines {
			if !isEngineAvailable(cfg, engine) {
				continue
			}

			// 先检查缓存
			allCached := true
			cachedResults := map[string]string{}
			if cfg.EnableCache {
				for k, v := range remoteFields {
					if cached := getCachedTranslation(v, targetLang, cfg.CacheExpireDays); cached != nil {
						cachedResults[k] = cached.Result
					} else {
						allCached = false
					}
				}
			} else {
				allCached = false
			}

			if allCached {
				for k, v := range cachedResults {
					result.Fields[k] = v
				}
				result.Engine = TranslateEngine("cache")
				result.Cached = true
				return result, nil
			}

			// 对未缓存的字段进行翻译
			uncachedFields := map[string]string{}
			for k, v := range remoteFields {
				if _, ok := cachedResults[k]; !ok {
					uncachedFields[k] = v
				}
			}

			translated, err := translateFieldsWithEngine(cfg, engine, uncachedFields, targetLang)
			if err != nil {
				log.Printf("[Translate] Engine %s failed for fields: %v", engine, err)
				lastErr = err
				continue
			}

			// 合并结果
			for k, v := range cachedResults {
				result.Fields[k] = v
			}
			for k, v := range translated {
				if v != "" {
					result.Fields[k] = v
					// 缓存每个字段的翻译
					if cfg.EnableCache {
						if original, ok := uncachedFields[k]; ok {
							setCachedTranslation(original, targetLang, v, string(engine))
						}
					}
				}
			}
			result.Engine = engine
			return result, nil
		}

		if lastErr != nil {
			// 有部分本地翻译结果时不返回错误
			if len(result.Fields) > 0 {
				return result, nil
			}
			return nil, fmt.Errorf("all engines failed: %w", lastErr)
		}
	}

	if len(result.Fields) > 0 {
		result.Engine = EngineLocal
		return result, nil
	}
	return nil, fmt.Errorf("no available translation engine")
}

// TranslateFieldsConcurrent 并发翻译多个字段（用于批量翻译场景）
func TranslateFieldsConcurrent(items []map[string]string, targetLang string, preferredEngine TranslateEngine, concurrency int) []map[string]string {
	if concurrency <= 0 {
		concurrency = 3
	}

	results := make([]map[string]string, len(items))
	sem := make(chan struct{}, concurrency)
	var wg sync.WaitGroup

	for i, fields := range items {
		wg.Add(1)
		go func(idx int, f map[string]string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			res, err := TranslateMetadataFieldsMultiEngine(f, targetLang, preferredEngine)
			if err != nil || res == nil {
				results[idx] = nil
			} else {
				results[idx] = res.Fields
			}
		}(i, fields)
	}

	wg.Wait()
	return results
}

// ============================================================
// 引擎优先级与可用性
// ============================================================

func buildEnginePriority(cfg TranslateConfig, preferred TranslateEngine) []TranslateEngine {
	if preferred == "" {
		preferred = cfg.PreferredEngine
	}

	var engines []TranslateEngine

	// 首选引擎放最前面
	if preferred != "" {
		engines = append(engines, preferred)
	}

	// 按配置的优先级追加其余引擎
	for _, e := range cfg.EnginePriority {
		if e != preferred {
			engines = append(engines, e)
		}
	}

	// 确保所有引擎都在列表中
	allEngines := []TranslateEngine{EngineLocal, EngineGoogle, EngineBaidu, EngineDeepL, EngineAI}
	for _, e := range allEngines {
		found := false
		for _, existing := range engines {
			if existing == e {
				found = true
				break
			}
		}
		if !found {
			engines = append(engines, e)
		}
	}

	return engines
}

func isEngineAvailable(cfg TranslateConfig, engine TranslateEngine) bool {
	switch engine {
	case EngineLocal:
		return true
	case EngineGoogle:
		return cfg.GoogleAPIKey != ""
	case EngineBaidu:
		return cfg.BaiduAppID != "" && cfg.BaiduSecret != ""
	case EngineDeepL:
		return cfg.DeepLAPIKey != ""
	case EngineAI:
		aiCfg := LoadAIConfig()
		return aiCfg.EnableCloudAI && aiCfg.CloudAPIKey != ""
	}
	return false
}

// ============================================================
// 各翻译引擎实现
// ============================================================

func callTranslateEngine(cfg TranslateConfig, engine TranslateEngine, text, targetLang string) (string, error) {
	switch engine {
	case EngineLocal:
		return translateWithLocal(text, targetLang)
	case EngineGoogle:
		return translateWithGoogle(cfg.GoogleAPIKey, text, targetLang)
	case EngineBaidu:
		return translateWithBaidu(cfg.BaiduAppID, cfg.BaiduSecret, text, targetLang)
	case EngineDeepL:
		return translateWithDeepL(cfg.DeepLAPIKey, cfg.DeepLFreeAPI, text, targetLang)
	case EngineAI:
		return translateWithAI(text, targetLang)
	}
	return "", fmt.Errorf("unknown engine: %s", engine)
}

func translateFieldsWithEngine(cfg TranslateConfig, engine TranslateEngine, fields map[string]string, targetLang string) (map[string]string, error) {
	switch engine {
	case EngineAI:
		// AI 翻译可以一次翻译多个字段
		aiCfg := LoadAIConfig()
		return TranslateMetadataFields(aiCfg, fields, targetLang)
	default:
		// 其他引擎逐字段翻译
		result := map[string]string{}
		for k, v := range fields {
			translated, err := callTranslateEngine(cfg, engine, v, targetLang)
			if err != nil {
				return nil, err
			}
			if translated != "" {
				result[k] = translated
			}
		}
		return result, nil
	}
}

// ---- 本地词典翻译 ----

func translateWithLocal(text, targetLang string) (string, error) {
	// 尝试按 genre 格式翻译（逗号分隔的标签列表）
	translated := TranslateGenre(text, targetLang)
	if translated != text {
		return translated, nil
	}

	// 尝试单个标签翻译
	result := translateTagLocal(text, targetLang)
	if result != "" {
		return result, nil
	}

	return "", fmt.Errorf("local dictionary has no translation for: %s", text)
}

// ---- Google Translate ----

func googleTargetLang(targetLang string) string {
	if strings.HasPrefix(targetLang, "zh") {
		return "zh-CN"
	}
	if targetLang == "" {
		return "en"
	}
	return targetLang
}

func translateWithGoogle(apiKey, text, targetLang string) (string, error) {
	if apiKey == "" {
		return "", fmt.Errorf("google API key not configured")
	}

	apiURL := fmt.Sprintf("https://translation.googleapis.com/language/translate/v2?key=%s", url.QueryEscape(apiKey))

	payload := url.Values{}
	payload.Set("q", text)
	payload.Set("target", googleTargetLang(targetLang))
	payload.Set("format", "text")

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.PostForm(apiURL, payload)
	if err != nil {
		return "", fmt.Errorf("google translate request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("read google response failed: %w", err)
	}

	if resp.StatusCode != 200 {
		return "", fmt.Errorf("google translate API error %d: %s", resp.StatusCode, string(body))
	}

	var result struct {
		Data struct {
			Translations []struct {
				TranslatedText     string `json:"translatedText"`
				DetectedSourceLang string `json:"detectedSourceLanguage"`
			} `json:"translations"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return "", fmt.Errorf("parse google response failed: %w", err)
	}

	if len(result.Data.Translations) == 0 {
		return "", fmt.Errorf("google translate returned empty result")
	}

	return result.Data.Translations[0].TranslatedText, nil
}

// ---- 百度翻译 ----

func baiduTargetLang(targetLang string) string {
	if strings.HasPrefix(targetLang, "zh") {
		return "zh"
	}
	if targetLang == "" {
		return "en"
	}
	// 百度翻译的语言代码映射
	langMap := map[string]string{
		"ja": "jp", "ko": "kor", "fr": "fra", "es": "spa",
		"pt": "pt", "de": "de", "it": "it", "ru": "ru",
	}
	if mapped, ok := langMap[targetLang]; ok {
		return mapped
	}
	return targetLang
}

func translateWithBaidu(appID, secret, text, targetLang string) (string, error) {
	if appID == "" || secret == "" {
		return "", fmt.Errorf("baidu translate credentials not configured")
	}

	salt := fmt.Sprintf("%d", time.Now().UnixNano())
	signStr := appID + text + salt + secret
	h := md5.Sum([]byte(signStr))
	sign := hex.EncodeToString(h[:])

	// 自动检测源语言
	from := "auto"
	to := baiduTargetLang(targetLang)

	apiURL := "https://fanyi-api.baidu.com/api/trans/vip/translate"
	params := url.Values{}
	params.Set("q", text)
	params.Set("from", from)
	params.Set("to", to)
	params.Set("appid", appID)
	params.Set("salt", salt)
	params.Set("sign", sign)

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Get(apiURL + "?" + params.Encode())
	if err != nil {
		return "", fmt.Errorf("baidu translate request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("read baidu response failed: %w", err)
	}

	var result struct {
		ErrorCode   string `json:"error_code"`
		ErrorMsg    string `json:"error_msg"`
		TransResult []struct {
			Src string `json:"src"`
			Dst string `json:"dst"`
		} `json:"trans_result"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return "", fmt.Errorf("parse baidu response failed: %w", err)
	}

	if result.ErrorCode != "" && result.ErrorCode != "52000" {
		return "", fmt.Errorf("baidu translate error %s: %s", result.ErrorCode, result.ErrorMsg)
	}

	if len(result.TransResult) == 0 {
		return "", fmt.Errorf("baidu translate returned empty result")
	}

	// 合并多行翻译结果
	var parts []string
	for _, t := range result.TransResult {
		parts = append(parts, t.Dst)
	}
	return strings.Join(parts, "\n"), nil
}

// ---- DeepL 翻译 ----

func deeplTargetLang(targetLang string) string {
	if strings.HasPrefix(targetLang, "zh") {
		return "ZH"
	}
	// DeepL 使用大写语言代码
	langMap := map[string]string{
		"en": "EN", "de": "DE", "fr": "FR", "es": "ES",
		"pt": "PT-BR", "it": "IT", "nl": "NL", "pl": "PL",
		"ru": "RU", "ja": "JA", "ko": "KO",
	}
	if mapped, ok := langMap[targetLang]; ok {
		return mapped
	}
	return strings.ToUpper(targetLang)
}

func translateWithDeepL(apiKey string, freeAPI bool, text, targetLang string) (string, error) {
	if apiKey == "" {
		return "", fmt.Errorf("deepl API key not configured")
	}

	baseURL := "https://api.deepl.com/v2/translate"
	if freeAPI {
		baseURL = "https://api-free.deepl.com/v2/translate"
	}

	payload := url.Values{}
	payload.Set("text", text)
	payload.Set("target_lang", deeplTargetLang(targetLang))

	req, err := http.NewRequest("POST", baseURL, strings.NewReader(payload.Encode()))
	if err != nil {
		return "", fmt.Errorf("create deepl request failed: %w", err)
	}
	req.Header.Set("Authorization", "DeepL-Auth-Key "+apiKey)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("deepl translate request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("read deepl response failed: %w", err)
	}

	if resp.StatusCode != 200 {
		return "", fmt.Errorf("deepl API error %d: %s", resp.StatusCode, string(body))
	}

	var result struct {
		Translations []struct {
			DetectedSourceLang string `json:"detected_source_language"`
			Text               string `json:"text"`
		} `json:"translations"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return "", fmt.Errorf("parse deepl response failed: %w", err)
	}

	if len(result.Translations) == 0 {
		return "", fmt.Errorf("deepl translate returned empty result")
	}

	return result.Translations[0].Text, nil
}

// ---- AI (Cloud LLM) 翻译 ----

func translateWithAI(text, targetLang string) (string, error) {
	aiCfg := LoadAIConfig()
	if !aiCfg.EnableCloudAI || aiCfg.CloudAPIKey == "" {
		return "", fmt.Errorf("AI not configured")
	}

	result, err := TranslateMetadataFields(aiCfg, map[string]string{"text": text}, targetLang)
	if err != nil {
		return "", err
	}
	if t, ok := result["text"]; ok {
		return t, nil
	}
	return "", fmt.Errorf("AI translation returned no result")
}

// ============================================================
// 引擎健康度追踪（用于智能负载均衡）
// ============================================================

type engineStats struct {
	mu           sync.Mutex
	successCount int
	failCount    int
	totalLatency time.Duration
	lastFailTime time.Time
}

var (
	engineHealth   = map[TranslateEngine]*engineStats{}
	engineHealthMu sync.RWMutex
)

func getEngineStats(engine TranslateEngine) *engineStats {
	engineHealthMu.RLock()
	stats, ok := engineHealth[engine]
	engineHealthMu.RUnlock()
	if ok {
		return stats
	}

	engineHealthMu.Lock()
	defer engineHealthMu.Unlock()
	stats, ok = engineHealth[engine]
	if !ok {
		stats = &engineStats{}
		engineHealth[engine] = stats
	}
	return stats
}

func recordEngineSuccess(engine TranslateEngine, latency time.Duration) {
	stats := getEngineStats(engine)
	stats.mu.Lock()
	defer stats.mu.Unlock()
	stats.successCount++
	stats.totalLatency += latency
}

func recordEngineFailure(engine TranslateEngine) {
	stats := getEngineStats(engine)
	stats.mu.Lock()
	defer stats.mu.Unlock()
	stats.failCount++
	stats.lastFailTime = time.Now()
}

// GetEngineHealth 获取所有引擎的健康度信息
func GetEngineHealth() map[string]interface{} {
	engineHealthMu.RLock()
	defer engineHealthMu.RUnlock()

	result := map[string]interface{}{}
	for engine, stats := range engineHealth {
		stats.mu.Lock()
		total := stats.successCount + stats.failCount
		var avgLatency float64
		if stats.successCount > 0 {
			avgLatency = float64(stats.totalLatency.Milliseconds()) / float64(stats.successCount)
		}
		successRate := float64(0)
		if total > 0 {
			successRate = float64(stats.successCount) / float64(total) * 100
		}
		result[string(engine)] = map[string]interface{}{
			"successCount": stats.successCount,
			"failCount":    stats.failCount,
			"avgLatencyMs": math.Round(avgLatency),
			"successRate":  math.Round(successRate*10) / 10,
			"lastFailTime": stats.lastFailTime,
		}
		stats.mu.Unlock()
	}
	return result
}

// SmartSelectEngine 智能选择最佳引擎（基于成功率和延迟）
func SmartSelectEngine() TranslateEngine {
	cfg := LoadTranslateConfig()
	engines := cfg.EnginePriority

	type scored struct {
		engine TranslateEngine
		score  float64
	}

	var candidates []scored
	for _, engine := range engines {
		if !isEngineAvailable(cfg, engine) {
			continue
		}
		stats := getEngineStats(engine)
		stats.mu.Lock()
		total := stats.successCount + stats.failCount
		var s float64
		if total == 0 {
			s = 50 // 未使用过的引擎给中等分数
		} else {
			successRate := float64(stats.successCount) / float64(total)
			avgLatency := float64(0)
			if stats.successCount > 0 {
				avgLatency = float64(stats.totalLatency.Milliseconds()) / float64(stats.successCount)
			}
			// 分数 = 成功率权重 * 70 + 速度权重 * 30
			latencyScore := math.Max(0, 100-avgLatency/50)
			s = successRate*70 + latencyScore*0.3

			// 最近失败的引擎降权
			if !stats.lastFailTime.IsZero() && time.Since(stats.lastFailTime) < 5*time.Minute {
				s *= 0.5
			}
		}
		stats.mu.Unlock()
		candidates = append(candidates, scored{engine, s})
	}

	if len(candidates) == 0 {
		return EngineLocal
	}

	sort.Slice(candidates, func(i, j int) bool {
		return candidates[i].score > candidates[j].score
	})

	// 前两名引擎中随机选择（避免集中负载）
	if len(candidates) >= 2 && candidates[1].score > candidates[0].score*0.8 {
		if rand.Float64() < 0.3 {
			return candidates[1].engine
		}
	}

	return candidates[0].engine
}
