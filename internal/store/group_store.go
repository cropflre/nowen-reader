package store

import (
	"database/sql"
	"fmt"
	"log"
	"path"
	"sort"
	"strings"
	"time"
	"unicode"
)

// firstString 从可变参数中安全取第一个字符串值。
func firstString(s []string) string {
	if len(s) > 0 {
		return s[0]
	}
	return ""
}

// ============================================================
// ComicGroup CRUD
// ============================================================

// ComicGroupWithCount 返回系列信息及其漫画数量。
type ComicGroupWithCount struct {
	ID          int    `json:"id"`
	Name        string `json:"name"`
	CoverURL    string `json:"coverUrl"`
	SortOrder   int    `json:"sortOrder"`
	Author      string `json:"author"`
	Description string `json:"description"`
	Tags        string `json:"tags"`
	Year        *int   `json:"year"`
	Publisher   string `json:"publisher"`
	Language    string `json:"language"`
	Genre       string `json:"genre"`
	Status      string `json:"status"`
	CreatedAt   string `json:"createdAt"`
	UpdatedAt   string `json:"updatedAt"`
	ComicCount  int    `json:"comicCount"`
}

// ComicGroupDetail 包含系列详情和所属漫画列表。
type ComicGroupDetail struct {
	ID          int              `json:"id"`
	Name        string           `json:"name"`
	CoverURL    string           `json:"coverUrl"`
	SortOrder   int              `json:"sortOrder"`
	Author      string           `json:"author"`
	Description string           `json:"description"`
	Tags        string           `json:"tags"`
	Year        *int             `json:"year"`
	Publisher   string           `json:"publisher"`
	Language    string           `json:"language"`
	Genre       string           `json:"genre"`
	Status      string           `json:"status"`
	CreatedAt   string           `json:"createdAt"`
	UpdatedAt   string           `json:"updatedAt"`
	ComicCount  int              `json:"comicCount"`
	Comics      []GroupComicItem `json:"comics"`
}

// GroupComicItem 分组内的漫画条目。
type GroupComicItem struct {
	ComicID       string  `json:"id"`
	Filename      string  `json:"filename"`
	Title         string  `json:"title"`
	PageCount     int     `json:"pageCount"`
	FileSize      int64   `json:"fileSize"`
	LastReadPage  int     `json:"lastReadPage"`
	TotalReadTime int     `json:"totalReadTime"`
	CoverURL      string  `json:"coverUrl"`
	SortIndex     int     `json:"sortIndex"`
	ReadingStatus string  `json:"readingStatus"`
	LastReadAt    *string `json:"lastReadAt"`
	ComicType     string  `json:"type"`
}

// GroupListOptions 分组列表查询选项。
type GroupListOptions struct {
	UserID      string // 用户ID过滤
	ContentType string // 内容类型过滤: "comic" | "novel" | "" (全部)
}

// GetAllGroups 获取所有分组（带漫画数量）。
// 如果提供了 userID，只返回该用户的分组。
// 如果提供了 contentType，只返回包含该类型漫画的分组。
func GetAllGroups(userID ...string) ([]ComicGroupWithCount, error) {
	return GetAllGroupsWithOptions(GroupListOptions{
		UserID: firstString(userID),
	})
}

// GetAllGroupsWithOptions 获取所有分组（带漫画数量），支持更多过滤选项。
// 当指定 ContentType 时，只返回包含该类型漫画的分组，且 comicCount 只统计该类型的数量。
// 注意：分组是全局资源，所有已登录用户都能看到所有分组（不按 userId 过滤），只有管理员能修改。
func GetAllGroupsWithOptions(opts GroupListOptions) ([]ComicGroupWithCount, error) {
	var conditions []string
	var args []interface{}
	// P0修复：不再按 userId 过滤分组列表，所有用户都能看到所有分组
	// 旧逻辑会导致成员用户看不到管理员创建的分组
	// contentType 过滤：只返回至少包含一本指定类型漫画的分组
	if opts.ContentType == "comic" || opts.ContentType == "novel" {
		conditions = append(conditions, `g."id" IN (
			SELECT DISTINCT gi2."groupId" FROM "ComicGroupItem" gi2
			JOIN "Comic" c2 ON c2."id" = gi2."comicId"
			WHERE c2."type" = ?
		)`)
		args = append(args, opts.ContentType)
	}

	whereClause := ""
	if len(conditions) > 0 {
		whereClause = " WHERE " + strings.Join(conditions, " AND ")
	}

	// 当指定 contentType 时，JOIN 中也要按类型过滤，确保 comicCount 只统计该类型的漫画
	joinClause := `LEFT JOIN "ComicGroupItem" gi ON gi."groupId" = g."id"`
	if opts.ContentType == "comic" || opts.ContentType == "novel" {
		joinClause = `LEFT JOIN ("ComicGroupItem" gi INNER JOIN "Comic" ct ON ct."id" = gi."comicId" AND ct."type" = ?) ON gi."groupId" = g."id"`
		// 将 contentType 参数插入到 args 的最前面（因为 JOIN 子句在 WHERE 之前解析）
		args = append([]interface{}{opts.ContentType}, args...)
	}

	rows, err := db.Query(`
		SELECT g."id", g."name", g."coverUrl", g."sortOrder",
		       g."author", g."description", g."tags", g."year",
		       g."publisher", g."language", g."genre", g."status",
		       g."createdAt", g."updatedAt",
		       COUNT(gi."comicId") as comicCount
		FROM "ComicGroup" g
		`+joinClause+`
	`+whereClause+`
		GROUP BY g."id"
		ORDER BY g."sortOrder" ASC, g."name" ASC
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var groups []ComicGroupWithCount
	for rows.Next() {
		var g ComicGroupWithCount
		var createdAt, updatedAt time.Time
		if err := rows.Scan(&g.ID, &g.Name, &g.CoverURL, &g.SortOrder,
			&g.Author, &g.Description, &g.Tags, &g.Year,
			&g.Publisher, &g.Language, &g.Genre, &g.Status,
			&createdAt, &updatedAt, &g.ComicCount); err != nil {
			continue
		}
		g.CreatedAt = createdAt.UTC().Format(time.RFC3339)
		g.UpdatedAt = updatedAt.UTC().Format(time.RFC3339)
		// 如果没有自定义封面，使用第一本漫画的缩略图
		if g.CoverURL == "" && g.ComicCount > 0 {
			var firstComicID string
			err := db.QueryRow(`
				SELECT gi."comicId" FROM "ComicGroupItem" gi
				WHERE gi."groupId" = ? ORDER BY gi."sortIndex" ASC LIMIT 1
			`, g.ID).Scan(&firstComicID)
			if err == nil {
				g.CoverURL = fmt.Sprintf("/api/comics/%s/thumbnail", firstComicID)
			}
		}
		groups = append(groups, g)
	}
	if groups == nil {
		groups = []ComicGroupWithCount{}
	}
	return groups, nil
}

// GetGroupByID 获取单个分组详情（含漫画列表）。
// 可选 contentType 参数：传入 "comic" 或 "novel" 时只返回对应类型的漫画，comicCount 也只统计该类型。
func GetGroupByID(groupID int, contentType ...string) (*ComicGroupDetail, error) {
	var g ComicGroupDetail
	var createdAt, updatedAt time.Time

	// 根据 contentType 决定 comicCount 子查询是否带类型过滤
	countSubQuery := `(SELECT COUNT(*) FROM "ComicGroupItem" WHERE "groupId" = g."id")`
	var countArgs []interface{}
	cType := firstString(contentType)
	if cType == "comic" || cType == "novel" {
		countSubQuery = `(SELECT COUNT(*) FROM "ComicGroupItem" gi2 JOIN "Comic" c2 ON c2."id" = gi2."comicId" WHERE gi2."groupId" = g."id" AND c2."type" = ?)`
		countArgs = append(countArgs, cType)
	}

	queryArgs := append(countArgs, groupID)
	err := db.QueryRow(`
		SELECT g."id", g."name", g."coverUrl", g."sortOrder",
		       g."author", g."description", g."tags", g."year",
		       g."publisher", g."language", g."genre", g."status",
		       g."createdAt", g."updatedAt",
		       `+countSubQuery+` as comicCount
		FROM "ComicGroup" g WHERE g."id" = ?
	`, queryArgs...).Scan(&g.ID, &g.Name, &g.CoverURL, &g.SortOrder,
		&g.Author, &g.Description, &g.Tags, &g.Year,
		&g.Publisher, &g.Language, &g.Genre, &g.Status,
		&createdAt, &updatedAt, &g.ComicCount)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	g.CreatedAt = createdAt.UTC().Format(time.RFC3339)
	g.UpdatedAt = updatedAt.UTC().Format(time.RFC3339)

	// 获取分组内的漫画（按 contentType 过滤）
	comicSQL := `
		SELECT c."id", c."filename", c."title", c."pageCount", c."fileSize",
		       c."lastReadPage", c."totalReadTime", c."readingStatus", c."lastReadAt",
		       gi."sortIndex", COALESCE(c."type", '') as "type"
		FROM "ComicGroupItem" gi
		JOIN "Comic" c ON c."id" = gi."comicId"
		WHERE gi."groupId" = ?`
	var comicArgs []interface{}
	comicArgs = append(comicArgs, groupID)
	if cType == "comic" || cType == "novel" {
		comicSQL += ` AND c."type" = ?`
		comicArgs = append(comicArgs, cType)
	}
	comicSQL += ` ORDER BY gi."sortIndex" ASC`

	rows, err := db.Query(comicSQL, comicArgs...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	g.Comics = []GroupComicItem{}
	for rows.Next() {
		var item GroupComicItem
		var lastReadAt sql.NullTime
		if err := rows.Scan(
			&item.ComicID, &item.Filename, &item.Title, &item.PageCount, &item.FileSize,
			&item.LastReadPage, &item.TotalReadTime, &item.ReadingStatus, &lastReadAt,
			&item.SortIndex, &item.ComicType,
		); err != nil {
			continue
		}
		item.CoverURL = fmt.Sprintf("/api/comics/%s/thumbnail", item.ComicID)
		if lastReadAt.Valid {
			s := lastReadAt.Time.UTC().Format(time.RFC3339)
			item.LastReadAt = &s
		}
		g.Comics = append(g.Comics, item)
	}

	// 如果没有自定义封面，使用第一本漫画的缩略图
	if g.CoverURL == "" && len(g.Comics) > 0 {
		g.CoverURL = g.Comics[0].CoverURL
	}

	return &g, nil
}

// CreateGroup 创建一个新分组。
func CreateGroup(name string, userID ...string) (int64, error) {
	now := time.Now().UTC()
	uid := ""
	if len(userID) > 0 {
		uid = userID[0]
	}
	res, err := db.Exec(`
		INSERT INTO "ComicGroup" ("name", "userId", "createdAt", "updatedAt")
		VALUES (?, ?, ?, ?)
	`, name, uid, now, now)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// UpdateGroup 更新分组名称和封面。
func UpdateGroup(groupID int, name string, coverURL string) error {
	_, err := db.Exec(`
		UPDATE "ComicGroup" SET "name" = ?, "coverUrl" = ?, "updatedAt" = ?
		WHERE "id" = ?
	`, name, coverURL, time.Now().UTC(), groupID)
	return err
}

// GroupMetadataUpdate 系列元数据更新请求。
type GroupMetadataUpdate struct {
	Name        *string `json:"name"`
	CoverURL    *string `json:"coverUrl"`
	Author      *string `json:"author"`
	Description *string `json:"description"`
	Tags        *string `json:"tags"`
	Year        *int    `json:"year"`
	Publisher   *string `json:"publisher"`
	Language    *string `json:"language"`
	Genre       *string `json:"genre"`
	Status      *string `json:"status"`
}

// UpdateGroupMetadata 更新系列的元数据字段。
func UpdateGroupMetadata(groupID int, update GroupMetadataUpdate) error {
	var setClauses []string
	var args []interface{}

	if update.Name != nil {
		setClauses = append(setClauses, `"name" = ?`)
		args = append(args, *update.Name)
	}
	if update.CoverURL != nil {
		setClauses = append(setClauses, `"coverUrl" = ?`)
		args = append(args, *update.CoverURL)
	}
	if update.Author != nil {
		setClauses = append(setClauses, `"author" = ?`)
		args = append(args, *update.Author)
	}
	if update.Description != nil {
		setClauses = append(setClauses, `"description" = ?`)
		args = append(args, *update.Description)
	}
	if update.Tags != nil {
		setClauses = append(setClauses, `"tags" = ?`)
		args = append(args, *update.Tags)
	}
	if update.Year != nil {
		setClauses = append(setClauses, `"year" = ?`)
		args = append(args, *update.Year)
	}
	if update.Publisher != nil {
		setClauses = append(setClauses, `"publisher" = ?`)
		args = append(args, *update.Publisher)
	}
	if update.Language != nil {
		setClauses = append(setClauses, `"language" = ?`)
		args = append(args, *update.Language)
	}
	if update.Genre != nil {
		setClauses = append(setClauses, `"genre" = ?`)
		args = append(args, *update.Genre)
	}
	if update.Status != nil {
		setClauses = append(setClauses, `"status" = ?`)
		args = append(args, *update.Status)
	}

	if len(setClauses) == 0 {
		return nil // 没有需要更新的字段
	}

	setClauses = append(setClauses, `"updatedAt" = ?`)
	args = append(args, time.Now().UTC())
	args = append(args, groupID)

	_, err := db.Exec(`UPDATE "ComicGroup" SET `+strings.Join(setClauses, ", ")+` WHERE "id" = ?`, args...)
	return err
}

// InheritGroupMetadataFromFirstComic 从系列的第一本漫画继承元数据到系列。
// 仅填充系列中为空的字段，不覆盖已有数据。
func InheritGroupMetadataFromFirstComic(groupID int) error {
	// 获取当前系列元数据
	group, err := GetGroupByID(groupID)
	if err != nil || group == nil || len(group.Comics) == 0 {
		return err
	}

	// 获取第一本漫画的详细元数据
	firstComicID := group.Comics[0].ComicID
	var author, publisher, language, genre, description string
	var year sql.NullInt64
	err = db.QueryRow(`
		SELECT COALESCE("author",''), COALESCE("publisher",''), COALESCE("language",''),
		       COALESCE("genre",''), COALESCE("description",''), "year"
		FROM "Comic" WHERE "id" = ?
	`, firstComicID).Scan(&author, &publisher, &language, &genre, &description, &year)
	if err != nil {
		return err
	}

	// 只填充系列中为空的字段
	update := GroupMetadataUpdate{}
	if group.Author == "" && author != "" {
		update.Author = &author
	}
	if group.Publisher == "" && publisher != "" {
		update.Publisher = &publisher
	}
	if group.Language == "" && language != "" {
		update.Language = &language
	}
	if group.Genre == "" && genre != "" {
		update.Genre = &genre
	}
	if group.Description == "" && description != "" {
		update.Description = &description
	}
	if group.Year == nil && year.Valid {
		y := int(year.Int64)
		update.Year = &y
	}

	return UpdateGroupMetadata(groupID, update)
}

// DeleteGroup 删除分组（不删除漫画本身）。
// 显式删除关联记录，避免外键 CASCADE 在某些连接上未启用的情况。
func DeleteGroup(groupID int) error {
	// 先删除关联的 ComicGroupItem 记录
	if _, err := db.Exec(`DELETE FROM "ComicGroupItem" WHERE "groupId" = ?`, groupID); err != nil {
		return err
	}
	// 再删除分组本身
	_, err := db.Exec(`DELETE FROM "ComicGroup" WHERE "id" = ?`, groupID)
	return err
}

// naturalSortKey 生成自然排序键，将数字部分补零对齐，实现数字感知排序。
// 例如 "怪医黑杰克 3" → "怪医黑杰克 00000000000000000003"
func naturalSortKey(s string) string {
	var buf strings.Builder
	i := 0
	runes := []rune(strings.ToLower(s))
	for i < len(runes) {
		if runes[i] >= '0' && runes[i] <= '9' {
			j := i
			for j < len(runes) && runes[j] >= '0' && runes[j] <= '9' {
				j++
			}
			num := string(runes[i:j])
			// 补零到20位，确保数字排序正确
			for k := 0; k < 20-len(num); k++ {
				buf.WriteByte('0')
			}
			buf.WriteString(num)
			i = j
		} else {
			buf.WriteRune(runes[i])
			i++
		}
	}
	return buf.String()
}

// AddComicsToGroup 将多本漫画添加到分组。
// 添加前会按标题自然排序（数字感知），确保 "第3卷" 排在 "第29卷" 前面。
func AddComicsToGroup(groupID int, comicIDs []string) error {
	// 查询漫画标题用于自然排序
	if len(comicIDs) > 1 {
		titleMap := make(map[string]string) // comicID → title
		for _, cid := range comicIDs {
			var title string
			if err := db.QueryRow(`SELECT "title" FROM "Comic" WHERE "id" = ?`, cid).Scan(&title); err == nil {
				titleMap[cid] = title
			}
		}
		sort.Slice(comicIDs, func(i, j int) bool {
			return naturalSortKey(titleMap[comicIDs[i]]) < naturalSortKey(titleMap[comicIDs[j]])
		})
	}

	// 获取当前最大 sortIndex
	var maxIdx int
	db.QueryRow(`SELECT COALESCE(MAX("sortIndex"), -1) FROM "ComicGroupItem" WHERE "groupId" = ?`, groupID).Scan(&maxIdx)

	for i, comicID := range comicIDs {
		_, err := db.Exec(`
			INSERT INTO "ComicGroupItem" ("groupId", "comicId", "sortIndex")
			VALUES (?, ?, ?)
			ON CONFLICT("groupId", "comicId") DO NOTHING
		`, groupID, comicID, maxIdx+1+i)
		if err != nil {
			return err
		}
	}

	// 更新分组的 updatedAt
	db.Exec(`UPDATE "ComicGroup" SET "updatedAt" = ? WHERE "id" = ?`, time.Now().UTC(), groupID)
	return nil
}

// RemoveComicFromGroup 从分组移除漫画。如果移除后分组为空，自动删除分组。
func RemoveComicFromGroup(groupID int, comicID string) error {
	_, err := db.Exec(`DELETE FROM "ComicGroupItem" WHERE "groupId" = ? AND "comicId" = ?`, groupID, comicID)
	if err != nil {
		return err
	}
	db.Exec(`UPDATE "ComicGroup" SET "updatedAt" = ? WHERE "id" = ?`, time.Now().UTC(), groupID)

	// 检查分组是否为空，为空则自动删除
	var count int
	err = db.QueryRow(`SELECT COUNT(*) FROM "ComicGroupItem" WHERE "groupId" = ?`, groupID).Scan(&count)
	if err == nil && count == 0 {
		db.Exec(`DELETE FROM "ComicGroup" WHERE "id" = ?`, groupID)
	}

	return nil
}

// ReorderGroupComics 重新排序分组内的漫画。
func ReorderGroupComics(groupID int, comicIDs []string) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	stmt, err := tx.Prepare(`UPDATE "ComicGroupItem" SET "sortIndex" = ? WHERE "groupId" = ? AND "comicId" = ?`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for i, comicID := range comicIDs {
		if _, err := stmt.Exec(i, groupID, comicID); err != nil {
			return err
		}
	}

	tx.Exec(`UPDATE "ComicGroup" SET "updatedAt" = ? WHERE "id" = ?`, time.Now().UTC(), groupID)
	return tx.Commit()
}

// GetGroupedComicIDs 返回所有属于分组的 comicID 及其对应的 groupID 列表。
// 支持一本漫画属于多个分组的情况。
// JOIN ComicGroup 确保不返回孤儿记录（分组已删除但关联未级联清理的情况）。
func GetGroupedComicIDs() (map[string][]int, error) {
	rows, err := db.Query(`
		SELECT gi."comicId", gi."groupId"
		FROM "ComicGroupItem" gi
		INNER JOIN "ComicGroup" g ON g."id" = gi."groupId"
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make(map[string][]int)
	for rows.Next() {
		var comicID string
		var groupID int
		if rows.Scan(&comicID, &groupID) == nil {
			result[comicID] = append(result[comicID], groupID)
		}
	}
	return result, nil
}

// ============================================================
// 智能分组：自动识别可合并的漫画系列
// ============================================================

// AutoDetectGroup 表示自动检测出的一个建议分组。
type AutoDetectGroup struct {
	Name     string   `json:"name"`
	ComicIDs []string `json:"comicIds"`
	Titles   []string `json:"titles"`
}

// AutoDetectGroups 使用 normalizeTitle 自动检测可合并的漫画。
// 排除已经在分组中的漫画。
// 增强版：路径分组 + 精确匹配 + 编辑距离模糊匹配。
// contentType 可选参数：传入 "comic" 或 "novel" 只检测对应类型的漫画。
func AutoDetectGroups(contentType ...string) ([]AutoDetectGroup, error) {
	// 获取已分组的漫画ID
	grouped, err := GetGroupedComicIDs()
	if err != nil {
		return nil, err
	}

	// 构建查询：可按 contentType 过滤（增加 filename 字段用于路径分组）
	querySQL := `SELECT "id", "title", "filename" FROM "Comic"`
	var queryArgs []interface{}
	if len(contentType) > 0 && (contentType[0] == "comic" || contentType[0] == "novel") {
		querySQL += ` WHERE "type" = ?`
		queryArgs = append(queryArgs, contentType[0])
	}
	querySQL += ` ORDER BY "title" ASC`

	rows, err := db.Query(querySQL, queryArgs...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	type comicRef struct {
		ID       string
		Title    string
		Filename string // 相对路径，如 "海贼王/1.cbz"
	}

	// 收集所有未分组漫画
	var allRefs []comicRef
	totalCount := 0
	skippedGrouped := 0
	for rows.Next() {
		var id, title, filename string
		if rows.Scan(&id, &title, &filename) != nil {
			continue
		}
		totalCount++
		// 跳过已分组的漫画
		if _, ok := grouped[id]; ok {
			skippedGrouped++
			continue
		}
		allRefs = append(allRefs, comicRef{ID: id, Title: title, Filename: filename})
	}
	log.Printf("[auto-detect] 总计 %d 本漫画，已分组 %d 本，待检测 %d 本", totalCount, skippedGrouped, len(allRefs))

	var suggestions []AutoDetectGroup
	matchedIDs := make(map[string]bool) // 记录已被匹配的漫画ID

	// ── 第零轮：路径分组（同一文件夹下的文件归为一组）──
	// 将 filename 按父文件夹聚合，如 "海贼王/1.cbz" → dir="海贼王"
	// 增强：支持多级目录结构，如 "乌龙院/乌龙院前篇/卷1.cbz" → dir="乌龙院/乌龙院前篇"
	dirMap := make(map[string][]comicRef)
	for _, ref := range allRefs {
		dir := path.Dir(ref.Filename) // 使用 path（正斜杠），因为 filename 已统一为 "/"
		if dir == "." || dir == "/" || dir == "" {
			continue // 根目录下的文件跳过路径分组，交给后续标题匹配
		}
		dirMap[dir] = append(dirMap[dir], ref)
	}

	// 多级目录分组策略：
	// 1. 优先按最深层目录分组（如 "乌龙院/乌龙院前篇" 下的文件归为一组）
	// 2. 如果某个目录下只有子目录没有直接文件，则不单独创建分组
	// 3. 组名使用完整的目录路径层级（如 "乌龙院 / 乌龙院前篇"）
	for dir, refs := range dirMap {
		if len(refs) < 2 {
			continue // 文件夹下只有一个文件，不构成分组
		}

		// 构建组名：使用目录路径中的各层级名称
		groupName := buildGroupNameFromPath(dir)
		if groupName == "" {
			continue
		}

		var ids []string
		var titles []string
		for _, ref := range refs {
			ids = append(ids, ref.ID)
			titles = append(titles, ref.Title)
			matchedIDs[ref.ID] = true
		}
		suggestions = append(suggestions, AutoDetectGroup{
			Name:     groupName,
			ComicIDs: ids,
			Titles:   titles,
		})
	}
	log.Printf("[auto-detect] 路径分组: 发现 %d 个目录分组，匹配 %d 本漫画", len(suggestions), len(matchedIDs))

	// ── 第一轮：精确匹配（normalizeTitle 完全相同）──
	titleMap := make(map[string][]comicRef)
	for _, ref := range allRefs {
		if matchedIDs[ref.ID] {
			continue // 已被路径分组匹配，跳过
		}
		normalized := normalizeTitle(ref.Title)
		if normalized == "" {
			continue
		}
		titleMap[normalized] = append(titleMap[normalized], ref)
	}

	// 收集精确匹配的结果
	for normalized, refs := range titleMap {
		if len(refs) < 2 {
			continue
		}
		groupName := normalized
		if len(refs) > 0 {
			name := extractSeriesName(refs[0].Title)
			if name != "" {
				groupName = name
			}
		}

		var ids []string
		var titles []string
		for _, ref := range refs {
			ids = append(ids, ref.ID)
			titles = append(titles, ref.Title)
			matchedIDs[ref.ID] = true
		}
		suggestions = append(suggestions, AutoDetectGroup{
			Name:     groupName,
			ComicIDs: ids,
			Titles:   titles,
		})
	}

	// ── 第二轮：对未匹配的漫画做编辑距离模糊匹配 ──
	var unmatched []struct {
		ref        comicRef
		normalized string
	}
	for _, ref := range allRefs {
		if matchedIDs[ref.ID] {
			continue
		}
		normalized := normalizeTitle(ref.Title)
		if normalized == "" {
			continue
		}
		unmatched = append(unmatched, struct {
			ref        comicRef
			normalized string
		}{ref: ref, normalized: normalized})
	}

	// 用编辑距离聚类未匹配的标题
	if len(unmatched) > 1 {
		used := make(map[int]bool)
		for i := 0; i < len(unmatched); i++ {
			if used[i] {
				continue
			}
			cluster := []int{i}
			ri := []rune(unmatched[i].normalized)
			for j := i + 1; j < len(unmatched); j++ {
				if used[j] {
					continue
				}
				rj := []rune(unmatched[j].normalized)
				// 长度差太大的直接跳过
				lenDiff := len(ri) - len(rj)
				if lenDiff < 0 {
					lenDiff = -lenDiff
				}
				if lenDiff > 3 {
					continue
				}
				// 编辑距离阈值：短字符串要求更严格
				maxLen := len(ri)
				if len(rj) > maxLen {
					maxLen = len(rj)
				}
				threshold := 2
				if maxLen >= 10 {
					threshold = 3
				}
				if maxLen < 4 {
					threshold = 1
				}

				dist := LevenshteinDistance(unmatched[i].normalized, unmatched[j].normalized)
				if dist <= threshold {
					cluster = append(cluster, j)
				}
			}

			if len(cluster) >= 2 {
				var ids []string
				var titles []string
				for _, idx := range cluster {
					used[idx] = true
					ids = append(ids, unmatched[idx].ref.ID)
					titles = append(titles, unmatched[idx].ref.Title)
				}
				// 组名取第一个的系列名
				groupName := extractSeriesName(unmatched[cluster[0]].ref.Title)
				if groupName == "" {
					groupName = unmatched[cluster[0]].normalized
				}
				suggestions = append(suggestions, AutoDetectGroup{
					Name:     groupName,
					ComicIDs: ids,
					Titles:   titles,
				})
			}
		}
	}

	log.Printf("[auto-detect] 检测完成: 共发现 %d 个可合并系列", len(suggestions))
	if len(suggestions) == 0 {
		log.Printf("[auto-detect] 未发现可合并系列。可能原因: 所有漫画已分组(%d本), 或文件名无法匹配", skippedGrouped)
	}
	if suggestions == nil {
		suggestions = []AutoDetectGroup{}
	}
	return suggestions, nil
}

// extractSeriesName 从标题中提取系列名（去掉卷号等）。
// 支持的格式：
//   - [Comic][FL063][佛陀01][手塚治虫][時報][HMM] → "佛陀"
//   - [三眼神童典藏版][手塚治虫][東販]Vol.01 → "三眼神童典藏版"
//   - 佛陀01 → "佛陀"
//   - NARUTO vol.23 → "NARUTO"
//   - 进击的巨人 第5卷 → "进击的巨人"
func extractSeriesName(title string) string {
	// 如果标题包含方括号，提取中括号内的部分
	if strings.Contains(title, "[") || strings.Contains(title, "]") {
		parts := splitBrackets(title)

		// 两类候选：
		// volumeCandidates: 包含末尾卷号的部分（去掉卷号后的名称）
		// nameCandidates:   纯名称部分（不含卷号，但含CJK且较长，可能是书名本身）
		var volumeCandidates []string
		var nameCandidates []string

		for _, part := range parts {
			part = strings.TrimSpace(part)
			if part == "" {
				continue
			}
			// 跳过常见标签
			lp := strings.ToLower(part)
			if lp == "comic" || lp == "manga" || lp == "漫画" {
				continue
			}
			// 跳过看起来纯编号的部分 (FL063, HMM, DL, 3A等)
			if isLikelyCode(part) {
				continue
			}
			// 尝试去掉末尾卷号
			trimmed := trimTrailingVolumeNumber(part)
			if trimmed != "" && trimmed != part {
				// 包含卷号 → 高优先级候选
				volumeCandidates = append(volumeCandidates, trimmed)
			} else if containsCJK(part) && cjkRuneCount(part) >= 2 {
				// 不含卷号，但含CJK字符且长度>=2（可能是书名、出版社、作者等）
				nameCandidates = append(nameCandidates, part)
			}
		}

		// 优先从volumeCandidates中选取含CJK的（如 "[佛陀01]" → "佛陀"）
		for _, c := range volumeCandidates {
			if containsCJK(c) {
				return c
			}
		}

		// 从nameCandidates中选取CJK字符最多的（最可能是书名）
		// 这一步优先于非CJK的volumeCandidates（如"Vol"），
		// 因为"三眼神童典藏版"比"Vol"更有意义
		bestName := ""
		bestNameLen := 0
		for _, c := range nameCandidates {
			l := cjkRuneCount(c)
			if l > bestNameLen {
				bestName = c
				bestNameLen = l
			}
		}
		if bestName != "" {
			return bestName
		}

		// 最后兜底：使用非CJK的volumeCandidates（如 NARUTO）
		if len(volumeCandidates) > 0 {
			return volumeCandidates[0]
		}
	}

	// 处理方括号外的部分（如 "[...][...]Vol.01" 中的 "Vol.01"）
	// 先尝试整体去掉末尾卷号
	cleaned := trimTrailingVolumeNumber(title)
	if cleaned != "" && cleaned != title {
		return cleaned
	}

	return ""
}

// splitBrackets 分割方括号内的内容。
func splitBrackets(s string) []string {
	var parts []string
	inBracket := false
	var current strings.Builder
	for _, r := range s {
		switch r {
		case '[', '【', '「', '『':
			if current.Len() > 0 && !inBracket {
				parts = append(parts, current.String())
				current.Reset()
			}
			inBracket = true
		case ']', '】', '」', '』':
			if inBracket {
				parts = append(parts, current.String())
				current.Reset()
				inBracket = false
			}
		default:
			current.WriteRune(r)
		}
	}
	if current.Len() > 0 {
		parts = append(parts, current.String())
	}
	return parts
}

// trimTrailingVolumeNumber 去掉末尾的卷号标记。
// 支持: "佛陀01" "NARUTO23" "进击的巨人 第5卷" "ABC vol.3"
func trimTrailingVolumeNumber(s string) string {
	s = strings.TrimSpace(s)
	// 先尝试匹配常见的卷号后缀模式
	lowers := strings.ToLower(s)
	for _, suffix := range []string{" vol.", " vol ", " volume ", " 第", " 卷", " 集"} {
		idx := strings.LastIndex(lowers, suffix)
		if idx > 0 {
			return strings.TrimSpace(s[:idx])
		}
	}
	// 去掉末尾数字
	name := strings.TrimRight(s, "0123456789")
	name = strings.TrimRight(name, " .-_") // 去掉 "Name - " 或 "Name." 的分隔符
	if name == "" {
		return ""
	}
	return strings.TrimSpace(name)
}

// isLikelyCode 判断是否像编号（如 FL063, HMM, DL版 等）。
// 注意：含有多个CJK字符的字符串不应被判定为编号。
// 【P2修复】放宽对2字符CJK名称的限制，避免 "火影"、"死神"、"棋魂" 被误判。
func isLikelyCode(s string) bool {
	if len(s) <= 2 {
		// 如果是2字符且都是CJK，不算编号（如 "火影"、"死神"、"棋魂"）
		runes := []rune(s)
		if len(runes) == 2 && isCJKRune(runes[0]) && isCJKRune(runes[1]) {
			return false
		}
		return true
	}
	// 如果包含CJK字符且CJK字符数>=2，不太可能是编号
	if cjkRuneCount(s) >= 2 {
		return false
	}
	// 全大写字母+数字且较短 → 编号
	if len(s) <= 8 {
		allUpper := true
		hasLetter := false
		for _, r := range s {
			if r >= 'a' && r <= 'z' {
				allUpper = false
				break
			}
			if (r >= 'A' && r <= 'Z') || (r >= 'a' && r <= 'z') {
				hasLetter = true
			}
		}
		if allUpper && hasLetter && isAlphaNumeric(s) {
			return true
		}
	}
	// 以常见出版标签结尾，但仅对纯标签短字符串（如"DL版"）生效
	// 不对长CJK字符串（如"三眼神童典藏版"）误判
	for _, tag := range []string{"版", "出版", "文庫", "文库"} {
		if strings.HasSuffix(s, tag) {
			// 去掉标签后缀，如果剩余部分很短或不含CJK，才是编号
			base := strings.TrimSuffix(s, tag)
			if cjkRuneCount(base) < 2 {
				return true
			}
			return false
		}
	}
	return false
}

// containsCJK 判断字符串是否包含中日韩字符。
func containsCJK(s string) bool {
	for _, r := range s {
		if r >= 0x4E00 && r <= 0x9FFF { // CJK Unified Ideographs
			return true
		}
		if r >= 0x3040 && r <= 0x30FF { // Hiragana + Katakana
			return true
		}
		if r >= 0xAC00 && r <= 0xD7A3 { // Korean
			return true
		}
	}
	return false
}

// cjkRuneCount 统计字符串中CJK字符的数量。
func cjkRuneCount(s string) int {
	count := 0
	for _, r := range s {
		if (r >= 0x4E00 && r <= 0x9FFF) || // CJK Unified Ideographs
			(r >= 0x3040 && r <= 0x30FF) || // Hiragana + Katakana
			(r >= 0xAC00 && r <= 0xD7A3) { // Korean
			count++
		}
	}
	return count
}

func isAlphaNumeric(s string) bool {
	for _, r := range s {
		if !((r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9')) {
			return false
		}
	}
	return true
}

// buildGroupNameFromPath 从多级目录路径构建可读的组名。
// 例如：
//   - "乌龙院/乌龙院前篇" → "乌龙院 / 乌龙院前篇"
//   - "海贼王" → "海贼王"
//   - "[汉化组]作品名/第一部" → "作品名 / 第一部"
func buildGroupNameFromPath(dirPath string) string {
	parts := strings.Split(dirPath, "/")
	var cleanParts []string
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" || p == "." {
			continue
		}
		cleaned := cleanDirName(p)
		if cleaned != "" {
			cleanParts = append(cleanParts, cleaned)
		}
	}
	if len(cleanParts) == 0 {
		return ""
	}
	// 如果只有一级，直接返回
	if len(cleanParts) == 1 {
		return cleanParts[0]
	}
	// 多级目录：使用最近一级作为主名称
	// 但如果最近一级名称包含在上级名称中（如 "乌龙院/乌龙院前篇"），
	// 则使用最近一级即可，因为它已经足够描述
	lastPart := cleanParts[len(cleanParts)-1]
	return lastPart
}

// cleanDirName 清理文件夹名称，提取出可读的组名。
// 处理策略：
//  1. 去除方括号标签（如 [汉化组]、[作者名]），保留核心名称
//  2. 如果文件夹名本身就是简洁的系列名（如"海贼王"），直接返回
//  3. 处理嵌套路径时只取最近一级（path.Base 已在调用处完成）
func cleanDirName(name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		return ""
	}

	// 如果文件夹名不含方括号，直接作为组名（去掉首尾空白即可）
	if !strings.ContainsAny(name, "[]【】「」『』") {
		// 去掉常见的无意义前缀/后缀
		name = strings.TrimSpace(name)
		if name == "" {
			return ""
		}
		return name
	}

	// 包含方括号时，尝试提取核心名称
	// 收集方括号外的部分和方括号内含CJK的部分
	var outsideParts []string
	var bracketParts []string
	inBracket := false
	var current strings.Builder
	for _, r := range name {
		switch r {
		case '[', '【', '「', '『':
			if current.Len() > 0 && !inBracket {
				outsideParts = append(outsideParts, strings.TrimSpace(current.String()))
			}
			current.Reset()
			inBracket = true
		case ']', '】', '」', '』':
			if inBracket && current.Len() > 0 {
				part := strings.TrimSpace(current.String())
				if part != "" && !isLikelyCode(part) {
					bracketParts = append(bracketParts, part)
				}
			}
			current.Reset()
			inBracket = false
		default:
			current.WriteRune(r)
		}
	}
	if current.Len() > 0 && !inBracket {
		outsideParts = append(outsideParts, strings.TrimSpace(current.String()))
	}

	// 优先使用方括号外的非空内容（更可能是文件夹的主名称）
	for _, p := range outsideParts {
		p = strings.TrimSpace(p)
		if p != "" && len([]rune(p)) >= 2 {
			return p
		}
	}

	// 其次使用方括号内CJK字符最多的部分
	bestPart := ""
	bestCJK := 0
	for _, p := range bracketParts {
		c := cjkRuneCount(p)
		if c > bestCJK {
			bestPart = p
			bestCJK = c
		}
	}
	if bestPart != "" {
		return bestPart
	}

	// 兜底：使用方括号内最长的部分
	for _, p := range bracketParts {
		if len([]rune(p)) > len([]rune(bestPart)) {
			bestPart = p
		}
	}
	if bestPart != "" {
		return bestPart
	}

	// 最终兜底：返回原始名称
	return name
}

// isNumericTitle 判断标题是否为纯数字命名（如 "1"、"02"、"123"）。
// 用于辅助路径分组：如果文件名是纯数字，说明系列信息只在文件夹名中。
func isNumericTitle(title string) bool {
	title = strings.TrimSpace(title)
	if title == "" {
		return false
	}
	for _, r := range title {
		if !unicode.IsDigit(r) && r != ' ' && r != '_' && r != '-' && r != '.' {
			return false
		}
	}
	return true
}

// ============================================================
// 批量操作
// ============================================================

// BatchDeleteGroups 批量删除多个分组。
func BatchDeleteGroups(groupIDs []int) (int, error) {
	deleted := 0
	for _, id := range groupIDs {
		if err := DeleteGroup(id); err != nil {
			continue
		}
		deleted++
	}
	return deleted, nil
}

// MergeGroups 将多个分组合并为一个新分组。
// 取第一个分组的封面，合并所有成员漫画并去重。
func MergeGroups(groupIDs []int, newName string, userID string) (int64, error) {
	if len(groupIDs) < 2 {
		return 0, fmt.Errorf("至少需要两个分组才能合并")
	}

	// 1. 收集所有漫画 ID（去重）
	seen := make(map[string]bool)
	var allComicIDs []string
	var coverURL string
	for i, gid := range groupIDs {
		detail, err := GetGroupByID(gid)
		if err != nil || detail == nil {
			continue
		}
		// 使用第一个有封面的分组的封面
		if i == 0 || (coverURL == "" && detail.CoverURL != "") {
			coverURL = detail.CoverURL
		}
		for _, c := range detail.Comics {
			if !seen[c.ComicID] {
				seen[c.ComicID] = true
				allComicIDs = append(allComicIDs, c.ComicID)
			}
		}
	}

	// 2. 创建新分组
	uid := userID
	newID, err := CreateGroup(newName, uid)
	if err != nil {
		return 0, fmt.Errorf("创建合并分组失败: %w", err)
	}

	// 3. 设置封面
	if coverURL != "" {
		UpdateGroup(int(newID), newName, coverURL)
	}

	// 4. 添加所有漫画到新分组
	if len(allComicIDs) > 0 {
		if err := AddComicsToGroup(int(newID), allComicIDs); err != nil {
			return newID, fmt.Errorf("添加漫画到合并分组失败: %w", err)
		}
	}

	// 5. 删除旧分组
	for _, gid := range groupIDs {
		DeleteGroup(gid)
	}

	return newID, nil
}

// GroupExportItem 分组导出数据条目。
type GroupExportItem struct {
	ID         int               `json:"id"`
	Name       string            `json:"name"`
	CoverURL   string            `json:"coverUrl"`
	ComicCount int               `json:"comicCount"`
	CreatedAt  string            `json:"createdAt"`
	UpdatedAt  string            `json:"updatedAt"`
	Comics     []GroupComicBrief `json:"comics"`
}

// GroupComicBrief 分组导出中的漫画简要信息。
type GroupComicBrief struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	Filename string `json:"filename"`
}

// ExportGroupsData 导出指定分组的数据。
func ExportGroupsData(groupIDs []int) ([]GroupExportItem, error) {
	var items []GroupExportItem
	for _, gid := range groupIDs {
		detail, err := GetGroupByID(gid)
		if err != nil || detail == nil {
			continue
		}
		item := GroupExportItem{
			ID:         detail.ID,
			Name:       detail.Name,
			CoverURL:   detail.CoverURL,
			ComicCount: detail.ComicCount,
			CreatedAt:  detail.CreatedAt,
			UpdatedAt:  detail.UpdatedAt,
		}
		for _, c := range detail.Comics {
			item.Comics = append(item.Comics, GroupComicBrief{
				ID:       c.ComicID,
				Title:    c.Title,
				Filename: c.Filename,
			})
		}
		if item.Comics == nil {
			item.Comics = []GroupComicBrief{}
		}
		items = append(items, item)
	}
	if items == nil {
		items = []GroupExportItem{}
	}
	return items, nil
}

// BatchCreateGroups 批量创建分组并添加漫画（用于自动检测后一键创建）。
// 如果已存在同名分组，则将漫画添加到现有分组而不是创建新分组。
// autoInherit: 为 true 时，创建分组后自动从首卷继承元数据到系列。
func BatchCreateGroups(groups []AutoDetectGroup, autoInherit bool, userID ...string) (int, error) {
	// 预加载所有已有分组名 → ID 的映射
	existingGroups, err := GetAllGroups()
	if err != nil {
		return 0, err
	}
	nameToID := make(map[string]int)
	for _, g := range existingGroups {
		nameToID[strings.ToLower(g.Name)] = g.ID
	}

	created := 0
	for _, g := range groups {
		key := strings.ToLower(g.Name)
		if existingID, ok := nameToID[key]; ok {
			// 同名分组已存在，将漫画添加到现有分组
			if err := AddComicsToGroup(existingID, g.ComicIDs); err != nil {
				continue
			}
			// 自动继承元数据到系列
			if autoInherit {
				_ = InheritGroupMetadataFromFirstComic(existingID)
			}
			created++
			continue
		}
		id, err := CreateGroup(g.Name, userID...)
		if err != nil {
			continue
		}
		if err := AddComicsToGroup(int(id), g.ComicIDs); err != nil {
			continue
		}
		nameToID[key] = int(id)
		// 自动继承元数据到系列
		if autoInherit {
			_ = InheritGroupMetadataFromFirstComic(int(id))
		}
		created++
	}
	return created, nil
}

// ============================================================
// 元数据继承：从首卷继承到系列所有卷
// ============================================================

// InheritField 描述一个将要被继承的字段变更。
type InheritField struct {
	Field    string `json:"field"`    // 字段名
	Label    string `json:"label"`    // 显示名称
	Value    string `json:"value"`    // 将要设置的值
	OldValue string `json:"oldValue"` // 当前值（空表示未设置）
}

// InheritPreview 继承预览结果。
type InheritPreview struct {
	SourceComicID    string         `json:"sourceComicId"`    // 首卷漫画ID
	SourceComicTitle string         `json:"sourceComicTitle"` // 首卷标题
	GroupChanges     []InheritField `json:"groupChanges"`     // 系列级别的变更
	VolumeCount      int            `json:"volumeCount"`      // 将受影响的卷数
	VolumeChanges    []InheritField `json:"volumeChanges"`    // 卷级别的变更（汇总）
}

// PreviewInheritMetadata 预览从首卷继承元数据的结果，不实际执行变更。
// 返回将要变更的字段列表，供用户确认。
func PreviewInheritMetadata(groupID int) (*InheritPreview, error) {
	group, err := GetGroupByID(groupID)
	if err != nil || group == nil || len(group.Comics) == 0 {
		return nil, fmt.Errorf("系列不存在或没有漫画")
	}

	firstComicID := group.Comics[0].ComicID
	var author, publisher, language, genre, description, title string
	var year sql.NullInt64
	err = db.QueryRow(`
		SELECT COALESCE("title",''), COALESCE("author",''), COALESCE("publisher",''),
		       COALESCE("language",''), COALESCE("genre",''), COALESCE("description",''), "year"
		FROM "Comic" WHERE "id" = ?
	`, firstComicID).Scan(&title, &author, &publisher, &language, &genre, &description, &year)
	if err != nil {
		return nil, err
	}

	preview := &InheritPreview{
		SourceComicID:    firstComicID,
		SourceComicTitle: title,
	}

	// 系列级别变更预览
	if group.Author == "" && author != "" {
		preview.GroupChanges = append(preview.GroupChanges, InheritField{
			Field: "author", Label: "作者", Value: author, OldValue: group.Author,
		})
	}
	if group.Publisher == "" && publisher != "" {
		preview.GroupChanges = append(preview.GroupChanges, InheritField{
			Field: "publisher", Label: "出版商", Value: publisher, OldValue: group.Publisher,
		})
	}
	if group.Language == "" && language != "" {
		preview.GroupChanges = append(preview.GroupChanges, InheritField{
			Field: "language", Label: "语言", Value: language, OldValue: group.Language,
		})
	}
	if group.Genre == "" && genre != "" {
		preview.GroupChanges = append(preview.GroupChanges, InheritField{
			Field: "genre", Label: "类型", Value: genre, OldValue: group.Genre,
		})
	}
	if group.Description == "" && description != "" {
		preview.GroupChanges = append(preview.GroupChanges, InheritField{
			Field: "description", Label: "简介", Value: description, OldValue: group.Description,
		})
	}
	if group.Year == nil && year.Valid {
		preview.GroupChanges = append(preview.GroupChanges, InheritField{
			Field: "year", Label: "年份", Value: fmt.Sprintf("%d", year.Int64), OldValue: "",
		})
	}

	// 卷级别变更预览：统计有多少卷的空字段会被填充
	affectedCount := 0
	var volumeFieldChanges = map[string]int{} // field → 受影响的卷数
	for _, comic := range group.Comics {
		if comic.ComicID == firstComicID {
			continue // 跳过首卷自身
		}
		var cAuthor, cPublisher, cLanguage, cGenre, cDescription string
		var cYear sql.NullInt64
		err := db.QueryRow(`
			SELECT COALESCE("author",''), COALESCE("publisher",''), COALESCE("language",''),
			       COALESCE("genre",''), COALESCE("description",''), "year"
			FROM "Comic" WHERE "id" = ?
		`, comic.ComicID).Scan(&cAuthor, &cPublisher, &cLanguage, &cGenre, &cDescription, &cYear)
		if err != nil {
			continue
		}
		changed := false
		if cAuthor == "" && author != "" {
			volumeFieldChanges["author"]++
			changed = true
		}
		if cPublisher == "" && publisher != "" {
			volumeFieldChanges["publisher"]++
			changed = true
		}
		if cLanguage == "" && language != "" {
			volumeFieldChanges["language"]++
			changed = true
		}
		if cGenre == "" && genre != "" {
			volumeFieldChanges["genre"]++
			changed = true
		}
		if cDescription == "" && description != "" {
			volumeFieldChanges["description"]++
			changed = true
		}
		if !cYear.Valid && year.Valid {
			volumeFieldChanges["year"]++
			changed = true
		}
		if changed {
			affectedCount++
		}
	}
	preview.VolumeCount = affectedCount

	// 汇总卷级别变更
	fieldLabels := map[string]string{
		"author": "作者", "publisher": "出版商", "language": "语言",
		"genre": "类型", "description": "简介", "year": "年份",
	}
	fieldValues := map[string]string{
		"author": author, "publisher": publisher, "language": language,
		"genre": genre, "description": description,
	}
	if year.Valid {
		fieldValues["year"] = fmt.Sprintf("%d", year.Int64)
	}
	for field, count := range volumeFieldChanges {
		preview.VolumeChanges = append(preview.VolumeChanges, InheritField{
			Field:    field,
			Label:    fieldLabels[field],
			Value:    fieldValues[field],
			OldValue: fmt.Sprintf("%d 卷将被更新", count),
		})
	}

	return preview, nil
}

// InheritMetadataToAllVolumes 将首卷的元数据继承到系列中所有卷。
// 仅填充各卷中为空的字段，不覆盖已有数据。
// 同时也会继承到系列（ComicGroup）本身。
func InheritMetadataToAllVolumes(groupID int) error {
	group, err := GetGroupByID(groupID)
	if err != nil || group == nil || len(group.Comics) == 0 {
		return fmt.Errorf("系列不存在或没有漫画")
	}

	// 先继承到系列本身
	if err := InheritGroupMetadataFromFirstComic(groupID); err != nil {
		return fmt.Errorf("继承到系列失败: %w", err)
	}

	// 获取首卷元数据
	firstComicID := group.Comics[0].ComicID
	var author, publisher, language, genre, description string
	var year sql.NullInt64
	err = db.QueryRow(`
		SELECT COALESCE("author",''), COALESCE("publisher",''), COALESCE("language",''),
		       COALESCE("genre",''), COALESCE("description",''), "year"
		FROM "Comic" WHERE "id" = ?
	`, firstComicID).Scan(&author, &publisher, &language, &genre, &description, &year)
	if err != nil {
		return fmt.Errorf("读取首卷元数据失败: %w", err)
	}

	// 遍历所有卷，填充空字段
	for _, comic := range group.Comics {
		if comic.ComicID == firstComicID {
			continue // 跳过首卷自身
		}

		var cAuthor, cPublisher, cLanguage, cGenre, cDescription string
		var cYear sql.NullInt64
		err := db.QueryRow(`
			SELECT COALESCE("author",''), COALESCE("publisher",''), COALESCE("language",''),
			       COALESCE("genre",''), COALESCE("description",''), "year"
			FROM "Comic" WHERE "id" = ?
		`, comic.ComicID).Scan(&cAuthor, &cPublisher, &cLanguage, &cGenre, &cDescription, &cYear)
		if err != nil {
			continue
		}

		updates := map[string]interface{}{}
		if cAuthor == "" && author != "" {
			updates["author"] = author
		}
		if cPublisher == "" && publisher != "" {
			updates["publisher"] = publisher
		}
		if cLanguage == "" && language != "" {
			updates["language"] = language
		}
		if cGenre == "" && genre != "" {
			updates["genre"] = genre
		}
		if cDescription == "" && description != "" {
			updates["description"] = description
		}
		if !cYear.Valid && year.Valid {
			updates["year"] = year.Int64
		}

		if len(updates) > 0 {
			UpdateComicFields(comic.ComicID, updates)
		}
	}

	return nil
}

// ============================================================
// P2: 系列级标签管理
// ============================================================

// GetGroupTags 获取系列的所有标签。
func GetGroupTags(groupID int) ([]Tag, error) {
	rows, err := db.Query(`
		SELECT t."id", t."name", t."color"
		FROM "Tag" t
		INNER JOIN "ComicGroupTag" cgt ON cgt."tagId" = t."id"
		WHERE cgt."groupId" = ?
		ORDER BY t."name" ASC
	`, groupID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var tags []Tag
	for rows.Next() {
		var t Tag
		if err := rows.Scan(&t.ID, &t.Name, &t.Color); err != nil {
			continue
		}
		tags = append(tags, t)
	}
	if tags == nil {
		tags = []Tag{}
	}
	return tags, nil
}

// SetGroupTags 设置系列的标签（替换所有现有标签）。
// tagNames: 标签名称列表，不存在的标签会自动创建。
func SetGroupTags(groupID int, tagNames []string) error {
	// 先删除现有关联
	if _, err := db.Exec(`DELETE FROM "ComicGroupTag" WHERE "groupId" = ?`, groupID); err != nil {
		return err
	}

	if len(tagNames) == 0 {
		return nil
	}

	// 确保标签存在并获取 ID
	for _, name := range tagNames {
		name = strings.TrimSpace(name)
		if name == "" {
			continue
		}
		// 查找或创建标签
		var tagID int
		err := db.QueryRow(`SELECT "id" FROM "Tag" WHERE "name" = ?`, name).Scan(&tagID)
		if err == sql.ErrNoRows {
			// 创建新标签
			res, err := db.Exec(`INSERT INTO "Tag" ("name", "color") VALUES (?, '')`, name)
			if err != nil {
				continue
			}
			id, _ := res.LastInsertId()
			tagID = int(id)
		} else if err != nil {
			continue
		}
		// 添加关联
		db.Exec(`INSERT OR IGNORE INTO "ComicGroupTag" ("groupId", "tagId") VALUES (?, ?)`, groupID, tagID)
	}

	return nil
}

// SyncGroupTagsToVolumes 将系列级标签同步到系列内所有卷。
// 仅添加卷中缺少的标签，不删除卷已有的标签。
func SyncGroupTagsToVolumes(groupID int) error {
	group, err := GetGroupByID(groupID)
	if err != nil || group == nil || len(group.Comics) == 0 {
		return nil
	}

	// 获取系列级标签名称
	groupTags, err := GetGroupTags(groupID)
	if err != nil || len(groupTags) == 0 {
		return nil
	}

	var tagNames []string
	for _, t := range groupTags {
		tagNames = append(tagNames, t.Name)
	}

	// 为每本漫画添加缺少的标签
	for _, comic := range group.Comics {
		_ = AddTagsToComic(comic.ComicID, tagNames)
	}

	return nil
}

// ============================================================
// P3: 按话/卷分类模式 — 扫描后自动分组
// ============================================================

// chapterPatterns 话级关键词正则
var chapterKeywords = []string{
	"第", "话", "話", "回", "chapter", "ch.", "ch ", "ep", "episode", "#",
}

// IsChapterNaming 判断文件名是否符合按话命名模式。
func IsChapterNaming(filename string) bool {
	lower := strings.ToLower(filename)
	for _, kw := range chapterKeywords {
		if strings.Contains(lower, kw) {
			return true
		}
	}
	return false
}

// AutoGroupByDirectory 按文件夹自动创建分组（用于按话分类模式）。
// 扫描指定目录下的所有漫画，将同一文件夹下的漫画自动归为一组。
// 仅处理尚未分组的漫画。
func AutoGroupByDirectory() (int, error) {
	grouped, err := GetGroupedComicIDs()
	if err != nil {
		return 0, err
	}

	// 查询所有未分组的漫画
	rows, err := db.Query(`SELECT "id", "title", "filename" FROM "Comic" ORDER BY "title" ASC`)
	if err != nil {
		return 0, err
	}
	defer rows.Close()

	type comicRef struct {
		ID       string
		Title    string
		Filename string
	}

	dirMap := make(map[string][]comicRef)
	for rows.Next() {
		var id, title, filename string
		if rows.Scan(&id, &title, &filename) != nil {
			continue
		}
		if _, ok := grouped[id]; ok {
			continue
		}
		dir := path.Dir(filename)
		if dir == "." || dir == "/" || dir == "" {
			continue
		}
		dirMap[dir] = append(dirMap[dir], comicRef{ID: id, Title: title, Filename: filename})
	}

	created := 0
	for dir, refs := range dirMap {
		if len(refs) < 2 {
			continue
		}

		// 检查是否有话级命名特征
		hasChapterNaming := false
		for _, ref := range refs {
			if IsChapterNaming(ref.Title) || IsChapterNaming(ref.Filename) {
				hasChapterNaming = true
				break
			}
		}
		if !hasChapterNaming {
			continue
		}

		groupName := cleanDirName(path.Base(dir))
		if groupName == "" {
			continue
		}

		// 检查是否已存在同名分组
		var existingID int
		err := db.QueryRow(`SELECT "id" FROM "ComicGroup" WHERE "name" = ?`, groupName).Scan(&existingID)
		if err == nil {
			// 已存在，添加漫画到现有分组
			var ids []string
			for _, ref := range refs {
				ids = append(ids, ref.ID)
			}
			_ = AddComicsToGroup(existingID, ids)
			created++
			continue
		}

		// 创建新分组
		id, err := CreateGroup(groupName)
		if err != nil {
			continue
		}

		// 标记为自动创建 + 按话分类
		db.Exec(`UPDATE "ComicGroup" SET "autoCreated" = 1, "classifyMode" = 'chapter' WHERE "id" = ?`, id)

		var ids []string
		for _, ref := range refs {
			ids = append(ids, ref.ID)
		}
		if err := AddComicsToGroup(int(id), ids); err != nil {
			continue
		}

		// 自动继承元数据
		_ = InheritGroupMetadataFromFirstComic(int(id))
		created++
		log.Printf("[auto-group] 按话自动创建系列: %s (%d 话)", groupName, len(refs))
	}

	return created, nil
}

// Tag 是从 model 包复制的简化版本，避免循环依赖。
type Tag struct {
	ID    int    `json:"id"`
	Name  string `json:"name"`
	Color string `json:"color"`
}
