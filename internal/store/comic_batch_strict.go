package store

import (
	"fmt"
	"time"
)

// FixComicTypesBySourceStrict is the error-propagating variant used by the
// scanner job coordinator. The legacy helper is kept for compatibility with
// older call sites, but scanner jobs must never report success after a failed
// type reconciliation.
func FixComicTypesBySourceStrict(fileSourceMap map[string]string) error {
	if len(fileSourceMap) == 0 {
		return nil
	}

	var toComic []string
	var toNovel []string
	rows, err := db.Query(`SELECT "id", "type" FROM "Comic"`)
	if err != nil {
		return fmt.Errorf("query content types: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var id, comicType string
		if err := rows.Scan(&id, &comicType); err != nil {
			return fmt.Errorf("scan content type: %w", err)
		}
		source, ok := fileSourceMap[id]
		if !ok {
			continue
		}
		switch {
		case source == "comics" && comicType != "comic":
			toComic = append(toComic, id)
		case source == "novels" && comicType != "novel":
			toNovel = append(toNovel, id)
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate content types: %w", err)
	}

	return runSerializedDBWrite("scanner-fix-content-types-strict", func() error {
		if err := batchUpdateType(toComic, "comic"); err != nil {
			return fmt.Errorf("set comic types: %w", err)
		}
		if err := batchUpdateType(toNovel, "novel"); err != nil {
			return fmt.Errorf("set novel types: %w", err)
		}
		return nil
	})
}

// FixComicLibraryAssignmentsStrict reconciles library/type/relative-path state
// in bounded transactions and returns every database failure to the caller.
// This is intentionally separate from the legacy helper whose signature cannot
// report an error.
func FixComicLibraryAssignmentsStrict(
	fileLibraryMap map[string]string,
	fileSourceMap map[string]string,
	fileRelPathMap map[string]string,
) (moved int, typeFixed int, err error) {
	if len(fileLibraryMap) == 0 {
		return 0, 0, nil
	}

	rows, err := db.Query(`SELECT "id", COALESCE("libraryId", ''), COALESCE("relativePath", ''), COALESCE("type", '') FROM "Comic"`)
	if err != nil {
		return 0, 0, fmt.Errorf("query content assignments: %w", err)
	}
	defer rows.Close()

	type comicUpdate struct {
		ID        string
		LibraryID string
		RelPath   string
		Type      string
		Moved     bool
		TypeFixed bool
	}
	updates := make([]comicUpdate, 0)

	for rows.Next() {
		var id, libraryID, relPath, comicType string
		if err := rows.Scan(&id, &libraryID, &relPath, &comicType); err != nil {
			return 0, 0, fmt.Errorf("scan content assignment: %w", err)
		}

		diskLibraryID, ok := fileLibraryMap[id]
		if !ok {
			continue
		}

		nextLibraryID := libraryID
		nextRelPath := relPath
		nextType := comicType
		wasMoved := false
		wasTypeFixed := false
		needsUpdate := false

		if diskLibraryID != "" && diskLibraryID != libraryID {
			nextLibraryID = diskLibraryID
			wasMoved = true
			needsUpdate = true
		}
		if diskRelPath, ok := fileRelPathMap[id]; ok && diskRelPath != "" && diskRelPath != relPath {
			nextRelPath = diskRelPath
			needsUpdate = true
		}
		if source, ok := fileSourceMap[id]; ok {
			switch {
			case source == "comics" && comicType != "comic":
				nextType = "comic"
				wasTypeFixed = true
				needsUpdate = true
			case source == "novels" && comicType != "novel":
				nextType = "novel"
				wasTypeFixed = true
				needsUpdate = true
			}
		}

		if needsUpdate {
			updates = append(updates, comicUpdate{
				ID: id, LibraryID: nextLibraryID, RelPath: nextRelPath, Type: nextType,
				Moved: wasMoved, TypeFixed: wasTypeFixed,
			})
		}
	}
	if err := rows.Err(); err != nil {
		return 0, 0, fmt.Errorf("iterate content assignments: %w", err)
	}
	if len(updates) == 0 {
		return 0, 0, nil
	}

	const assignmentBatchSize = 500
	now := time.Now().UTC()
	for i := 0; i < len(updates); i += assignmentBatchSize {
		end := i + assignmentBatchSize
		if end > len(updates) {
			end = len(updates)
		}
		batch := updates[i:end]

		if err := runSerializedDBWrite("scanner-fix-library-assignments-strict", func() error {
			tx, err := db.Begin()
			if err != nil {
				return err
			}
			defer tx.Rollback()

			stmt, err := tx.Prepare(`UPDATE "Comic" SET "libraryId" = ?, "relativePath" = ?, "type" = ?, "updatedAt" = ? WHERE "id" = ?`)
			if err != nil {
				return err
			}
			defer stmt.Close()
			for _, update := range batch {
				if _, err := stmt.Exec(update.LibraryID, update.RelPath, update.Type, now, update.ID); err != nil {
					return err
				}
			}
			return tx.Commit()
		}); err != nil {
			return moved, typeFixed, fmt.Errorf("commit assignment batch %d-%d: %w", i, end, err)
		}

		for _, update := range batch {
			if update.Moved {
				moved++
			}
			if update.TypeFixed {
				typeFixed++
			}
		}
	}

	return moved, typeFixed, nil
}
