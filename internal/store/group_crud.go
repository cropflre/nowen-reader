package store

import (
	"database/sql"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
)

// ============================================================
// ComicGroup CRUD
// ============================================================

var (
	ErrGroupSeriesOrderMismatch = errors.New("series list does not match group membership")
	ErrShelfSeriesConflict      = errors.New("item already belongs to another shelf series")
	ErrShelfSortModeInvalid     = errors.New("invalid shelf series sort mode")
)

// ComicGroupWithCount 返回系列信息及其漫画数量。
type ComicGroupWithCount struct {
	ID            int    `json:"id"`
	Name          string `json:"name"`
	CoverURL      string `json:"coverUrl"`
	SortOrder     int    `json:"sortOrder"`
	ShelfSeries   bool   `json:"shelfSeries"`
	ShelfSortMode string `json:"shelfSortMode"`
	Author        string `json:"author"`
	Description   string `json:"description"`
	Tags          string `json:"tags"`
	Year          *int   `json:"year"`
	Publisher     string `json:"publisher"`
	Language      string `json:"language"`
	Genre         string `json:"genre"`
	Status        string `json:"status"`
	CreatedAt     string `json:"createdAt"`
	UpdatedAt     string `json:"updatedAt"`
	ComicCount    int    `json:"comicCount"`
	ContentType   string `json:"contentType"` // 系列主要内容类型: "comic" | "novel"
}

// ComicGroupDetail 包含系列详情和所属漫画列表。
type ComicGroupDetail struct {
	ID            int               `json:"id"`
	Name          string            `json:"name"`
	CoverURL      string            `json:"coverUrl"`
	SortOrder     int               `json:"sortOrder"`
	ShelfSeries   bool              `json:"shelfSeries"`
	ShelfSortMode string            `json:"shelfSortMode"`
	Author        string            `json:"author"`
	Description   string            `json:"description"`
	Tags          string            `json:"tags"`
	Year          *int              `json:"year"`
	Publisher     string            `json:"publisher"`
	Language      string            `json:"language"`
	Genre         string            `json:"genre"`
	Status        string            `json:"status"`
	CreatedAt     string            `json:"createdAt"`
	UpdatedAt     string            `json:"updatedAt"`
	ComicCount    int               `json:"comicCount"`
	SeriesList    []GroupSeriesItem `json:"seriesList"`
	Comics        []GroupComicItem  `json:"comics"`
}

// GroupSeriesItem 分组内的目录作品条目。
type GroupSeriesItem struct {
	SeriesID         string           `json:"id"`
	Title            string           `json:"title"`
	RootRelativePath string           `json:"rootRelativePath"`
	CoverComicID     string           `json:"coverComicId"`
	CoverURL         string           `json:"coverUrl"`
	SortIndex        int              `json:"sortIndex"`
	Comics           []GroupComicItem `json:"comics"`
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
	UserID           string   // 用户ID过滤
	ContentType      string   // 内容类型过滤: "comic" | "novel" | "" (全部)
	Category         string   // 分类过滤（slug）
	Tags             []string // 标签过滤（标签名列表，AND 逻辑）
	FavoritesOnly    bool     // 仅返回包含收藏漫画的分组
	FilterLibraryIDs bool     // 如果为 true 且 LibraryIDs 为空，则强制返回空结果
	LibraryIDs       []string // 书库ID过滤：只返回包含这些书库中漫画的分组
	IncludeEmpty     bool     // 是否包含空合集（默认 false）
}

type GroupDetailOptions struct {
	UserID           string
	ContentType      string
	FilterLibraryIDs bool
	LibraryIDs       []string
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
// 当指定 LibraryIDs 时，只返回包含这些书库中漫画的分组（用于非管理员用户的书库权限过滤）。
func GetAllGroupsWithOptions(opts GroupListOptions) ([]ComicGroupWithCount, error) {
	if opts.FilterLibraryIDs && len(opts.LibraryIDs) == 0 {
		return []ComicGroupWithCount{}, nil
	}

	const expandedMembersCTE = `WITH "GroupExpandedComic" AS (
		SELECT gi."groupId", gi."comicId", 1 AS "sourceOrder", gi."sortIndex" AS "outerSort", 0 AS "innerSort"
		FROM "ComicGroupItem" gi
		UNION ALL
		SELECT cgs."groupId", csi."comicId", 0 AS "sourceOrder", cgs."sortIndex" AS "outerSort",
		       CASE WHEN csi."comicId" = cs."coverComicId" THEN -1 ELSE csi."sortIndex" END AS "innerSort"
		FROM "ComicGroupSeries" cgs
		JOIN "ComicSeries" cs ON cs."id" = cgs."seriesId"
		JOIN "ComicSeriesItem" csi ON csi."seriesId" = cgs."seriesId"
		JOIN "Comic" c_series ON c_series."id" = csi."comicId" AND c_series."libraryId" = cs."libraryId"
	)`

	visibility := func(alias string) (string, []interface{}) {
		var parts []string
		var values []interface{}
		if opts.ContentType == "comic" || opts.ContentType == "novel" {
			parts = append(parts, alias+`."type" = ?`)
			values = append(values, opts.ContentType)
		}
		if len(opts.LibraryIDs) > 0 {
			parts = append(parts, alias+`."libraryId" IN (`+placeholders(len(opts.LibraryIDs))+`)`)
			for _, id := range opts.LibraryIDs {
				values = append(values, id)
			}
		}
		if len(parts) == 0 {
			return "1=1", values
		}
		return strings.Join(parts, " AND "), values
	}

	var conditions []string
	var whereArgs []interface{}
	if opts.ContentType == "comic" || opts.ContentType == "novel" || len(opts.LibraryIDs) > 0 {
		visible, values := visibility("c_visible")
		conditions = append(conditions, `EXISTS (
			SELECT 1 FROM "GroupExpandedComic" gm_visible
			JOIN "Comic" c_visible ON c_visible."id" = gm_visible."comicId"
			WHERE gm_visible."groupId" = g."id" AND `+visible+`
		)`)
		whereArgs = append(whereArgs, values...)
	}

	if opts.Category != "" {
		visible, values := visibility("c_category")
		conditions = append(conditions, `EXISTS (
			SELECT 1 FROM "GroupExpandedComic" gm_category
			JOIN "Comic" c_category ON c_category."id" = gm_category."comicId"
			JOIN "ComicCategory" cc ON cc."comicId" = c_category."id"
			JOIN "Category" cat ON cat."id" = cc."categoryId"
			WHERE gm_category."groupId" = g."id" AND `+visible+` AND cat."slug" = ?
		)`)
		whereArgs = append(whereArgs, values...)
		whereArgs = append(whereArgs, opts.Category)
	}
	for index, tagName := range opts.Tags {
		comicAlias := fmt.Sprintf("c_tag_%d", index)
		memberAlias := fmt.Sprintf("gm_tag_%d", index)
		tagAlias := fmt.Sprintf("tag_%d", index)
		comicTagAlias := fmt.Sprintf("ct_tag_%d", index)
		visible, values := visibility(comicAlias)
		conditions = append(conditions, fmt.Sprintf(`EXISTS (
			SELECT 1 FROM "GroupExpandedComic" %[1]s
			JOIN "Comic" %[2]s ON %[2]s."id" = %[1]s."comicId"
			JOIN "ComicTag" %[3]s ON %[3]s."comicId" = %[2]s."id"
			JOIN "Tag" %[4]s ON %[4]s."id" = %[3]s."tagId"
			WHERE %[1]s."groupId" = g."id" AND %[5]s AND %[4]s."name" = ?
		)`, memberAlias, comicAlias, comicTagAlias, tagAlias, visible))
		whereArgs = append(whereArgs, values...)
		whereArgs = append(whereArgs, tagName)
	}
	if opts.FavoritesOnly {
		visible, values := visibility("c_favorite")
		favoriteCondition := `c_favorite."isFavorite" = 1`
		favoriteJoin := ""
		if opts.UserID != "" {
			favoriteJoin = `LEFT JOIN "UserComicState" ucs_favorite ON ucs_favorite."comicId" = c_favorite."id" AND ucs_favorite."userId" = ?`
			favoriteCondition = `COALESCE(ucs_favorite."isFavorite", 0) = 1`
			values = append([]interface{}{opts.UserID}, values...)
		}
		conditions = append(conditions, `EXISTS (
			SELECT 1 FROM "GroupExpandedComic" gm_favorite
			JOIN "Comic" c_favorite ON c_favorite."id" = gm_favorite."comicId"
			`+favoriteJoin+`
			WHERE gm_favorite."groupId" = g."id" AND `+visible+` AND `+favoriteCondition+`
		)`)
		whereArgs = append(whereArgs, values...)
	}

	whereClause := ""
	if len(conditions) > 0 {
		whereClause = " WHERE " + strings.Join(conditions, " AND ")
	}
	joinVisibility, joinArgs := visibility("c_member")
	havingClause := ""
	if !opts.IncludeEmpty {
		havingClause = ` HAVING COUNT(DISTINCT c_member."id") > 0`
	}
	args := append(joinArgs, whereArgs...)
	rows, err := db.Query(expandedMembersCTE+`
		SELECT g."id", g."name", g."coverUrl", g."sortOrder", g."shelfSeries", g."shelfSortMode",
		       g."author", g."description", g."tags", g."year",
		       g."publisher", g."language", g."genre", g."status",
		       g."createdAt", g."updatedAt",
		       COUNT(DISTINCT c_member."id") as comicCount,
		       CASE WHEN COUNT(DISTINCT CASE WHEN c_member."type" = 'novel' THEN c_member."id" END) > COUNT(DISTINCT c_member."id") / 2
		            THEN 'novel' ELSE 'comic' END as contentType
		FROM "ComicGroup" g
		LEFT JOIN "GroupExpandedComic" gm ON gm."groupId" = g."id"
		LEFT JOIN "Comic" c_member ON c_member."id" = gm."comicId" AND `+joinVisibility+`
	`+whereClause+`
		GROUP BY g."id"
		`+havingClause+`
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
		if err := rows.Scan(&g.ID, &g.Name, &g.CoverURL, &g.SortOrder, &g.ShelfSeries, &g.ShelfSortMode,
			&g.Author, &g.Description, &g.Tags, &g.Year,
			&g.Publisher, &g.Language, &g.Genre, &g.Status,
			&createdAt, &updatedAt, &g.ComicCount, &g.ContentType); err != nil {
			continue
		}
		g.CreatedAt = createdAt.UTC().Format(time.RFC3339)
		g.UpdatedAt = updatedAt.UTC().Format(time.RFC3339)
		// 封面 URL：优先自定义封面，否则使用第一个可见目录作品或散本的封面。
		if g.CoverURL != "" {
			g.CoverURL = BuildGroupCoverURL(g.ID)
		} else if g.ComicCount > 0 {
			var firstComicID string
			coverVisibility, coverArgs := visibility("c_cover")
			coverArgs = append([]interface{}{g.ID}, coverArgs...)
			err := db.QueryRow(expandedMembersCTE+`
				SELECT c_cover."id"
				FROM "GroupExpandedComic" gm_cover
				JOIN "Comic" c_cover ON c_cover."id" = gm_cover."comicId"
				WHERE gm_cover."groupId" = ? AND `+coverVisibility+`
				ORDER BY gm_cover."sourceOrder", gm_cover."outerSort", gm_cover."innerSort", c_cover."id"
				LIMIT 1
			`, coverArgs...).Scan(&firstComicID)
			if err == nil {
				g.CoverURL = BuildComicCoverURL(firstComicID)
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
	return GetGroupByIDWithOptions(groupID, GroupDetailOptions{ContentType: firstString(contentType)})
}

// GetGroupByIDWithOptions returns only members visible through the requested
// library scope. Directory series and direct comics share the same boundary.
func GetGroupByIDWithOptions(groupID int, opts GroupDetailOptions) (*ComicGroupDetail, error) {
	if opts.FilterLibraryIDs && len(opts.LibraryIDs) == 0 {
		return nil, nil
	}
	var g ComicGroupDetail
	var createdAt, updatedAt time.Time

	// 根据 contentType 决定 comicCount 子查询是否带类型过滤
	countSubQuery := `(SELECT COUNT(*) FROM "ComicGroupItem" WHERE "groupId" = g."id")`
	var countArgs []interface{}
	cType := opts.ContentType
	if cType == "comic" || cType == "novel" {
		countSubQuery = `(SELECT COUNT(*) FROM "ComicGroupItem" gi2 JOIN "Comic" c2 ON c2."id" = gi2."comicId" WHERE gi2."groupId" = g."id" AND c2."type" = ?)`
		countArgs = append(countArgs, cType)
	}

	queryArgs := append(countArgs, groupID)
	err := db.QueryRow(`
		SELECT g."id", g."name", g."coverUrl", g."sortOrder", g."shelfSeries", g."shelfSortMode",
		       g."author", g."description", g."tags", g."year",
		       g."publisher", g."language", g."genre", g."status",
		       g."createdAt", g."updatedAt",
		       `+countSubQuery+` as comicCount
		FROM "ComicGroup" g WHERE g."id" = ?
	`, queryArgs...).Scan(&g.ID, &g.Name, &g.CoverURL, &g.SortOrder, &g.ShelfSeries, &g.ShelfSortMode,
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
	if len(opts.LibraryIDs) > 0 {
		comicSQL += ` AND c."libraryId" IN (` + placeholders(len(opts.LibraryIDs)) + `)`
		for _, libraryID := range opts.LibraryIDs {
			comicArgs = append(comicArgs, libraryID)
		}
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
		item.CoverURL = BuildComicCoverURL(item.ComicID)
		if lastReadAt.Valid {
			s := lastReadAt.Time.UTC().Format(time.RFC3339)
			item.LastReadAt = &s
		}
		g.Comics = append(g.Comics, item)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()

	// 获取分组内的目录作品 (ComicSeries)
	g.SeriesList = []GroupSeriesItem{}
	seriesSQL := `
		SELECT cs."id", cs."title", cs."rootRelativePath", cs."coverComicId", cs."coverUrl", cgs."sortIndex"
		FROM "ComicGroupSeries" cgs
		JOIN "ComicSeries" cs ON cs."id" = cgs."seriesId"
		WHERE cgs."groupId" = ?`
	seriesArgs := []interface{}{groupID}
	if cType == "novel" {
		seriesSQL += ` AND 1 = 0`
	}
	if len(opts.LibraryIDs) > 0 {
		seriesSQL += ` AND cs."libraryId" IN (` + placeholders(len(opts.LibraryIDs)) + `)`
		for _, libraryID := range opts.LibraryIDs {
			seriesArgs = append(seriesArgs, libraryID)
		}
	}
	seriesSQL += ` ORDER BY cgs."sortIndex" ASC`
	seriesRows, err := db.Query(seriesSQL, seriesArgs...)
	if err != nil {
		return nil, err
	}
	defer seriesRows.Close()
	for seriesRows.Next() {
		var sItem GroupSeriesItem
		var storedCoverURL string
		if scanErr := seriesRows.Scan(&sItem.SeriesID, &sItem.Title, &sItem.RootRelativePath, &sItem.CoverComicID, &storedCoverURL, &sItem.SortIndex); scanErr == nil {
			sItem.Comics = []GroupComicItem{}
			seriesComicSQL := `
					SELECT c."id", c."filename", c."title", c."pageCount", c."fileSize",
					       c."lastReadPage", c."totalReadTime", c."readingStatus", c."lastReadAt",
					       csi."sortIndex", COALESCE(c."type", '') as "type"
					FROM "ComicSeriesItem" csi
					JOIN "ComicSeries" cs_member ON cs_member."id" = csi."seriesId"
					JOIN "Comic" c ON c."id" = csi."comicId" AND c."libraryId" = cs_member."libraryId"
					WHERE csi."seriesId" = ?`
			seriesComicArgs := []interface{}{sItem.SeriesID}
			if cType == "comic" {
				seriesComicSQL += ` AND c."type" = ?`
				seriesComicArgs = append(seriesComicArgs, cType)
			}
			seriesComicSQL += ` ORDER BY csi."sortIndex" ASC`
			cRows, cErr := db.Query(seriesComicSQL, seriesComicArgs...)
			if cErr != nil {
				return nil, cErr
			}
			coverVisible := false
			for cRows.Next() {
				var item GroupComicItem
				var lastReadAt sql.NullTime
				if cRows.Scan(
					&item.ComicID, &item.Filename, &item.Title, &item.PageCount, &item.FileSize,
					&item.LastReadPage, &item.TotalReadTime, &item.ReadingStatus, &lastReadAt,
					&item.SortIndex, &item.ComicType,
				) == nil {
					item.CoverURL = BuildComicCoverURL(item.ComicID)
					if lastReadAt.Valid {
						str := lastReadAt.Time.UTC().Format(time.RFC3339)
						item.LastReadAt = &str
					}
					if item.ComicID == sItem.CoverComicID {
						coverVisible = true
					}
					sItem.Comics = append(sItem.Comics, item)
				}
			}
			cRows.Close()
			if len(sItem.Comics) > 0 {
				if storedCoverURL != "" {
					sItem.CoverURL = BuildSeriesCoverURL(sItem.SeriesID)
				} else if coverVisible {
					sItem.CoverURL = BuildComicCoverURL(sItem.CoverComicID)
				} else {
					sItem.CoverURL = sItem.Comics[0].CoverURL
				}
			}
			if len(sItem.Comics) > 0 || cType == "" {
				g.SeriesList = append(g.SeriesList, sItem)
			}
		}
	}
	if err := seriesRows.Err(); err != nil {
		return nil, err
	}

	memberIDs := make(map[string]struct{}, len(g.Comics))
	for _, comic := range g.Comics {
		memberIDs[comic.ComicID] = struct{}{}
	}
	for _, series := range g.SeriesList {
		for _, comic := range series.Comics {
			memberIDs[comic.ComicID] = struct{}{}
		}
	}
	g.ComicCount = len(memberIDs)

	// 封面 URL：有自定义封面时返回本地缓存路径，无封面时按优先使用 Series 目录作品或第一本漫画缩略图
	if g.CoverURL != "" {
		g.CoverURL = BuildGroupCoverURL(g.ID)
	} else if len(g.SeriesList) > 0 && g.SeriesList[0].CoverURL != "" {
		g.CoverURL = g.SeriesList[0].CoverURL
	} else if len(g.Comics) > 0 {
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

// CreateGroupWithItems atomically creates a group and all requested direct and
// directory-series memberships. Any invalid membership rolls back the group.
func CreateGroupWithItems(name, userID string, comicIDs, seriesIDs []string) (int64, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return 0, fmt.Errorf("group name is required")
	}
	tx, err := db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()

	now := time.Now().UTC()
	result, err := tx.Exec(`
		INSERT INTO "ComicGroup" ("name", "userId", "createdAt", "updatedAt")
		VALUES (?, ?, ?, ?)
	`, name, userID, now, now)
	if err != nil {
		return 0, err
	}
	groupID, err := result.LastInsertId()
	if err != nil {
		return 0, err
	}

	sortedComicIDs := append([]string(nil), comicIDs...)
	if len(sortedComicIDs) > 1 {
		titles := make(map[string]string, len(sortedComicIDs))
		for _, comicID := range sortedComicIDs {
			var title string
			if err := tx.QueryRow(`SELECT "title" FROM "Comic" WHERE "id" = ?`, comicID).Scan(&title); err != nil {
				return 0, fmt.Errorf("resolve comic %s: %w", comicID, err)
			}
			titles[comicID] = title
		}
		sort.SliceStable(sortedComicIDs, func(i, j int) bool {
			return naturalSortKey(titles[sortedComicIDs[i]]) < naturalSortKey(titles[sortedComicIDs[j]])
		})
	}
	for index, comicID := range sortedComicIDs {
		if _, err := tx.Exec(`
			INSERT INTO "ComicGroupItem" ("groupId", "comicId", "sortIndex")
			VALUES (?, ?, ?)
			ON CONFLICT("groupId", "comicId") DO NOTHING
		`, groupID, comicID, index); err != nil {
			return 0, fmt.Errorf("add comic %s: %w", comicID, err)
		}
	}
	for index, seriesID := range seriesIDs {
		if _, err := tx.Exec(`
			INSERT INTO "ComicGroupSeries" ("groupId", "seriesId", "sortIndex")
			VALUES (?, ?, ?)
			ON CONFLICT("groupId", "seriesId") DO NOTHING
		`, groupID, seriesID, index); err != nil {
			return 0, fmt.Errorf("add series %s: %w", seriesID, err)
		}
	}

	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return groupID, nil
}

// UpdateGroup 更新分组名称和封面。
func UpdateGroup(groupID int, name string, coverURL string) error {
	if coverURL == "" || strings.HasPrefix(coverURL, "/api/comics/group_") {
		_, err := db.Exec(`
			UPDATE "ComicGroup" SET "name" = ?, "updatedAt" = ?
			WHERE "id" = ?
		`, name, time.Now().UTC(), groupID)
		return err
	}

	_, err := db.Exec(`
		UPDATE "ComicGroup" SET "name" = ?, "coverUrl" = ?, "updatedAt" = ?
		WHERE "id" = ?
	`, name, coverURL, time.Now().UTC(), groupID)
	return err
}

// UpdateGroupShelfSettings controls whether a collection participates in the
// title-sorted shelf and how its members are ordered inside that shelf block.
func UpdateGroupShelfSettings(groupID int, enabled bool, sortMode string) error {
	sortMode = strings.ToLower(strings.TrimSpace(sortMode))
	if sortMode == "" {
		sortMode = "custom"
	}
	if sortMode != "custom" && sortMode != "publication" && sortMode != "volume" {
		return ErrShelfSortModeInvalid
	}
	if enabled {
		var conflict int
		err := db.QueryRow(`
			SELECT EXISTS (
				SELECT 1
				FROM "ComicGroupSeries" mine
				JOIN "ComicGroupSeries" other ON other."seriesId" = mine."seriesId" AND other."groupId" != mine."groupId"
				JOIN "ComicGroup" owner ON owner."id" = other."groupId" AND owner."shelfSeries" = 1
				WHERE mine."groupId" = ?
				UNION ALL
				SELECT 1
				FROM "ComicGroupItem" mine
				JOIN "ComicGroupItem" other ON other."comicId" = mine."comicId" AND other."groupId" != mine."groupId"
				JOIN "ComicGroup" owner ON owner."id" = other."groupId" AND owner."shelfSeries" = 1
				WHERE mine."groupId" = ?
				LIMIT 1
			)
		`, groupID, groupID).Scan(&conflict)
		if err != nil {
			return err
		}
		if conflict != 0 {
			return ErrShelfSeriesConflict
		}
	}

	_, err := db.Exec(`
		UPDATE "ComicGroup"
		SET "shelfSeries" = ?, "shelfSortMode" = ?, "updatedAt" = ?
		WHERE "id" = ?
	`, enabled, sortMode, time.Now().UTC(), groupID)
	return err
}

func groupUsesShelfSeries(groupID int) (bool, error) {
	var enabled bool
	err := db.QueryRow(`SELECT "shelfSeries" FROM "ComicGroup" WHERE "id" = ?`, groupID).Scan(&enabled)
	return enabled, err
}

func ensureShelfMembersAvailable(groupID int, memberTable, memberColumn string, memberIDs []string) error {
	if len(memberIDs) == 0 {
		return nil
	}
	enabled, err := groupUsesShelfSeries(groupID)
	if err != nil || !enabled {
		return err
	}
	for _, memberID := range memberIDs {
		var conflict int
		query := fmt.Sprintf(`
			SELECT EXISTS (
				SELECT 1 FROM %s member
				JOIN "ComicGroup" owner ON owner."id" = member."groupId" AND owner."shelfSeries" = 1
				WHERE member.%s = ? AND member."groupId" != ?
			)
		`, memberTable, memberColumn)
		if err := db.QueryRow(query, memberID, groupID).Scan(&conflict); err != nil {
			return err
		}
		if conflict != 0 {
			return ErrShelfSeriesConflict
		}
	}
	return nil
}

func GetGroupStoredCoverURL(groupID int) (string, error) {
	var coverURL string
	err := db.QueryRow(`SELECT "coverUrl" FROM "ComicGroup" WHERE "id" = ?`, groupID).Scan(&coverURL)
	return coverURL, err
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

	// External rating fields
	ExternalRating          *float64   `json:"externalRating"`
	ExternalRatingMax       *float64   `json:"externalRatingMax"`
	ExternalRatingSource    *string    `json:"externalRatingSource"`
	ExternalRatingUpdatedAt *time.Time `json:"externalRatingUpdatedAt"`
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
	if update.ExternalRating != nil {
		setClauses = append(setClauses, `"externalRating" = ?`)
		args = append(args, *update.ExternalRating)
	}
	if update.ExternalRatingMax != nil {
		setClauses = append(setClauses, `"externalRatingMax" = ?`)
		args = append(args, *update.ExternalRatingMax)
	}
	if update.ExternalRatingSource != nil {
		setClauses = append(setClauses, `"externalRatingSource" = ?`)
		args = append(args, *update.ExternalRatingSource)
	}
	if update.ExternalRatingUpdatedAt != nil {
		setClauses = append(setClauses, `"externalRatingUpdatedAt" = ?`)
		args = append(args, *update.ExternalRatingUpdatedAt)
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
	if err := ensureShelfMembersAvailable(groupID, `"ComicGroupItem"`, `"comicId"`, comicIDs); err != nil {
		return err
	}
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

// RemoveComicFromGroup 从分组移除漫画。如果移除后分组无任何数据，自动删除分组。
func RemoveComicFromGroup(groupID int, comicID string) error {
	_, err := db.Exec(`DELETE FROM "ComicGroupItem" WHERE "groupId" = ? AND "comicId" = ?`, groupID, comicID)
	if err != nil {
		return err
	}
	db.Exec(`UPDATE "ComicGroup" SET "updatedAt" = ? WHERE "id" = ?`, time.Now().UTC(), groupID)

	// 检查分组是否为空（无漫画且无目录作品），为空则自动删除
	var countItems, countSeries int
	_ = db.QueryRow(`SELECT COUNT(*) FROM "ComicGroupItem" WHERE "groupId" = ?`, groupID).Scan(&countItems)
	_ = db.QueryRow(`SELECT COUNT(*) FROM "ComicGroupSeries" WHERE "groupId" = ?`, groupID).Scan(&countSeries)
	if countItems == 0 && countSeries == 0 {
		db.Exec(`DELETE FROM "ComicGroup" WHERE "id" = ?`, groupID)
	}

	return nil
}

// AddSeriesToGroup 将一个或多个目录作品 (ComicSeries) 添加到分组。
func AddSeriesToGroup(groupID int, seriesIDs []string) error {
	if len(seriesIDs) == 0 {
		return nil
	}
	if err := ensureShelfMembersAvailable(groupID, `"ComicGroupSeries"`, `"seriesId"`, seriesIDs); err != nil {
		return err
	}
	var maxIdx int
	db.QueryRow(`SELECT COALESCE(MAX("sortIndex"), -1) FROM "ComicGroupSeries" WHERE "groupId" = ?`, groupID).Scan(&maxIdx)

	for i, seriesID := range seriesIDs {
		_, err := db.Exec(`
			INSERT INTO "ComicGroupSeries" ("groupId", "seriesId", "sortIndex")
			VALUES (?, ?, ?)
			ON CONFLICT("groupId", "seriesId") DO NOTHING
		`, groupID, seriesID, maxIdx+1+i)
		if err != nil {
			return err
		}
	}

	db.Exec(`UPDATE "ComicGroup" SET "updatedAt" = ? WHERE "id" = ?`, time.Now().UTC(), groupID)
	return nil
}

// RemoveSeriesFromGroup 从分组移除目录作品 (ComicSeries)。如果移除后分组无任何数据，自动删除分组。
func RemoveSeriesFromGroup(groupID int, seriesID string) error {
	_, err := db.Exec(`DELETE FROM "ComicGroupSeries" WHERE "groupId" = ? AND "seriesId" = ?`, groupID, seriesID)
	if err != nil {
		return err
	}
	db.Exec(`UPDATE "ComicGroup" SET "updatedAt" = ? WHERE "id" = ?`, time.Now().UTC(), groupID)

	var countItems, countSeries int
	_ = db.QueryRow(`SELECT COUNT(*) FROM "ComicGroupItem" WHERE "groupId" = ?`, groupID).Scan(&countItems)
	_ = db.QueryRow(`SELECT COUNT(*) FROM "ComicGroupSeries" WHERE "groupId" = ?`, groupID).Scan(&countSeries)
	if countItems == 0 && countSeries == 0 {
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

// ReorderGroupSeries updates the display order of every directory work in a group.
// The caller must provide the complete membership list exactly once so a stale UI
// cannot accidentally leave duplicate or partially ordered entries behind.
func ReorderGroupSeries(groupID int, seriesIDs []string) error {
	if len(seriesIDs) == 0 {
		return fmt.Errorf("%w: series ID list is required", ErrGroupSeriesOrderMismatch)
	}

	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	rows, err := tx.Query(`SELECT "seriesId" FROM "ComicGroupSeries" WHERE "groupId" = ?`, groupID)
	if err != nil {
		return err
	}
	members := make(map[string]struct{}, len(seriesIDs))
	for rows.Next() {
		var seriesID string
		if err := rows.Scan(&seriesID); err != nil {
			rows.Close()
			return err
		}
		members[seriesID] = struct{}{}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()

	if len(members) != len(seriesIDs) {
		return ErrGroupSeriesOrderMismatch
	}
	seen := make(map[string]struct{}, len(seriesIDs))
	for _, seriesID := range seriesIDs {
		if _, ok := members[seriesID]; !ok {
			return fmt.Errorf("%w: series %q is not in group", ErrGroupSeriesOrderMismatch, seriesID)
		}
		if _, duplicate := seen[seriesID]; duplicate {
			return fmt.Errorf("%w: series %q appears more than once", ErrGroupSeriesOrderMismatch, seriesID)
		}
		seen[seriesID] = struct{}{}
	}

	stmt, err := tx.Prepare(`UPDATE "ComicGroupSeries" SET "sortIndex" = ? WHERE "groupId" = ? AND "seriesId" = ?`)
	if err != nil {
		return err
	}
	defer stmt.Close()
	for index, seriesID := range seriesIDs {
		if _, err := stmt.Exec(index, groupID, seriesID); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(`UPDATE "ComicGroup" SET "updatedAt" = ? WHERE "id" = ?`, time.Now().UTC(), groupID); err != nil {
		return err
	}
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
