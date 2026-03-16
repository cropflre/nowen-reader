package service

import (
	"regexp"
	"strconv"
	"strings"
)

// SeriesInfo 从文件名中检测到的系列信息。
type SeriesInfo struct {
	SeriesName  string
	SeriesIndex int
}

// 系列匹配正则表达式（按优先级排序）
var seriesPatterns = []*regexp.Regexp{
	// "[作者] 系列名 Vol.01" / "系列名 Vol.01"
	regexp.MustCompile(`(?i)^(?:\[.*?\]\s*)?(.+?)\s+vol\.?\s*(\d+)`),
	// "系列名 v01" / "系列名 v1"
	regexp.MustCompile(`(?i)^(?:\[.*?\]\s*)?(.+?)\s+v(\d+)`),
	// "系列名 #01" / "系列名 #1"
	regexp.MustCompile(`^(?:\[.*?\]\s*)?(.+?)\s*#(\d+)`),
	// "系列名 第01卷" / "系列名 第1巻"
	regexp.MustCompile(`^(?:\[.*?\]\s*)?(.+?)\s*第\s*(\d+)\s*[卷巻册話话集]`),
	// "系列名 01" (末尾数字，至少两位)
	regexp.MustCompile(`^(?:\[.*?\]\s*)?(.+?)\s+(\d{2,3})$`),
	// "(C99) [作者] 系列名 01"
	regexp.MustCompile(`^(?:\([^)]+\)\s*)?(?:\[.*?\]\s*)?(.+?)\s+(\d{2,3})$`),
}

// DetectSeries 从文件名中检测系列名和卷号。
// 返回 nil 表示未检测到系列信息。
func DetectSeries(filename string) *SeriesInfo {
	// 去掉文件扩展名
	name := strings.TrimSuffix(filename, getExtension(filename))
	name = strings.TrimSpace(name)

	if name == "" {
		return nil
	}

	for _, pattern := range seriesPatterns {
		matches := pattern.FindStringSubmatch(name)
		if len(matches) >= 3 {
			seriesName := strings.TrimSpace(matches[1])
			index, err := strconv.Atoi(matches[2])
			if err != nil || seriesName == "" {
				continue
			}
			// 清理系列名中的常见前缀/后缀
			seriesName = cleanSeriesName(seriesName)
			if seriesName == "" {
				continue
			}
			return &SeriesInfo{
				SeriesName:  seriesName,
				SeriesIndex: index,
			}
		}
	}

	return nil
}

// getExtension 获取文件扩展名（包含点号）
func getExtension(filename string) string {
	for i := len(filename) - 1; i >= 0; i-- {
		if filename[i] == '.' {
			return filename[i:]
		}
	}
	return ""
}

// cleanSeriesName 清理系列名中的常见噪音
func cleanSeriesName(name string) string {
	// 移除末尾的常见分隔符
	name = strings.TrimRight(name, " -_–—")
	// 移除末尾的括号内容（如 "(完)")
	re := regexp.MustCompile(`\s*[\(（][^)）]*[\)）]\s*$`)
	name = re.ReplaceAllString(name, "")
	return strings.TrimSpace(name)
}
