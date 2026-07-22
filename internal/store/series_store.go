package store

import (
	"database/sql"
	"fmt"
	"sort"
	"strings"
	"time"
)

const SeriesShelfIDPrefix = "series-"

type SeriesSourceItem struct {
	ID           string
	Title        string
	Filename     string
	RelativePath string
}

type DetectedSeries struct {
	ID               string
	LibraryID        string
	RootRelativePath string
	Title            string
	SortTitle        string
	CoverComicID     string
	Sections         []DetectedSeriesSection
	Items            []DetectedSeriesItem
}

type DetectedSeriesSection struct {
	ID              string
	Title           string
	RelativePath    string
	Kind            string
	SeasonNumber    *int
	SortIndex       int
	DetectionSource string
}

type DetectedSeriesItem struct {
	ComicID      string
	SectionID    string
	SortIndex    int
	DisplayLabel string
}

type SeriesSummary struct {
	ID                 string  `json:"id"`
	LibraryID          string  `json:"libraryId"`
	RootRelativePath   string  `json:"rootRelativePath"`
	Title              string  `json:"title"`
	SortTitle          string  `json:"sortTitle"`
	CoverComicID       string  `json:"coverComicId"`
	CoverURL           string  `json:"coverUrl"`
	ItemCount          int     `json:"itemCount"`
	SectionCount       int     `json:"sectionCount"`
	CompletedItemCount int     `json:"completedItemCount"`
	TotalReadTime      int     `json:"totalReadTime"`
	FileSize           int64   `json:"fileSize"`
	LastReadAt         *string `json:"lastReadAt"`
	IsFavorite         bool    `json:"isFavorite"`
	ManualLocked       bool    `json:"manualLocked"`
	CanManage          bool    `json:"canManage,omitempty"`
	CreatedAt          string  `json:"createdAt"`
	UpdatedAt          string  `json:"updatedAt"`
}

type SeriesItemDetail struct {
	Comic        ComicListItem `json:"comic"`
	SectionID    string        `json:"sectionId,omitempty"`
	SortIndex    int           `json:"sortIndex"`
	DisplayLabel string        `json:"displayLabel"`
}

type SeriesSectionDetail struct {
	ID           string             `json:"id"`
	Title        string             `json:"title"`
	RelativePath string             `json:"relativePath"`
	Kind         string             `json:"kind"`
	SeasonNumber *int               `json:"seasonNumber,omitempty"`
	SortIndex    int                `json:"sortIndex"`
	ManualLocked bool               `json:"manualLocked"`
	Items        []SeriesItemDetail `json:"items"`
}

type SeriesDetail struct {
	Series      SeriesSummary         `json:"series"`
	Sections    []SeriesSectionDetail `json:"sections"`
	Unsectioned []SeriesItemDetail    `json:"unsectioned"`
}

func GetComicSeriesSourceFingerprint() (string, error) {
	var comicCount, comicPathLength, libraryCount int64
	var comicUpdatedAt, libraryUpdatedAt string
	err := db.QueryRow(`
		SELECT COUNT(*),
		       COALESCE(SUM(LENGTH(COALESCE(NULLIF(c."relativePath", ''), c."filename")) + LENGTH(c."title")), 0),
		       COALESCE(MAX(CAST(c."updatedAt" AS TEXT)), '')
		FROM "Comic" c
		JOIN "Library" l ON l."id" = c."libraryId"
		WHERE l."enabled" = 1 AND l."type" = 'comic'
	`).Scan(&comicCount, &comicPathLength, &comicUpdatedAt)
	if err != nil {
		return "", err
	}
	if err := db.QueryRow(`
		SELECT COUNT(*), COALESCE(MAX(CAST("updatedAt" AS TEXT)), '')
		FROM "Library" WHERE "enabled" = 1 AND "type" = 'comic'
	`).Scan(&libraryCount, &libraryUpdatedAt); err != nil {
		return "", err
	}
	return fmt.Sprintf("%d:%d:%s:%d:%s", comicCount, comicPathLength, comicUpdatedAt, libraryCount, libraryUpdatedAt), nil
}

func GetSeriesSourceItems(libraryID string) ([]SeriesSourceItem, error) {
	rows, err := db.Query(`
		SELECT c."id", c."title", c."filename", COALESCE(NULLIF(c."relativePath", ''), c."filename")
		FROM "Comic" c
		JOIN "Library" l ON l."id" = c."libraryId"
		WHERE c."libraryId" = ? AND l."type" = 'comic'
		ORDER BY c."relativePath", c."filename"
	`, libraryID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []SeriesSourceItem
	for rows.Next() {
		var item SeriesSourceItem
		if err := rows.Scan(&item.ID, &item.Title, &item.Filename, &item.RelativePath); err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func ReplaceDetectedSeries(libraryID string, detected []DetectedSeries) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	locked := make(map[string]bool)
	rows, err := tx.Query(`SELECT "rootRelativePath" FROM "ComicSeries" WHERE "libraryId" = ? AND "manualLocked" = 1`, libraryID)
	if err != nil {
		return err
	}
	for rows.Next() {
		var root string
		if rows.Scan(&root) == nil {
			locked[root] = true
		}
	}
	rows.Close()

	// Clear only automatically detected memberships before rebuilding. This
	// prevents the unique comicId membership index from blocking a safe
	// directory rename while preserving all manually locked structures.
	if _, err := tx.Exec(`
		DELETE FROM "ComicSeriesItem"
		WHERE "seriesId" IN (
			SELECT "id" FROM "ComicSeries"
			WHERE "libraryId" = ? AND "manualLocked" = 0
		)
	`, libraryID); err != nil {
		return err
	}

	seen := make(map[string]struct{}, len(detected))
	for _, series := range detected {
		seen[series.RootRelativePath] = struct{}{}
		if locked[series.RootRelativePath] {
			continue
		}
		if _, err := tx.Exec(`
			INSERT INTO "ComicSeries" ("id", "libraryId", "rootRelativePath", "title", "sortTitle", "coverComicId", "detectionSource", "manualLocked", "createdAt", "updatedAt")
			VALUES (?, ?, ?, ?, ?, ?, 'directory', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
			ON CONFLICT("libraryId", "rootRelativePath") DO UPDATE SET
				"title" = excluded."title",
				"sortTitle" = excluded."sortTitle",
				"coverComicId" = CASE WHEN "ComicSeries"."coverComicId" = '' THEN excluded."coverComicId" ELSE "ComicSeries"."coverComicId" END,
				"updatedAt" = CURRENT_TIMESTAMP
		`, series.ID, series.LibraryID, series.RootRelativePath, series.Title, series.SortTitle, series.CoverComicID); err != nil {
			return err
		}

		var persistedID string
		if err := tx.QueryRow(`SELECT "id" FROM "ComicSeries" WHERE "libraryId" = ? AND "rootRelativePath" = ?`, series.LibraryID, series.RootRelativePath).Scan(&persistedID); err != nil {
			return err
		}
		if _, err := tx.Exec(`DELETE FROM "ComicSeriesItem" WHERE "seriesId" = ?`, persistedID); err != nil {
			return err
		}
		if _, err := tx.Exec(`DELETE FROM "ComicSeriesSection" WHERE "seriesId" = ? AND "manualLocked" = 0`, persistedID); err != nil {
			return err
		}

		sectionIDMap := make(map[string]string, len(series.Sections))
		for _, section := range series.Sections {
			sectionID := section.ID
			sectionIDMap[section.ID] = sectionID
			if _, err := tx.Exec(`
				INSERT INTO "ComicSeriesSection" ("id", "seriesId", "title", "relativePath", "kind", "seasonNumber", "sortIndex", "detectionSource", "manualLocked")
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
				ON CONFLICT("seriesId", "relativePath") DO UPDATE SET
					"title" = excluded."title", "kind" = excluded."kind", "seasonNumber" = excluded."seasonNumber",
					"sortIndex" = excluded."sortIndex", "detectionSource" = excluded."detectionSource"
			`, sectionID, persistedID, section.Title, section.RelativePath, section.Kind, section.SeasonNumber, section.SortIndex, section.DetectionSource); err != nil {
				return err
			}
		}
		for _, item := range series.Items {
			var sectionID interface{}
			if item.SectionID != "" {
				mapped := sectionIDMap[item.SectionID]
				sectionID = mapped
			}
			if _, err := tx.Exec(`
				INSERT INTO "ComicSeriesItem" ("seriesId", "sectionId", "comicId", "sortIndex", "displayLabel")
				VALUES (?, ?, ?, ?, ?)
				ON CONFLICT("seriesId", "comicId") DO UPDATE SET
					"sectionId" = excluded."sectionId", "sortIndex" = excluded."sortIndex", "displayLabel" = excluded."displayLabel"
			`, persistedID, sectionID, item.ComicID, item.SortIndex, item.DisplayLabel); err != nil {
				return err
			}
		}
	}

	staleRows, err := tx.Query(`SELECT "id", "rootRelativePath" FROM "ComicSeries" WHERE "libraryId" = ? AND "manualLocked" = 0`, libraryID)
	if err != nil {
		return err
	}
	var staleIDs []string
	for staleRows.Next() {
		var id, root string
		if staleRows.Scan(&id, &root) == nil {
			if _, ok := seen[root]; !ok {
				staleIDs = append(staleIDs, id)
			}
		}
	}
	staleRows.Close()
	for _, id := range staleIDs {
		if _, err := tx.Exec(`DELETE FROM "ComicSeries" WHERE "id" = ?`, id); err != nil {
			return err
		}
	}

	// Directory-created ComicGroup rows represented the old flat workaround.
	// Remove only groups fully covered by the new series model and scoped to
	// this library. User-created collections are never touched.
	if _, err := tx.Exec(`
		DELETE FROM "ComicGroup"
		WHERE COALESCE("autoCreated", 0) = 1
		  AND COALESCE("classifyMode", '') = 'directory'
		  AND EXISTS (
			SELECT 1 FROM "ComicGroupItem" gi
			JOIN "Comic" c ON c."id" = gi."comicId"
			WHERE gi."groupId" = "ComicGroup"."id" AND c."libraryId" = ?
		  )
		  AND NOT EXISTS (
			SELECT 1 FROM "ComicGroupItem" gi
			JOIN "Comic" c ON c."id" = gi."comicId"
			WHERE gi."groupId" = "ComicGroup"."id" AND c."libraryId" <> ?
		  )
		  AND NOT EXISTS (
			SELECT 1 FROM "ComicGroupItem" gi
			JOIN "Comic" c ON c."id" = gi."comicId"
			WHERE gi."groupId" = "ComicGroup"."id"
			  AND c."libraryId" = ?
			  AND NOT EXISTS (SELECT 1 FROM "ComicSeriesItem" si WHERE si."comicId" = gi."comicId")
		  )
	`, libraryID, libraryID, libraryID); err != nil {
		return err
	}

	return tx.Commit()
}

func seriesSummaryByID(id, userID string) (*SeriesSummary, error) {
	userJoin := ""
	userArgs := []interface{}{}
	stateLastRead := `c."lastReadAt"`
	stateFavorite := `c."isFavorite"`
	statePage := `c."lastReadPage"`
	stateStatus := `c."readingStatus"`
	stateReadTime := `c."totalReadTime"`
	if userID != "" {
		userJoin = `LEFT JOIN "UserComicState" ucs ON ucs."comicId" = c."id" AND ucs."userId" = ?`
		userArgs = append(userArgs, userID)
		stateLastRead = `ucs."lastReadAt"`
		stateFavorite = `COALESCE(ucs."isFavorite", 0)`
		statePage = `COALESCE(ucs."lastReadPage", 0)`
		stateStatus = `COALESCE(ucs."readingStatus", '')`
		stateReadTime = `COALESCE(ucs."totalReadTime", 0)`
	}
	query := fmt.Sprintf(`
		SELECT s."id", s."libraryId", s."rootRelativePath", s."title", s."sortTitle", s."coverComicId", s."manualLocked",
		       COUNT(DISTINCT si."comicId"), COUNT(DISTINCT sec."id"),
		       SUM(CASE WHEN %s = 'finished' OR (c."pageCount" > 0 AND %s IS NOT NULL AND %s >= c."pageCount" - 1) THEN 1 ELSE 0 END),
		       COALESCE(SUM(%s), 0), COALESCE(SUM(c."fileSize"), 0), MAX(%s), MAX(%s),
		       s."createdAt", s."updatedAt"
		FROM "ComicSeries" s
		JOIN "ComicSeriesItem" si ON si."seriesId" = s."id"
		JOIN "Comic" c ON c."id" = si."comicId"
		LEFT JOIN "ComicSeriesSection" sec ON sec."id" = si."sectionId"
		%s
		WHERE s."id" = ?
		GROUP BY s."id"
	`, stateStatus, stateLastRead, statePage, stateReadTime, stateLastRead, stateFavorite, userJoin)
	args := append(userArgs, id)
	var summary SeriesSummary
	var lastRead sql.NullString
	var favorite sql.NullBool
	var createdAt, updatedAt time.Time
	if err := db.QueryRow(query, args...).Scan(
		&summary.ID, &summary.LibraryID, &summary.RootRelativePath, &summary.Title, &summary.SortTitle,
		&summary.CoverComicID, &summary.ManualLocked, &summary.ItemCount, &summary.SectionCount,
		&summary.CompletedItemCount, &summary.TotalReadTime, &summary.FileSize, &lastRead, &favorite,
		&createdAt, &updatedAt,
	); err == sql.ErrNoRows {
		return nil, nil
	} else if err != nil {
		return nil, err
	}
	summary.CreatedAt = createdAt.UTC().Format(time.RFC3339Nano)
	summary.UpdatedAt = updatedAt.UTC().Format(time.RFC3339Nano)
	if lastRead.Valid && lastRead.String != "" {
		value := lastRead.String
		summary.LastReadAt = &value
	}
	summary.IsFavorite = favorite.Valid && favorite.Bool
	if summary.CoverComicID == "" {
		_ = db.QueryRow(`SELECT "comicId" FROM "ComicSeriesItem" WHERE "seriesId" = ? ORDER BY "sortIndex", "comicId" LIMIT 1`, id).Scan(&summary.CoverComicID)
	}
	if summary.CoverComicID != "" {
		summary.CoverURL = "/api/comics/" + summary.CoverComicID + "/thumbnail"
	}
	return &summary, nil
}

func CollapseComicListIntoSeries(items []ComicListItem, userID string) ([]ComicListItem, error) {
	if len(items) == 0 {
		return items, nil
	}
	placeholders := make([]string, len(items))
	args := make([]interface{}, len(items))
	for i := range items {
		placeholders[i] = "?"
		args[i] = items[i].ID
	}
	rows, err := db.Query(fmt.Sprintf(`SELECT "comicId", "seriesId" FROM "ComicSeriesItem" WHERE "comicId" IN (%s)`, strings.Join(placeholders, ",")), args...)
	if err != nil {
		return nil, err
	}
	memberToSeries := make(map[string]string)
	seriesIDs := make(map[string]struct{})
	for rows.Next() {
		var comicID, seriesID string
		if rows.Scan(&comicID, &seriesID) == nil {
			memberToSeries[comicID] = seriesID
			seriesIDs[seriesID] = struct{}{}
		}
	}
	rows.Close()
	if len(seriesIDs) == 0 {
		return items, nil
	}

	collapsed := make([]ComicListItem, 0, len(items)-len(memberToSeries)+len(seriesIDs))
	for _, item := range items {
		if _, grouped := memberToSeries[item.ID]; !grouped {
			collapsed = append(collapsed, item)
		}
	}
	for seriesID := range seriesIDs {
		summary, err := seriesSummaryByID(seriesID, userID)
		if err != nil {
			return nil, err
		}
		if summary == nil || summary.ItemCount < 2 {
			continue
		}
		tags := []ComicTagInfo{{Name: fmt.Sprintf("%d 项", summary.ItemCount), Color: ""}}
		if summary.SectionCount > 0 {
			tags = append(tags, ComicTagInfo{Name: fmt.Sprintf("%d 季/篇", summary.SectionCount), Color: ""})
		}
		collapsed = append(collapsed, ComicListItem{
			ID:            SeriesShelfIDPrefix + summary.ID,
			Filename:      "__series__.cbz",
			Title:         summary.Title,
			TitleSortKey:  BuildTitleSortKey(summary.Title),
			PageCount:     summary.ItemCount,
			FileSize:      summary.FileSize,
			AddedAt:       summary.CreatedAt,
			UpdatedAt:     summary.UpdatedAt,
			LastReadPage:  summary.CompletedItemCount,
			LastReadAt:    summary.LastReadAt,
			IsFavorite:    summary.IsFavorite,
			TotalReadTime: summary.TotalReadTime,
			CoverURL:      summary.CoverURL,
			ComicType:     "comic",
			LibraryID:     summary.LibraryID,
			ComicCount:    summary.ItemCount,
			Tags:          tags,
			Categories:    []ComicCategoryInfo{},
		})
	}
	return collapsed, nil
}

// getAllComicsSeriesView applies filters to readable items, collapses directory
// series, then paginates the logical shelf. This keeps a series from being split
// across SQL pages and gives callers stable totals for the mixed shelf.
func getAllComicsSeriesView(opts ComicListOptions) (*ComicListResult, error) {
	page, pageSize := opts.Page, opts.PageSize
	if page < 1 {
		page = 1
	}

	flatOpts := opts
	flatOpts.SeriesView = false
	flatOpts.Page = 0
	flatOpts.PageSize = 0
	flat, err := GetAllComics(flatOpts)
	if err != nil {
		return nil, err
	}
	items, err := CollapseComicListIntoSeries(flat.Comics, opts.UserID)
	if err != nil {
		return nil, err
	}
	sortSeriesShelfItems(items, opts.SortBy, opts.SortOrder)

	total := len(items)
	totalPages := 1
	if pageSize > 0 {
		if total > 0 {
			totalPages = (total + pageSize - 1) / pageSize
		}
		start := (page - 1) * pageSize
		if start >= total {
			items = []ComicListItem{}
		} else {
			end := start + pageSize
			if end > total {
				end = total
			}
			items = items[start:end]
		}
	} else {
		pageSize = total
	}

	return &ComicListResult{
		Comics:     items,
		Total:      total,
		Page:       page,
		PageSize:   pageSize,
		TotalPages: totalPages,
	}, nil
}

func sortSeriesShelfItems(items []ComicListItem, sortBy, sortOrder string) {
	desc := strings.EqualFold(sortOrder, "desc")
	compareString := func(a, b string) int {
		if a < b {
			return -1
		}
		if a > b {
			return 1
		}
		return 0
	}
	compareInt64 := func(a, b int64) int {
		if a < b {
			return -1
		}
		if a > b {
			return 1
		}
		return 0
	}
	valueString := func(value *string) string {
		if value == nil {
			return ""
		}
		return *value
	}
	valueInt := func(value *int) int64 {
		if value == nil {
			return -1
		}
		return int64(*value)
	}

	sort.SliceStable(items, func(i, j int) bool {
		a, b := items[i], items[j]
		cmp := 0
		switch sortBy {
		case "addedAt":
			cmp = compareString(a.AddedAt, b.AddedAt)
		case "updatedAt":
			cmp = compareString(a.UpdatedAt, b.UpdatedAt)
		case "lastReadAt":
			cmp = compareString(valueString(a.LastReadAt), valueString(b.LastReadAt))
		case "rating":
			cmp = compareInt64(valueInt(a.Rating), valueInt(b.Rating))
		case "custom":
			cmp = compareInt64(int64(a.SortOrder), int64(b.SortOrder))
		case "fileSize":
			cmp = compareInt64(a.FileSize, b.FileSize)
		case "metadataSource":
			cmp = compareString(a.MetadataSource, b.MetadataSource)
		default:
			cmp = compareString(a.TitleSortKey, b.TitleSortKey)
		}
		if cmp == 0 {
			cmp = compareString(a.TitleSortKey, b.TitleSortKey)
		}
		if cmp == 0 {
			cmp = compareString(a.Title, b.Title)
		}
		if cmp == 0 {
			cmp = compareString(a.ID, b.ID)
		}
		if desc {
			return cmp > 0
		}
		return cmp < 0
	})
}

func GetSeriesDetail(id, userID string) (*SeriesDetail, error) {
	summary, err := seriesSummaryByID(id, userID)
	if err != nil || summary == nil {
		return nil, err
	}
	sectionsRows, err := db.Query(`
		SELECT "id", "title", "relativePath", "kind", "seasonNumber", "sortIndex", "manualLocked"
		FROM "ComicSeriesSection" WHERE "seriesId" = ? ORDER BY "sortIndex", "title"
	`, id)
	if err != nil {
		return nil, err
	}
	sections := make([]SeriesSectionDetail, 0)
	sectionIndex := make(map[string]int)
	for sectionsRows.Next() {
		var section SeriesSectionDetail
		var number sql.NullInt64
		if err := sectionsRows.Scan(&section.ID, &section.Title, &section.RelativePath, &section.Kind, &number, &section.SortIndex, &section.ManualLocked); err != nil {
			sectionsRows.Close()
			return nil, err
		}
		if number.Valid {
			n := int(number.Int64)
			section.SeasonNumber = &n
		}
		section.Items = []SeriesItemDetail{}
		sectionIndex[section.ID] = len(sections)
		sections = append(sections, section)
	}
	sectionsRows.Close()

	itemRows, err := db.Query(`SELECT "comicId", COALESCE("sectionId", ''), "sortIndex", "displayLabel" FROM "ComicSeriesItem" WHERE "seriesId" = ? ORDER BY "sortIndex", "comicId"`, id)
	if err != nil {
		return nil, err
	}
	var unsectioned []SeriesItemDetail
	for itemRows.Next() {
		var comicID, sectionID, label string
		var sortIndex int
		if err := itemRows.Scan(&comicID, &sectionID, &sortIndex, &label); err != nil {
			itemRows.Close()
			return nil, err
		}
		comic, err := GetComicByIDForUser(comicID, userID)
		if err != nil || comic == nil {
			continue
		}
		item := SeriesItemDetail{Comic: *comic, SectionID: sectionID, SortIndex: sortIndex, DisplayLabel: label}
		if idx, ok := sectionIndex[sectionID]; ok {
			sections[idx].Items = append(sections[idx].Items, item)
		} else {
			unsectioned = append(unsectioned, item)
		}
	}
	itemRows.Close()
	return &SeriesDetail{Series: *summary, Sections: sections, Unsectioned: unsectioned}, nil
}

func ListSeriesSummaries(libraryIDs []string, userID, search string) ([]SeriesSummary, error) {
	conditions := []string{"1=1"}
	args := []interface{}{}
	if len(libraryIDs) > 0 {
		placeholders := make([]string, len(libraryIDs))
		for i, id := range libraryIDs {
			placeholders[i] = "?"
			args = append(args, id)
		}
		conditions = append(conditions, fmt.Sprintf(`"libraryId" IN (%s)`, strings.Join(placeholders, ",")))
	}
	if strings.TrimSpace(search) != "" {
		conditions = append(conditions, `LOWER("title") LIKE ?`)
		args = append(args, "%"+strings.ToLower(strings.TrimSpace(search))+"%")
	}
	rows, err := db.Query(`SELECT "id" FROM "ComicSeries" WHERE `+strings.Join(conditions, " AND ")+` ORDER BY "sortTitle", "title"`, args...)
	if err != nil {
		return nil, err
	}
	var ids []string
	for rows.Next() {
		var id string
		if rows.Scan(&id) == nil {
			ids = append(ids, id)
		}
	}
	rows.Close()
	result := make([]SeriesSummary, 0, len(ids))
	for _, id := range ids {
		summary, err := seriesSummaryByID(id, userID)
		if err != nil {
			return nil, err
		}
		if summary != nil && summary.ItemCount >= 2 {
			result = append(result, *summary)
		}
	}
	return result, nil
}

func UpdateSeries(id, title, coverComicID string, manualLocked *bool) error {
	sets := []string{`"updatedAt" = CURRENT_TIMESTAMP`}
	args := []interface{}{}
	if strings.TrimSpace(title) != "" {
		sets = append(sets, `"title" = ?`, `"sortTitle" = ?`)
		args = append(args, strings.TrimSpace(title), strings.ToLower(strings.TrimSpace(title)))
	}
	if coverComicID != "" {
		sets = append(sets, `"coverComicId" = ?`)
		args = append(args, coverComicID)
	}
	if manualLocked != nil {
		sets = append(sets, `"manualLocked" = ?`)
		args = append(args, *manualLocked)
	}
	args = append(args, id)
	_, err := db.Exec(`UPDATE "ComicSeries" SET `+strings.Join(sets, ", ")+` WHERE "id" = ?`, args...)
	return err
}

func DeleteSeriesRelationship(id string) error {
	_, err := db.Exec(`DELETE FROM "ComicSeries" WHERE "id" = ?`, id)
	return err
}

func SetSeriesItemStructure(seriesID, comicID, sectionID string, sortIndex int) error {
	var section interface{}
	if sectionID != "" {
		var count int
		if err := db.QueryRow(`SELECT COUNT(*) FROM "ComicSeriesSection" WHERE "id" = ? AND "seriesId" = ?`, sectionID, seriesID).Scan(&count); err != nil {
			return err
		}
		if count == 0 {
			return fmt.Errorf("section does not belong to series")
		}
		section = sectionID
	}
	result, err := db.Exec(`UPDATE "ComicSeriesItem" SET "sectionId" = ?, "sortIndex" = ? WHERE "seriesId" = ? AND "comicId" = ?`, section, sortIndex, seriesID, comicID)
	if err != nil {
		return err
	}
	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return fmt.Errorf("comic does not belong to series")
	}
	return nil
}

func SortSeriesDetail(detail *SeriesDetail) {
	if detail == nil {
		return
	}
	sort.SliceStable(detail.Sections, func(i, j int) bool { return detail.Sections[i].SortIndex < detail.Sections[j].SortIndex })
	for i := range detail.Sections {
		sort.SliceStable(detail.Sections[i].Items, func(a, b int) bool {
			return detail.Sections[i].Items[a].SortIndex < detail.Sections[i].Items[b].SortIndex
		})
	}
	sort.SliceStable(detail.Unsectioned, func(i, j int) bool { return detail.Unsectioned[i].SortIndex < detail.Unsectioned[j].SortIndex })
}

func TouchSeries(id string) error {
	_, err := db.Exec(`UPDATE "ComicSeries" SET "updatedAt" = ? WHERE "id" = ?`, time.Now().UTC(), id)
	return err
}
