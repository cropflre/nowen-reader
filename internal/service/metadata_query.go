package service

import (
	"path/filepath"
	"regexp"
	"strings"

	"github.com/nowen-reader/nowen-reader/internal/store"
)

func ExtractSearchQuery(filename string) string {
	name := strings.TrimSuffix(filename, filepath.Ext(filename))
	name = bracketRe.ReplaceAllString(name, " ")
	name = bookTitleRe.ReplaceAllString(name, "") // 去掉《》符号，保留书名内容
	name = volChRe.ReplaceAllString(name, " ")
	name = resolutionRe.ReplaceAllString(name, " ")
	name = sepRe.ReplaceAllString(name, " ")
	name = spaceRe.ReplaceAllString(name, " ")
	return strings.TrimSpace(name)
}

// ============================================================
// 智能名称清洗和搜索查询构建
// ============================================================

var (
	// 版本/卷/章标记：v01, Vol.01, 第01卷, 第01话, 第01集, #01, Part 1 等
	titleVolChRe = regexp.MustCompile(`(?i)(?:\b(?:v|vol|volume|ch|chapter|part|ep|episode|book|bk)\.?\s*\d+[-–~]\d+|\b(?:v|vol|volume|ch|chapter|part|ep|episode|book|bk)\.?\s*\d+|第\s*\d+\s*[卷巻册話话集部篇章回本]|\d+[卷巻册話话集部篇章回]|\b#\s*\d+)`)
	// 常见格式/质量/扫描组标记
	titleQualityRe = regexp.MustCompile(`(?i)\b(digital|scan|hq|lq|raw|rip|c\d{2,3}|web|webrip|kindle|kobo|asin|isbn)\b`)
	// 年份标记（仅独立出现的4位数年份，如 2024, (2020)）
	titleYearRe = regexp.MustCompile(`(?:^|\s)\(?\d{4}\)?(?:\s|$)`)
	// 语言标记
	titleLangRe = regexp.MustCompile(`(?i)\b(chinese|english|japanese|korean|zh|en|ja|jp|ko|cn|cht|chs|eng|jap)\b`)
	// 尾部多余修饰词（常见于中文漫画文件名后缀）
	titleSuffixRe = regexp.MustCompile(`(?i)(?:\s*[-–]\s*(?:完结|连载中|全集|完|全|合集))+\s*$`)
	// 标题中的方括号内容（如 [汉化组], [DL版]）
	titleBracketRe = regexp.MustCompile(`[\[【\(（{][^\]】\)）}]*[\]】\)）}]`)
	// 中文书名号
	titleBookMarkRe = regexp.MustCompile(`[《》「」『』]`)
	// 分隔符序列
	titleSepRe = regexp.MustCompile(`[-_.~]+`)
	// 多空格
	titleSpaceRe = regexp.MustCompile(`\s+`)
)

// CleanTitle 对漫画/小说标题进行智能清洗，去除版本号、卷号、特殊标记等干扰信息，
// 提取核心作品名称用于搜索匹配。
func CleanTitle(title string) string {
	if title == "" {
		return ""
	}
	name := title

	// 1. 去除方括号及其内容（如 [汉化组]、(DL版) 等）
	name = titleBracketRe.ReplaceAllString(name, " ")
	// 2. 去除中文书名号（保留内容）
	name = titleBookMarkRe.ReplaceAllString(name, "")
	// 3. 去除版本/卷/章标记
	name = titleVolChRe.ReplaceAllString(name, " ")
	// 4. 去除质量/格式标记
	name = titleQualityRe.ReplaceAllString(name, " ")
	// 5. 去除语言标记
	name = titleLangRe.ReplaceAllString(name, " ")
	// 6. 去除尾部修饰词（完结、连载中等）
	name = titleSuffixRe.ReplaceAllString(name, "")
	// 7. 去除独立年份标记
	name = titleYearRe.ReplaceAllString(name, " ")
	// 8. 分隔符统一为空格
	name = titleSepRe.ReplaceAllString(name, " ")
	name = titleSpaceRe.ReplaceAllString(name, " ")

	return strings.TrimSpace(name)
}

// BuildSearchQuery 根据标题和文件名智能构建搜索查询。
// 优先使用已有标题（清洗后），文件名作为回退。
// 实现多级策略：
//  1. 标题不为空且与文件名不同 → 使用清洗后的标题
//  2. 标题为空或等于文件名 → 从文件名提取
//  3. 两者都无法得出有效查询 → 返回空字符串
//
// 增强：当 basename 是纯数字或分卷词（如 "01.PDF"、"第三部.zip"）时，
// 单独的 basename 作为搜索词必然搜不到结果，需要回退使用父目录路径中的
// "非分卷词"作为搜索主体。
func BuildSearchQuery(title, filename string) string {
	// 标题去除文件扩展名的比较
	filenameBase := strings.TrimSuffix(filename, filepath.Ext(filename))

	// 如果有独立的标题（非文件名派生），优先使用
	if title != "" && title != filename && title != filenameBase {
		cleaned := CleanTitle(title)
		if cleaned != "" && len(cleaned) >= 2 {
			return cleaned
		}
	}

	// 回退：从文件名提取
	q := ExtractSearchQuery(filename)

	// 如果提取出来的只是数字或分卷词，说明 basename 没什么搜索价值，
	// 需要使用父目录补全
	if q == "" || isQueryWeak(q) {
		if dirQuery := extractQueryFromParentDirs(filename); dirQuery != "" {
			return dirQuery
		}
	}
	return q
}

// isQueryWeak 判断搜索查询是否过于薄弱（纯数字、分卷词等无法独立检索的字符串）。
func isQueryWeak(q string) bool {
	q = strings.TrimSpace(q)
	if q == "" {
		return true
	}
	// 全部为数字、空格、分隔符
	allDigit := true
	for _, r := range q {
		if (r >= '0' && r <= '9') || r == ' ' || r == '_' || r == '-' || r == '.' {
			continue
		}
		allDigit = false
		break
	}
	if allDigit {
		return true
	}
	// 整串看起来就是个分卷词
	return store.IsVolumePartNameForQuery(q)
}

// extractQueryFromParentDirs 从相对路径的父目录链中找一个"非分卷词"目录，
// 用 CleanTitle 清洗后作为搜索查询。
func extractQueryFromParentDirs(filename string) string {
	rel := strings.ReplaceAll(filename, "\\", "/")
	dir := filepath.Dir(rel)
	dir = strings.ReplaceAll(dir, "\\", "/")
	if dir == "." || dir == "/" || dir == "" {
		return ""
	}
	parts := strings.Split(dir, "/")
	// 从最近的父目录向上查找
	for i := len(parts) - 1; i >= 0; i-- {
		p := strings.TrimSpace(parts[i])
		if p == "" || p == "." {
			continue
		}
		if store.IsVolumePartNameForQuery(p) {
			continue
		}
		// 用 CleanTitle 把方括号、卷号等噪声清掉
		cleaned := CleanTitle(p)
		if cleaned != "" && len(cleaned) >= 2 {
			return cleaned
		}
	}
	return ""
}
