package service

import (
	"fmt"
	"log"
	"os"

	"github.com/nowen-reader/nowen-reader/internal/model"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

// strictQuickSync mirrors the optimized temporary-table quick sync, but never
// converts a database failure into a successful zero/partial scan. Batches that
// committed before a later failure are reflected in the returned counters.
func strictQuickSync() (added, removed int, err error) {
	libraries, err := store.GetScannableLibraries()
	if err != nil {
		return 0, 0, fmt.Errorf("get scannable libraries: %w", err)
	}
	ownership, err := LoadLibraryOwnership()
	if err != nil {
		return 0, 0, fmt.Errorf("build library ownership: %w", err)
	}

	var filesOnDisk []diskFile
	completeLibraries := make(map[string]bool)
	libraryByID := make(map[string]model.Library, len(libraries))

	for _, lib := range libraries {
		libraryByID[lib.ID] = lib
		rootPaths := libraryRootPaths(lib)
		useFolderComics := lib.Type != "novel"
		source := "comics"
		if lib.Type == "novel" {
			source = "novels"
		} else if lib.Type == "mixed" {
			source = "mixed"
		}

		complete := true
		for _, rootPath := range rootPaths {
			if ownership.RootHasExactConflict(rootPath) || !ownership.IsOwnedBy(lib.ID, rootPath) {
				complete = false
				log.Printf("[quick-sync] skipping conflicting root %s for library %s", rootPath, lib.ID)
				continue
			}
			info, statErr := os.Stat(rootPath)
			if statErr != nil || !info.IsDir() {
				complete = false
				continue
			}
			files, walkComplete := walkDirRecursive(lib.ID, rootPath, useFolderComics, ownership)
			if !walkComplete {
				complete = false
			}
			for i := range files {
				files[i].Source = source
				files[i].LibraryID = lib.ID
			}
			filesOnDisk = append(filesOnDisk, files...)
		}
		if complete {
			completeLibraries[lib.ID] = true
		}
	}

	if len(completeLibraries) == 0 {
		return 0, 0, nil
	}

	tx, err := store.DB().Begin()
	if err != nil {
		return 0, 0, fmt.Errorf("begin quick-sync diff transaction: %w", err)
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`CREATE TEMP TABLE IF NOT EXISTS "_DiskFiles" ("id" TEXT PRIMARY KEY, "filename" TEXT, "title" TEXT, "fileSize" INTEGER, "source" TEXT, "libraryId" TEXT, "relativePath" TEXT)`); err != nil {
		return 0, 0, fmt.Errorf("create disk-files temp table: %w", err)
	}
	if _, err := tx.Exec(`CREATE TEMP TABLE IF NOT EXISTS "_ScannedLibraries" ("id" TEXT PRIMARY KEY)`); err != nil {
		return 0, 0, fmt.Errorf("create scanned-libraries temp table: %w", err)
	}
	if _, err := tx.Exec(`DELETE FROM "_DiskFiles"`); err != nil {
		return 0, 0, fmt.Errorf("clear disk-files temp table: %w", err)
	}
	if _, err := tx.Exec(`DELETE FROM "_ScannedLibraries"`); err != nil {
		return 0, 0, fmt.Errorf("clear scanned-libraries temp table: %w", err)
	}
	for libraryID := range completeLibraries {
		if _, err := tx.Exec(`INSERT OR IGNORE INTO "_ScannedLibraries" ("id") VALUES (?)`, libraryID); err != nil {
			return 0, 0, fmt.Errorf("mark scanned library %s: %w", libraryID, err)
		}
	}

	insertStmt, err := tx.Prepare(`INSERT OR IGNORE INTO "_DiskFiles" ("id", "filename", "title", "fileSize", "source", "libraryId", "relativePath") VALUES (?, ?, ?, ?, ?, ?, ?)`)
	if err != nil {
		return 0, 0, fmt.Errorf("prepare disk-files insert: %w", err)
	}
	for _, file := range filesOnDisk {
		if _, err := insertStmt.Exec(file.ID, file.Filename, file.Title, file.FileSize, file.Source, file.LibraryID, file.Filename); err != nil {
			insertStmt.Close()
			return 0, 0, fmt.Errorf("insert disk file %s: %w", file.Filename, err)
		}
	}
	if err := insertStmt.Close(); err != nil {
		return 0, 0, fmt.Errorf("close disk-files insert: %w", err)
	}

	rows, err := tx.Query(`SELECT d."id", d."filename", d."title", d."fileSize" FROM "_DiskFiles" d LEFT JOIN "Comic" c ON d."id" = c."id" WHERE c."id" IS NULL`)
	if err != nil {
		return 0, 0, fmt.Errorf("query new contents: %w", err)
	}
	var toAdd []struct {
		ID       string
		Filename string
		Title    string
		FileSize int64
	}
	for rows.Next() {
		var item struct {
			ID       string
			Filename string
			Title    string
			FileSize int64
		}
		if err := rows.Scan(&item.ID, &item.Filename, &item.Title, &item.FileSize); err != nil {
			rows.Close()
			return 0, 0, fmt.Errorf("scan new content: %w", err)
		}
		toAdd = append(toAdd, item)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return 0, 0, fmt.Errorf("iterate new contents: %w", err)
	}
	if err := rows.Close(); err != nil {
		return 0, 0, fmt.Errorf("close new-content rows: %w", err)
	}

	rows, err = tx.Query(`
		SELECT c."id", c."libraryId", COALESCE(NULLIF(c."relativePath", ''), c."filename")
		FROM "Comic" c
		JOIN "_ScannedLibraries" s ON s."id" = c."libraryId"
		LEFT JOIN "_DiskFiles" d ON c."id" = d."id"
		WHERE d."id" IS NULL
	`)
	if err != nil {
		return 0, 0, fmt.Errorf("query stale contents: %w", err)
	}
	var toRemove []string
	for rows.Next() {
		var id, libraryID, relativePath string
		if err := rows.Scan(&id, &libraryID, &relativePath); err != nil {
			rows.Close()
			return 0, 0, fmt.Errorf("scan stale content: %w", err)
		}
		if lib, ok := libraryByID[libraryID]; ok && recordDelegatedToAnotherLibrary(lib, relativePath, ownership) {
			continue
		}
		toRemove = append(toRemove, id)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return 0, 0, fmt.Errorf("iterate stale contents: %w", err)
	}
	if err := rows.Close(); err != nil {
		return 0, 0, fmt.Errorf("close stale-content rows: %w", err)
	}

	if _, err := tx.Exec(`DROP TABLE IF EXISTS "_DiskFiles"`); err != nil {
		return 0, 0, fmt.Errorf("drop disk-files temp table: %w", err)
	}
	if _, err := tx.Exec(`DROP TABLE IF EXISTS "_ScannedLibraries"`); err != nil {
		return 0, 0, fmt.Errorf("drop scanned-libraries temp table: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return 0, 0, fmt.Errorf("commit quick-sync diff transaction: %w", err)
	}

	fileLibraryMap := make(map[string]string, len(filesOnDisk))
	fileSourceMap := make(map[string]string, len(filesOnDisk))
	fileRelPathMap := make(map[string]string, len(filesOnDisk))
	for _, file := range filesOnDisk {
		fileSourceMap[file.ID] = file.Source
		fileLibraryMap[file.ID] = file.LibraryID
		fileRelPathMap[file.ID] = file.Filename
	}

	for i := 0; i < len(toAdd); i += dbBatchSize {
		end := i + dbBatchSize
		if end > len(toAdd) {
			end = len(toAdd)
		}
		if err := store.BulkCreateComicsWithSource(toAdd[i:end], fileSourceMap, fileLibraryMap); err != nil {
			return added, removed, fmt.Errorf("insert scanned contents batch %d-%d: %w", i, end, err)
		}
		added += end - i
	}

	if err := store.FixComicTypesBySourceStrict(fileSourceMap); err != nil {
		return added, removed, fmt.Errorf("reconcile content types: %w", err)
	}
	moved, typeFixed, err := store.FixComicLibraryAssignmentsStrict(fileLibraryMap, fileSourceMap, fileRelPathMap)
	if err != nil {
		return added, removed, fmt.Errorf("reconcile library assignments: %w", err)
	}
	if moved > 0 || typeFixed > 0 {
		log.Printf("[quick-sync] library assignment fixed: moved=%d, typeFixed=%d", moved, typeFixed)
	}

	for i := 0; i < len(toRemove); i += dbBatchSize {
		end := i + dbBatchSize
		if end > len(toRemove) {
			end = len(toRemove)
		}
		if err := store.BulkDeleteComicsByIDs(toRemove[i:end]); err != nil {
			return added, removed, fmt.Errorf("delete stale contents batch %d-%d: %w", i, end, err)
		}
		removed += end - i
	}

	if added > 0 || removed > 0 {
		log.Printf("[quick-sync] committed added=%d removed=%d", added, removed)
	}
	return added, removed, nil
}
