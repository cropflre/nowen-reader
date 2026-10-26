package store

import (
	"database/sql"
	"fmt"
	"sort"
	"strings"
	"time"
)

const (
	SeriesShelfIDPrefix       = "series-"
	MinLibrarySeriesDepth     = 1
	MaxLibrarySeriesDepth     = 8
	DefaultLibrarySeriesDepth = 1
)

func NormalizeSeriesDepth(depth int) int {
	if depth < MinLibrarySeriesDepth {
		return DefaultLibrarySeriesDepth
	}
	if depth > MaxLibrarySeriesDepth {
		return MaxLibrarySeriesDepth
	}
	return depth
}

func MinEffectiveSeriesMembers(seriesDepth int) int {
	if NormalizeSeriesDepth(seriesDepth) > 1 {
		return 1
	}
	return 2
}

func IsEffectiveSeriesCount(itemCount int, seriesDepth int) bool {
	return itemCount >= MinEffectiveSeriesMembers(seriesDepth)
}

func effectiveSeriesMinMembersSQL(libAlias string) string {
	return fmt.Sprintf(`CASE WHEN COALESCE(MAX(%s."seriesDepth"), 1) > 1 THEN 1 ELSE 2 END`, libAlias)
}

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
	ID                      string              `json:"id"`
	LibraryID               string              `json:"libraryId"`
	SeriesDepth             int                 `json:"seriesDepth"`
	ContentType             string              `json:"contentType"`
	RootRelativePath        string              `json:"rootRelativePath"`
	Title                   string              `json:"title"`
	SortTitle               string              `json:"sortTitle"`
	CoverComicID            string              `json:"coverComicId"`
	CoverURL                string              `json:"coverUrl"`
	Author                  string              `json:"author"`
	Description             string              `json:"description"`
	Year                    *int                `json:"year"`
	Publisher               string              `json:"publisher"`
	Language                string              `json:"language"`
	Genre                   string              `json:"genre"`
	Status                  string              `json:"status"`
	ExternalRating          *float64            `json:"externalRating"`
	ExternalRatingMax       *float64            `json:"externalRatingMax"`
	ExternalRatingSource    string              `json:"externalRatingSource"`
	ExternalRatingUpdatedAt *time.Time          `json:"externalRatingUpdatedAt"`
	MetadataLocked          bool                `json:"metadataLocked"`
	Tags                    []Tag               `json:"tags"`
	Categories              []ComicCategoryInfo `json:"categories"`
	ItemCount               int                 `json:"itemCount"`
	SectionCount            int                 `json:"sectionCount"`
	CompletedItemCount      int                 `json:"completedItemCount"`
	TotalReadTime           int                 `json:"totalReadTime"`
	FileSize                int64               `json:"fileSize"`
	LastReadAt              *string             `json:"lastReadAt"`
	IsFavorite              bool                `json:"isFavorite"`
	ManualLocked            bool                `json:"manualLocked"`
	CanManage               bool                `json:"canManage,omitempty"`
	CreatedAt               string              `json:"createdAt"`
	UpdatedAt               string              `json:"updatedAt"`
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

// GetComicSeriesSourceFingerprint reads an O(1) structural revision. Ordinary
// reading, rating and favorite updates do not invalidate directory detection.
func GetComicSeriesSourceFingerprint() (string, error) {
	var revision string
	err := db.QueryRow(`SELECT CAST("revision" AS TEXT) FROM "ComicSeriesSourceRevision" WHERE "id" = 1`).Scan(&revision)
	return revision, err
}

func GetBuiltComicSeriesFingerprint() (string, error) {
	var revision string
	err := db.QueryRow(`SELECT CAST("builtRevision" AS TEXT) FROM "ComicSeriesSourceRevision" WHERE "id" = 1`).Scan(&revision)
	return revision, err
}

func MarkComicSeriesBuilt(fingerprint string) error {
	_, err := db.Exec(`UPDATE "ComicSeriesSourceRevision" SET "builtRevision" = ? WHERE "id" = 1`, fingerprint)
	return err
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
	return runSerializedDBWrite("replace-detected-series", func() error {
		tx, err := db.Begin()
		if err != nil {
			return err
		}
		defer tx.Rollback()

		seriesDepth := DefaultLibrarySeriesDepth
		_ = tx.QueryRow(`SELECT COALESCE("seriesDepth", 1) FROM "Library" WHERE "id" = ?`, libraryID).Scan(&seriesDepth)
		minMembers := MinEffectiveSeriesMembers(seriesDepth)

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

		lockedComicIDs := make(map[string]bool)
		lockedItemRows, err := tx.Query(`
			SELECT si."comicId"
			FROM "ComicSeriesItem" si
			JOIN "ComicSeries" s ON s."id" = si."seriesId"
			WHERE s."libraryId" = ? AND s."manualLocked" = 1
		`, libraryID)
		if err != nil {
			return err
		}
		for lockedItemRows.Next() {
			var comicID string
			if lockedItemRows.Scan(&comicID) == nil {
				lockedComicIDs[comicID] = true
			}
		}
		lockedItemRows.Close()

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
			if locked[series.RootRelativePath] {
				seen[series.RootRelativePath] = struct{}{}
				continue
			}

			filteredItems := make([]DetectedSeriesItem, 0, len(series.Items))
			for _, item := range series.Items {
				if lockedComicIDs[item.ComicID] {
					continue
				}
				item.SortIndex = len(filteredItems)
				filteredItems = append(filteredItems, item)
			}
			if len(filteredItems) < minMembers {
				continue
			}
			seen[series.RootRelativePath] = struct{}{}

			coverComicID := series.CoverComicID
			if coverComicID == "" || lockedComicIDs[coverComicID] {
				coverComicID = filteredItems[0].ComicID
			}

			sortTitle := BuildTitleSortKey(series.Title)
			if _, err := tx.Exec(`
				INSERT INTO "ComicSeries" ("id", "libraryId", "rootRelativePath", "title", "sortTitle", "coverComicId", "detectionSource", "manualLocked", "createdAt", "updatedAt")
				VALUES (?, ?, ?, ?, ?, ?, 'directory', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
				ON CONFLICT("libraryId", "rootRelativePath") DO UPDATE SET
					"title" = CASE WHEN "ComicSeries"."metadataLocked" = 1 THEN "ComicSeries"."title" ELSE excluded."title" END,
					"sortTitle" = CASE WHEN "ComicSeries"."metadataLocked" = 1 THEN "ComicSeries"."sortTitle" ELSE excluded."sortTitle" END,
					"coverComicId" = CASE WHEN "ComicSeries"."coverComicId" = '' THEN excluded."coverComicId" ELSE "ComicSeries"."coverComicId" END,
					"updatedAt" = CURRENT_TIMESTAMP
			`, series.ID, series.LibraryID, series.RootRelativePath, series.Title, sortTitle, coverComicID); err != nil {
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

			type existingSection struct {
				id           string
				manualLocked bool
			}
			existingSectionsByRelPath := make(map[string]existingSection)
			existingSecRows, err := tx.Query(`SELECT "id", "relativePath", "manualLocked" FROM "ComicSeriesSection" WHERE "seriesId" = ?`, persistedID)
			if err != nil {
				return err
			}
			for existingSecRows.Next() {
				var secID, relPath string
				var secLocked bool
				if existingSecRows.Scan(&secID, &relPath, &secLocked) == nil {
					existingSectionsByRelPath[relPath] = existingSection{id: secID, manualLocked: secLocked}
				}
			}
			existingSecRows.Close()

			sectionIDMap := make(map[string]string, len(series.Sections))
			for _, section := range series.Sections {
				if existingSec, ok := existingSectionsByRelPath[section.RelativePath]; ok && existingSec.manualLocked {
					sectionIDMap[section.ID] = existingSec.id
					continue
				}
				if _, err := tx.Exec(`
					INSERT INTO "ComicSeriesSection" ("id", "seriesId", "title", "relativePath", "kind", "seasonNumber", "sortIndex", "detectionSource", "manualLocked")
					VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
					ON CONFLICT("seriesId", "relativePath") DO UPDATE SET
						"title" = excluded."title", "kind" = excluded."kind", "seasonNumber" = excluded."seasonNumber",
						"sortIndex" = excluded."sortIndex", "detectionSource" = excluded."detectionSource"
				`, section.ID, persistedID, section.Title, section.RelativePath, section.Kind, section.SeasonNumber, section.SortIndex, section.DetectionSource); err != nil {
					return err
				}
				var persistedSecID string
				if err := tx.QueryRow(`SELECT "id" FROM "ComicSeriesSection" WHERE "seriesId" = ? AND "relativePath" = ?`, persistedID, section.RelativePath).Scan(&persistedSecID); err != nil {
					return err
				}
				sectionIDMap[section.ID] = persistedSecID
			}
			for _, item := range filteredItems {
				var sectionID interface{}
				if item.SectionID != "" {
					if mapped, ok := sectionIDMap[item.SectionID]; ok && mapped != "" {
						sectionID = mapped
					}
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

		staleRows, err := tx.Query(`
			SELECT "id", "rootRelativePath"
			FROM "ComicSeries"
			WHERE "libraryId" = ? AND "manualLocked" = 0
		`, libraryID)
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
	})
}

func seriesSummaryByID(id, userID string) (*SeriesSummary, error) {
	summaries, err := seriesSummariesByIDs([]string{id}, userID)
	if err != nil {
		return nil, err
	}
	summary, ok := summaries[id]
	if !ok {
		return nil, nil
	}
	return &summary, nil
}

// seriesSummariesByIDs loads summaries and their metadata in bounded batches.
// Query count depends on the number of batches, rather than the number of works.
// The CROSS JOIN intentionally keeps membership lookup ahead of Comic lookup;
// otherwise SQLite may choose libraryId and scan a whole library per work.
func seriesSummariesByIDs(ids []string, userID string) (map[string]SeriesSummary, error) {
	result := make(map[string]SeriesSummary, len(ids))
	for start := 0; start < len(ids); start += seriesMembershipBatchSize {
		end := start + seriesMembershipBatchSize
		if end > len(ids) {
			end = len(ids)
		}
		batch := ids[start:end]
		placeholders := make([]string, len(batch))
		args := make([]interface{}, len(batch))
		for i, id := range batch {
			placeholders[i] = "?"
			args[i] = id
		}
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
		SELECT s."id", s."libraryId", COALESCE(MAX(l."seriesDepth"), 1),
		       CASE
		         WHEN MAX(l."type") = 'novel' THEN 'novel'
		         WHEN MAX(l."type") = 'comic' THEN 'comic'
		         WHEN SUM(CASE WHEN c."type" = 'novel' THEN 1 ELSE 0 END) > COUNT(DISTINCT si."comicId") / 2 THEN 'novel'
		         ELSE 'comic'
		       END,
		       s."rootRelativePath", s."title", s."sortTitle", COALESCE(NULLIF(s."coverComicId", ''), (SELECT "comicId" FROM "ComicSeriesItem" WHERE "seriesId" = s."id" ORDER BY "sortIndex", "comicId" LIMIT 1)), s."coverUrl",
		       s."author", s."description", s."year", s."publisher", s."language", s."genre", s."status",
		       s."externalRating", s."externalRatingMax", s."externalRatingSource", s."externalRatingUpdatedAt",
		       s."metadataLocked", s."manualLocked",
		       COUNT(DISTINCT si."comicId"), COUNT(DISTINCT sec."id"),
		       SUM(CASE WHEN %s = 'finished' OR (c."pageCount" > 0 AND %s IS NOT NULL AND %s >= c."pageCount" - 1) THEN 1 ELSE 0 END),
		       COALESCE(SUM(%s), 0), COALESCE(SUM(c."fileSize"), 0), MAX(%s), MAX(%s),
		       s."createdAt", s."updatedAt"
		FROM "ComicSeries" s
		JOIN "Library" l ON l."id" = s."libraryId"
		JOIN "ComicSeriesItem" si ON si."seriesId" = s."id"
		CROSS JOIN "Comic" c ON c."id" = si."comicId" AND c."libraryId" = s."libraryId"
		LEFT JOIN "ComicSeriesSection" sec ON sec."id" = si."sectionId"
		%s
		WHERE s."id" IN (%s)
		GROUP BY s."id"
	`, stateStatus, stateLastRead, statePage, stateReadTime, stateLastRead, stateFavorite, userJoin, strings.Join(placeholders, ","))

		rows, err := db.Query(query, append(userArgs, args...)...)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var summary SeriesSummary
			var lastRead sql.NullString
			var favorite sql.NullBool
			var storedCoverURL string
			var createdAt, updatedAt time.Time
			if err := rows.Scan(
				&summary.ID, &summary.LibraryID, &summary.SeriesDepth, &summary.ContentType, &summary.RootRelativePath, &summary.Title, &summary.SortTitle,
				&summary.CoverComicID, &storedCoverURL, &summary.Author, &summary.Description, &summary.Year,
				&summary.Publisher, &summary.Language, &summary.Genre, &summary.Status,
				&summary.ExternalRating, &summary.ExternalRatingMax, &summary.ExternalRatingSource, &summary.ExternalRatingUpdatedAt,
				&summary.MetadataLocked, &summary.ManualLocked, &summary.ItemCount, &summary.SectionCount,
				&summary.CompletedItemCount, &summary.TotalReadTime, &summary.FileSize, &lastRead, &favorite,
				&createdAt, &updatedAt,
			); err != nil {
				rows.Close()
				return nil, err
			}
			summary.SeriesDepth = NormalizeSeriesDepth(summary.SeriesDepth)
			summary.CreatedAt = createdAt.UTC().Format(time.RFC3339Nano)
			summary.UpdatedAt = updatedAt.UTC().Format(time.RFC3339Nano)
			if lastRead.Valid && lastRead.String != "" {
				value := lastRead.String
				summary.LastReadAt = &value
			}
			summary.IsFavorite = favorite.Valid && favorite.Bool

			summary.Tags = []Tag{}
			summary.Categories = []ComicCategoryInfo{}
			if storedCoverURL != "" {
				summary.CoverURL = BuildSeriesCoverURL(summary.ID)
			} else if summary.CoverComicID != "" {
				summary.CoverURL = BuildComicCoverURL(summary.CoverComicID)
			}
			result[summary.ID] = summary

		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return nil, err
		}
		tags, err := db.Query(`SELECT st."seriesId", t."id", t."name", t."color"
        FROM "ComicSeriesTag" st JOIN "Tag" t ON t."id" = st."tagId"
        WHERE st."seriesId" IN (`+strings.Join(placeholders, ",")+`) ORDER BY t."name"`, args...)
		if err != nil {
			return nil, err
		}
		for tags.Next() {
			var id string
			var tag Tag
			if err := tags.Scan(&id, &tag.ID, &tag.Name, &tag.Color); err != nil {
				tags.Close()
				return nil, err
			}
			summary, ok := result[id]
			if !ok {
				continue
			}
			summary.Tags = append(summary.Tags, tag)
			result[id] = summary
		}
		err = tags.Err()
		tags.Close()
		if err != nil {
			return nil, err
		}
		categories, err := db.Query(`SELECT sc."seriesId", cat."id", cat."name", cat."slug", cat."icon"
        FROM "ComicSeriesCategory" sc JOIN "Category" cat ON cat."id" = sc."categoryId"
        WHERE sc."seriesId" IN (`+strings.Join(placeholders, ",")+`) ORDER BY cat."sortOrder", cat."id"`, args...)
		if err != nil {
			return nil, err
		}
		for categories.Next() {
			var id string
			var category ComicCategoryInfo
			if err := categories.Scan(&id, &category.ID, &category.Name, &category.Slug, &category.Icon); err != nil {
				categories.Close()
				return nil, err
			}
			summary, ok := result[id]
			if !ok {
				continue
			}
			summary.Categories = append(summary.Categories, category)
			result[id] = summary
		}
		err = categories.Err()
		categories.Close()
		if err != nil {
			return nil, err
		}
	}
	return result, nil
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

	seriesIDList := make([]string, 0, len(seriesIDs))
	for seriesID := range seriesIDs {
		seriesIDList = append(seriesIDList, seriesID)
	}
	summaries, err := seriesSummariesByIDs(seriesIDList, userID)
	if err != nil {
		return nil, err
	}
	effectiveSeries := make(map[string]SeriesSummary, len(summaries))
	for seriesID, summary := range summaries {
		if summary.ContentType == "comic" && IsEffectiveSeriesCount(summary.ItemCount, summary.SeriesDepth) {
			effectiveSeries[seriesID] = summary
		}
	}
	if len(effectiveSeries) == 0 {
		return items, nil
	}

	collapsed := make([]ComicListItem, 0, len(items))
	for _, item := range items {
		seriesID, grouped := memberToSeries[item.ID]
		if grouped {
			if summary, ok := effectiveSeries[seriesID]; ok && item.ComicType != "novel" && (item.LibraryID == "" || item.LibraryID == summary.LibraryID) {
				continue
			}
		}
		collapsed = append(collapsed, item)
	}
	for _, seriesID := range seriesIDList {
		summary, ok := effectiveSeries[seriesID]
		if !ok {
			continue
		}
		collapsed = append(collapsed, seriesShelfItem(summary))
	}
	return collapsed, nil
}

type shelfSeriesOrder struct {
	GroupID       int
	GroupSortKey  string
	SortMode      string
	MemberKind    int
	MemberIndex   int
	MemberYear    *int
	MemberSortKey string
}

func loadShelfSeriesOrders() (map[string]shelfSeriesOrder, error) {
	rows, err := db.Query(`
		SELECT 'series', cgs."seriesId", g."id",
		       COALESCE(NULLIF(g."shelfSortTitle", ''), title_sort_key(g."name")),
		       g."shelfSortMode", cgs."sortIndex", cs."year", cs."sortTitle"
		FROM "ComicGroup" g
		JOIN "ComicGroupSeries" cgs ON cgs."groupId" = g."id"
		JOIN "ComicSeries" cs ON cs."id" = cgs."seriesId"
		WHERE g."shelfSeries" = 1
		UNION ALL
		SELECT 'comic', gi."comicId", g."id",
		       COALESCE(NULLIF(g."shelfSortTitle", ''), title_sort_key(g."name")),
		       g."shelfSortMode", gi."sortIndex", c."year",
		       COALESCE(NULLIF(c."titleSortKey", ''), title_sort_key(c."title"))
		FROM "ComicGroup" g
		JOIN "ComicGroupItem" gi ON gi."groupId" = g."id"
		JOIN "Comic" c ON c."id" = gi."comicId"
		WHERE g."shelfSeries" = 1
		ORDER BY 3 ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	orders := make(map[string]shelfSeriesOrder)
	for rows.Next() {
		var kind, id string
		var order shelfSeriesOrder
		var year sql.NullInt64
		if err := rows.Scan(
			&kind, &id, &order.GroupID, &order.GroupSortKey, &order.SortMode,
			&order.MemberIndex, &year, &order.MemberSortKey,
		); err != nil {
			return nil, err
		}
		if kind == "comic" {
			order.MemberKind = 1
		}
		if year.Valid {
			value := int(year.Int64)
			order.MemberYear = &value
		}
		key := id
		if kind == "series" {
			key = SeriesShelfIDPrefix + id
		}
		if _, exists := orders[key]; !exists {
			orders[key] = order
		}
	}
	return orders, rows.Err()
}

func sortSeriesShelfItems(items []ComicListItem, sortBy, sortOrder string) {
	sortSeriesShelfItemsWithOrders(items, sortBy, sortOrder, nil)
}

func sortSeriesShelfItemsWithOrders(items []ComicListItem, sortBy, sortOrder string, shelfOrders map[string]shelfSeriesOrder) {
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
	titleSortKey := func(item ComicListItem) string {
		if item.TitleSortKey != "" {
			return item.TitleSortKey
		}
		return BuildTitleSortKey(item.Title)
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
			aShelf, aGrouped := shelfOrders[a.ID]
			bShelf, bGrouped := shelfOrders[b.ID]
			aBlockKey := titleSortKey(a)
			bBlockKey := titleSortKey(b)
			if aGrouped {
				aBlockKey = aShelf.GroupSortKey
			}
			if bGrouped {
				bBlockKey = bShelf.GroupSortKey
			}
			cmp = compareString(aBlockKey, bBlockKey)
			if desc {
				cmp = -cmp
			}
			if cmp == 0 && aGrouped && bGrouped && aShelf.GroupID == bShelf.GroupID {
				switch aShelf.SortMode {
				case "publication":
					aYear, bYear := int64(1<<62), int64(1<<62)
					if aShelf.MemberYear != nil {
						aYear = int64(*aShelf.MemberYear)
					}
					if bShelf.MemberYear != nil {
						bYear = int64(*bShelf.MemberYear)
					}
					cmp = compareInt64(aYear, bYear)
					if cmp == 0 {
						cmp = compareInt64(int64(aShelf.MemberIndex), int64(bShelf.MemberIndex))
					}
				case "volume":
					cmp = compareString(aShelf.MemberSortKey, bShelf.MemberSortKey)
					if cmp == 0 {
						cmp = compareInt64(int64(aShelf.MemberIndex), int64(bShelf.MemberIndex))
					}
				default:
					cmp = compareInt64(int64(aShelf.MemberKind), int64(bShelf.MemberKind))
					if cmp == 0 {
						cmp = compareInt64(int64(aShelf.MemberIndex), int64(bShelf.MemberIndex))
					}
				}
				if cmp == 0 {
					cmp = compareString(titleSortKey(a), titleSortKey(b))
				}
				if cmp == 0 {
					cmp = compareString(a.ID, b.ID)
				}
				return cmp < 0
			}
			if cmp == 0 {
				aBlockID := "item:" + a.ID
				bBlockID := "item:" + b.ID
				if aGrouped {
					aBlockID = fmt.Sprintf("group:%020d", aShelf.GroupID)
				}
				if bGrouped {
					bBlockID = fmt.Sprintf("group:%020d", bShelf.GroupID)
				}
				cmp = compareString(aBlockID, bBlockID)
				if desc {
					cmp = -cmp
				}
			}
			if cmp != 0 {
				return cmp < 0
			}
			cmp = compareString(titleSortKey(a), titleSortKey(b))
		}
		if cmp == 0 {
			cmp = compareString(titleSortKey(a), titleSortKey(b))
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
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		ids = append(ids, id)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	summaries, err := seriesSummariesByIDs(ids, userID)
	if err != nil {
		return nil, err
	}
	result := make([]SeriesSummary, 0, len(ids))
	for _, id := range ids {
		if summary, ok := summaries[id]; ok && IsEffectiveSeriesCount(summary.ItemCount, summary.SeriesDepth) {
			result = append(result, summary)
		}
	}
	return result, nil
}

func UpdateSeries(id, title, coverComicID string, manualLocked *bool) error {
	sets := []string{`"updatedAt" = CURRENT_TIMESTAMP`}
	args := []interface{}{}
	if strings.TrimSpace(title) != "" {
		sets = append(sets, `"title" = ?`, `"sortTitle" = ?`)
		trimmedTitle := strings.TrimSpace(title)
		args = append(args, trimmedTitle, BuildTitleSortKey(trimmedTitle))
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

type SeriesMetadataUpdate struct {
	Title                   *string
	CoverURL                *string
	Author                  *string
	Description             *string
	Year                    *int
	Publisher               *string
	Language                *string
	Genre                   *string
	Status                  *string
	ExternalRating          *float64
	ExternalRatingMax       *float64
	ExternalRatingSource    *string
	ExternalRatingUpdatedAt *time.Time
	MetadataLocked          *bool
	ManualLocked            *bool
}

func UpdateSeriesMetadata(id string, update SeriesMetadataUpdate) error {
	sets := []string{`"updatedAt" = CURRENT_TIMESTAMP`}
	args := []interface{}{}
	appendValue := func(column string, value interface{}) {
		sets = append(sets, `"`+column+`" = ?`)
		args = append(args, value)
	}
	if update.Title != nil {
		title := strings.TrimSpace(*update.Title)
		appendValue("title", title)
		appendValue("sortTitle", BuildTitleSortKey(title))
	}
	if update.CoverURL != nil {
		appendValue("coverUrl", *update.CoverURL)
	}
	if update.Author != nil {
		appendValue("author", *update.Author)
	}
	if update.Description != nil {
		appendValue("description", *update.Description)
	}
	if update.Year != nil {
		appendValue("year", *update.Year)
	}
	if update.Publisher != nil {
		appendValue("publisher", *update.Publisher)
	}
	if update.Language != nil {
		appendValue("language", *update.Language)
	}
	if update.Genre != nil {
		appendValue("genre", *update.Genre)
	}
	if update.Status != nil {
		appendValue("status", *update.Status)
	}
	if update.ExternalRating != nil {
		appendValue("externalRating", *update.ExternalRating)
	}
	if update.ExternalRatingMax != nil {
		appendValue("externalRatingMax", *update.ExternalRatingMax)
	}
	if update.ExternalRatingSource != nil {
		appendValue("externalRatingSource", *update.ExternalRatingSource)
	}
	if update.ExternalRatingUpdatedAt != nil {
		appendValue("externalRatingUpdatedAt", *update.ExternalRatingUpdatedAt)
	}
	if update.MetadataLocked != nil {
		appendValue("metadataLocked", *update.MetadataLocked)
	}
	if update.ManualLocked != nil {
		appendValue("manualLocked", *update.ManualLocked)
	}
	args = append(args, id)
	_, err := db.Exec(`UPDATE "ComicSeries" SET `+strings.Join(sets, ", ")+` WHERE "id" = ?`, args...)
	return err
}

func GetSeriesStoredCoverURL(id string) (string, error) {
	var coverURL string
	err := db.QueryRow(`SELECT "coverUrl" FROM "ComicSeries" WHERE "id" = ?`, id).Scan(&coverURL)
	return coverURL, err
}

func GetSeriesMemberComicIDs(id string) ([]string, error) {
	rows, err := db.Query(`
		SELECT si."comicId"
		FROM "ComicSeriesItem" si
		JOIN "ComicSeries" s ON s."id" = si."seriesId"
		CROSS JOIN "Comic" c ON c."id" = si."comicId" AND c."libraryId" = s."libraryId"
		WHERE si."seriesId" = ?
		ORDER BY si."sortIndex", si."comicId"
	`, id)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := []string{}
	for rows.Next() {
		var comicID string
		if err := rows.Scan(&comicID); err != nil {
			return nil, err
		}
		ids = append(ids, comicID)
	}
	return ids, rows.Err()
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
