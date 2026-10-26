package store

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"time"

	"github.com/nowen-reader/nowen-reader/internal/model"
)

const SeriesLayoutSnapshotSchemaVersion = 1

const maxLibrarySeriesSnapshots = 10

var (
	ErrSeriesLayoutRevisionConflict = errors.New("series layout source revision conflict")
	ErrSeriesLayoutLockConflict     = errors.New("series layout manual lock conflict")
	ErrSeriesLayoutSnapshotNotFound = errors.New("series layout snapshot not found")
	ErrSeriesLayoutSnapshotConflict = errors.New("series layout snapshot state conflict")
)

// Test hook used exclusively in unit tests to inject a failure right before commit
// and verify atomic rollback of Library + Snapshot + ComicSeries tables.
var testSeriesLayoutBeforeCommitHook func(tx *sql.Tx) error

func SetSeriesLayoutBeforeCommitHookForTest(hook func(tx *sql.Tx) error) {
	testSeriesLayoutBeforeCommitHook = hook
}

type ArchivedSeriesTag struct {
	TagID int    `json:"tagId"`
	Name  string `json:"name"`
	Color string `json:"color"`
}

type ArchivedSeriesCategory struct {
	CategoryID int    `json:"categoryId"`
	Name       string `json:"name"`
	Slug       string `json:"slug"`
	Icon       string `json:"icon"`
	SortOrder  int    `json:"sortOrder"`
}

type ArchivedGroupSeriesLink struct {
	GroupID     int    `json:"groupId"`
	GroupName   string `json:"groupName"`
	GroupUserID string `json:"groupUserId,omitempty"`
	SortIndex   int    `json:"sortIndex"`
}

type ArchivedSeriesSection struct {
	ID              string `json:"id"`
	Title           string `json:"title"`
	RelativePath    string `json:"relativePath"`
	Kind            string `json:"kind"`
	SeasonNumber    *int   `json:"seasonNumber,omitempty"`
	SortIndex       int    `json:"sortIndex"`
	DetectionSource string `json:"detectionSource"`
	ManualLocked    bool   `json:"manualLocked"`
}

type ArchivedSeriesItem struct {
	ComicID      string `json:"comicId"`
	SectionID    string `json:"sectionId,omitempty"`
	SortIndex    int    `json:"sortIndex"`
	DisplayLabel string `json:"displayLabel"`
}

type ArchivedSeriesRecord struct {
	ID                      string                    `json:"id"`
	LibraryID               string                    `json:"libraryId"`
	RootRelativePath        string                    `json:"rootRelativePath"`
	Title                   string                    `json:"title"`
	SortTitle               string                    `json:"sortTitle"`
	CoverComicID            string                    `json:"coverComicId"`
	CoverURL                string                    `json:"coverUrl"`
	DetectionSource         string                    `json:"detectionSource"`
	Author                  string                    `json:"author"`
	Description             string                    `json:"description"`
	TagsText                string                    `json:"tagsText"`
	Year                    *int                      `json:"year,omitempty"`
	Publisher               string                    `json:"publisher"`
	Language                string                    `json:"language"`
	Genre                   string                    `json:"genre"`
	Status                  string                    `json:"status"`
	ExternalRating          *float64                  `json:"externalRating,omitempty"`
	ExternalRatingMax       *float64                  `json:"externalRatingMax,omitempty"`
	ExternalRatingSource    string                    `json:"externalRatingSource"`
	ExternalRatingUpdatedAt *time.Time                `json:"externalRatingUpdatedAt,omitempty"`
	MetadataLocked          bool                      `json:"metadataLocked"`
	ManualLocked            bool                      `json:"manualLocked"`
	CreatedAt               time.Time                 `json:"createdAt"`
	UpdatedAt               time.Time                 `json:"updatedAt"`
	Sections                []ArchivedSeriesSection   `json:"sections"`
	Items                   []ArchivedSeriesItem      `json:"items"`
	Tags                    []ArchivedSeriesTag       `json:"tags"`
	Categories              []ArchivedSeriesCategory  `json:"categories"`
	GroupLinks              []ArchivedGroupSeriesLink `json:"groupLinks"`
}

func (r ArchivedSeriesRecord) HasManualMetadata() bool {
	if r.MetadataLocked || r.ManualLocked {
		return true
	}
	if r.CoverURL != "" || r.Author != "" || r.Description != "" || r.TagsText != "" ||
		r.Year != nil || r.Publisher != "" || r.Language != "" || r.Genre != "" ||
		r.Status != "" || r.ExternalRating != nil || r.ExternalRatingSource != "" {
		return true
	}
	return len(r.Tags) > 0 || len(r.Categories) > 0 || len(r.GroupLinks) > 0
}

type SeriesLayoutSnapshotPayload struct {
	SchemaVersion       int                    `json:"schemaVersion"`
	LibraryID           string                 `json:"libraryId"`
	LibraryName         string                 `json:"libraryName"`
	PreviousSeriesDepth int                    `json:"previousSeriesDepth"`
	NextSeriesDepth     int                    `json:"nextSeriesDepth"`
	CapturedAt          time.Time              `json:"capturedAt"`
	SourceComicDigest   string                 `json:"sourceComicDigest"`
	Series              []ArchivedSeriesRecord `json:"series"`
}

type SeriesLayoutSnapshotSummary struct {
	ID                     string     `json:"id"`
	LibraryID              string     `json:"libraryId"`
	SchemaVersion          int        `json:"schemaVersion"`
	Reason                 string     `json:"reason"`
	PreviousSeriesDepth    int        `json:"previousSeriesDepth"`
	NextSeriesDepth        int        `json:"nextSeriesDepth"`
	SourceRevisionBefore   int64      `json:"sourceRevisionBefore"`
	SourceRevisionAfter    int64      `json:"sourceRevisionAfter"`
	PostStateDigest        string     `json:"postStateDigest"`
	SeriesCountBefore      int        `json:"seriesCountBefore"`
	SeriesCountAfter       int        `json:"seriesCountAfter"`
	ArchivedSeriesCount    int        `json:"archivedSeriesCount"`
	MatchedSeriesCount     int        `json:"matchedSeriesCount"`
	CreatedByUserID        string     `json:"createdByUserId,omitempty"`
	RestoredFromSnapshotID string     `json:"restoredFromSnapshotId,omitempty"`
	RestoredAt             *time.Time `json:"restoredAt,omitempty"`
	CreatedAt              time.Time  `json:"createdAt"`
}

type SeriesLayoutSnapshotExport struct {
	Snapshot SeriesLayoutSnapshotSummary `json:"snapshot"`
	Payload  SeriesLayoutSnapshotPayload `json:"payload"`
}

type SeriesLayoutLockConflict struct {
	Kind             string `json:"kind"` // "series" | "section"
	SeriesID         string `json:"seriesId"`
	SectionID        string `json:"sectionId,omitempty"`
	Title            string `json:"title"`
	RootRelativePath string `json:"rootRelativePath"`
	Reason           string `json:"reason"`
}

type SeriesLayoutConflictError struct {
	Kind                  string                     `json:"kind"` // "revision" | "lock" | "snapshot"
	Message               string                     `json:"message"`
	CurrentSourceRevision string                     `json:"currentSourceRevision,omitempty"`
	LockConflicts         []SeriesLayoutLockConflict `json:"lockConflicts,omitempty"`
}

func (e *SeriesLayoutConflictError) Error() string {
	return e.Message
}

func newSnapshotID() string {
	var randBytes [6]byte
	_, _ = rand.Read(randBytes[:])
	return fmt.Sprintf("snap_%d_%s", time.Now().UTC().UnixNano(), hex.EncodeToString(randBytes[:]))
}

type sqlQueryer interface {
	Query(query string, args ...interface{}) (*sql.Rows, error)
	QueryRow(query string, args ...interface{}) *sql.Row
}

func LoadLibrarySeriesRecords(libraryID string) ([]ArchivedSeriesRecord, error) {
	return loadLibrarySeriesRecordsFrom(db, libraryID)
}

func loadLibrarySeriesRecordsFrom(q sqlQueryer, libraryID string) ([]ArchivedSeriesRecord, error) {
	rows, err := q.Query(`
		SELECT "id", "libraryId", "rootRelativePath", "title", "sortTitle",
		       "coverComicId", "coverUrl", "detectionSource",
		       "author", "description", "tags", "year", "publisher", "language", "genre", "status",
		       "externalRating", "externalRatingMax", "externalRatingSource", "externalRatingUpdatedAt",
		       "metadataLocked", "manualLocked", "createdAt", "updatedAt"
		FROM "ComicSeries"
		WHERE "libraryId" = ?
		ORDER BY "rootRelativePath", "id"
	`, libraryID)
	if err != nil {
		return nil, err
	}
	var records []ArchivedSeriesRecord
	indexByID := make(map[string]int)
	for rows.Next() {
		var rec ArchivedSeriesRecord
		var year sql.NullInt64
		var extRating, extRatingMax sql.NullFloat64
		var extUpdated sql.NullTime
		if err := rows.Scan(
			&rec.ID, &rec.LibraryID, &rec.RootRelativePath, &rec.Title, &rec.SortTitle,
			&rec.CoverComicID, &rec.CoverURL, &rec.DetectionSource,
			&rec.Author, &rec.Description, &rec.TagsText, &year, &rec.Publisher, &rec.Language, &rec.Genre, &rec.Status,
			&extRating, &extRatingMax, &rec.ExternalRatingSource, &extUpdated,
			&rec.MetadataLocked, &rec.ManualLocked, &rec.CreatedAt, &rec.UpdatedAt,
		); err != nil {
			rows.Close()
			return nil, err
		}
		if year.Valid {
			y := int(year.Int64)
			rec.Year = &y
		}
		if extRating.Valid {
			v := extRating.Float64
			rec.ExternalRating = &v
		}
		if extRatingMax.Valid {
			v := extRatingMax.Float64
			rec.ExternalRatingMax = &v
		}
		if extUpdated.Valid {
			t := extUpdated.Time.UTC()
			rec.ExternalRatingUpdatedAt = &t
		}
		rec.CreatedAt = rec.CreatedAt.UTC()
		rec.UpdatedAt = rec.UpdatedAt.UTC()
		rec.Sections = []ArchivedSeriesSection{}
		rec.Items = []ArchivedSeriesItem{}
		rec.Tags = []ArchivedSeriesTag{}
		rec.Categories = []ArchivedSeriesCategory{}
		rec.GroupLinks = []ArchivedGroupSeriesLink{}
		indexByID[rec.ID] = len(records)
		records = append(records, rec)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()

	if len(records) == 0 {
		return []ArchivedSeriesRecord{}, nil
	}

	secRows, err := q.Query(`
		SELECT sec."seriesId", sec."id", sec."title", sec."relativePath", sec."kind",
		       sec."seasonNumber", sec."sortIndex", sec."detectionSource", sec."manualLocked"
		FROM "ComicSeriesSection" sec
		JOIN "ComicSeries" s ON s."id" = sec."seriesId"
		WHERE s."libraryId" = ?
		ORDER BY sec."seriesId", sec."sortIndex", sec."id"
	`, libraryID)
	if err != nil {
		return nil, err
	}
	for secRows.Next() {
		var seriesID string
		var sec ArchivedSeriesSection
		var num sql.NullInt64
		if err := secRows.Scan(&seriesID, &sec.ID, &sec.Title, &sec.RelativePath, &sec.Kind, &num, &sec.SortIndex, &sec.DetectionSource, &sec.ManualLocked); err != nil {
			secRows.Close()
			return nil, err
		}
		if num.Valid {
			n := int(num.Int64)
			sec.SeasonNumber = &n
		}
		if idx, ok := indexByID[seriesID]; ok {
			records[idx].Sections = append(records[idx].Sections, sec)
		}
	}
	secRows.Close()

	itemRows, err := q.Query(`
		SELECT si."seriesId", si."comicId", COALESCE(si."sectionId", ''), si."sortIndex", si."displayLabel"
		FROM "ComicSeriesItem" si
		JOIN "ComicSeries" s ON s."id" = si."seriesId"
		WHERE s."libraryId" = ?
		ORDER BY si."seriesId", si."sortIndex", si."comicId"
	`, libraryID)
	if err != nil {
		return nil, err
	}
	for itemRows.Next() {
		var seriesID string
		var item ArchivedSeriesItem
		if err := itemRows.Scan(&seriesID, &item.ComicID, &item.SectionID, &item.SortIndex, &item.DisplayLabel); err != nil {
			itemRows.Close()
			return nil, err
		}
		if idx, ok := indexByID[seriesID]; ok {
			records[idx].Items = append(records[idx].Items, item)
		}
	}
	itemRows.Close()

	tagRows, err := q.Query(`
		SELECT st."seriesId", t."id", t."name", t."color"
		FROM "ComicSeriesTag" st
		JOIN "Tag" t ON t."id" = st."tagId"
		JOIN "ComicSeries" s ON s."id" = st."seriesId"
		WHERE s."libraryId" = ?
		ORDER BY st."seriesId", t."id"
	`, libraryID)
	if err != nil {
		return nil, err
	}
	for tagRows.Next() {
		var seriesID string
		var tag ArchivedSeriesTag
		if err := tagRows.Scan(&seriesID, &tag.TagID, &tag.Name, &tag.Color); err != nil {
			tagRows.Close()
			return nil, err
		}
		if idx, ok := indexByID[seriesID]; ok {
			records[idx].Tags = append(records[idx].Tags, tag)
		}
	}
	tagRows.Close()

	catRows, err := q.Query(`
		SELECT sc."seriesId", cat."id", cat."name", cat."slug", cat."icon", cat."sortOrder"
		FROM "ComicSeriesCategory" sc
		JOIN "Category" cat ON cat."id" = sc."categoryId"
		JOIN "ComicSeries" s ON s."id" = sc."seriesId"
		WHERE s."libraryId" = ?
		ORDER BY sc."seriesId", cat."sortOrder", cat."id"
	`, libraryID)
	if err != nil {
		return nil, err
	}
	for catRows.Next() {
		var seriesID string
		var cat ArchivedSeriesCategory
		if err := catRows.Scan(&seriesID, &cat.CategoryID, &cat.Name, &cat.Slug, &cat.Icon, &cat.SortOrder); err != nil {
			catRows.Close()
			return nil, err
		}
		if idx, ok := indexByID[seriesID]; ok {
			records[idx].Categories = append(records[idx].Categories, cat)
		}
	}
	catRows.Close()

	groupRows, err := q.Query(`
		SELECT cgs."seriesId", g."id", g."name", COALESCE(g."userId", ''), cgs."sortIndex"
		FROM "ComicGroupSeries" cgs
		JOIN "ComicGroup" g ON g."id" = cgs."groupId"
		JOIN "ComicSeries" s ON s."id" = cgs."seriesId"
		WHERE s."libraryId" = ?
		ORDER BY cgs."seriesId", cgs."groupId"
	`, libraryID)
	if err != nil {
		return nil, err
	}
	for groupRows.Next() {
		var seriesID string
		var link ArchivedGroupSeriesLink
		if err := groupRows.Scan(&seriesID, &link.GroupID, &link.GroupName, &link.GroupUserID, &link.SortIndex); err != nil {
			groupRows.Close()
			return nil, err
		}
		if idx, ok := indexByID[seriesID]; ok {
			records[idx].GroupLinks = append(records[idx].GroupLinks, link)
		}
	}
	groupRows.Close()

	return records, nil
}

func getSeriesSourceItemsFrom(q sqlQueryer, libraryID string) ([]SeriesSourceItem, error) {
	rows, err := q.Query(`
		SELECT c."id", c."title", c."filename", COALESCE(NULLIF(c."relativePath", ''), c."filename")
		FROM "Comic" c
		JOIN "Library" l ON l."id" = c."libraryId"
		WHERE c."libraryId" = ? AND l."type" = 'comic'
		ORDER BY c."relativePath", c."filename", c."id"
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

func computeSourceComicDigest(items []SeriesSourceItem) string {
	sorted := append([]SeriesSourceItem(nil), items...)
	sort.Slice(sorted, func(i, j int) bool {
		if sorted[i].ID != sorted[j].ID {
			return sorted[i].ID < sorted[j].ID
		}
		return sorted[i].RelativePath < sorted[j].RelativePath
	})
	// Encode fields instead of concatenating delimiters: titles and paths may
	// themselves contain newlines or separators. Reading state is not structural.
	encoded, _ := json.Marshal(sorted)
	digest := sha256.Sum256(encoded)
	return hex.EncodeToString(digest[:])
}

func computeLibrarySeriesStateDigestFrom(q sqlQueryer, libraryID string) (string, error) {
	var libType string
	var seriesDepth int
	if err := q.QueryRow(`SELECT "type", COALESCE("seriesDepth", 1) FROM "Library" WHERE "id" = ?`, libraryID).Scan(&libType, &seriesDepth); err != nil {
		return "", err
	}
	sourceItems, err := getSeriesSourceItemsFrom(q, libraryID)
	if err != nil {
		return "", err
	}
	records, err := loadLibrarySeriesRecordsFrom(q, libraryID)
	if err != nil {
		return "", err
	}

	// Hash every archived business field, including rating scale/source/time.
	// A normal projection refresh touches updatedAt without changing the layout.
	for i := range records {
		records[i].UpdatedAt = time.Time{}
	}
	state := struct {
		LibraryID   string
		LibraryType string
		SeriesDepth int
		Source      string
		Series      []ArchivedSeriesRecord
	}{libraryID, libType, NormalizeSeriesDepth(seriesDepth), computeSourceComicDigest(sourceItems), records}
	encoded, err := json.Marshal(state)
	if err != nil {
		return "", err
	}
	digest := sha256.Sum256(encoded)
	// A version prefix prevents older, incomplete digests from being accepted.
	return "v2:" + hex.EncodeToString(digest[:]), nil
}

// FindLatestHistoricalSnapshotPayload loads the most recent snapshot payload for a library
// whose previousSeriesDepth equals targetDepth, enabling verified identity recovery when
// switching back to an earlier depth.
func FindLatestHistoricalSnapshotPayload(libraryID string, targetDepth int) (*SeriesLayoutSnapshotPayload, error) {
	return findLatestHistoricalSnapshotPayloadFrom(db, libraryID, targetDepth)
}

func findLatestHistoricalSnapshotPayloadFrom(q sqlQueryer, libraryID string, targetDepth int) (*SeriesLayoutSnapshotPayload, error) {
	var raw string
	err := q.QueryRow(`
		SELECT "payloadJson"
		FROM "LibrarySeriesRebuildSnapshot"
		WHERE "libraryId" = ? AND "previousSeriesDepth" = ? AND "schemaVersion" = ?
		ORDER BY "createdAt" DESC, "id" DESC
		LIMIT 1
	`, libraryID, NormalizeSeriesDepth(targetDepth), SeriesLayoutSnapshotSchemaVersion).Scan(&raw)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var payload SeriesLayoutSnapshotPayload
	if err := json.Unmarshal([]byte(raw), &payload); err != nil {
		return nil, err
	}
	return &payload, nil
}

func ListLibrarySeriesSnapshots(libraryID string, limit int) ([]SeriesLayoutSnapshotSummary, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := db.Query(`
		SELECT "id", "libraryId", "schemaVersion", "reason",
		       "previousSeriesDepth", "nextSeriesDepth",
		       "sourceRevisionBefore", "sourceRevisionAfter", "postStateDigest",
		       "seriesCountBefore", "seriesCountAfter",
		       "archivedSeriesCount", "matchedSeriesCount",
		       "createdByUserId", "restoredFromSnapshotId", "restoredAt", "createdAt"
		FROM "LibrarySeriesRebuildSnapshot"
		WHERE "libraryId" = ?
		ORDER BY "createdAt" DESC, "id" DESC
		LIMIT ?
	`, libraryID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]SeriesLayoutSnapshotSummary, 0)
	for rows.Next() {
		var s SeriesLayoutSnapshotSummary
		var restoredAt sql.NullTime
		if err := rows.Scan(
			&s.ID, &s.LibraryID, &s.SchemaVersion, &s.Reason,
			&s.PreviousSeriesDepth, &s.NextSeriesDepth,
			&s.SourceRevisionBefore, &s.SourceRevisionAfter, &s.PostStateDigest,
			&s.SeriesCountBefore, &s.SeriesCountAfter,
			&s.ArchivedSeriesCount, &s.MatchedSeriesCount,
			&s.CreatedByUserID, &s.RestoredFromSnapshotID, &restoredAt, &s.CreatedAt,
		); err != nil {
			return nil, err
		}
		s.CreatedAt = s.CreatedAt.UTC()
		if restoredAt.Valid {
			t := restoredAt.Time.UTC()
			s.RestoredAt = &t
		}
		result = append(result, s)
	}
	return result, rows.Err()
}

func GetLibrarySeriesSnapshotExport(libraryID, snapshotID string) (*SeriesLayoutSnapshotExport, error) {
	var s SeriesLayoutSnapshotSummary
	var restoredAt sql.NullTime
	var raw string
	err := db.QueryRow(`
		SELECT "id", "libraryId", "schemaVersion", "reason",
		       "previousSeriesDepth", "nextSeriesDepth",
		       "sourceRevisionBefore", "sourceRevisionAfter", "postStateDigest",
		       "seriesCountBefore", "seriesCountAfter",
		       "archivedSeriesCount", "matchedSeriesCount",
		       "createdByUserId", "restoredFromSnapshotId", "restoredAt", "createdAt",
		       "payloadJson"
		FROM "LibrarySeriesRebuildSnapshot"
		WHERE "libraryId" = ? AND "id" = ?
	`, libraryID, snapshotID).Scan(
		&s.ID, &s.LibraryID, &s.SchemaVersion, &s.Reason,
		&s.PreviousSeriesDepth, &s.NextSeriesDepth,
		&s.SourceRevisionBefore, &s.SourceRevisionAfter, &s.PostStateDigest,
		&s.SeriesCountBefore, &s.SeriesCountAfter,
		&s.ArchivedSeriesCount, &s.MatchedSeriesCount,
		&s.CreatedByUserID, &s.RestoredFromSnapshotID, &restoredAt, &s.CreatedAt,
		&raw,
	)
	if err == sql.ErrNoRows {
		return nil, ErrSeriesLayoutSnapshotNotFound
	}
	if err != nil {
		return nil, err
	}
	s.CreatedAt = s.CreatedAt.UTC()
	if restoredAt.Valid {
		t := restoredAt.Time.UTC()
		s.RestoredAt = &t
	}
	var payload SeriesLayoutSnapshotPayload
	if err := json.Unmarshal([]byte(raw), &payload); err != nil {
		return nil, fmt.Errorf("decode snapshot payload: %w", err)
	}
	return &SeriesLayoutSnapshotExport{
		Snapshot: s,
		Payload:  payload,
	}, nil
}

func updateLibraryTx(tx *sql.Tx, lib *model.Library) error {
	if lib.SeriesDepth == 0 {
		lib.SeriesDepth = DefaultLibrarySeriesDepth
	}
	lib.UpdatedAt = time.Now().UTC()
	if _, err := tx.Exec(`
		UPDATE "Library"
		SET "name" = ?, "type" = ?, "seriesDepth" = ?, "rootPath" = ?, "enabled" = ?,
		    "sortOrder" = ?, "defaultAccess" = ?, "lastScanAt" = ?, "lastScanAdded" = ?,
		    "lastScanTotal" = ?, "scanEnabled" = ?, "updatedAt" = ?
		WHERE "id" = ?
	`,
		lib.Name, lib.Type, lib.SeriesDepth, lib.RootPath, lib.Enabled,
		lib.SortOrder, lib.DefaultAccess, lib.LastScanAt, lib.LastScanAdded,
		lib.LastScanTotal, lib.ScanEnabled, lib.UpdatedAt, lib.ID,
	); err != nil {
		return err
	}
	if lib.RootPaths != nil {
		if _, err := tx.Exec(`DELETE FROM "library_root_paths" WHERE "libraryId" = ?`, lib.ID); err != nil {
			return err
		}
		for _, p := range lib.RootPaths {
			if p != "" && p != lib.RootPath {
				if _, err := tx.Exec(`INSERT OR IGNORE INTO "library_root_paths"("libraryId", "rootPath") VALUES (?, ?)`, lib.ID, p); err != nil {
					return err
				}
			}
		}
	}
	return nil
}

func applyArchivedSeriesSetTx(tx *sql.Tx, libraryID string, nextRecords []ArchivedSeriesRecord) error {
	// Delete all existing ComicSeries for this library inside the transaction AFTER
	// the pre-change snapshot row has already been persisted in tx.
	// Cascading FKs clean up ComicSeriesSection, ComicSeriesItem, ComicSeriesTag,
	// ComicSeriesCategory, and ComicGroupSeries for this library's old series.
	if _, err := tx.Exec(`DELETE FROM "ComicSeries" WHERE "libraryId" = ?`, libraryID); err != nil {
		return err
	}

	now := time.Now().UTC()
	for _, rec := range nextRecords {
		createdAt := rec.CreatedAt
		if createdAt.IsZero() {
			createdAt = now
		}
		updatedAt := rec.UpdatedAt
		if updatedAt.IsZero() {
			updatedAt = now
		}
		sortTitle := rec.SortTitle
		if sortTitle == "" {
			sortTitle = BuildTitleSortKey(rec.Title)
		}
		detectionSource := rec.DetectionSource
		if detectionSource == "" {
			detectionSource = "directory"
		}
		if _, err := tx.Exec(`
			INSERT INTO "ComicSeries" (
				"id", "libraryId", "rootRelativePath", "title", "sortTitle",
				"coverComicId", "coverUrl", "detectionSource",
				"author", "description", "tags", "year", "publisher", "language", "genre", "status",
				"externalRating", "externalRatingMax", "externalRatingSource", "externalRatingUpdatedAt",
				"metadataLocked", "manualLocked", "createdAt", "updatedAt"
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`,
			rec.ID, libraryID, rec.RootRelativePath, rec.Title, sortTitle,
			rec.CoverComicID, rec.CoverURL, detectionSource,
			rec.Author, rec.Description, rec.TagsText, rec.Year, rec.Publisher, rec.Language, rec.Genre, rec.Status,
			rec.ExternalRating, rec.ExternalRatingMax, rec.ExternalRatingSource, rec.ExternalRatingUpdatedAt,
			rec.MetadataLocked, rec.ManualLocked, createdAt, updatedAt,
		); err != nil {
			return fmt.Errorf("insert series %s (%s): %w", rec.ID, rec.RootRelativePath, err)
		}

		validSections := make(map[string]bool, len(rec.Sections))
		for _, sec := range rec.Sections {
			secSource := sec.DetectionSource
			if secSource == "" {
				secSource = "directory"
			}
			if _, err := tx.Exec(`
				INSERT INTO "ComicSeriesSection" (
					"id", "seriesId", "title", "relativePath", "kind", "seasonNumber",
					"sortIndex", "detectionSource", "manualLocked"
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
			`, sec.ID, rec.ID, sec.Title, sec.RelativePath, sec.Kind, sec.SeasonNumber, sec.SortIndex, secSource, sec.ManualLocked); err != nil {
				return fmt.Errorf("insert section %s: %w", sec.ID, err)
			}
			validSections[sec.ID] = true
		}

		for _, item := range rec.Items {
			var secID interface{}
			if item.SectionID != "" && validSections[item.SectionID] {
				secID = item.SectionID
			}
			if _, err := tx.Exec(`
				INSERT INTO "ComicSeriesItem" ("seriesId", "sectionId", "comicId", "sortIndex", "displayLabel")
				VALUES (?, ?, ?, ?, ?)
			`, rec.ID, secID, item.ComicID, item.SortIndex, item.DisplayLabel); err != nil {
				return fmt.Errorf("insert item %s into series %s: %w", item.ComicID, rec.ID, err)
			}
		}

		for _, tag := range rec.Tags {
			tagID, err := resolveOrCreateTagTx(tx, tag)
			if err != nil {
				return err
			}
			if _, err := tx.Exec(`INSERT OR IGNORE INTO "ComicSeriesTag" ("seriesId", "tagId") VALUES (?, ?)`, rec.ID, tagID); err != nil {
				return err
			}
		}

		for _, cat := range rec.Categories {
			catID, err := resolveOrCreateCategoryTx(tx, cat)
			if err != nil {
				return err
			}
			if _, err := tx.Exec(`INSERT OR IGNORE INTO "ComicSeriesCategory" ("seriesId", "categoryId") VALUES (?, ?)`, rec.ID, catID); err != nil {
				return err
			}
		}

		for _, grp := range rec.GroupLinks {
			var groupExists int
			if err := tx.QueryRow(`SELECT COUNT(*) FROM "ComicGroup" WHERE "id" = ?`, grp.GroupID).Scan(&groupExists); err != nil {
				return err
			}
			if groupExists > 0 {
				if _, err := tx.Exec(`
					INSERT OR REPLACE INTO "ComicGroupSeries" ("groupId", "seriesId", "sortIndex")
					VALUES (?, ?, ?)
				`, grp.GroupID, rec.ID, grp.SortIndex); err != nil {
					return err
				}
			}
		}
	}
	return nil
}

func resolveOrCreateTagTx(tx *sql.Tx, tag ArchivedSeriesTag) (int, error) {
	var id int
	if tag.TagID > 0 {
		err := tx.QueryRow(`SELECT "id" FROM "Tag" WHERE "id" = ?`, tag.TagID).Scan(&id)
		if err == nil {
			return id, nil
		}
	}
	err := tx.QueryRow(`SELECT "id" FROM "Tag" WHERE "name" = ?`, tag.Name).Scan(&id)
	if err == nil {
		return id, nil
	}
	color := tag.Color
	if color == "" {
		color = "default"
	}
	res, err := tx.Exec(`INSERT INTO "Tag" ("name", "color") VALUES (?, ?)`, tag.Name, color)
	if err != nil {
		return 0, err
	}
	inserted, err := res.LastInsertId()
	return int(inserted), err
}

func resolveOrCreateCategoryTx(tx *sql.Tx, cat ArchivedSeriesCategory) (int, error) {
	var id int
	if cat.CategoryID > 0 {
		err := tx.QueryRow(`SELECT "id" FROM "Category" WHERE "id" = ?`, cat.CategoryID).Scan(&id)
		if err == nil {
			return id, nil
		}
	}
	if cat.Slug != "" {
		if err := tx.QueryRow(`SELECT "id" FROM "Category" WHERE "slug" = ?`, cat.Slug).Scan(&id); err == nil {
			return id, nil
		}
	}
	if err := tx.QueryRow(`SELECT "id" FROM "Category" WHERE "name" = ?`, cat.Name).Scan(&id); err == nil {
		return id, nil
	}
	icon := cat.Icon
	if icon == "" {
		icon = "📚"
	}
	slug := cat.Slug
	if slug == "" {
		slug = fmt.Sprintf("cat-%d", time.Now().UnixNano())
	}
	res, err := tx.Exec(`INSERT INTO "Category" ("name", "slug", "icon", "sortOrder") VALUES (?, ?, ?, ?)`, cat.Name, slug, icon, cat.SortOrder)
	if err != nil {
		return 0, err
	}
	inserted, err := res.LastInsertId()
	return int(inserted), err
}

type SeriesLayoutTxPlanInput struct {
	UpdatedLibrary         *model.Library
	ExpectedSourceRevision string
	CreatedByUserID        string
	BuildPlan              func(currentDepth int, existing []ArchivedSeriesRecord, items []SeriesSourceItem, historical *SeriesLayoutSnapshotPayload) (nextRecords []ArchivedSeriesRecord, lockConflicts []SeriesLayoutLockConflict, archivedCount int, matchedCount int, err error)
}

type SeriesLayoutTxResult struct {
	Library  *model.Library               `json:"library"`
	Snapshot *SeriesLayoutSnapshotSummary `json:"snapshot"`
}

// pruneLibrarySeriesSnapshotsTx bounds full-payload storage for both depth
// changes and restores. Cleanup rolls back with the operation if commit fails.
func pruneLibrarySeriesSnapshotsTx(tx *sql.Tx, libraryID string) error {
	_, err := tx.Exec(`
		DELETE FROM "LibrarySeriesRebuildSnapshot"
		WHERE "libraryId" = ? AND "id" NOT IN (
			SELECT "id" FROM "LibrarySeriesRebuildSnapshot"
			WHERE "libraryId" = ?
			ORDER BY "createdAt" DESC, "id" DESC LIMIT ?
		)
	`, libraryID, libraryID, maxLibrarySeriesSnapshots)
	return err
}

// ExecuteLibrarySeriesDepthChange atomically snapshots pre-change series state,
// updates Library configuration (including seriesDepth), applies matched/restored/new
// series records, and advances builtRevision only when no other library was dirty.
func ExecuteLibrarySeriesDepthChange(input SeriesLayoutTxPlanInput) (*SeriesLayoutTxResult, error) {
	var out *SeriesLayoutTxResult
	err := runSerializedDBWrite("library-series-depth-change", func() error {
		tx, err := db.Begin()
		if err != nil {
			return err
		}
		defer tx.Rollback()

		var currentDepth int
		var currentType, currentName string
		if err := tx.QueryRow(`SELECT "name", "type", COALESCE("seriesDepth", 1) FROM "Library" WHERE "id" = ?`, input.UpdatedLibrary.ID).Scan(&currentName, &currentType, &currentDepth); err != nil {
			return err
		}
		currentDepth = NormalizeSeriesDepth(currentDepth)
		nextDepth := NormalizeSeriesDepth(input.UpdatedLibrary.SeriesDepth)

		var revBefore, builtBefore int64
		if err := tx.QueryRow(`SELECT "revision", "builtRevision" FROM "ComicSeriesSourceRevision" WHERE "id" = 1`).Scan(&revBefore, &builtBefore); err != nil {
			return err
		}
		revBeforeStr := strconv.FormatInt(revBefore, 10)
		if input.ExpectedSourceRevision != "" && input.ExpectedSourceRevision != revBeforeStr {
			return &SeriesLayoutConflictError{
				Kind:                  "revision",
				Message:               "Library source revision changed since preview; please refresh preview before saving",
				CurrentSourceRevision: revBeforeStr,
			}
		}

		existingRecords, err := loadLibrarySeriesRecordsFrom(tx, input.UpdatedLibrary.ID)
		if err != nil {
			return err
		}
		sourceItems, err := getSeriesSourceItemsFrom(tx, input.UpdatedLibrary.ID)
		if err != nil {
			return err
		}
		historical, err := findLatestHistoricalSnapshotPayloadFrom(tx, input.UpdatedLibrary.ID, nextDepth)
		if err != nil {
			return err
		}

		nextRecords, lockConflicts, archivedCount, matchedCount, err := input.BuildPlan(currentDepth, existingRecords, sourceItems, historical)
		if err != nil {
			return err
		}
		if len(lockConflicts) > 0 {
			return &SeriesLayoutConflictError{
				Kind:          "lock",
				Message:       "Cannot change seriesDepth while manual structure locks would be split, merged, or rewritten",
				LockConflicts: lockConflicts,
			}
		}

		now := time.Now().UTC()
		payload := SeriesLayoutSnapshotPayload{
			SchemaVersion:       SeriesLayoutSnapshotSchemaVersion,
			LibraryID:           input.UpdatedLibrary.ID,
			LibraryName:         currentName,
			PreviousSeriesDepth: currentDepth,
			NextSeriesDepth:     nextDepth,
			CapturedAt:          now,
			SourceComicDigest:   computeSourceComicDigest(sourceItems),
			Series:              existingRecords,
		}
		payloadBytes, err := json.Marshal(payload)
		if err != nil {
			return err
		}

		snapshotID := newSnapshotID()
		// Persist snapshot FIRST inside the transaction before deleting/replacing series.
		if _, err := tx.Exec(`
			INSERT INTO "LibrarySeriesRebuildSnapshot" (
				"id", "libraryId", "schemaVersion", "reason",
				"previousSeriesDepth", "nextSeriesDepth",
				"sourceRevisionBefore", "sourceRevisionAfter", "postStateDigest",
				"seriesCountBefore", "seriesCountAfter",
				"archivedSeriesCount", "matchedSeriesCount",
				"createdByUserId", "payloadJson", "createdAt"
			) VALUES (?, ?, ?, 'depth_change', ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?)
		`,
			snapshotID, input.UpdatedLibrary.ID, SeriesLayoutSnapshotSchemaVersion,
			currentDepth, nextDepth,
			revBefore, revBefore,
			len(existingRecords), len(nextRecords),
			archivedCount, matchedCount,
			input.CreatedByUserID, string(payloadBytes), now,
		); err != nil {
			return err
		}

		if err := updateLibraryTx(tx, input.UpdatedLibrary); err != nil {
			return err
		}
		if err := applyArchivedSeriesSetTx(tx, input.UpdatedLibrary.ID, nextRecords); err != nil {
			return err
		}

		var revAfter int64
		if err := tx.QueryRow(`SELECT "revision" FROM "ComicSeriesSourceRevision" WHERE "id" = 1`).Scan(&revAfter); err != nil {
			return err
		}
		postDigest, err := computeLibrarySeriesStateDigestFrom(tx, input.UpdatedLibrary.ID)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(`
			UPDATE "LibrarySeriesRebuildSnapshot"
			SET "sourceRevisionAfter" = ?, "postStateDigest" = ?
			WHERE "id" = ?
		`, revAfter, postDigest, snapshotID); err != nil {
			return err
		}

		// Only acknowledge builtRevision if no other library was dirty prior to this transaction.
		if revBefore == builtBefore {
			if _, err := tx.Exec(`UPDATE "ComicSeriesSourceRevision" SET "builtRevision" = ? WHERE "id" = 1`, revAfter); err != nil {
				return err
			}
		}

		if err := pruneLibrarySeriesSnapshotsTx(tx, input.UpdatedLibrary.ID); err != nil {
			return err
		}

		if testSeriesLayoutBeforeCommitHook != nil {
			if err := testSeriesLayoutBeforeCommitHook(tx); err != nil {
				return err
			}
		}

		if err := tx.Commit(); err != nil {
			return err
		}

		out = &SeriesLayoutTxResult{
			Library: input.UpdatedLibrary,
			Snapshot: &SeriesLayoutSnapshotSummary{
				ID:                   snapshotID,
				LibraryID:            input.UpdatedLibrary.ID,
				SchemaVersion:        SeriesLayoutSnapshotSchemaVersion,
				Reason:               "depth_change",
				PreviousSeriesDepth:  currentDepth,
				NextSeriesDepth:      nextDepth,
				SourceRevisionBefore: revBefore,
				SourceRevisionAfter:  revAfter,
				PostStateDigest:      postDigest,
				SeriesCountBefore:    len(existingRecords),
				SeriesCountAfter:     len(nextRecords),
				ArchivedSeriesCount:  archivedCount,
				MatchedSeriesCount:   matchedCount,
				CreatedByUserID:      input.CreatedByUserID,
				CreatedAt:            now,
			},
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// ExecuteRestoreLibrarySeriesSnapshot validates that the target library's source
// and series structure still match the post-change state of snapshotID,
// archives a pre_restore snapshot, restores the previous seriesDepth and archived
// series records + relations, and commits atomically.
func ExecuteRestoreLibrarySeriesSnapshot(libraryID, snapshotID, userID string) (*SeriesLayoutTxResult, error) {
	var out *SeriesLayoutTxResult
	err := runSerializedDBWrite("restore-library-series-snapshot", func() error {
		tx, err := db.Begin()
		if err != nil {
			return err
		}
		defer tx.Rollback()

		var snap SeriesLayoutSnapshotSummary
		var restoredAt sql.NullTime
		var rawPayload string
		err = tx.QueryRow(`
			SELECT "id", "libraryId", "schemaVersion", "reason",
			       "previousSeriesDepth", "nextSeriesDepth",
			       "sourceRevisionBefore", "sourceRevisionAfter", "postStateDigest",
			       "seriesCountBefore", "seriesCountAfter",
			       "archivedSeriesCount", "matchedSeriesCount",
			       "createdByUserId", "restoredFromSnapshotId", "restoredAt", "createdAt",
			       "payloadJson"
			FROM "LibrarySeriesRebuildSnapshot"
			WHERE "libraryId" = ? AND "id" = ?
		`, libraryID, snapshotID).Scan(
			&snap.ID, &snap.LibraryID, &snap.SchemaVersion, &snap.Reason,
			&snap.PreviousSeriesDepth, &snap.NextSeriesDepth,
			&snap.SourceRevisionBefore, &snap.SourceRevisionAfter, &snap.PostStateDigest,
			&snap.SeriesCountBefore, &snap.SeriesCountAfter,
			&snap.ArchivedSeriesCount, &snap.MatchedSeriesCount,
			&snap.CreatedByUserID, &snap.RestoredFromSnapshotID, &restoredAt, &snap.CreatedAt,
			&rawPayload,
		)
		if err == sql.ErrNoRows {
			return ErrSeriesLayoutSnapshotNotFound
		}
		if err != nil {
			return err
		}
		if snap.SchemaVersion != SeriesLayoutSnapshotSchemaVersion {
			return &SeriesLayoutConflictError{
				Kind:    "snapshot",
				Message: fmt.Sprintf("Unsupported snapshot schemaVersion %d (expected %d); export snapshot for manual recovery", snap.SchemaVersion, SeriesLayoutSnapshotSchemaVersion),
			}
		}

		var payload SeriesLayoutSnapshotPayload
		if err := json.Unmarshal([]byte(rawPayload), &payload); err != nil {
			return fmt.Errorf("decode snapshot payload: %w", err)
		}
		if payload.LibraryID != libraryID {
			return &SeriesLayoutConflictError{
				Kind:    "snapshot",
				Message: "Snapshot libraryId does not match target library",
			}
		}

		var revNow, builtBefore int64
		if err := tx.QueryRow(`SELECT "revision", "builtRevision" FROM "ComicSeriesSourceRevision" WHERE "id" = 1`).Scan(&revNow, &builtBefore); err != nil {
			return err
		}
		// The global revision also changes for unrelated libraries. The target
		// library digest below covers its source files and archived business state.
		currentDigest, err := computeLibrarySeriesStateDigestFrom(tx, libraryID)
		if err != nil {
			return err
		}
		if snap.PostStateDigest == "" || currentDigest != snap.PostStateDigest {
			return &SeriesLayoutConflictError{
				Kind:    "snapshot",
				Message: "Library series state has been edited after this snapshot was created; export snapshot for manual inspection instead of overwriting newer edits",
			}
		}

		// Verify all archived member comics still belong to this library and do not collide elsewhere.
		sourceItems, err := getSeriesSourceItemsFrom(tx, libraryID)
		if err != nil {
			return err
		}
		validComics := make(map[string]bool, len(sourceItems))
		for _, it := range sourceItems {
			validComics[it.ID] = true
		}
		for _, rec := range payload.Series {
			var otherLib string
			err := tx.QueryRow(`SELECT "libraryId" FROM "ComicSeries" WHERE "id" = ? AND "libraryId" != ?`, rec.ID, libraryID).Scan(&otherLib)
			if err == nil {
				return &SeriesLayoutConflictError{
					Kind:    "snapshot",
					Message: fmt.Sprintf("Archived series ID %s conflicts with another library (%s)", rec.ID, otherLib),
				}
			}
			for _, item := range rec.Items {
				if !validComics[item.ComicID] {
					return &SeriesLayoutConflictError{
						Kind:    "snapshot",
						Message: fmt.Sprintf("Archived comic %s no longer exists in library %s", item.ComicID, libraryID),
					}
				}
			}
		}

		// Load current library row & current series records so we can archive a pre_restore snapshot first.
		var lib model.Library
		var createdAt, updatedAt time.Time
		if err := tx.QueryRow(`
			SELECT "id", "name", "type", COALESCE("seriesDepth", 1), "rootPath", "enabled",
			       "sortOrder", COALESCE("defaultAccess", 'private'), "lastScanAt", "lastScanAdded",
			       "lastScanTotal", "scanEnabled", "createdAt", "updatedAt"
			FROM "Library" WHERE "id" = ?
		`, libraryID).Scan(
			&lib.ID, &lib.Name, &lib.Type, &lib.SeriesDepth, &lib.RootPath, &lib.Enabled,
			&lib.SortOrder, &lib.DefaultAccess, &lib.LastScanAt, &lib.LastScanAdded,
			&lib.LastScanTotal, &lib.ScanEnabled, &createdAt, &updatedAt,
		); err != nil {
			return err
		}
		lib.CreatedAt = createdAt
		lib.UpdatedAt = updatedAt
		currentDepth := NormalizeSeriesDepth(lib.SeriesDepth)
		targetDepth := NormalizeSeriesDepth(snap.PreviousSeriesDepth)

		currentRecords, err := loadLibrarySeriesRecordsFrom(tx, libraryID)
		if err != nil {
			return err
		}
		now := time.Now().UTC()
		preRestorePayload := SeriesLayoutSnapshotPayload{
			SchemaVersion:       SeriesLayoutSnapshotSchemaVersion,
			LibraryID:           libraryID,
			LibraryName:         lib.Name,
			PreviousSeriesDepth: currentDepth,
			NextSeriesDepth:     targetDepth,
			CapturedAt:          now,
			SourceComicDigest:   computeSourceComicDigest(sourceItems),
			Series:              currentRecords,
		}
		preRestoreBytes, err := json.Marshal(preRestorePayload)
		if err != nil {
			return err
		}
		preRestoreID := newSnapshotID()
		if _, err := tx.Exec(`
			INSERT INTO "LibrarySeriesRebuildSnapshot" (
				"id", "libraryId", "schemaVersion", "reason",
				"previousSeriesDepth", "nextSeriesDepth",
				"sourceRevisionBefore", "sourceRevisionAfter", "postStateDigest",
				"seriesCountBefore", "seriesCountAfter",
				"archivedSeriesCount", "matchedSeriesCount",
				"createdByUserId", "restoredFromSnapshotId", "payloadJson", "createdAt"
			) VALUES (?, ?, ?, 'pre_restore', ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?)
		`,
			preRestoreID, libraryID, SeriesLayoutSnapshotSchemaVersion,
			currentDepth, targetDepth,
			revNow, revNow,
			len(currentRecords), len(payload.Series),
			len(currentRecords), len(payload.Series),
			userID, snapshotID, string(preRestoreBytes), now,
		); err != nil {
			return err
		}

		lib.SeriesDepth = targetDepth
		// Preserve existing extra rootPaths (do not wipe library_root_paths when lib.RootPaths == nil).
		lib.RootPaths = nil
		if err := updateLibraryTx(tx, &lib); err != nil {
			return err
		}
		if err := applyArchivedSeriesSetTx(tx, libraryID, payload.Series); err != nil {
			return err
		}

		var revAfter int64
		if err := tx.QueryRow(`SELECT "revision" FROM "ComicSeriesSourceRevision" WHERE "id" = 1`).Scan(&revAfter); err != nil {
			return err
		}
		postDigest, err := computeLibrarySeriesStateDigestFrom(tx, libraryID)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(`
			UPDATE "LibrarySeriesRebuildSnapshot"
			SET "sourceRevisionAfter" = ?, "postStateDigest" = ?
			WHERE "id" = ?
		`, revAfter, postDigest, preRestoreID); err != nil {
			return err
		}
		if _, err := tx.Exec(`UPDATE "LibrarySeriesRebuildSnapshot" SET "restoredAt" = ? WHERE "id" = ?`, now, snapshotID); err != nil {
			return err
		}
		if revNow == builtBefore {
			if _, err := tx.Exec(`UPDATE "ComicSeriesSourceRevision" SET "builtRevision" = ? WHERE "id" = 1`, revAfter); err != nil {
				return err
			}
		}

		if err := pruneLibrarySeriesSnapshotsTx(tx, libraryID); err != nil {
			return err
		}

		if testSeriesLayoutBeforeCommitHook != nil {
			if err := testSeriesLayoutBeforeCommitHook(tx); err != nil {
				return err
			}
		}

		if err := tx.Commit(); err != nil {
			return err
		}

		restoredLib, _ := GetLibraryByID(libraryID)
		if restoredLib == nil {
			restoredLib = &lib
		}
		out = &SeriesLayoutTxResult{
			Library: restoredLib,
			Snapshot: &SeriesLayoutSnapshotSummary{
				ID:                     preRestoreID,
				LibraryID:              libraryID,
				SchemaVersion:          SeriesLayoutSnapshotSchemaVersion,
				Reason:                 "pre_restore",
				PreviousSeriesDepth:    currentDepth,
				NextSeriesDepth:        targetDepth,
				SourceRevisionBefore:   revNow,
				SourceRevisionAfter:    revAfter,
				PostStateDigest:        postDigest,
				SeriesCountBefore:      len(currentRecords),
				SeriesCountAfter:       len(payload.Series),
				ArchivedSeriesCount:    len(currentRecords),
				MatchedSeriesCount:     len(payload.Series),
				CreatedByUserID:        userID,
				RestoredFromSnapshotID: snapshotID,
				CreatedAt:              now,
			},
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}
