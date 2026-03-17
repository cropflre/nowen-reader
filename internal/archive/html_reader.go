package archive

import (
	"fmt"
	"os"
	"regexp"
	"strings"
)

// ============================================================
// HTML Reader (单文件 HTML → 单章节小说)
// ============================================================

// htmlReader 将一个 HTML 文件当作单章节的小说来阅读。
type htmlReader struct {
	filepath string
	title    string
	content  string
	entries  []Entry
}

// 用于从 HTML 中提取 <title> 标签内容
var htmlTitlePattern = regexp.MustCompile(`(?is)<title[^>]*>\s*(.*?)\s*</title>`)

func newHtmlReader(fp string) (*htmlReader, error) {
	data, err := os.ReadFile(fp)
	if err != nil {
		return nil, fmt.Errorf("read html %s: %w", fp, err)
	}

	// 检测编码并转换为 UTF-8（复用 txt_reader 中的编码检测）
	text := detectAndDecodeText(data)
	data = nil // 释放原始数据

	// 尝试从 <title> 中提取标题
	title := extractHtmlTitle(text)
	if title == "" {
		// 使用文件名作为标题
		base := strings.TrimSuffix(strings.TrimSuffix(
			fileBaseName(fp), ".html"), ".htm")
		title = base
	}

	r := &htmlReader{
		filepath: fp,
		title:    title,
		content:  text,
		entries: []Entry{
			{Name: "chapter-0001.html", IsDirectory: false},
		},
	}

	return r, nil
}

func (r *htmlReader) ListEntries() []Entry {
	return r.entries
}

func (r *htmlReader) ExtractEntry(entryName string) ([]byte, error) {
	if entryName == "chapter-0001.html" {
		// 提取 <body> 中的内容，如果没有 <body> 则返回全部内容
		body := extractHtmlBody(r.content)
		return []byte(body), nil
	}
	return nil, fmt.Errorf("entry not found in html: %s", entryName)
}

func (r *htmlReader) Close() {
	// 无需清理
}

// GetChapterTitle 返回 HTML 文件的章节标题
func (r *htmlReader) GetChapterTitle(entryName string) string {
	if entryName == "chapter-0001.html" {
		return r.title
	}
	return ""
}

// extractHtmlTitle 从 HTML 内容中提取 <title> 标签的文本
func extractHtmlTitle(html string) string {
	matches := htmlTitlePattern.FindStringSubmatch(html)
	if len(matches) >= 2 {
		title := strings.TrimSpace(matches[1])
		// 移除 HTML 实体
		title = strings.ReplaceAll(title, "&amp;", "&")
		title = strings.ReplaceAll(title, "&lt;", "<")
		title = strings.ReplaceAll(title, "&gt;", ">")
		title = strings.ReplaceAll(title, "&quot;", "\"")
		title = strings.ReplaceAll(title, "&#39;", "'")
		return title
	}
	return ""
}

// extractHtmlBody 提取 HTML <body> 标签中的内容。
// 如果没有 <body> 标签，返回原始内容。
func extractHtmlBody(html string) string {
	// 查找 <body...> 的位置
	bodyOpenPattern := regexp.MustCompile(`(?is)<body[^>]*>`)
	bodyClosePattern := regexp.MustCompile(`(?is)</body>`)

	openLoc := bodyOpenPattern.FindStringIndex(html)
	if openLoc == nil {
		// 没有 <body> 标签，返回全文
		return html
	}

	closeLoc := bodyClosePattern.FindStringIndex(html)
	if closeLoc == nil {
		// 有 <body> 但没有 </body>，返回 <body> 之后的内容
		return strings.TrimSpace(html[openLoc[1]:])
	}

	return strings.TrimSpace(html[openLoc[1]:closeLoc[0]])
}

// fileBaseName 返回不带目录的文件名（不含扩展名）
func fileBaseName(fp string) string {
	// 提取最后的文件名部分
	name := fp
	if idx := strings.LastIndexAny(name, "/\\"); idx >= 0 {
		name = name[idx+1:]
	}
	return name
}

// GetHtmlChapterTitles 为 HTML reader 返回章节标题列表
func GetHtmlChapterTitles(r Reader) []string {
	if hr, ok := r.(*htmlReader); ok {
		return []string{hr.title}
	}
	return nil
}
