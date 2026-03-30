package store

import (
	"crypto/md5"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode"
)

// ============================================================
// ID 生成 (与 Node.js 保持一致: md5(filename).substring(0,12))
// ============================================================

// FilenameToID 从文件名生成稳定的 12 字符十六进制 ID。
func FilenameToID(filename string) string {
	h := md5.Sum([]byte(filename))
	return fmt.Sprintf("%x", h)[:12]
}

// FilenameToTitle 从文件名推导出标题（去掉扩展名）。
func FilenameToTitle(filename string) string {
	ext := filepath.Ext(filename)
	return strings.TrimSuffix(filename, ext)
}

// ============================================================
// Comic 变更操作
// ============================================================

// UpdateReadingProgress 更新最后阅读页码和时间戳。
// 如果 userID 不为空，同时更新 UserComicState。
func UpdateReadingProgress(comicID string, page int, userID ...string) error {
	now := time.Now().UTC()
	// 始终更新 Comic 表（全局默认值 / 向后兼容）
	_, err := db.Exec(`
		UPDATE "Comic" SET "lastReadPage" = ?, "lastReadAt" = ?, "updatedAt" = ?
		WHERE "id" = ?
	`, page, now, now, comicID)
	if err != nil {
		return err
	}
	// 更新 UserComicState
	if len(userID) > 0 && userID[0] != "" {
		_, err = db.Exec(`
			INSERT INTO "UserComicState" ("userId", "comicId", "lastReadPage", "lastReadAt")
			VALUES (?, ?, ?, ?)
			ON CONFLICT("userId", "comicId") DO UPDATE SET "lastReadPage" = ?, "lastReadAt" = ?
		`, userID[0], comicID, page, now, page, now)
	}
	return err
}

// ToggleFavorite 切换收藏状态，返回新状态。
func ToggleFavorite(comicID string, userID ...string) (bool, error) {
	uid := ""
	if len(userID) > 0 {
		uid = userID[0]
	}

	// 如果有 userID，从 UserComicState 读取当前状态
	var current int
	if uid != "" {
		err := db.QueryRow(`SELECT COALESCE("isFavorite", 0) FROM "UserComicState" WHERE "userId" = ? AND "comicId" = ?`, uid, comicID).Scan(&current)
		if err != nil {
			current = 0 // 不存在则默认未收藏
		}
	} else {
		err := db.QueryRow(`SELECT "isFavorite" FROM "Comic" WHERE "id" = ?`, comicID).Scan(&current)
		if err != nil {
			return false, err
		}
	}

	newVal := 0
	if current == 0 {
		newVal = 1
	}

	// 始终更新 Comic 表
	_, err := db.Exec(`UPDATE "Comic" SET "isFavorite" = ?, "updatedAt" = ? WHERE "id" = ?`,
		newVal, time.Now().UTC(), comicID)
	if err != nil {
		return false, err
	}

	// 更新 UserComicState
	if uid != "" {
		_, err = db.Exec(`
			INSERT INTO "UserComicState" ("userId", "comicId", "isFavorite")
			VALUES (?, ?, ?)
			ON CONFLICT("userId", "comicId") DO UPDATE SET "isFavorite" = ?
		`, uid, comicID, newVal, newVal)
		if err != nil {
			return newVal == 1, err
		}
	}

	return newVal == 1, nil
}

// UpdateRating 设置评分 (1-5 或 nil 清除)。
func UpdateRating(comicID string, rating *int, userID ...string) error {
	_, err := db.Exec(`UPDATE "Comic" SET "rating" = ?, "updatedAt" = ? WHERE "id" = ?`,
		rating, time.Now().UTC(), comicID)
	if err != nil {
		return err
	}
	if len(userID) > 0 && userID[0] != "" {
		_, err = db.Exec(`
			INSERT INTO "UserComicState" ("userId", "comicId", "rating")
			VALUES (?, ?, ?)
			ON CONFLICT("userId", "comicId") DO UPDATE SET "rating" = ?
		`, userID[0], comicID, rating, rating)
	}
	return err
}

// DeleteComic 从数据库删除漫画，可选删除磁盘文件。
// deleteFiles 为 true 时同时删除磁盘上的文件。
func DeleteComic(comicID string, comicsDirs []string, deleteFiles bool) error {
	// Get filename before deleting
	var filename string
	err := db.QueryRow(`SELECT "filename" FROM "Comic" WHERE "id" = ?`, comicID).Scan(&filename)
	if err != nil {
		return err
	}

	// Delete from DB (CASCADE handles relations)
	_, err = db.Exec(`DELETE FROM "Comic" WHERE "id" = ?`, comicID)
	if err != nil {
		return err
	}

	// Delete file from disk only if requested
	if deleteFiles {
		for _, dir := range comicsDirs {
			fp := filepath.Join(dir, filename)
			if _, err := os.Stat(fp); err == nil {
				_ = os.Remove(fp)
				break
			}
		}
	}
	return nil
}

// ============================================================
// 标签操作
// ============================================================

type TagWithCount struct {
	ID    int    `json:"id"`
	Name  string `json:"name"`
	Color string `json:"color"`
	Count int    `json:"count"`
}

// GetAllTags 返回所有标签及其漫画计数。
func GetAllTags() ([]TagWithCount, error) {
	rows, err := db.Query(`
		SELECT t."id", t."name", t."color", COUNT(ct."comicId") as cnt
		FROM "Tag" t
		LEFT JOIN "ComicTag" ct ON ct."tagId" = t."id"
		GROUP BY t."id"
		ORDER BY t."name" ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var tags []TagWithCount
	for rows.Next() {
		var t TagWithCount
		if err := rows.Scan(&t.ID, &t.Name, &t.Color, &t.Count); err != nil {
			continue
		}
		tags = append(tags, t)
	}
	if tags == nil {
		tags = []TagWithCount{}
	}
	return tags, nil
}

// AddTagsToComic 为漫画添加标签（upsert）。
func AddTagsToComic(comicID string, tagNames []string) error {
	for _, name := range tagNames {
		// Upsert tag
		_, err := db.Exec(`INSERT INTO "Tag" ("name") VALUES (?) ON CONFLICT("name") DO NOTHING`, name)
		if err != nil {
			return err
		}

		var tagID int
		err = db.QueryRow(`SELECT "id" FROM "Tag" WHERE "name" = ?`, name).Scan(&tagID)
		if err != nil {
			return err
		}

		// Link to comic
		_, err = db.Exec(`INSERT INTO "ComicTag" ("comicId", "tagId") VALUES (?, ?) ON CONFLICT DO NOTHING`,
			comicID, tagID)
		if err != nil {
			return err
		}
	}
	return nil
}

// RemoveTagFromComic 从漫画移除标签，清理孤立标签。
func RemoveTagFromComic(comicID string, tagName string) error {
	var tagID int
	err := db.QueryRow(`SELECT "id" FROM "Tag" WHERE "name" = ?`, tagName).Scan(&tagID)
	if err == sql.ErrNoRows {
		return nil // tag doesn't exist
	}
	if err != nil {
		return err
	}

	_, err = db.Exec(`DELETE FROM "ComicTag" WHERE "comicId" = ? AND "tagId" = ?`, comicID, tagID)
	if err != nil {
		return err
	}

	// Clean up orphan tag
	var count int
	_ = db.QueryRow(`SELECT COUNT(*) FROM "ComicTag" WHERE "tagId" = ?`, tagID).Scan(&count)
	if count == 0 {
		_, _ = db.Exec(`DELETE FROM "Tag" WHERE "id" = ?`, tagID)
	}
	return nil
}

// ClearAllTagsFromComic 一次性清除漫画的所有标签，并清理孤立标签。
func ClearAllTagsFromComic(comicID string) error {
	// 先获取该漫画关联的所有 tagId
	rows, err := db.Query(`SELECT "tagId" FROM "ComicTag" WHERE "comicId" = ?`, comicID)
	if err != nil {
		return err
	}
	var tagIDs []int
	for rows.Next() {
		var id int
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		tagIDs = append(tagIDs, id)
	}
	rows.Close()

	if len(tagIDs) == 0 {
		return nil
	}

	// 批量删除关联记录
	_, err = db.Exec(`DELETE FROM "ComicTag" WHERE "comicId" = ?`, comicID)
	if err != nil {
		return err
	}

	// 清理孤立标签（没有被任何漫画引用的标签）
	for _, tagID := range tagIDs {
		var count int
		_ = db.QueryRow(`SELECT COUNT(*) FROM "ComicTag" WHERE "tagId" = ?`, tagID).Scan(&count)
		if count == 0 {
			_, _ = db.Exec(`DELETE FROM "Tag" WHERE "id" = ?`, tagID)
		}
	}
	return nil
}

// UpdateTagColor 更新标签颜色。
func UpdateTagColor(tagName, color string) error {
	_, err := db.Exec(`UPDATE "Tag" SET "color" = ? WHERE "name" = ?`, color, tagName)
	return err
}

// DeleteTag 删除标签及其所有关联（从所有漫画移除此标签）。
func DeleteTag(tagName string) error {
	var tagID int
	err := db.QueryRow(`SELECT "id" FROM "Tag" WHERE "name" = ?`, tagName).Scan(&tagID)
	if err != nil {
		return nil // tag doesn't exist
	}
	_, _ = db.Exec(`DELETE FROM "ComicTag" WHERE "tagId" = ?`, tagID)
	_, err = db.Exec(`DELETE FROM "Tag" WHERE "id" = ?`, tagID)
	return err
}

// RenameTag 重命名标签，目标标签已存在时自动合并。
func RenameTag(oldName, newName string) error {
	// Check if target tag exists
	var existingID int
	err := db.QueryRow(`SELECT "id" FROM "Tag" WHERE "name" = ?`, newName).Scan(&existingID)

	var oldID int
	err2 := db.QueryRow(`SELECT "id" FROM "Tag" WHERE "name" = ?`, oldName).Scan(&oldID)
	if err2 != nil {
		return nil // old tag doesn't exist
	}

	if err == sql.ErrNoRows {
		// Simple rename
		_, err = db.Exec(`UPDATE "Tag" SET "name" = ? WHERE "id" = ?`, newName, oldID)
		return err
	}

	// Target exists: merge
	_, _ = db.Exec(`
		UPDATE OR IGNORE "ComicTag" SET "tagId" = ? WHERE "tagId" = ?
	`, existingID, oldID)
	_, _ = db.Exec(`DELETE FROM "ComicTag" WHERE "tagId" = ?`, oldID)
	_, _ = db.Exec(`DELETE FROM "Tag" WHERE "id" = ?`, oldID)
	return nil
}

// ============================================================
// 分类操作
// ============================================================

type CategoryWithCount struct {
	ID    int    `json:"id"`
	Name  string `json:"name"`
	Slug  string `json:"slug"`
	Icon  string `json:"icon"`
	Count int    `json:"count"`
}

// GetAllCategories 返回所有分类及其漫画计数。
func GetAllCategories() ([]CategoryWithCount, error) {
	rows, err := db.Query(`
		SELECT cat."id", cat."name", cat."slug", cat."icon", COUNT(cc."comicId") as cnt
		FROM "Category" cat
		LEFT JOIN "ComicCategory" cc ON cc."categoryId" = cat."id"
		GROUP BY cat."id"
		ORDER BY cat."sortOrder" ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var cats []CategoryWithCount
	for rows.Next() {
		var c CategoryWithCount
		if err := rows.Scan(&c.ID, &c.Name, &c.Slug, &c.Icon, &c.Count); err != nil {
			continue
		}
		cats = append(cats, c)
	}
	if cats == nil {
		cats = []CategoryWithCount{}
	}
	return cats, nil
}

// PredefinedCategory 表示一个预定义分类。
type PredefinedCategory struct {
	Slug   string
	Icon   string
	NameZH string
	NameEN string
}

// PredefinedCategories 是 24 个预定义分类列表。
var PredefinedCategories = []PredefinedCategory{
	{Slug: "romance", Icon: "💕", NameZH: "恋爱", NameEN: "Romance"},
	{Slug: "action", Icon: "⚔️", NameZH: "动作", NameEN: "Action"},
	{Slug: "fantasy", Icon: "🔮", NameZH: "奇幻", NameEN: "Fantasy"},
	{Slug: "comedy", Icon: "😂", NameZH: "搞笑", NameEN: "Comedy"},
	{Slug: "drama", Icon: "🎭", NameZH: "剧情", NameEN: "Drama"},
	{Slug: "horror", Icon: "👻", NameZH: "恐怖", NameEN: "Horror"},
	{Slug: "thriller", Icon: "😱", NameZH: "惊悚", NameEN: "Thriller"},
	{Slug: "mystery", Icon: "🔍", NameZH: "悬疑", NameEN: "Mystery"},
	{Slug: "slice-of-life", Icon: "☀️", NameZH: "日常", NameEN: "Slice of Life"},
	{Slug: "school", Icon: "🏫", NameZH: "校园", NameEN: "School"},
	{Slug: "sci-fi", Icon: "🚀", NameZH: "科幻", NameEN: "Sci-Fi"},
	{Slug: "sports", Icon: "⚽", NameZH: "运动", NameEN: "Sports"},
	{Slug: "historical", Icon: "📜", NameZH: "历史", NameEN: "Historical"},
	{Slug: "isekai", Icon: "🌀", NameZH: "异世界", NameEN: "Isekai"},
	{Slug: "mecha", Icon: "🤖", NameZH: "机甲", NameEN: "Mecha"},
	{Slug: "supernatural", Icon: "✨", NameZH: "超自然", NameEN: "Supernatural"},
	{Slug: "martial-arts", Icon: "🥋", NameZH: "武侠", NameEN: "Martial Arts"},
	{Slug: "shounen", Icon: "👦", NameZH: "少年", NameEN: "Shounen"},
	{Slug: "shoujo", Icon: "👧", NameZH: "少女", NameEN: "Shoujo"},
	{Slug: "seinen", Icon: "🧑", NameZH: "青年", NameEN: "Seinen"},
	{Slug: "josei", Icon: "👩", NameZH: "女性", NameEN: "Josei"},
	{Slug: "adventure", Icon: "🗺️", NameZH: "冒险", NameEN: "Adventure"},
	{Slug: "psychological", Icon: "🧠", NameZH: "心理", NameEN: "Psychological"},
	{Slug: "gourmet", Icon: "🍜", NameZH: "美食", NameEN: "Gourmet"},
}

// InitCategories 初始化所有预定义分类（upsert）。
func InitCategories(lang string) error {
	isZH := strings.HasPrefix(lang, "zh")
	for i, cat := range PredefinedCategories {
		name := cat.NameEN
		if isZH {
			name = cat.NameZH
		}
		_, err := db.Exec(`
			INSERT INTO "Category" ("name", "slug", "icon", "sortOrder")
			VALUES (?, ?, ?, ?)
			ON CONFLICT("slug") DO UPDATE SET "icon" = ?, "sortOrder" = ?
		`, name, cat.Slug, cat.Icon, i, cat.Icon, i)
		if err != nil {
			return err
		}
	}
	return nil
}

// AddCategoriesToComic 通过 slug 为漫画添加分类。
func AddCategoriesToComic(comicID string, categorySlugs []string) error {
	for _, slug := range categorySlugs {
		var catID int
		err := db.QueryRow(`SELECT "id" FROM "Category" WHERE "slug" = ?`, slug).Scan(&catID)
		if err == sql.ErrNoRows {
			name := slug
			icon := "📚"
			sortOrder := 999
			for _, pc := range PredefinedCategories {
				if pc.Slug == slug {
					name = pc.NameZH
					icon = pc.Icon
					break
				}
			}
			res, err := db.Exec(`INSERT INTO "Category" ("name", "slug", "icon", "sortOrder") VALUES (?, ?, ?, ?)`,
				name, slug, icon, sortOrder)
			if err != nil {
				return err
			}
			id, _ := res.LastInsertId()
			catID = int(id)
		} else if err != nil {
			return err
		}

		_, err = db.Exec(`INSERT INTO "ComicCategory" ("comicId", "categoryId") VALUES (?, ?) ON CONFLICT DO NOTHING`,
			comicID, catID)
		if err != nil {
			return err
		}
	}
	return nil
}

// RemoveCategoryFromComic 从漫画移除分类。
func RemoveCategoryFromComic(comicID, categorySlug string) error {
	var catID int
	err := db.QueryRow(`SELECT "id" FROM "Category" WHERE "slug" = ?`, categorySlug).Scan(&catID)
	if err != nil {
		return nil
	}
	_, err = db.Exec(`DELETE FROM "ComicCategory" WHERE "comicId" = ? AND "categoryId" = ?`, comicID, catID)
	return err
}

// SetComicCategories 替换漫画的所有分类。
func SetComicCategories(comicID string, categorySlugs []string) error {
	_, err := db.Exec(`DELETE FROM "ComicCategory" WHERE "comicId" = ?`, comicID)
	if err != nil {
		return err
	}
	if len(categorySlugs) > 0 {
		return AddCategoriesToComic(comicID, categorySlugs)
	}
	return nil
}

// UpdateCategory 更新分类的名称和图标。
func UpdateCategory(slug, name, icon string) error {
	sets := []string{}
	args := []interface{}{}
	if name != "" {
		sets = append(sets, `"name" = ?`)
		args = append(args, name)
	}
	if icon != "" {
		sets = append(sets, `"icon" = ?`)
		args = append(args, icon)
	}
	if len(sets) == 0 {
		return nil
	}
	args = append(args, slug)
	query := fmt.Sprintf(`UPDATE "Category" SET %s WHERE "slug" = ?`, strings.Join(sets, ", "))
	_, err := db.Exec(query, args...)
	return err
}

// DeleteCategory 删除分类及其所有漫画关联。
func DeleteCategory(slug string) error {
	var catID int
	err := db.QueryRow(`SELECT "id" FROM "Category" WHERE "slug" = ?`, slug).Scan(&catID)
	if err != nil {
		return nil // doesn't exist
	}
	_, _ = db.Exec(`DELETE FROM "ComicCategory" WHERE "categoryId" = ?`, catID)
	_, err = db.Exec(`DELETE FROM "Category" WHERE "id" = ?`, catID)
	return err
}

// ============================================================
// 辅助函数
// ============================================================

// normalizeTitle 标准化标题用于比较。
// 增强版：提取核心标题，去除卷号、扫图组、作者等元信息。
// 支持繁简体归一化，确保 "进击的巨人" 和 "進擊的巨人" 可以匹配。
func normalizeTitle(title string) string {
	// 第一步：如果包含方括号或圆括号，尝试提取核心书名部分
	core := extractCoreTitle(title)
	if core == "" {
		core = title
	}

	// 第二步：去除常见卷号后缀模式（在小写化之前处理中文模式）
	core = removeVolumePatterns(core)

	// 第三步：繁简体归一化（将繁体转为简体）
	core = toSimplified(core)

	// 第四步：统一小写，去除标点和空白
	s := strings.ToLower(core)
	replacer := strings.NewReplacer(" ", "", "_", "", "-", "", ".", "", "~", "", "　", "")
	s = replacer.Replace(s)

	// 去掉残留的括号字符
	for _, ch := range []string{"(", ")", "[", "]", "{", "}", "【", "】", "（", "）", "「", "」", "『", "』"} {
		s = strings.ReplaceAll(s, ch, "")
	}

	// 只去掉末尾 1-3 位数字（卷号），保留 4 位及以上的数字（可能是年份）
	// 【P2修复】使用 rune 遍历而非字节遍历，确保 Unicode 字符安全
	runes := []rune(s)
	trailingDigits := 0
	for i := len(runes) - 1; i >= 0; i-- {
		if unicode.IsDigit(runes[i]) {
			trailingDigits++
			continue
		}
		break
	}
	if trailingDigits >= 1 && trailingDigits <= 3 {
		s = string(runes[:len(runes)-trailingDigits])
	}

	return strings.TrimSpace(s)
}

// extractCoreTitle 从包含方括号/圆括号的文件名中提取核心标题。
// 典型格式:
//   - "[扫图组][作品名01][作者][出版社]" → "作品名01"
//   - "[Group] Title Vol.01 [Author]" → "Title Vol.01"
//   - "佛陀(01)" → "佛陀(01)"  (圆括号保留供后续卷号处理)
//   - "(出版社)作品名[版本]" → "作品名"
//   - "作品名 第3巻" → "作品名 第3巻" (无括号直接返回)
func extractCoreTitle(title string) string {
	if !strings.ContainsAny(title, "[]【】「」『』()（）") {
		return title
	}

	// 分割出括号内外的所有部分（支持方括号和圆括号）
	type segment struct {
		text      string
		inBracket bool
	}
	var segments []segment
	inBracket := false
	var current strings.Builder
	for _, r := range title {
		switch r {
		case '[', '【', '「', '『', '(', '（':
			if current.Len() > 0 {
				segments = append(segments, segment{text: strings.TrimSpace(current.String()), inBracket: inBracket})
				current.Reset()
			}
			inBracket = true
		case ']', '】', '」', '』', ')', '）':
			if current.Len() > 0 {
				segments = append(segments, segment{text: strings.TrimSpace(current.String()), inBracket: inBracket})
				current.Reset()
			}
			inBracket = false
		default:
			current.WriteRune(r)
		}
	}
	if current.Len() > 0 {
		segments = append(segments, segment{text: strings.TrimSpace(current.String()), inBracket: inBracket})
	}

	// 策略：找含卷号的CJK部分（最高优先级）→ 最长CJK部分 → 最长非标签部分
	type candidate struct {
		text     string
		score    int // 越高越好
		cjkCount int
	}
	var candidates []candidate
	for _, seg := range segments {
		t := strings.TrimSpace(seg.text)
		if t == "" {
			continue
		}
		lp := strings.ToLower(t)
		// 跳过明显的标签
		if lp == "comic" || lp == "manga" || lp == "漫画" || lp == "同人" {
			continue
		}
		// 跳过看起来是编号的短字符串
		if isLikelyCode(t) {
			continue
		}

		cc := cjkRuneCount(t)
		score := cc * 10 // CJK 字符加权

		// 含卷号的加分（说明是书名+卷号组合）
		if hasVolumeIndicator(t) {
			score += 50
		}

		// 方括号外的长文本更可能是标题
		if !seg.inBracket {
			score += 20
		}

		candidates = append(candidates, candidate{text: t, score: score, cjkCount: cc})
	}

	if len(candidates) == 0 {
		return title
	}

	// 选分数最高的
	best := candidates[0]
	for _, c := range candidates[1:] {
		if c.score > best.score {
			best = c
		}
	}
	return best.text
}

// hasVolumeIndicator 检查字符串是否包含卷号指示符
func hasVolumeIndicator(s string) bool {
	lower := strings.ToLower(s)
	indicators := []string{
		"vol.", "vol ", "volume", " v0", " v1", " v2", " v3", " v4", " v5", " v6", " v7", " v8", " v9",
		"第", "巻", "巻", "卷", "集", "話", "话", "册", "編", "编",
		" ch.", " ch ", "chapter",
	}
	for _, ind := range indicators {
		if strings.Contains(lower, ind) {
			return true
		}
	}
	// 末尾跟着数字
	trimmed := strings.TrimSpace(s)
	if len(trimmed) > 0 {
		last := trimmed[len(trimmed)-1]
		if last >= '0' && last <= '9' {
			return true
		}
	}
	return false
}

// removeVolumePatterns 去除常见的卷号/话号后缀模式。
// 【P0增强】支持圆括号卷号、无空格中文卷号、#号格式、日文卷标等。
func removeVolumePatterns(s string) string {
	lower := strings.ToLower(s)

	// ── 模式1: 带空格分隔的卷号关键词 ──
	spacePatterns := []string{
		" volume ", " vol.", " vol ",
		" chapter ", " ch.", " ch ",
		" 第", // 第X卷/第X巻/第X集/第X話
		" 卷", // 卷X
		" 巻", // 巻X（日文）
		" #", // #127
	}
	for _, p := range spacePatterns {
		idx := strings.LastIndex(lower, p)
		if idx > 0 {
			return strings.TrimSpace(s[:idx])
		}
	}

	// ── 模式2: 无空格中文卷号（需要用 rune 处理）──
	// 匹配: "进击的巨人第5卷" "火影忍者卷十二" "ナルト第12巻"
	runes := []rune(s)
	for i, r := range runes {
		if r == '第' && i > 0 {
			// "第" 后面跟数字或中文数字，说明是卷号
			if i+1 < len(runes) && isChineseNumOrDigit(runes[i+1]) {
				return strings.TrimSpace(string(runes[:i]))
			}
		}
		if (r == '卷' || r == '巻') && i > 0 {
			// "卷/巻" 后面跟数字，说明前面是书名后面是卷号
			if i+1 < len(runes) && isChineseNumOrDigit(runes[i+1]) {
				return strings.TrimSpace(string(runes[:i]))
			}
			// "卷/巻" 前面是数字，说明 "X卷" 是卷号后缀
			if unicode.IsDigit(runes[i-1]) || isChineseNumChar(runes[i-1]) {
				// 向前找到卷号起始位置
				j := i - 1
				for j > 0 && (unicode.IsDigit(runes[j-1]) || isChineseNumChar(runes[j-1])) {
					j--
				}
				result := strings.TrimSpace(string(runes[:j]))
				if result != "" {
					return result
				}
			}
		}
	}

	// ── 模式3: 圆括号卷号 ──
	// "佛陀(01)" "作品名（第5卷）" "Title (Vol.3)"
	for _, pair := range [][2]string{{"(", ")"}, {"（", "）"}} {
		lastOpen := strings.LastIndex(s, pair[0])
		if lastOpen > 0 {
			closeIdx := strings.Index(s[lastOpen:], pair[1])
			if closeIdx > 0 {
				inside := s[lastOpen+len(pair[0]) : lastOpen+closeIdx]
				if looksLikeVolumeNumber(inside) {
					return strings.TrimSpace(s[:lastOpen])
				}
			}
		}
	}

	// ── 模式4: #号格式 (无空格)──
	// "Batman#127" "X-Men#001"
	hashIdx := strings.LastIndex(lower, "#")
	if hashIdx > 0 {
		after := lower[hashIdx+1:]
		if len(after) > 0 && after[0] >= '0' && after[0] <= '9' {
			return strings.TrimSpace(s[:hashIdx])
		}
	}

	// ── 模式5: "_v01" "v01" 模式（v + 数字）──
	for i := len(lower) - 1; i >= 1; i-- {
		if lower[i] >= '0' && lower[i] <= '9' {
			continue
		}
		if lower[i] == 'v' && i > 0 && (lower[i-1] == ' ' || lower[i-1] == '_' || lower[i-1] == '-' || lower[i-1] == '.') {
			digitLen := len(lower) - 1 - i
			if digitLen >= 1 && digitLen <= 3 {
				return strings.TrimSpace(s[:i-1])
			}
		}
		break
	}

	return s
}

// looksLikeVolumeNumber 判断括号内的内容是否像卷号。
// 匹配: "01" "第5卷" "Vol.3" "Volume 12" "#127" 等
func looksLikeVolumeNumber(s string) bool {
	s = strings.TrimSpace(s)
	if s == "" {
		return false
	}
	l := strings.ToLower(s)

	// 纯数字
	allDigit := true
	for _, r := range s {
		if !unicode.IsDigit(r) {
			allDigit = false
			break
		}
	}
	if allDigit {
		return true
	}

	// 以 "第" 开头 或 以 "卷/巻/集/話/话/册" 结尾
	if strings.HasPrefix(s, "第") {
		return true
	}
	for _, suffix := range []string{"卷", "巻", "集", "話", "话", "册", "編", "编"} {
		if strings.HasSuffix(s, suffix) {
			return true
		}
	}

	// Vol / Volume / Chapter / Ch 开头
	for _, prefix := range []string{"vol", "volume", "chapter", "ch", "#"} {
		if strings.HasPrefix(l, prefix) {
			return true
		}
	}

	return false
}

// isChineseNumOrDigit 判断字符是否为阿拉伯数字或中文数字
func isChineseNumOrDigit(r rune) bool {
	return unicode.IsDigit(r) || isChineseNumChar(r)
}

// isChineseNumChar 判断字符是否为中文数字字符
func isChineseNumChar(r rune) bool {
	switch r {
	case '一', '二', '三', '四', '五', '六', '七', '八', '九', '十',
		'零', '百', '千', '万', '壱', '弐', '参', '壹', '贰', '叁',
		'肆', '伍', '陆', '柒', '捌', '玖', '拾':
		return true
	}
	return false
}

// LevenshteinDistance 计算两个字符串的编辑距离（用于模糊匹配）
func LevenshteinDistance(a, b string) int {
	ra := []rune(a)
	rb := []rune(b)
	la, lb := len(ra), len(rb)
	if la == 0 {
		return lb
	}
	if lb == 0 {
		return la
	}

	// 使用单行 DP 优化空间
	prev := make([]int, lb+1)
	curr := make([]int, lb+1)
	for j := 0; j <= lb; j++ {
		prev[j] = j
	}
	for i := 1; i <= la; i++ {
		curr[0] = i
		for j := 1; j <= lb; j++ {
			cost := 1
			if ra[i-1] == rb[j-1] {
				cost = 0
			}
			curr[j] = min(curr[j-1]+1, min(prev[j]+1, prev[j-1]+cost))
		}
		prev, curr = curr, prev
	}
	return prev[lb]
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}

// isCJKRune 判断单个字符是否为CJK字符（中日韩统一表意文字 + 平假名 + 片假名 + 韩文）。
func isCJKRune(r rune) bool {
	return (r >= 0x4E00 && r <= 0x9FFF) || // CJK Unified Ideographs
		(r >= 0x3040 && r <= 0x30FF) || // Hiragana + Katakana
		(r >= 0xAC00 && r <= 0xD7A3) // Korean
}

// ============================================================
// 繁简体转换（P1: 漫画标题归一化）
// ============================================================

// toSimplified 将字符串中的繁体中文转为简体中文。
// 使用高频漫画常用汉字映射表，覆盖常见的繁简差异。
func toSimplified(s string) string {
	var builder strings.Builder
	builder.Grow(len(s))
	for _, r := range s {
		if mapped, ok := traditionalToSimplifiedMap[r]; ok {
			builder.WriteRune(mapped)
		} else {
			builder.WriteRune(r)
		}
	}
	return builder.String()
}

// traditionalToSimplifiedMap 繁体→简体映射表。
// 包含漫画/小说标题中高频出现的繁简差异字。
var traditionalToSimplifiedMap = map[rune]rune{
	// 常用动词/动作
	'進': '进', '擊': '击', '戰': '战', '鬥': '斗', '殺': '杀', '滅': '灭',
	'開': '开', '關': '关', '衝': '冲', '動': '动', '運': '运', '發': '发',
	'變': '变', '護': '护', '與': '与', '覺': '觉', '學': '学', '練': '练',
	'飛': '飞', '轉': '转', '過': '过', '還': '还', '選': '选', '認': '认',
	'說': '说', '話': '话', '請': '请', '讓': '让', '記': '记', '設': '设',
	'試': '试', '該': '该', '調': '调', '論': '论', '證': '证', '識': '识',
	'讀': '读', '譯': '译', '議': '议', '許': '许', '訂': '订', '計': '计',
	'報': '报', '書': '书', '買': '买', '賣': '卖', '質': '质', '賞': '赏',

	// 常用名词
	'龍': '龙', '鳳': '凤', '馬': '马', '魚': '鱼', '鳥': '鸟', '貓': '猫',
	'獸': '兽', '靈': '灵', '寶': '宝', '劍': '剑', '鎧': '铠', '銃': '铳',
	'彈': '弹', '國': '国', '園': '园', '場': '场', '門': '门', '東': '东',
	'風': '风', '雲': '云', '電': '电', '體': '体', '頭': '头', '臉': '脸',
	'聲': '声', '業': '业', '專': '专', '號': '号', '點': '点', '邊': '边',
	'車': '车', '軍': '军', '陣': '阵', '隊': '队', '階': '阶', '職': '职',
	'齒': '齿', '歲': '岁', '島': '岛', '嶺': '岭', '廳': '厅', '廠': '厂',

	// 常用形容词/副词
	'強': '强', '聖': '圣', '無': '无', '亂': '乱',
	'難': '难', '雙': '双', '單': '单', '極': '极', '終': '终', '絕': '绝',
	'獨': '独', '總': '总', '當': '当', '長': '长', '廣': '广', '萬': '万',
	'後': '后', '復': '复', '遠': '远', '華': '华', '麗': '丽', '歡': '欢',

	// 常用人称/代词
	'個': '个', '們': '们', '誰': '谁', '對': '对', '從': '从', '將': '将',

	// 漫画/小说特有高频字
	'傳': '传', '俠': '侠', '賊': '贼', '盜': '盗', '獵': '猎', '衛': '卫',
	'術': '术', '藝': '艺', '創': '创', '禦': '御', '導': '导', '師': '师',
	'網': '网', '織': '织', '紀': '纪', '約': '约', '綫': '线', '線': '线',
	'續': '续', '結': '结', '組': '组', '編': '编', '紅': '红', '綠': '绿',
	'藍': '蓝', '銀': '银', '鐵': '铁', '鋼': '钢', '銅': '铜', '鑽': '钻',
	'機': '机', '義': '义', '會': '会', '間': '间', '經': '经',
	'裝': '装', '見': '见', '親': '亲', '觀': '观', '現': '现', '歷': '历',
	'殘': '残', '價': '价', '億': '亿', '際': '际', '陰': '阴', '陽': '阳',
	'靜': '静', '響': '响', '頂': '顶', '須': '须', '預': '预', '領': '领',
	'題': '题', '騎': '骑', '驅': '驱', '驚': '惊', '願': '愿', '類': '类',
	'異': '异', '範': '范', '築': '筑', '齊': '齐', '實': '实', '寫': '写',
}
