package service

import (
	"strings"
	"unicode"
)

// ============================================================
// Bidirectional tag mapping (English ↔ Chinese)
// ============================================================

var enToZH = map[string]string{
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

// zhToEN is the reverse map (Chinese → English). Built at init.
var zhToEN map[string]string

func init() {
	zhToEN = make(map[string]string, len(enToZH))
	seen := map[string]bool{}
	for en, zh := range enToZH {
		if !seen[zh] {
			// Title-case the English term
			words := strings.Split(en, " ")
			for i, w := range words {
				if len(w) > 0 {
					words[i] = strings.ToUpper(w[:1]) + w[1:]
				}
			}
			zhToEN[zh] = strings.Join(words, " ")
			seen[zh] = true
		}
	}
}

func isChinese(s string) bool {
	for _, r := range s {
		if unicode.Is(unicode.Han, r) {
			return true
		}
	}
	return false
}

func translateTagLocal(tag, targetLang string) string {
	isTargetZh := strings.HasPrefix(targetLang, "zh")

	if isTargetZh {
		key := strings.ToLower(strings.TrimSpace(tag))
		if zh, ok := enToZH[key]; ok {
			return zh
		}
		return ""
	}
	// Chinese → English
	trimmed := strings.TrimSpace(tag)
	if en, ok := zhToEN[trimmed]; ok {
		return en
	}
	return ""
}

func needsTranslation(tag, targetLang string) bool {
	isTargetZh := strings.HasPrefix(targetLang, "zh")
	tagIsChinese := isChinese(tag)

	if isTargetZh && tagIsChinese {
		return false
	}
	if !isTargetZh && !tagIsChinese {
		return false
	}
	return true
}

// translateTagsWithAI uses Cloud LLM to translate unmapped tags.
func translateTagsWithAI(tags []string, targetLang string) map[string]string {
	cfg := LoadAIConfig()
	if !cfg.EnableCloudAI || cfg.CloudAPIKey == "" {
		return nil
	}

	genreString := strings.Join(tags, ", ")
	result, err := TranslateMetadataFields(cfg, map[string]string{"genre": genreString}, targetLang)
	if err != nil || result == nil {
		return nil
	}

	translated, ok := result["genre"]
	if !ok || translated == "" {
		return nil
	}

	translatedTags := strings.Split(translated, ",")
	mapping := map[string]string{}
	for i := 0; i < len(tags) && i < len(translatedTags); i++ {
		t := strings.TrimSpace(translatedTags[i])
		if t != "" && t != tags[i] {
			mapping[tags[i]] = t
		}
	}
	return mapping
}

// TranslateTags translates all given tags to the target language.
// Returns a mapping of { originalName: translatedName }.
func TranslateTags(tagNames []string, targetLang string) map[string]string {
	result := map[string]string{}
	var unmapped []string

	for _, tag := range tagNames {
		if !needsTranslation(tag, targetLang) {
			continue
		}
		local := translateTagLocal(tag, targetLang)
		if local != "" {
			result[tag] = local
		} else {
			unmapped = append(unmapped, tag)
		}
	}

	// Use AI for unmapped tags
	if len(unmapped) > 0 {
		aiResults := translateTagsWithAI(unmapped, targetLang)
		for k, v := range aiResults {
			result[k] = v
		}
	}

	return result
}
