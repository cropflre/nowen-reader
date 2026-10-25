package store

import (
	"fmt"
	"strings"
)

const seriesMembershipBatchSize = 500

// GetAllComicsShelfSafe returns the logical shelf without exceeding SQLite's
// variable limit on large libraries. Novel-only shelves and shelves without
// directory series keep the normal SQL pagination path instead of loading the
// entire library into memory.
func GetAllComicsShelfSafe(opts ComicListOptions) (*ComicListResult, error) {
	if !opts.SeriesView {
		return GetAllComics(opts)
	}

	bypass, err := canBypassSeriesCollapse(opts)
	if err != nil {
		return nil, err
	}
	if bypass {
		plain := opts
		plain.SeriesView = false
		return GetAllComics(plain)
	}

	return getAllComicsSeriesPage(opts)
}

func canBypassSeriesCollapse(opts ComicListOptions) (bool, error) {
	if opts.ContentType == "novel" {
		return true, nil
	}

	ids := normalizedShelfLibraryIDs(opts.LibraryIDs)
	if opts.FilterLibraryIDs && len(ids) == 0 {
		return true, nil
	}

	// If every explicitly selected library is a novel library, directory
	// series cannot participate in this shelf at all.
	if opts.FilterLibraryIDs && len(ids) > 0 {
		allNovel := true
		for i := 0; i < len(ids); i += seriesMembershipBatchSize {
			end := i + seriesMembershipBatchSize
			if end > len(ids) {
				end = len(ids)
			}
			batch := ids[i:end]
			placeholders := make([]string, len(batch))
			args := make([]interface{}, len(batch))
			for j, id := range batch {
				placeholders[j] = "?"
				args[j] = id
			}
			var nonNovel int
			if err := db.QueryRow(
				fmt.Sprintf(`SELECT COUNT(*) FROM "Library" WHERE "id" IN (%s) AND "type" <> 'novel'`, strings.Join(placeholders, ",")),
				args...,
			).Scan(&nonNovel); err != nil {
				return false, fmt.Errorf("inspect library types: %w", err)
			}
			if nonNovel > 0 {
				allNovel = false
				break
			}
		}
		if allNovel {
			return true, nil
		}
	}

	// The common self-hosted case has no detected directory series at all. A
	// cheap EXISTS query lets even a 50k+ mixed/novel shelf retain real SQL
	// pagination instead of materialising every item in Go.
	if !opts.FilterLibraryIDs {
		var exists int
		if err := db.QueryRow(`SELECT EXISTS(SELECT 1 FROM "ComicSeriesItem" LIMIT 1)`).Scan(&exists); err != nil {
			return false, fmt.Errorf("inspect series memberships: %w", err)
		}
		return exists == 0, nil
	}

	for i := 0; i < len(ids); i += seriesMembershipBatchSize {
		end := i + seriesMembershipBatchSize
		if end > len(ids) {
			end = len(ids)
		}
		batch := ids[i:end]
		placeholders := make([]string, len(batch))
		args := make([]interface{}, len(batch))
		for j, id := range batch {
			placeholders[j] = "?"
			args[j] = id
		}
		var exists int
		if err := db.QueryRow(fmt.Sprintf(`
			SELECT EXISTS(
				SELECT 1
				FROM "ComicSeriesItem" si
				JOIN "Comic" c ON c."id" = si."comicId"
				WHERE c."libraryId" IN (%s)
				LIMIT 1
			)
		`, strings.Join(placeholders, ",")), args...).Scan(&exists); err != nil {
			return false, fmt.Errorf("inspect scoped series memberships: %w", err)
		}
		if exists != 0 {
			return false, nil
		}
	}
	return true, nil
}

func normalizedShelfLibraryIDs(raw []string) []string {
	seen := make(map[string]struct{}, len(raw))
	ids := make([]string, 0, len(raw))
	for _, id := range raw {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}
	return ids
}
