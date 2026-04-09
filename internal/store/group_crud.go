package store

import (
	"database/sql"
	"fmt"
	"sort"
	"strings"
	"time"
)

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
	ContentType string `json:"contentType"` // 系列主要内容类型: "comic" | "novel"
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
	UserID      string   // 用户ID过滤
	ContentType string   // 内容类型过滤: "comic" | "novel" | "" (全部)
	Category    string   // 分类过滤（slug）
	Tags        []string // 标签过滤（标签名列表，AND 逻辑）
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

	// 分类过滤：只返回至少包含一本属于指定分类的漫画的分组
	if opts.Category != "" {
		conditions = append(conditions, `g."id" IN (
			SELECT DISTINCT gi3."groupId" FROM "ComicGroupItem" gi3
			JOIN "ComicCategory" cc ON cc."comicId" = gi3."comicId"
			JOIN "Category" cat ON cat."id" = cc."categoryId"
			WHERE cat."slug" = ?
		)`)
		args = append(args, opts.Category)
	}

	// 标签过滤：只返回至少包含一本拥有所有指定标签的漫画的分组（AND 逻辑）
	if len(opts.Tags) > 0 {
		for _, tagName := range opts.Tags {
			conditions = append(conditions, `g."id" IN (
				SELECT DISTINCT gi4."groupId" FROM "ComicGroupItem" gi4
				JOIN "ComicTag" ct2 ON ct2."comicId" = gi4."comicId"
				JOIN "Tag" t ON t."id" = ct2."tagId"
				WHERE t."name" = ?
			)`)
			args = append(args, tagName)
		}
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
		       COUNT(gi."comicId") as comicCount,
		       COALESCE((
		         SELECT CASE WHEN SUM(CASE WHEN c_ct."type" = 'novel' THEN 1 ELSE 0 END) > COUNT(*) / 2
		                     THEN 'novel' ELSE 'comic' END
		         FROM "ComicGroupItem" gi_ct
		         JOIN "Comic" c_ct ON c_ct."id" = gi_ct."comicId"
		         WHERE gi_ct."groupId" = g."id"
		       ), 'comic') as contentType
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
			&createdAt, &updatedAt, &g.ComicCount, &g.ContentType); err != nil {
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
