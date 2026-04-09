package service

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
)

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
func GenerateSummary(cfg AIConfig, title, author, genre, existingDesc, contentType, targetLang string) (string, error) {
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
// Phase 1-2a: AI 漫画内容识别（基于封面+内页 Vision）
// ============================================================

// RecognizedContent AI 从漫画内容（封面+内页）识别出的结构化元数据
type RecognizedContent struct {
	Title    string `json:"title,omitempty"`
	Author   string `json:"author,omitempty"`
	Language string `json:"language,omitempty"`
	Genre    string `json:"genre,omitempty"`
	Year     *int   `json:"year,omitempty"`
	Tags     string `json:"tags,omitempty"`
}

// AIRecognizeComicContent 使用多模态 AI 分析漫画封面和前几页内容，
// 识别漫画名称、作者等元数据。完全不依赖文件名。
// coverData: 封面图片字节，pageImages: 内页图片字节列表（最多取前 2-3 页）。
func AIRecognizeComicContent(cfg AIConfig, coverData []byte, pageImages [][]byte, targetLang string) (*RecognizedContent, error) {
	if !cfg.EnableCloudAI || cfg.CloudAPIKey == "" {
		return nil, fmt.Errorf("cloud AI not configured")
	}

	// 检查 provider 是否支持 Vision
	if preset, ok := ProviderPresets[cfg.CloudProvider]; ok {
		if !preset.SupportsVision {
			return nil, fmt.Errorf("provider %s does not support vision/image analysis, cannot recognize comic content", cfg.CloudProvider)
		}
	}

	langName := "Chinese (简体中文)"
	if targetLang == "en" {
		langName = "English"
	}

	systemPrompt := fmt.Sprintf(`You are an expert manga/comic content analyst with deep knowledge of manga, comics, manhwa, manhua and related media.

Your task: Identify the comic/manga by analyzing the attached images (cover and sample pages). The images are provided as part of this message — do NOT say images are missing.

Analysis strategy:
1. **Cover image**: Look for title text (any language), author/artist name, publisher logo, volume/issue number, art style
2. **Sample pages**: Look for title pages, copyright pages, running headers/footers with series name, character dialogue that reveals the story
3. **Visual recognition**: Use art style, character design, and visual elements to identify well-known series
4. **Text extraction**: Read any visible text in the images (Japanese, Chinese, Korean, English, etc.)

You MUST return ONLY a valid JSON object (no markdown, no explanation, no extra text):
{
  "title": "the official/clean title of the manga/comic (no volume numbers)",
  "author": "author/artist name if identifiable",
  "language": "primary language code (zh/ja/en/ko) detected from the content",
  "genre": "comma-separated genres inferred from visual content and story elements",
  "year": null,
  "tags": "comma-separated descriptive tags based on visual analysis"
}

Rules:
- Title should be the canonical/official name of the series, cleaned of volume/chapter numbers
- If you recognize a well-known series, use its most commonly known title in %s
- For unknown series, extract the title text exactly as shown on the cover/title page
- If you cannot determine a field with reasonable confidence, omit it
- Do NOT guess randomly — only include information you can actually see or confidently recognize
- ALWAYS respond with a JSON object, even if you can only fill in partial fields
- NEVER respond with plain text or ask for more information — just do your best with what you see`, langName)

	userPrompt := "I have attached comic/manga images below. The first image is the cover, followed by sample interior pages. Please analyze them and return a JSON object with title, author, language, genre, year, tags. Remember: respond with ONLY a JSON object."

	// 构建图片列表
	var images []ImageContent
	if len(coverData) > 0 {
		mimeType := detectImageMimeType(coverData)
		images = append(images, ImageContent{Base64: encodeBase64(coverData), MimeType: mimeType})
	}
	for _, pageData := range pageImages {
		if len(pageData) > 0 {
			mimeType := detectImageMimeType(pageData)
			images = append(images, ImageContent{Base64: encodeBase64(pageData), MimeType: mimeType})
		}
		// 限制最多 3 张图片（封面 + 2 内页），避免 token 过多
		if len(images) >= 3 {
			break
		}
	}

	if len(images) == 0 {
		return nil, fmt.Errorf("no images provided for content recognition")
	}

	// 记录图片信息，方便调试
	for i, img := range images {
		log.Printf("[AI] recognize_content image[%d]: mimeType=%s base64Len=%d", i, img.MimeType, len(img.Base64))
	}

	content, err := CallCloudLLM(cfg, systemPrompt, userPrompt, &LLMCallOptions{
		Scenario:  "recognize_content",
		MaxTokens: 400,
		Images:    images,
	})
	if err != nil {
		return nil, err
	}

	log.Printf("[AI] recognize_content raw response (len=%d): %.500s", len(content), content)

	// 清理 markdown 代码块
	content = strings.ReplaceAll(content, "```json", "")
	content = strings.ReplaceAll(content, "```", "")
	content = strings.TrimSpace(content)

	// 提取 JSON
	start := strings.Index(content, "{")
	end := strings.LastIndex(content, "}")
	if start >= 0 && end > start {
		content = content[start : end+1]
	} else {
		// AI 返回的内容中没有找到 JSON 对象
		preview := content
		if len(preview) > 200 {
			preview = preview[:200]
		}
		return nil, fmt.Errorf("AI 返回内容中未包含有效的 JSON 对象，原始响应: %s", preview)
	}

	var recognized RecognizedContent
	if err := json.Unmarshal([]byte(content), &recognized); err != nil {
		// 记录解析失败的内容，方便调试
		preview := content
		if len(preview) > 300 {
			preview = preview[:300]
		}
		return nil, fmt.Errorf("failed to parse AI content recognition response: %w\nContent: %s", err, preview)
	}
	return &recognized, nil
}

// detectImageMimeType 检测图片 MIME 类型
func detectImageMimeType(data []byte) string {
	if len(data) < 4 {
		return "image/jpeg"
	}
	// 使用标准库检测
	ct := http.DetectContentType(data)
	// http.DetectContentType 对图片返回 image/jpeg, image/png, image/gif, image/webp 等
	if strings.HasPrefix(ct, "image/") {
		return ct
	}
	// 手动检测 WebP（标准库某些版本可能不识别）
	if data[0] == 0x52 && data[1] == 0x49 && data[2] == 0x46 && data[3] == 0x46 {
		if len(data) > 11 && string(data[8:12]) == "WEBP" {
			return "image/webp"
		}
	}
	return "image/jpeg"
}

// ============================================================
// Phase 1-2b: AI 文件名智能解析（备用方案）
// ============================================================

// ParsedFilename AI 从文件名解析出的结构化元数据
type ParsedFilename struct {
	Title    string `json:"title,omitempty"`
	Author   string `json:"author,omitempty"`
	Group    string `json:"group,omitempty"` // 汉化组/扫图组
	Language string `json:"language,omitempty"`
	Genre    string `json:"genre,omitempty"`
	Year     *int   `json:"year,omitempty"`
	Tags     string `json:"tags,omitempty"` // 逗号分隔的额外标签
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
- Return ONLY a valid JSON object, no extra text or markdown`

	userPrompt := fmt.Sprintf(`Parse this filename and extract structured metadata:

"%s"

Return a JSON object with these fields (omit empty ones):
{
  "title": "the main title/work name",
  "author": "author/artist name",
  "group": "scan/translation group name",
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
// Phase 1-3b: AI 智能标签建议（系列级增强版）
// ============================================================

// SuggestGroupTags 根据系列的元数据和所有卷的标题，让 AI 推荐合适的标签。
// 相比单本 SuggestTags，增加了系列上下文（卷数、所有卷标题列表）。
func SuggestGroupTags(cfg AIConfig, groupName, author, genre, description string, volumeTitles []string, contentType, targetLang string, existingTags []string) ([]string, error) {
	if !cfg.EnableCloudAI || cfg.CloudAPIKey == "" {
		return nil, fmt.Errorf("cloud AI not configured")
	}

	langName := "Chinese (简体中文)"
	if targetLang == "en" {
		langName = "English"
	}

	systemPrompt := fmt.Sprintf(`You are an expert %s librarian and tagger. Based on the given series metadata and volume titles, suggest relevant tags in %s.

Requirements:
- Suggest 5-10 tags that would help users discover and categorize this series
- Tags should be concise (1-4 words each)
- Include genre tags, theme tags, mood/style tags, and audience tags (e.g. target demographic)
- Consider the overall series theme based on all volume titles
- If existing tags are provided, suggest NEW tags that complement them (don't repeat existing ones)
- Return ONLY a JSON array of tag strings, no extra text or markdown
- Tags should be in %s`, contentType, langName, langName)

	// 构建上下文
	var parts []string
	if groupName != "" {
		parts = append(parts, fmt.Sprintf("Series Name: %s", groupName))
	}
	if author != "" {
		parts = append(parts, fmt.Sprintf("Author: %s", author))
	}
	if genre != "" {
		parts = append(parts, fmt.Sprintf("Genre: %s", genre))
	}
	if description != "" {
		desc := description
		if len(desc) > 500 {
			desc = desc[:500] + "..."
		}
		parts = append(parts, fmt.Sprintf("Description: %s", desc))
	}
	if len(volumeTitles) > 0 {
		// 最多列出前 20 个卷标题
		titles := volumeTitles
		if len(titles) > 20 {
			titles = titles[:20]
		}
		parts = append(parts, fmt.Sprintf("Volume count: %d", len(volumeTitles)))
		parts = append(parts, fmt.Sprintf("Volume titles:\n%s", strings.Join(titles, "\n")))
	}
	if len(existingTags) > 0 {
		parts = append(parts, fmt.Sprintf("Existing tags (do NOT repeat): %s", strings.Join(existingTags, ", ")))
	}

	userPrompt := fmt.Sprintf("Suggest tags for this %s series:\n\n%s\n\nReturn a JSON array of tag strings.", contentType, strings.Join(parts, "\n"))

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

// SuggestGroupCategories AI 智能建议系列分类。
// availableCategories: 可选分类列表，格式为 "slug:name"。
func SuggestGroupCategories(cfg AIConfig, groupName, author, genre, description string, volumeTitles []string, contentType, targetLang string, existingTags []string, availableCategories []string) ([]string, error) {
	if !cfg.EnableCloudAI || cfg.CloudAPIKey == "" {
		return nil, fmt.Errorf("cloud AI not configured")
	}

	systemPrompt := fmt.Sprintf(`You are an expert %s librarian. Based on the given series metadata, suggest the most appropriate categories from the provided list.

Requirements:
- Select 1-5 categories that best describe this series
- Only choose from the provided available categories
- Consider the series name, author, genre, description, tags, and volume titles
- Return ONLY a JSON array of category slug strings (not names), no extra text or markdown`, contentType)

	// 构建上下文
	var parts []string
	if groupName != "" {
		parts = append(parts, fmt.Sprintf("Series Name: %s", groupName))
	}
	if author != "" {
		parts = append(parts, fmt.Sprintf("Author: %s", author))
	}
	if genre != "" {
		parts = append(parts, fmt.Sprintf("Genre: %s", genre))
	}
	if description != "" {
		desc := description
		if len(desc) > 500 {
			desc = desc[:500] + "..."
		}
		parts = append(parts, fmt.Sprintf("Description: %s", desc))
	}
	if len(existingTags) > 0 {
		parts = append(parts, fmt.Sprintf("Tags: %s", strings.Join(existingTags, ", ")))
	}
	if len(volumeTitles) > 0 {
		titles := volumeTitles
		if len(titles) > 10 {
			titles = titles[:10]
		}
		parts = append(parts, fmt.Sprintf("Volume titles:\n%s", strings.Join(titles, "\n")))
	}
	parts = append(parts, fmt.Sprintf("\nAvailable categories (slug:name):\n%s", strings.Join(availableCategories, "\n")))

	userPrompt := fmt.Sprintf("Select the most appropriate categories for this %s series:\n\n%s\n\nReturn a JSON array of category slug strings.", contentType, strings.Join(parts, "\n"))

	content, err := CallCloudLLM(cfg, systemPrompt, userPrompt, &LLMCallOptions{
		Scenario:  "suggest_categories",
		MaxTokens: 200,
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

	var slugs []string
	if err := json.Unmarshal([]byte(content), &slugs); err != nil {
		return nil, fmt.Errorf("failed to parse AI response: %w", err)
	}

	// 验证 slug 是否在可选列表中
	validSlugs := make(map[string]bool)
	for _, cat := range availableCategories {
		parts := strings.SplitN(cat, ":", 2)
		if len(parts) > 0 {
			validSlugs[parts[0]] = true
		}
	}

	var validResults []string
	for _, slug := range slugs {
		slug = strings.TrimSpace(slug)
		if slug != "" && validSlugs[slug] {
			validResults = append(validResults, slug)
		}
	}

	return validResults, nil
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
	return base64.StdEncoding.EncodeToString(data)
}

// ============================================================
// Phase 2-2: AI 推荐理由生成
