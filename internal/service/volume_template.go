package service

import (
	"fmt"
	"path"
	"regexp"
	"strconv"
	"strings"
)

// ============================================================
// 卷号提取与单卷标题模板渲染
//
// 解决"AI 返回的 volumeTitleTemplate 含 {N}/{NN}/{NNN} 占位符
// 但代码直接写入数据库，导致所有标题都变成 '佣兵天下 第{N}卷'" 的 bug。
//
// 设计原则：
//   1. 占位符必须用真实卷号替换，提取不到则放弃模板，回退到干净的 Title。
//   2. 任何情况下都不允许把含 {} 的字符串写回库（最终防线 sanitize）。
// ============================================================

// volumeNumRegexes 是按优先级排列的卷号提取正则。
//
// 优先匹配文件名中常见的卷次/话次/集数标识，而不是文件名中的全部数字
// （例如年份 2024 不应被识别为卷号）。
var volumeNumRegexes = []*regexp.Regexp{
	// 中文显式标记：第001卷 / 第 12 话 / 第3集
	regexp.MustCompile(`第\s*(\d{1,4})\s*[卷話话回集]`),
	// 英文 Vol/Volume/Ch/Chapter/Episode
	regexp.MustCompile(`(?i)\b(?:vol(?:ume)?|ch(?:apter)?|ep(?:isode)?)\s*[._\-]?\s*(\d{1,4})\b`),
	// 末尾形如 -001 / _007 / .003 的卷次（最常见命名）
	regexp.MustCompile(`[\-_.](\d{2,4})(?:[\-_.]|$)`),
	// 兜底：文件名末尾紧跟扩展名前的纯数字串（如 YongBing007.cbz）
	regexp.MustCompile(`(\d{2,4})$`),
}

// extractVolumeNumber 从文件名（不含目录）中提取卷号。返回 (number, ok)。
// 输入应为 path.Base 后、未去扩展名的字符串，函数内部会去掉扩展名。
func extractVolumeNumber(filename string) (int, bool) {
	if filename == "" {
		return 0, false
	}
	base := filename
	// 去掉扩展名
	if ext := path.Ext(base); ext != "" {
		base = strings.TrimSuffix(base, ext)
	}
	for _, re := range volumeNumRegexes {
		m := re.FindStringSubmatch(base)
		if len(m) >= 2 {
			n, err := strconv.Atoi(m[1])
			if err == nil && n >= 0 {
				return n, true
			}
		}
	}
	return 0, false
}

// volumeTemplatePlaceholders 命中 {N}, {NN}, {NNN}, {NNNN} 等占位符。
var volumeTemplatePlaceholders = regexp.MustCompile(`\{N+\}`)

// renderVolumeTitle 根据 AI 返回的模板和实际 filename 生成单卷标题。
//
// 行为：
//   - template 为空 → 返回 fallback（一般是干净的作品名 Title）
//   - template 含 {N} 但提取不到卷号 → 退回 fallback（绝不让 {N} 落地）
//   - 成功替换占位符 → 按占位符宽度补零（例如 {NNN} + 7 → "007"）
//   - template 不含占位符（AI 直接给了完整书名）→ 原样返回 template
func renderVolumeTitle(template, fallback, filename string) string {
	tpl := strings.TrimSpace(template)
	if tpl == "" {
		return fallback
	}
	if !volumeTemplatePlaceholders.MatchString(tpl) {
		// 模板里没有占位符（可能是单本作品的固定标题）
		return tpl
	}
	num, ok := extractVolumeNumber(filename)
	if !ok {
		// 提取不到卷号，绝不能把 {N} 写回去
		return fallback
	}
	rendered := volumeTemplatePlaceholders.ReplaceAllStringFunc(tpl, func(ph string) string {
		// 占位符宽度 = ph 长度 - 2（去掉 {}）
		width := len(ph) - 2
		if width <= 1 {
			return strconv.Itoa(num)
		}
		return fmt.Sprintf("%0*d", width, num)
	})
	return rendered
}

// sanitizeTitle 是最后一道防线：去掉任何残留的 {N+} 占位符碎片，
// 同时压缩多余空白。确保不会有 "佣兵天下 第{N}卷" 这种脏字符串落地。
func sanitizeTitle(s string) string {
	if s == "" {
		return s
	}
	cleaned := volumeTemplatePlaceholders.ReplaceAllString(s, "")
	// 压缩连续空格
	cleaned = strings.Join(strings.Fields(cleaned), " ")
	return strings.TrimSpace(cleaned)
}

// RenderVolumeTitle 是 renderVolumeTitle 的导出版本，供 handler 包调用。
func RenderVolumeTitle(template, fallback, filename string) string {
	return renderVolumeTitle(template, fallback, filename)
}

// SanitizeTitle 是 sanitizeTitle 的导出版本，供 handler 包调用。
func SanitizeTitle(s string) string {
	return sanitizeTitle(s)
}

// CleanupDirtyTitles 一次性扫描 Comic 表，把 Title 中残留的 {N+} 占位符
// 替换为真实卷号（从 filename 提取），提取不到则去掉占位符。
// 返回受影响的行数。仅用于修复历史已被污染的数据。
//
// 为避免循环 import，函数体放在 store 兼容层（下方）。
func CleanupDirtyTitles() (int, error) {
	return cleanupDirtyTitlesImpl()
}

// containsVolumeMarker 判断 title 是否带"卷号信息"（即与同目录其他卷有差异化）。
//
// 规则：
//   - title 包含本 filename 的卷号数字（去扩展名后） → 视为有卷号
//   - title 末尾包含数字（>=2 位） → 视为有卷号
//   - title 含 "第N卷/Vol.N/Ch.N/EP.N" 等显式标记 → 视为有卷号
//
// 用于扫描期统一规则的"桶内一致性校验"：一桶 N 本 comic 若都被算成同一标题，
// 说明 AI 模板没把卷号还原回去，需要回退到 FilenameToSmartTitle。
func containsVolumeMarker(title, filename string) bool {
	t := strings.TrimSpace(title)
	if t == "" {
		return false
	}
	// 1) 本卷号是否出现在 title 中
	if num, ok := extractVolumeNumber(filename); ok {
		if strings.Contains(t, strconv.Itoa(num)) {
			return true
		}
		// 也覆盖 "001" / "07" 等补零写法
		for _, w := range []int{2, 3, 4} {
			if strings.Contains(t, fmt.Sprintf("%0*d", w, num)) {
				return true
			}
		}
	}
	// 2) 显式卷号关键词
	if titleVolumeKeywordRe.MatchString(t) {
		return true
	}
	// 3) 末尾紧跟数字（>=2 位），视为卷号兜底
	if titleTailDigitRe.MatchString(t) {
		return true
	}
	return false
}

// titleVolumeKeywordRe 命中 "第N卷/第N话/Vol.N/Ch.N/Episode N" 等显式卷号标记。
var titleVolumeKeywordRe = regexp.MustCompile(`(?i)第\s*\d+\s*[卷話话回集]|\b(?:vol(?:ume)?|ch(?:apter)?|ep(?:isode)?)\s*[._\-]?\s*\d+\b`)

// titleTailDigitRe 命中标题末尾的 >=2 位数字（如 "封神纪 第三部 001"）。
var titleTailDigitRe = regexp.MustCompile(`\d{2,}\s*$`)
