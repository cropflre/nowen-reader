package store

import (
	"database/sql"
	"fmt"
	"strings"
	"time"
)

type ComicOwnershipRecord struct {
	ID           string
	Filename     string
	RelativePath string
	LibraryID    string
	Title        string
	ComicType    string
	UpdatedAt    time.Time
}

func GetComicOwnershipRecords() ([]ComicOwnershipRecord, error) {
	rows, err := db.Query(`
		SELECT "id", "filename", COALESCE(NULLIF("relativePath", ''), "filename"),
		       COALESCE("libraryId", ''), "title", COALESCE("type", 'comic'), "updatedAt"
		FROM "Comic"
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var result []ComicOwnershipRecord
	for rows.Next() {
		var item ComicOwnershipRecord
		if err := rows.Scan(&item.ID, &item.Filename, &item.RelativePath, &item.LibraryID, &item.Title, &item.ComicType, &item.UpdatedAt); err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

// ReconcileComicOwnership merges duplicate rows into keeperID and then moves
// the keeper to its canonical library identity. The complete merge is one
// serialized writer transaction so background scanner metadata writes cannot
// interleave with ownership migration.
func ReconcileComicOwnership(keeperID string, duplicateIDs []string, newID, libraryID, relativePath, comicType string) error {
	if keeperID == "" || newID == "" || libraryID == "" || relativePath == "" {
		return fmt.Errorf("invalid ownership reconciliation identity")
	}
	return runSerializedDBWrite("scanner-reconcile-library-ownership", func() error {
		tx, err := db.Begin()
		if err != nil {
			return err
		}
		defer tx.Rollback()

		for _, sourceID := range duplicateIDs {
			if sourceID == "" || sourceID == keeperID {
				continue
			}
			if err := mergeComicRows(tx, sourceID, keeperID); err != nil {
				return fmt.Errorf("merge comic %s into %s: %w", sourceID, keeperID, err)
			}
		}

		if keeperID != newID {
			var count int
			if err := tx.QueryRow(`SELECT COUNT(*) FROM "Comic" WHERE "id" = ?`, newID).Scan(&count); err != nil {
				return err
			}
			if count > 0 {
				return fmt.Errorf("target comic id already exists: %s", newID)
			}
		}

		if _, err := tx.Exec(`
			UPDATE "Comic"
			SET "id" = ?, "filename" = ?, "relativePath" = ?, "libraryId" = ?,
			    "type" = ?, "updatedAt" = ?
			WHERE "id" = ?
		`, newID, relativePath, relativePath, libraryID, comicType, time.Now().UTC(), keeperID); err != nil {
			return fmt.Errorf("move keeper to canonical identity: %w", err)
		}
		if keeperID != newID {
			if _, err := tx.Exec(`UPDATE "ScanRuleOpLog" SET "comicId" = ? WHERE "comicId" = ?`, newID, keeperID); err != nil && !isMissingTableError(err) {
				return err
			}
		}

		return tx.Commit()
	})
}

func mergeComicRows(tx *sql.Tx, sourceID, targetID string) error {
	if _, err := tx.Exec(`
		UPDATE "Comic" AS target SET
			"title" = CASE
				WHEN target."metadataSource" = '' AND COALESCE((SELECT "metadataSource" FROM "Comic" WHERE "id" = ?), '') != ''
				THEN (SELECT "title" FROM "Comic" WHERE "id" = ?)
				ELSE target."title" END,
			"pageCount" = MAX(target."pageCount", COALESCE((SELECT "pageCount" FROM "Comic" WHERE "id" = ?), 0)),
			"fileSize" = MAX(target."fileSize", COALESCE((SELECT "fileSize" FROM "Comic" WHERE "id" = ?), 0)),
			"addedAt" = MIN(target."addedAt", COALESCE((SELECT "addedAt" FROM "Comic" WHERE "id" = ?), target."addedAt")),
			"lastReadPage" = MAX(target."lastReadPage", COALESCE((SELECT "lastReadPage" FROM "Comic" WHERE "id" = ?), 0)),
			"lastReadAt" = CASE
				WHEN target."lastReadAt" IS NULL THEN (SELECT "lastReadAt" FROM "Comic" WHERE "id" = ?)
				WHEN (SELECT "lastReadAt" FROM "Comic" WHERE "id" = ?) IS NULL THEN target."lastReadAt"
				ELSE MAX(target."lastReadAt", (SELECT "lastReadAt" FROM "Comic" WHERE "id" = ?)) END,
			"isFavorite" = MAX(target."isFavorite", COALESCE((SELECT "isFavorite" FROM "Comic" WHERE "id" = ?), 0)),
			"rating" = COALESCE(target."rating", (SELECT "rating" FROM "Comic" WHERE "id" = ?)),
			"totalReadTime" = target."totalReadTime" + COALESCE((SELECT "totalReadTime" FROM "Comic" WHERE "id" = ?), 0),
			"author" = COALESCE(NULLIF(target."author", ''), (SELECT "author" FROM "Comic" WHERE "id" = ?)),
			"publisher" = COALESCE(NULLIF(target."publisher", ''), (SELECT "publisher" FROM "Comic" WHERE "id" = ?)),
			"year" = COALESCE(target."year", (SELECT "year" FROM "Comic" WHERE "id" = ?)),
			"description" = COALESCE(NULLIF(target."description", ''), (SELECT "description" FROM "Comic" WHERE "id" = ?)),
			"language" = COALESCE(NULLIF(target."language", ''), (SELECT "language" FROM "Comic" WHERE "id" = ?)),
			"genre" = COALESCE(NULLIF(target."genre", ''), (SELECT "genre" FROM "Comic" WHERE "id" = ?)),
			"seriesName" = COALESCE(NULLIF(target."seriesName", ''), (SELECT "seriesName" FROM "Comic" WHERE "id" = ?)),
			"seriesIndex" = CASE WHEN target."seriesIndex" = 0 THEN COALESCE((SELECT "seriesIndex" FROM "Comic" WHERE "id" = ?), 0) ELSE target."seriesIndex" END,
			"metadataSource" = COALESCE(NULLIF(target."metadataSource", ''), (SELECT "metadataSource" FROM "Comic" WHERE "id" = ?)),
			"coverImageUrl" = COALESCE(NULLIF(target."coverImageUrl", ''), (SELECT "coverImageUrl" FROM "Comic" WHERE "id" = ?)),
			"coverAspectRatio" = CASE WHEN target."coverAspectRatio" = 0 THEN COALESCE((SELECT "coverAspectRatio" FROM "Comic" WHERE "id" = ?), 0) ELSE target."coverAspectRatio" END,
			"readingStatus" = COALESCE(NULLIF(target."readingStatus", ''), (SELECT "readingStatus" FROM "Comic" WHERE "id" = ?)),
			"md5Hash" = COALESCE(NULLIF(target."md5Hash", ''), (SELECT "md5Hash" FROM "Comic" WHERE "id" = ?)),
			"contentType" = COALESCE(NULLIF(target."contentType", ''), (SELECT "contentType" FROM "Comic" WHERE "id" = ?)),
			"comicType" = COALESCE(NULLIF(target."comicType", ''), (SELECT "comicType" FROM "Comic" WHERE "id" = ?)),
			"externalRating" = COALESCE(target."externalRating", (SELECT "externalRating" FROM "Comic" WHERE "id" = ?)),
			"externalRatingMax" = MAX(target."externalRatingMax", COALESCE((SELECT "externalRatingMax" FROM "Comic" WHERE "id" = ?), 0)),
			"externalRatingSource" = COALESCE(NULLIF(target."externalRatingSource", ''), (SELECT "externalRatingSource" FROM "Comic" WHERE "id" = ?)),
			"externalRatingUpdatedAt" = MAX(target."externalRatingUpdatedAt", COALESCE((SELECT "externalRatingUpdatedAt" FROM "Comic" WHERE "id" = ?), ''))
		WHERE target."id" = ?
		`, sourceID, sourceID, sourceID, sourceID, sourceID, sourceID, sourceID, sourceID,
		sourceID, sourceID, sourceID, sourceID, sourceID, sourceID, sourceID, sourceID,
		sourceID, sourceID,
		sourceID, sourceID, sourceID, sourceID, sourceID, sourceID, sourceID, sourceID,
		sourceID, sourceID, sourceID, sourceID, sourceID, targetID); err != nil {
		return err
	}

	copyRelations := []string{
		`INSERT OR IGNORE INTO "ComicTag" ("comicId", "tagId") SELECT ?, "tagId" FROM "ComicTag" WHERE "comicId" = ?`,
		`INSERT OR IGNORE INTO "ComicCategory" ("comicId", "categoryId") SELECT ?, "categoryId" FROM "ComicCategory" WHERE "comicId" = ?`,
		`INSERT OR IGNORE INTO "ComicGroupItem" ("groupId", "comicId", "sortIndex") SELECT "groupId", ?, "sortIndex" FROM "ComicGroupItem" WHERE "comicId" = ?`,
	}
	for _, stmt := range copyRelations {
		if _, err := tx.Exec(stmt, targetID, sourceID); err != nil && !isMissingTableError(err) {
			return err
		}
	}

	if _, err := tx.Exec(`
		INSERT INTO "UserComicState" ("userId", "comicId", "lastReadPage", "lastReadAt", "isFavorite", "rating", "totalReadTime", "readingStatus")
		SELECT "userId", ?, "lastReadPage", "lastReadAt", "isFavorite", "rating", "totalReadTime", "readingStatus"
		FROM "UserComicState" WHERE "comicId" = ? AND 1
		ON CONFLICT("userId", "comicId") DO UPDATE SET
			"lastReadPage" = CASE WHEN COALESCE(excluded."lastReadAt", '') >= COALESCE("UserComicState"."lastReadAt", '') THEN excluded."lastReadPage" ELSE "UserComicState"."lastReadPage" END,
			"lastReadAt" = CASE
				WHEN "UserComicState"."lastReadAt" IS NULL THEN excluded."lastReadAt"
				WHEN excluded."lastReadAt" IS NULL THEN "UserComicState"."lastReadAt"
				ELSE MAX("UserComicState"."lastReadAt", excluded."lastReadAt") END,
			"isFavorite" = MAX("UserComicState"."isFavorite", excluded."isFavorite"),
			"rating" = COALESCE("UserComicState"."rating", excluded."rating"),
			"totalReadTime" = "UserComicState"."totalReadTime" + excluded."totalReadTime",
			"readingStatus" = CASE
				WHEN COALESCE(excluded."lastReadAt", '') >= COALESCE("UserComicState"."lastReadAt", '') AND excluded."readingStatus" != '' THEN excluded."readingStatus"
				WHEN "UserComicState"."readingStatus" != '' THEN "UserComicState"."readingStatus"
				ELSE excluded."readingStatus" END
	`, targetID, sourceID); err != nil && !isMissingTableError(err) {
		return err
	}

	for _, table := range []string{"ReadingSession", "MetadataSyncLog"} {
		if _, err := tx.Exec(fmt.Sprintf(`UPDATE "%s" SET "comicId" = ? WHERE "comicId" = ?`, table), targetID, sourceID); err != nil && !isMissingTableError(err) {
			return err
		}
	}
	if _, err := tx.Exec(`
		UPDATE "UserComicState"
		SET "totalReadTime" = MAX(
			"totalReadTime",
			COALESCE((
				SELECT SUM(rs."duration") FROM "ReadingSession" rs
				WHERE rs."comicId" = ? AND rs."userId" = "UserComicState"."userId"
			), 0)
		)
		WHERE "comicId" = ?
	`, targetID, targetID); err != nil && !isMissingTableError(err) {
		return err
	}
	if _, err := tx.Exec(`UPDATE "ScanRuleOpLog" SET "comicId" = ? WHERE "comicId" = ?`, targetID, sourceID); err != nil && !isMissingTableError(err) {
		return err
	}

	for _, table := range []string{"ComicTag", "ComicCategory", "ComicGroupItem", "UserComicState"} {
		if _, err := tx.Exec(fmt.Sprintf(`DELETE FROM "%s" WHERE "comicId" = ?`, table), sourceID); err != nil && !isMissingTableError(err) {
			return err
		}
	}
	if _, err := tx.Exec(`DELETE FROM "Comic" WHERE "id" = ?`, sourceID); err != nil {
		return err
	}
	return nil
}

func isMissingTableError(err error) bool {
	return err != nil && strings.Contains(strings.ToLower(err.Error()), "no such table")
}
