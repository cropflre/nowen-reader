package service

import (
	"strings"
	"time"
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

	// External rating from scraping sources
	ExternalRating          *float64   `json:"externalRating,omitempty"`       // 外部评分原始分数
	ExternalRatingMax       *float64   `json:"externalRatingMax,omitempty"`    // 满分值（如 10, 100）
	ExternalRatingSource    string     `json:"externalRatingSource,omitempty"` // 评分来源（"anilist", "bangumi"）
	ExternalRatingUpdatedAt *time.Time `json:"externalRatingUpdatedAt,omitempty"` // 评分更新时间
}

// ApplyOption 控制 ApplyMetadata 的可选行为。
type ApplyOption struct {
	SkipCover bool // 为 true 时跳过封面更新（用户反馈：刮削的封面大多是日版，而资源一般是台版）
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
