package service

import (
	"encoding/json"
	"fmt"
	"strings"
)

// ============================================================
// AI 目录级智能标题推断
//
// 与 AIParseFilename 相比，本函数额外接收：
//   - 父目录名（含可能的 [汉化组] [作者] 标签）
//   - 同目录下的若干文件名样本（帮助 AI 识别命名规律和扫图组前缀）
//
// 适用于这种典型场景：
//   目录: 【已完结】佣兵天下(潮華版)[黃玉郎][誰在乎版]
//   文件: 誰在乎版 YongBing-000.cbz / 誰在乎版 YongBing-001.cbz / ...
//   AI 应识别出：
//     title = 佣兵天下
//     author = 黃玉郎
//     scanGroup = 誰在乎版
//     status = 已完结
//     version = 潮華版
//     volumePattern = "YongBing-{NNN}"
// ============================================================

// InferredTitleStructure 是 AI 对一个目录+文件名集合的结构化解析结果。
type InferredTitleStructure struct {
	// 作品主名（推荐用作分组名 / Series 名）
	Title string `json:"title,omitempty"`
	// 作者/作画
	Author string `json:"author,omitempty"`
	// 出版/版本信息（如 "潮華版"、"典藏版"、"完全版"）
	Version string `json:"version,omitempty"`
	// 状态标签（"已完结" / "连载中" / "complete" / "ongoing"）
	Status string `json:"status,omitempty"`
	// 扫图组/汉化组（如 "誰在乎版"、"XX 漢化組"）
	ScanGroup string `json:"scanGroup,omitempty"`
	// 出版社
	Publisher string `json:"publisher,omitempty"`
	// 主语言（zh/ja/en/ko 等）
	Language string `json:"language,omitempty"`
	// 类型（comma-separated）
	Genre string `json:"genre,omitempty"`
	// 首版年份（不确定时省略）
	Year *int `json:"year,omitempty"`
	// 文件命名规则（如 "YongBing-{NNN}"、"第{N}卷"），便于批量重命名
	VolumePattern string `json:"volumePattern,omitempty"`
	// 单卷标题模板（如 "佣兵天下 第{N}卷"）
	VolumeTitleTemplate string `json:"volumeTitleTemplate,omitempty"`
	// 模型自评的置信度："high" / "medium" / "low"
	Confidence string `json:"confidence,omitempty"`
	// 模型简短解释（debug 用）
	Note string `json:"note,omitempty"`
}

// AIInferTitleStructure 让云端 LLM 综合分析"父目录 + 文件名样本"，
// 输出更准确的作品名/作者/扫图组/版本/状态等结构化字段。
//
// 参数说明：
//   - dirName: 漫画/小说所在的最近一级父目录名（已 Trim 但保留方括号原貌）
//   - fileSamples: 该目录下若干文件名样本（建议 5~10 个，越多代价越大）
//   - existingTitle: 当前数据库中已有的标题，可作为 AI 的参考
func AIInferTitleStructure(cfg AIConfig, dirName string, fileSamples []string, existingTitle string) (*InferredTitleStructure, error) {
	if !cfg.EnableCloudAI || cfg.CloudAPIKey == "" {
		return nil, fmt.Errorf("cloud AI not configured")
	}

	if dirName == "" && len(fileSamples) == 0 {
		return nil, fmt.Errorf("dirName and fileSamples cannot both be empty")
	}

	// 限制样本数量以控制 token
	if len(fileSamples) > 10 {
		fileSamples = fileSamples[:10]
	}

	systemPrompt := `You are an expert at understanding manga/comic/novel folder and filename naming conventions across Chinese, Japanese, English, and Korean.

Given:
1. A parent folder name (which may contain mixed metadata like author, scanlation group, status, version)
2. A list of filename samples from that folder (which often share a common prefix)

Your job: identify each piece of metadata correctly. In Chinese-language scanlation cultures, the same folder may contain ALL of:
- The actual work title (e.g. "佣兵天下", "海贼王")
- The author/artist name (e.g. "黃玉郎", "尾田榮一郎")
- The scanlation/scan group name, often ending with 版/組/社/汉化组/漢化版/扫图版 (e.g. "誰在乎版", "XX 漢化組")
- The publisher / version (e.g. "潮華版", "典藏版", "完全版", "東販")
- A completion status (e.g. "已完结", "完結", "連載中", "complete", "ongoing")

Crucial rules:
- Do NOT confuse the scanlation group (誰在乎版/XX組) with the actual title.
- The actual title is usually the LONGEST CJK substring outside of brackets, OR the bracket content that is neither author/group/status/version.
- If filenames share a common prefix that looks like a scan group (e.g. "誰在乎版 YongBing-000"), strip it.
- "YongBing" is a romanization (拼音/罗马音) of the title, NOT the title itself — the title should be the canonical Chinese/original-language name.
- CRITICAL: The "title" field MUST be a CLEAN work name only. It MUST NOT contain volume markers, episode markers, or ANY placeholder like {N}, {NN}, {NNN}, 第{N}卷, Vol.{N}, etc. Volume formatting goes in "volumeTitleTemplate", never in "title".
- For "volumeTitleTemplate": if the work has multiple volumes/chapters, return a template like "佣兵天下 第{NNN}卷" or "封神纪 第{NN}话". The placeholder width ({N}/{NN}/{NNN}) should match the digit width found in the filenames. If it is a single-volume work, OMIT volumeTitleTemplate entirely (do not invent one).

Output ONLY a single valid JSON object, no markdown, no commentary.`

	// 构造样本块
	var samplesBlock string
	if len(fileSamples) > 0 {
		samplesBlock = "Filename samples in this folder:\n"
		for _, s := range fileSamples {
			samplesBlock += "  - " + s + "\n"
		}
	}

	existingTitleBlock := ""
	if existingTitle != "" {
		existingTitleBlock = fmt.Sprintf("\nCurrent (possibly wrong) title in database: %q\n", existingTitle)
	}

	userPrompt := fmt.Sprintf(`Analyze the following manga/comic/novel folder and filenames. Return structured metadata.

Parent folder name:
  %s

%s%s
Return a JSON object with these fields (omit any field you cannot infer with reasonable confidence):
{
  "title": "the canonical work title (CLEAN name only, NEVER contains {N}/第{N}卷/Vol.{N} or any placeholder)",
  "author": "author/artist name",
  "version": "publication version like 潮華版/典藏版/完全版",
  "status": "已完结/连载中/complete/ongoing",
  "scanGroup": "scanlation/scan group name",
  "publisher": "publisher name",
  "language": "primary language code: zh/ja/en/ko",
  "genre": "comma-separated genres",
  "year": 2024,
  "volumePattern": "filename pattern with {NNN} placeholder, e.g. YongBing-{NNN}",
  "volumeTitleTemplate": "per-volume template using {N}/{NN}/{NNN} placeholders matching the digit width in filenames, e.g. 佣兵天下 第{NNN}卷. OMIT this field for single-volume works.",
  "confidence": "high|medium|low",
  "note": "very brief reasoning, max 1 sentence"
}`, dirName, samplesBlock, existingTitleBlock)

	content, err := CallCloudLLM(cfg, systemPrompt, userPrompt, &LLMCallOptions{
		Scenario:  "infer_title_structure",
		MaxTokens: 500,
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
	} else {
		preview := content
		if len(preview) > 200 {
			preview = preview[:200]
		}
		return nil, fmt.Errorf("AI 返回内容中未包含有效的 JSON 对象，原始响应: %s", preview)
	}

	var inferred InferredTitleStructure
	if err := json.Unmarshal([]byte(content), &inferred); err != nil {
		preview := content
		if len(preview) > 300 {
			preview = preview[:300]
		}
		return nil, fmt.Errorf("failed to parse AI title inference response: %w\nContent: %s", err, preview)
	}
	return &inferred, nil
}
