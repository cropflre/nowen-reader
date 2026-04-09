package service

import (
	"encoding/json"
	"fmt"
	"log"
	"net/url"
	"strings"
	"time"
)

// ============================================================
// Bangumi API (free, no key)
// ============================================================

const bangumiAPI = "https://api.bgm.tv"

func SearchBangumi(query, lang string) []ComicMetadata {
	return searchBangumiWithType(query, lang, 1, "bangumi")
}

// SearchBangumiNovel searches Bangumi for novels (type=2).
func SearchBangumiNovel(query, lang string) []ComicMetadata {
	return searchBangumiWithType(query, lang, 2, "bangumi_novel")
}

func searchBangumiWithType(query, lang string, bangumiType int, sourceName string) []ComicMetadata {
	u := fmt.Sprintf("%s/search/subject/%s?type=%d&responseGroup=large&max_results=10",
		bangumiAPI, url.PathEscape(query), bangumiType)

	resp, err := httpGet(u, map[string]string{
		"User-Agent": "NowenReader/1.0",
		"Accept":     "application/json",
	}, 15*time.Second)
	if err != nil {
		log.Printf("[metadata] Bangumi search failed: %v", err)
		return nil
	}
	defer resp.Body.Close()

	var data struct {
		List []struct {
			ID      int    `json:"id"`
			Name    string `json:"name"`
			NameCN  string `json:"name_cn"`
			Summary string `json:"summary"`
			Date    string `json:"date"`
			Images  struct {
				Large  string `json:"large"`
				Medium string `json:"medium"`
			} `json:"images"`
			Tags []struct {
				Name  string `json:"name"`
				Count int    `json:"count"`
			} `json:"tags"`
		} `json:"list"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return nil
	}

	var results []ComicMetadata
	isZh := strings.HasPrefix(lang, "zh")

	for _, s := range data.List {
		// 调用 Bangumi v0 详情 API 获取 infobox（包含作者、出版社等信息）
		author, publisher, language := fetchBangumiSubjectDetail(s.ID)

		var year *int
		if s.Date != "" {
			parts := strings.Split(s.Date, "-")
			if len(parts) > 0 {
				var y int
				if _, err := fmt.Sscanf(parts[0], "%d", &y); err == nil && y > 0 {
					year = &y
				}
			}
		}

		// Tags → genre (top 8 by count, sorted desc)
		var tagNames []string
		type tagItem struct {
			name  string
			count int
		}
		var sortedTags []tagItem
		for _, t := range s.Tags {
			sortedTags = append(sortedTags, tagItem{t.Name, t.Count})
		}
		for i := 0; i < len(sortedTags); i++ {
			for j := i + 1; j < len(sortedTags); j++ {
				if sortedTags[j].count > sortedTags[i].count {
					sortedTags[i], sortedTags[j] = sortedTags[j], sortedTags[i]
				}
			}
		}
		for i, t := range sortedTags {
			if i >= 8 {
				break
			}
			tagNames = append(tagNames, t.name)
		}

		title := s.Name
		if isZh && s.NameCN != "" {
			title = s.NameCN
		}

		coverURL := s.Images.Large
		if coverURL == "" {
			coverURL = s.Images.Medium
		}

		results = append(results, ComicMetadata{
			Title:       title,
			Author:      author,
			Publisher:   publisher,
			Year:        year,
			Description: s.Summary,
			Language:    language,
			Genre:       strings.Join(tagNames, ", "),
			CoverURL:    coverURL,
			Source:      sourceName,
		})
	}
	return results
}

// fetchBangumiSubjectDetail 调用 Bangumi v0 详情 API 获取 infobox 信息。
// 搜索 API 不返回 infobox，只有详情 API 才有。
func fetchBangumiSubjectDetail(subjectID int) (author, publisher, language string) {
	u := fmt.Sprintf("%s/v0/subjects/%d", bangumiAPI, subjectID)
	resp, err := httpGet(u, map[string]string{
		"User-Agent": "NowenReader/1.0",
		"Accept":     "application/json",
	}, 10*time.Second)
	if err != nil {
		log.Printf("[metadata] Bangumi subject detail failed for %d: %v", subjectID, err)
		return
	}
	defer resp.Body.Close()

	var detail struct {
		Infobox []struct {
			Key   string      `json:"key"`
			Value interface{} `json:"value"`
		} `json:"infobox"`
		Platform string `json:"platform"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&detail); err != nil {
		return
	}

	// 从 infobox 中提取作者、出版社、语言
	for _, info := range detail.Infobox {
		switch info.Key {
		case "作者", "著者", "作画", "原作", "脚本":
			if author == "" {
				author = extractInfoboxValue(info.Value)
			} else {
				// 多个作者角色，追加
				v := extractInfoboxValue(info.Value)
				if v != "" && !strings.Contains(author, v) {
					author = author + ", " + v
				}
			}
		case "出版社", "连载杂志", "发行":
			if publisher == "" {
				publisher = extractInfoboxValue(info.Value)
			}
		case "语言":
			if language == "" {
				language = extractInfoboxValue(info.Value)
			}
		}
	}

	// 如果 infobox 中没有语言信息，根据 platform 或默认推断
	if language == "" && detail.Platform != "" {
		platLower := strings.ToLower(detail.Platform)
		if strings.Contains(platLower, "日本") || strings.Contains(platLower, "japan") {
			language = "ja"
		} else if strings.Contains(platLower, "中国") || strings.Contains(platLower, "china") {
			language = "zh"
		} else if strings.Contains(platLower, "韩国") || strings.Contains(platLower, "korea") {
			language = "ko"
		}
	}

	return
}

// extractInfoboxValue 从 Bangumi infobox value 中提取字符串值。
// infobox value 可能是纯字符串，也可能是 [{"v": "xxx"}, ...] 格式的数组。
func extractInfoboxValue(value interface{}) string {
	switch v := value.(type) {
	case string:
		return strings.TrimSpace(v)
	case []interface{}:
		var names []string
		for _, item := range v {
			if m, ok := item.(map[string]interface{}); ok {
				if vv, ok := m["v"].(string); ok {
					vv = strings.TrimSpace(vv)
					if vv != "" {
						names = append(names, vv)
					}
				}
			}
		}
		return strings.Join(names, ", ")
	}
	return ""
}
