package service

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/nowen-reader/nowen-reader/internal/archive"
	"github.com/nowen-reader/nowen-reader/internal/config"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

// ComicMetadata holds metadata from various sources.
type ComicMetadata struct {
	Title       string `json:"title,omitempty"`
	Author      string `json:"author,omitempty"`
	Publisher   string `json:"publisher,omitempty"`
	Year        *int   `json:"year,omitempty"`
	Description string `json:"description,omitempty"`
	Language    string `json:"language,omitempty"`
	Genre       string `json:"genre,omitempty"`
	CoverURL    string `json:"coverUrl,omitempty"`
	Source      string `json:"source"`
}

// ============================================================
// Genre / Tag translation map (English → Chinese)
// ============================================================

var genreENtoZH = map[string]string{
	"action": "动作", "adventure": "冒险", "comedy": "喜剧", "drama": "剧情",
	"fantasy": "奇幻", "horror": "恐怖", "mystery": "悬疑", "romance": "恋爱",
	"sci-fi": "科幻", "science fiction": "科幻", "slice of life": "日常",
	"sports": "运动", "supernatural": "超自然", "thriller": "惊悚",
	"psychological": "心理", "historical": "历史", "mecha": "机甲", "music": "音乐",
	"martial arts": "武术", "military": "军事", "police": "警察", "school": "校园",
	"school life": "校园", "space": "太空", "magic": "魔法",
	"mahou shoujo": "魔法少女", "magical girls": "魔法少女", "vampire": "吸血鬼",
	"demons": "恶魔", "game": "游戏", "harem": "后宫", "reverse harem": "逆后宫",
	"parody": "恶搞", "samurai": "武士", "super power": "超能力", "superpower": "超能力",
	"kids": "儿童", "seinen": "青年", "shounen": "少年", "shoujo": "少女",
	"josei": "女性", "ecchi": "卖肉", "gender bender": "性别转换", "isekai": "异世界",
	"gourmet": "美食", "cooking": "料理", "survival": "生存", "crime": "犯罪",
	"detective": "侦探", "post-apocalyptic": "末日", "apocalypse": "末日",
	"tragedy": "悲剧", "war": "战争", "cyberpunk": "赛博朋克", "steampunk": "蒸汽朋克",
	"dystopia": "反乌托邦", "utopia": "乌托邦", "wuxia": "武侠", "xianxia": "仙侠",
	"xuanhuan": "玄幻", "reincarnation": "转生", "time travel": "穿越",
	"zombie": "丧尸", "zombies": "丧尸", "monster": "怪物", "monsters": "怪物",
	"animals": "动物", "pets": "宠物", "award winning": "获奖作品",
	"coming of age": "成长", "delinquents": "不良少年", "family": "家庭",
	"friendship": "友情", "love triangle": "三角关系", "revenge": "复仇",
	"time manipulation": "时间操控", "work": "职场", "workplace": "职场",
	"medical": "医疗", "mythology": "神话", "philosophical": "哲学",
	"crossdressing": "女装", "ninja": "忍者", "idol": "偶像", "idols": "偶像",
	"performing arts": "表演艺术", "otaku culture": "宅文化", "satire": "讽刺",
	"suspense": "悬疑", "urban": "都市", "villainess": "恶役",
	"virtual world": "虚拟世界", "based on a novel": "小说改编",
	"based on a manga": "漫画改编", "based on a video game": "游戏改编",
	"anthology": "短篇集", "4-koma": "四格漫画", "adaptation": "改编",
	"full color": "全彩", "web comic": "网络漫画", "webtoon": "条漫",
	"long strip": "条漫", "doujinshi": "同人志", "one shot": "单篇",
	"oneshot": "单篇", "gore": "血腥", "violence": "暴力",
	"mature": "成人", "adult": "成人",
}

// TranslateGenre translates comma-separated genres from English to Chinese.
func TranslateGenre(genre, lang string) string {
	if !strings.HasPrefix(lang, "zh") {
		return genre
	}
	parts := strings.Split(genre, ",")
	for i, p := range parts {
		trimmed := strings.TrimSpace(p)
		key := strings.ToLower(trimmed)
		if zh, ok := genreENtoZH[key]; ok {
			parts[i] = zh
		} else {
			parts[i] = trimmed
		}
	}
	return strings.Join(parts, ", ")
}

// ============================================================
// Search result relevance sorting
// ============================================================

// sortByRelevance 按标题与搜索关键词的相似度排序，最相关的排在最前面。
func sortByRelevance(results []ComicMetadata, query string) {
	if len(results) <= 1 {
		return
	}
	queryLower := strings.ToLower(strings.TrimSpace(query))

	// 计算匹配分数：完全匹配 > 包含 > 部分匹配
	score := func(m ComicMetadata) int {
		titleLower := strings.ToLower(strings.TrimSpace(m.Title))
		if titleLower == queryLower {
			return 100 // 完全匹配
		}
		if strings.Contains(titleLower, queryLower) || strings.Contains(queryLower, titleLower) {
			return 80 // 包含关系
		}
		// 检查每个搜索词是否出现在标题中
		words := strings.Fields(queryLower)
		matched := 0
		for _, w := range words {
			if strings.Contains(titleLower, w) {
				matched++
			}
		}
		if len(words) > 0 {
			return matched * 60 / len(words) // 部分匹配比例
		}
		return 0
	}

	// 简单冒泡排序（结果集通常很小）
	for i := 0; i < len(results); i++ {
		for j := i + 1; j < len(results); j++ {
			if score(results[j]) > score(results[i]) {
				results[i], results[j] = results[j], results[i]
			}
		}
	}
}

// ============================================================
// ComicInfo.xml parsing
// ============================================================

// ParseComicInfoXML parses ComicInfo.xml content into metadata.
func ParseComicInfoXML(xmlContent string) *ComicMetadata {
	m := &ComicMetadata{Source: "comicinfo"}

	getValue := func(tag string) string {
		re := regexp.MustCompile(`(?i)<` + tag + `>([^<]*)</` + tag + `>`)
		matches := re.FindStringSubmatch(xmlContent)
		if len(matches) > 1 {
			return strings.TrimSpace(matches[1])
		}
		return ""
	}

	m.Title = getValue("Title")
	author := getValue("Writer")
	if author == "" {
		author = getValue("Author")
	}
	m.Author = author
	m.Publisher = getValue("Publisher")
	m.Description = getValue("Summary")
	m.Language = getValue("LanguageISO")
	m.Genre = getValue("Genre")

	if y := getValue("Year"); y != "" {
		var year int
		if _, err := fmt.Sscanf(y, "%d", &year); err == nil {
			m.Year = &year
		}
	}

	return m
}

// ExtractComicInfoFromArchive tries to extract ComicInfo.xml from an archive.
func ExtractComicInfoFromArchive(archivePath string) (*ComicMetadata, error) {
	reader, err := archive.NewReader(archivePath)
	if err != nil {
		return nil, err
	}
	defer reader.Close()

	entries := reader.ListEntries()

	for _, e := range entries {
		lower := strings.ToLower(e.Name)
		if lower == "comicinfo.xml" || strings.HasSuffix(lower, "/comicinfo.xml") {
			data, err := reader.ExtractEntry(e.Name)
			if err != nil {
				return nil, err
			}
			return ParseComicInfoXML(string(data)), nil
		}
	}
	return nil, nil
}

// ============================================================
// EPUB OPF metadata extraction (小说专用)
// ============================================================

// ExtractEpubMetadata 从 EPUB 文件中提取 OPF 元数据，转换为 ComicMetadata。
// 支持提取 title、author、publisher、description、language、date、genre（subject）。
func ExtractEpubMetadata(filePath string) (*ComicMetadata, error) {
	epubMeta, err := archive.ExtractEpubOPFMetadata(filePath)
	if err != nil {
		return nil, err
	}

	// 至少需要标题才认为有效
	if epubMeta.Title == "" {
		return nil, nil
	}

	m := &ComicMetadata{
		Title:       epubMeta.Title,
		Author:      epubMeta.Author,
		Publisher:   epubMeta.Publisher,
		Description: epubMeta.Description,
		Language:    epubMeta.Language,
		Genre:       epubMeta.Genre,
		Source:      "epub_opf",
	}

	// 从日期中提取年份
	if epubMeta.Date != "" {
		var year int
		if _, err := fmt.Sscanf(epubMeta.Date, "%d", &year); err == nil && year > 0 {
			m.Year = &year
		}
	}

	return m, nil
}

// ============================================================
// Filename → search query extraction
// ============================================================

var (
	// bracketRe 匹配 [] 【】 () （） {} 及其内容，整体替换为空格
	bracketRe = regexp.MustCompile(`[\[【\(（{][^\]】\)）}]*[\]】\)）}]`)
	// bookTitleRe 仅去掉中文书名号 《》 符号本身，保留里面的内容
	bookTitleRe  = regexp.MustCompile(`[《》]`)
	volChRe      = regexp.MustCompile(`(?i)\b(v|vol|ch|c|#)\.?\s*\d+`)
	resolutionRe = regexp.MustCompile(`(?i)\b\d{3,4}[px]\b`)
	sepRe        = regexp.MustCompile(`[-_.]+`)
	spaceRe      = regexp.MustCompile(`\s+`)
)

// ExtractSearchQuery cleans a filename to derive a search query.
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
// AniList API (free, no key)
// ============================================================

const anilistAPI = "https://graphql.anilist.co"

func SearchAniList(query, lang string) []ComicMetadata {
	return searchAniListWithType(query, lang, "MANGA", "anilist")
}

// SearchAniListNovel searches AniList for light novels.
func SearchAniListNovel(query, lang string) []ComicMetadata {
	return searchAniListWithType(query, lang, "NOVEL", "anilist_novel")
}

func searchAniListWithType(query, lang, mediaType, sourceName string) []ComicMetadata {
	gql := fmt.Sprintf(`query ($search: String) {
		Page(page: 1, perPage: 10) {
			media(search: $search, type: %s, sort: SEARCH_MATCH) {`, mediaType) + `
				id
				title { romaji english native }
				description(asHtml: false)
				genres
				startDate { year }
				staff(sort: RELEVANCE, perPage: 5) {
					edges { role node { name { full } } }
				}
				coverImage { large }
				volumes
			}
		}
	}` + "}"

	body, _ := json.Marshal(map[string]interface{}{
		"query":     gql,
		"variables": map[string]string{"search": query},
	})

	resp, err := httpPostJSON(anilistAPI, body, nil, 15*time.Second)
	if err != nil {
		log.Printf("[metadata] AniList search failed: %v", err)
		return nil
	}
	defer resp.Body.Close()

	var data struct {
		Data struct {
			Page struct {
				Media []struct {
					Title struct {
						Romaji  string  `json:"romaji"`
						English *string `json:"english"`
						Native  *string `json:"native"`
					} `json:"title"`
					Description *string  `json:"description"`
					Genres      []string `json:"genres"`
					StartDate   struct {
						Year *int `json:"year"`
					} `json:"startDate"`
					Staff struct {
						Edges []struct {
							Role string `json:"role"`
							Node struct {
								Name struct {
									Full string `json:"full"`
								} `json:"name"`
							} `json:"node"`
						} `json:"edges"`
					} `json:"staff"`
					CoverImage struct {
						Large string `json:"large"`
					} `json:"coverImage"`
				} `json:"media"`
			} `json:"Page"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return nil
	}

	var results []ComicMetadata
	isZh := strings.HasPrefix(lang, "zh")

	for _, m := range data.Data.Page.Media {
		var authors []string
		for _, e := range m.Staff.Edges {
			role := strings.ToLower(e.Role)
			if strings.Contains(role, "story") || strings.Contains(role, "art") {
				authors = append(authors, e.Node.Name.Full)
			}
		}

		desc := ""
		if m.Description != nil {
			desc = stripHTML(*m.Description)
		}

		title := ""
		if isZh {
			if m.Title.Native != nil {
				title = *m.Title.Native
			}
			if title == "" {
				title = m.Title.Romaji
			}
		} else {
			if m.Title.English != nil {
				title = *m.Title.English
			}
			if title == "" {
				title = m.Title.Romaji
			}
		}

		genre := strings.Join(m.Genres, ", ")
		if genre != "" {
			genre = TranslateGenre(genre, lang)
		}

		results = append(results, ComicMetadata{
			Title:       title,
			Author:      strings.Join(authors, ", "),
			Year:        m.StartDate.Year,
			Description: desc,
			Genre:       genre,
			CoverURL:    m.CoverImage.Large,
			Source:      sourceName,
		})
	}
	return results
}

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
			Infobox []struct {
				Key   string      `json:"key"`
				Value interface{} `json:"value"`
			} `json:"infobox"`
		} `json:"list"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return nil
	}

	var results []ComicMetadata
	isZh := strings.HasPrefix(lang, "zh")

	for _, s := range data.List {
		var author, publisher string
		for _, info := range s.Infobox {
			if info.Key == "作者" || info.Key == "著者" || info.Key == "作画" {
				switch v := info.Value.(type) {
				case string:
					author = v
				case []interface{}:
					var names []string
					for _, item := range v {
						if m, ok := item.(map[string]interface{}); ok {
							if vv, ok := m["v"].(string); ok {
								names = append(names, vv)
							}
						}
					}
					author = strings.Join(names, ", ")
				}
			}
			if info.Key == "出版社" || info.Key == "连载杂志" {
				if v, ok := info.Value.(string); ok {
					publisher = v
				}
			}
		}

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
		// Simple sort by count: use sorted insertion
		type tagItem struct {
			name  string
			count int
		}
		var sortedTags []tagItem
		for _, t := range s.Tags {
			sortedTags = append(sortedTags, tagItem{t.Name, t.Count})
		}
		// Sort by count desc (simple bubble for small n)
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
			Genre:       strings.Join(tagNames, ", "),
			CoverURL:    coverURL,
			Source:      sourceName,
		})
	}
	return results
}

// ============================================================
// MangaDex API (free, no key)
// ============================================================

const mangadexAPI = "https://api.mangadex.org"

func SearchMangaDex(query, lang string) []ComicMetadata {
	u := fmt.Sprintf("%s/manga?title=%s&limit=10&includes[]=author&includes[]=artist&includes[]=cover_art&order[relevance]=desc",
		mangadexAPI, url.QueryEscape(query))

	resp, err := httpGet(u, map[string]string{
		"User-Agent": "NowenReader/1.0",
	}, 15*time.Second)
	if err != nil {
		log.Printf("[metadata] MangaDex search failed: %v", err)
		return nil
	}
	defer resp.Body.Close()

	var data struct {
		Data []struct {
			ID         string `json:"id"`
			Attributes struct {
				Title       map[string]string   `json:"title"`
				AltTitles   []map[string]string `json:"altTitles"`
				Description map[string]string   `json:"description"`
				Year        *int                `json:"year"`
				Tags        []struct {
					Attributes struct {
						Name  map[string]string `json:"name"`
						Group string            `json:"group"`
					} `json:"attributes"`
				} `json:"tags"`
				OriginalLanguage string `json:"originalLanguage"`
			} `json:"attributes"`
			Relationships []struct {
				Type       string `json:"type"`
				Attributes *struct {
					Name     string `json:"name"`
					FileName string `json:"fileName"`
				} `json:"attributes"`
			} `json:"relationships"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return nil
	}

	isZh := strings.HasPrefix(lang, "zh")
	var results []ComicMetadata

	for _, manga := range data.Data {
		attrs := manga.Attributes

		// Title
		title := pickLangValue(attrs.Title, lang)

		// Description
		desc := pickLangValue(attrs.Description, lang)

		// Authors
		var authors []string
		seen := map[string]bool{}
		for _, r := range manga.Relationships {
			if (r.Type == "author" || r.Type == "artist") && r.Attributes != nil && r.Attributes.Name != "" {
				if !seen[r.Attributes.Name] {
					authors = append(authors, r.Attributes.Name)
					seen[r.Attributes.Name] = true
				}
			}
		}

		// Cover URL
		var coverURL string
		for _, r := range manga.Relationships {
			if r.Type == "cover_art" && r.Attributes != nil && r.Attributes.FileName != "" {
				coverURL = fmt.Sprintf("https://uploads.mangadex.org/covers/%s/%s.256.jpg",
					manga.ID, r.Attributes.FileName)
				break
			}
		}

		// Genre tags
		var genreTags []string
		for _, t := range attrs.Tags {
			if t.Attributes.Group == "genre" || t.Attributes.Group == "theme" {
				tagName := ""
				if isZh {
					tagName = t.Attributes.Name["zh"]
				}
				if tagName == "" {
					tagName = t.Attributes.Name["en"]
				}
				if tagName == "" {
					for _, v := range t.Attributes.Name {
						tagName = v
						break
					}
				}
				if tagName != "" {
					genreTags = append(genreTags, tagName)
				}
			}
		}

		genre := strings.Join(genreTags, ", ")
		if genre != "" {
			genre = TranslateGenre(genre, lang)
		}

		results = append(results, ComicMetadata{
			Title:       title,
			Author:      strings.Join(authors, ", "),
			Year:        attrs.Year,
			Description: desc,
			Genre:       genre,
			Language:    attrs.OriginalLanguage,
			CoverURL:    coverURL,
			Source:      "mangadex",
		})
	}
	return results
}

// ============================================================
// MangaUpdates API (free)
// ============================================================

const mangaupdatesAPI = "https://api.mangaupdates.com/v1"

func SearchMangaUpdates(query, lang string) []ComicMetadata {
	body, _ := json.Marshal(map[string]interface{}{
		"search":   query,
		"per_page": 10,
	})

	resp, err := httpPostJSON(mangaupdatesAPI+"/series/search", body, nil, 15*time.Second)
	if err != nil {
		log.Printf("[metadata] MangaUpdates search failed: %v", err)
		return nil
	}
	defer resp.Body.Close()

	var data struct {
		Results []struct {
			Record struct {
				Title       string `json:"title"`
				Description string `json:"description"`
				Image       struct {
					URL struct {
						Original string `json:"original"`
					} `json:"url"`
				} `json:"image"`
				Year   string `json:"year"`
				Genres []struct {
					Genre string `json:"genre"`
				} `json:"genres"`
				Authors []struct {
					Name string `json:"name"`
					Type string `json:"type"`
				} `json:"authors"`
				Publishers []struct {
					PublisherName string `json:"publisher_name"`
					Type          string `json:"type"`
				} `json:"publishers"`
			} `json:"record"`
		} `json:"results"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return nil
	}

	var results []ComicMetadata
	for _, r := range data.Results {
		rec := r.Record

		var authors []string
		for _, a := range rec.Authors {
			if a.Name != "" {
				authors = append(authors, a.Name)
			}
		}

		publisher := ""
		for _, p := range rec.Publishers {
			if p.Type == "Original" {
				publisher = p.PublisherName
				break
			}
		}
		if publisher == "" && len(rec.Publishers) > 0 {
			publisher = rec.Publishers[0].PublisherName
		}

		var year *int
		if rec.Year != "" {
			var y int
			if _, err := fmt.Sscanf(rec.Year, "%d", &y); err == nil && y > 0 {
				year = &y
			}
		}

		var genreNames []string
		for _, g := range rec.Genres {
			genreNames = append(genreNames, g.Genre)
		}
		genre := strings.Join(genreNames, ", ")
		if genre != "" {
			genre = TranslateGenre(genre, lang)
		}

		results = append(results, ComicMetadata{
			Title:       rec.Title,
			Author:      strings.Join(authors, ", "),
			Publisher:   publisher,
			Year:        year,
			Description: stripHTML(rec.Description),
			Genre:       genre,
			CoverURL:    rec.Image.URL.Original,
			Source:      "mangaupdates",
		})
	}
	return results
}

// ============================================================
// Kitsu API (free, no key)
// ============================================================

const kitsuAPI = "https://kitsu.io/api/edge"

func SearchKitsu(query, lang string) []ComicMetadata {
	u := fmt.Sprintf("%s/manga?filter[text]=%s&page[limit]=10", kitsuAPI, url.QueryEscape(query))

	resp, err := httpGet(u, map[string]string{
		"Accept": "application/vnd.api+json",
	}, 15*time.Second)
	if err != nil {
		log.Printf("[metadata] Kitsu search failed: %v", err)
		return nil
	}
	defer resp.Body.Close()

	var data struct {
		Data []struct {
			Attributes struct {
				CanonicalTitle string            `json:"canonicalTitle"`
				Titles         map[string]string `json:"titles"`
				Synopsis       string            `json:"synopsis"`
				StartDate      string            `json:"startDate"`
				PosterImage    *struct {
					Original string `json:"original"`
					Large    string `json:"large"`
					Medium   string `json:"medium"`
				} `json:"posterImage"`
				Serialization string `json:"serialization"`
			} `json:"attributes"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return nil
	}

	isZh := strings.HasPrefix(lang, "zh")
	var results []ComicMetadata

	for _, manga := range data.Data {
		attrs := manga.Attributes
		var year *int
		if attrs.StartDate != "" {
			parts := strings.Split(attrs.StartDate, "-")
			if len(parts) > 0 {
				var y int
				if _, err := fmt.Sscanf(parts[0], "%d", &y); err == nil && y > 0 {
					year = &y
				}
			}
		}

		title := attrs.CanonicalTitle
		if isZh {
			if t := attrs.Titles["ja_jp"]; t != "" {
				title = t
			}
		} else {
			if t := attrs.Titles["en"]; t != "" {
				title = t
			} else if t := attrs.Titles["en_jp"]; t != "" {
				title = t
			}
		}

		var coverURL string
		if attrs.PosterImage != nil {
			coverURL = attrs.PosterImage.Large
			if coverURL == "" {
				coverURL = attrs.PosterImage.Original
			}
			if coverURL == "" {
				coverURL = attrs.PosterImage.Medium
			}
		}

		results = append(results, ComicMetadata{
			Title:       title,
			Year:        year,
			Description: attrs.Synopsis,
			Publisher:   attrs.Serialization,
			CoverURL:    coverURL,
			Source:      "kitsu",
		})
	}
	return results
}

// ============================================================
// Google Books API (free, no key required for basic usage)
// ============================================================

const googleBooksAPI = "https://www.googleapis.com/books/v1/volumes"

func SearchGoogleBooks(query, lang string) []ComicMetadata {
	params := url.Values{}
	params.Set("q", query)
	params.Set("maxResults", "10")
	params.Set("printType", "books")
	if strings.HasPrefix(lang, "zh") {
		params.Set("langRestrict", "zh")
	}

	u := fmt.Sprintf("%s?%s", googleBooksAPI, params.Encode())
	resp, err := httpGet(u, map[string]string{
		"User-Agent": "NowenReader/1.0",
	}, 15*time.Second)
	if err != nil {
		log.Printf("[metadata] Google Books search failed: %v", err)
		return nil
	}
	defer resp.Body.Close()

	var data struct {
		Items []struct {
			VolumeInfo struct {
				Title         string   `json:"title"`
				Authors       []string `json:"authors"`
				Publisher     string   `json:"publisher"`
				PublishedDate string   `json:"publishedDate"`
				Description   string   `json:"description"`
				Categories    []string `json:"categories"`
				Language      string   `json:"language"`
				ImageLinks    *struct {
					Thumbnail      string `json:"thumbnail"`
					SmallThumbnail string `json:"smallThumbnail"`
				} `json:"imageLinks"`
				IndustryIdentifiers []struct {
					Type       string `json:"type"`
					Identifier string `json:"identifier"`
				} `json:"industryIdentifiers"`
			} `json:"volumeInfo"`
		} `json:"items"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return nil
	}

	var results []ComicMetadata
	for _, item := range data.Items {
		vi := item.VolumeInfo

		var year *int
		if vi.PublishedDate != "" {
			var y int
			if _, err := fmt.Sscanf(vi.PublishedDate, "%d", &y); err == nil && y > 0 {
				year = &y
			}
		}

		genre := strings.Join(vi.Categories, ", ")
		if genre != "" {
			genre = TranslateGenre(genre, lang)
		}

		var coverURL string
		if vi.ImageLinks != nil {
			coverURL = vi.ImageLinks.Thumbnail
			if coverURL == "" {
				coverURL = vi.ImageLinks.SmallThumbnail
			}
			// Google Books 返回的是 http URL，转换为 https
			if strings.HasPrefix(coverURL, "http://") {
				coverURL = "https://" + coverURL[7:]
			}
		}

		results = append(results, ComicMetadata{
			Title:       vi.Title,
			Author:      strings.Join(vi.Authors, ", "),
			Publisher:   vi.Publisher,
			Year:        year,
			Description: vi.Description,
			Genre:       genre,
			Language:    vi.Language,
			CoverURL:    coverURL,
			Source:      "googlebooks",
		})
	}
	return results
}

// ============================================================
// Unified search (parallel)
// ============================================================

// SearchMetadata searches multiple sources concurrently.
// contentType: "comic" | "novel" | "" (auto-detect default sources).
func SearchMetadata(query string, sources []string, lang string, contentType ...string) []ComicMetadata {
	ct := ""
	if len(contentType) > 0 {
		ct = contentType[0]
	}

	if len(sources) == 0 {
		switch ct {
		case "novel":
			sources = []string{"googlebooks", "anilist_novel", "bangumi_novel"}
		case "comic":
			sources = []string{"anilist", "bangumi", "mangadex", "mangaupdates", "kitsu"}
		default:
			sources = []string{"anilist", "bangumi", "mangadex", "mangaupdates", "kitsu"}
		}
	}

	type result struct {
		data []ComicMetadata
	}

	ch := make(chan result, len(sources))
	for _, src := range sources {
		go func(s string) {
			switch s {
			case "anilist":
				ch <- result{SearchAniList(query, lang)}
			case "anilist_novel":
				ch <- result{SearchAniListNovel(query, lang)}
			case "bangumi":
				ch <- result{SearchBangumi(query, lang)}
			case "bangumi_novel":
				ch <- result{SearchBangumiNovel(query, lang)}
			case "mangadex":
				ch <- result{SearchMangaDex(query, lang)}
			case "mangaupdates":
				ch <- result{SearchMangaUpdates(query, lang)}
			case "kitsu":
				ch <- result{SearchKitsu(query, lang)}
			case "googlebooks":
				ch <- result{SearchGoogleBooks(query, lang)}

			default:
				ch <- result{}
			}
		}(src)
	}

	var all []ComicMetadata
	for range sources {
		r := <-ch
		all = append(all, r.data...)
	}

	// 按标题与搜索关键词的匹配度排序，优先返回最相关的结果
	sortByRelevance(all, query)

	return all
}

// ============================================================
// Apply metadata to comic
// ============================================================

// ApplyMetadata updates comic fields in DB from metadata.
func ApplyMetadata(comicID string, meta ComicMetadata, lang string, overwrite bool) (*store.ComicListItem, error) {
	existing, err := store.GetComicByID(comicID)
	if err != nil || existing == nil {
		return nil, fmt.Errorf("comic not found: %s", comicID)
	}

	updates := map[string]interface{}{}

	shouldUpdate := func(current string) bool {
		return overwrite || current == ""
	}

	if meta.Title != "" && shouldUpdate(existing.Title) {
		updates["title"] = meta.Title
	}
	if meta.Author != "" && shouldUpdate(existing.Author) {
		updates["author"] = meta.Author
	}
	if meta.Publisher != "" && shouldUpdate(existing.Publisher) {
		updates["publisher"] = meta.Publisher
	}
	if meta.Description != "" && shouldUpdate(existing.Description) {
		updates["description"] = meta.Description
	}
	if meta.Language != "" && shouldUpdate(existing.Language) {
		updates["language"] = meta.Language
	}
	if meta.Genre != "" && shouldUpdate(existing.Genre) {
		updates["genre"] = meta.Genre
	}
	if meta.Year != nil {
		if overwrite || existing.Year == nil {
			updates["year"] = *meta.Year
		}
	}
	if meta.Source != "" {
		updates["metadataSource"] = meta.Source
	}
	if meta.CoverURL != "" {
		updates["coverImageUrl"] = meta.CoverURL
	}

	if len(updates) > 0 {
		if err := store.UpdateComicFields(comicID, updates); err != nil {
			return nil, err
		}
	}

	// Download cover image as thumbnail
	if meta.CoverURL != "" {
		go downloadCoverAsThumbnail(comicID, meta.CoverURL)
	}

	// Add genres as tags
	if meta.Genre != "" {
		genres := strings.Split(meta.Genre, ",")
		var tagNames []string
		for _, g := range genres {
			g = strings.TrimSpace(g)
			if g != "" {
				tagNames = append(tagNames, g)
			}
		}
		if len(tagNames) > 0 {
			_ = store.AddTagsToComic(comicID, tagNames)
		}
	}

	return store.GetComicByID(comicID)
}

// downloadCoverAsThumbnail fetches a cover URL and saves as WebP thumbnail.
func downloadCoverAsThumbnail(comicID, coverURL string) {
	thumbDir := config.GetThumbnailsDir()
	if err := os.MkdirAll(thumbDir, 0755); err != nil {
		return
	}

	client := &http.Client{Timeout: 30 * time.Second}
	req, err := http.NewRequest("GET", coverURL, nil)
	if err != nil {
		return
	}
	req.Header.Set("User-Agent", "NowenReader/1.0")

	resp, err := client.Do(req)
	if err != nil || resp.StatusCode != 200 {
		return
	}
	defer resp.Body.Close()

	imgData, err := io.ReadAll(resp.Body)
	if err != nil || len(imgData) == 0 {
		return
	}

	thumbPath := filepath.Join(thumbDir, comicID+".webp")
	webpData, err := archive.ResizeImageToWebP(imgData, config.GetThumbnailWidth(), config.GetThumbnailHeight(), 85)
	if err != nil {
		// Fallback: save raw image data directly
		_ = os.WriteFile(thumbPath, imgData, 0644)
	} else {
		_ = os.WriteFile(thumbPath, webpData, 0644)
	}
	log.Printf("[metadata] Cover cached for %s", comicID)
}

// ============================================================
// HTTP helpers
// ============================================================

// maxRetries429 是遇到 HTTP 429 时的最大重试次数
const maxRetries429 = 3

// retryAfterFromHeader 从 Retry-After 头中解析等待秒数，默认返回 fallback
func retryAfterFromHeader(resp *http.Response, fallback time.Duration) time.Duration {
	if ra := resp.Header.Get("Retry-After"); ra != "" {
		if secs, err := strconv.Atoi(ra); err == nil && secs > 0 {
			d := time.Duration(secs) * time.Second
			if d > 60*time.Second {
				d = 60 * time.Second // 最多等 60s
			}
			return d
		}
	}
	return fallback
}

func httpGet(rawURL string, headers map[string]string, timeout time.Duration) (*http.Response, error) {
	client := &http.Client{Timeout: timeout}

	for attempt := 0; attempt <= maxRetries429; attempt++ {
		req, err := http.NewRequest("GET", rawURL, nil)
		if err != nil {
			return nil, err
		}
		for k, v := range headers {
			req.Header.Set(k, v)
		}

		resp, err := client.Do(req)
		if err != nil {
			return nil, err
		}

		// 429 限流：指数退避重试
		if resp.StatusCode == http.StatusTooManyRequests && attempt < maxRetries429 {
			resp.Body.Close()
			backoff := retryAfterFromHeader(resp, time.Duration(math.Pow(2, float64(attempt+1)))*time.Second)
			log.Printf("[metadata] HTTP 429 on GET %s, retry %d/%d after %v", rawURL, attempt+1, maxRetries429, backoff)
			time.Sleep(backoff)
			continue
		}

		if resp.StatusCode >= 400 {
			resp.Body.Close()
			return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
		}
		return resp, nil
	}
	return nil, fmt.Errorf("HTTP 429: rate limited after %d retries", maxRetries429)
}

func httpPostJSON(rawURL string, body []byte, headers map[string]string, timeout time.Duration) (*http.Response, error) {
	client := &http.Client{Timeout: timeout}

	for attempt := 0; attempt <= maxRetries429; attempt++ {
		req, err := http.NewRequest("POST", rawURL, strings.NewReader(string(body)))
		if err != nil {
			return nil, err
		}
		req.Header.Set("Content-Type", "application/json")
		for k, v := range headers {
			req.Header.Set(k, v)
		}

		resp, err := client.Do(req)
		if err != nil {
			return nil, err
		}

		// 429 限流：指数退避重试
		if resp.StatusCode == http.StatusTooManyRequests && attempt < maxRetries429 {
			resp.Body.Close()
			backoff := retryAfterFromHeader(resp, time.Duration(math.Pow(2, float64(attempt+1)))*time.Second)
			log.Printf("[metadata] HTTP 429 on POST %s, retry %d/%d after %v", rawURL, attempt+1, maxRetries429, backoff)
			time.Sleep(backoff)
			continue
		}

		if resp.StatusCode >= 400 {
			resp.Body.Close()
			return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
		}
		return resp, nil
	}
	return nil, fmt.Errorf("HTTP 429: rate limited after %d retries", maxRetries429)
}

// ============================================================
// Utility
// ============================================================

var htmlTagRe = regexp.MustCompile(`<[^>]+>`)

func stripHTML(s string) string {
	s = htmlTagRe.ReplaceAllString(s, "")
	s = strings.ReplaceAll(s, "\n\n\n", "\n")
	return strings.TrimSpace(s)
}

func pickLangValue(m map[string]string, lang string) string {
	isZh := strings.HasPrefix(lang, "zh")
	if isZh {
		if v := m["zh"]; v != "" {
			return v
		}
		if v := m["zh-hk"]; v != "" {
			return v
		}
	}
	if v := m["en"]; v != "" {
		return v
	}
	if v := m["ja"]; v != "" {
		return v
	}
	for _, v := range m {
		return v
	}
	return ""
}
