package store

import (
	"crypto/sha1"
	"database/sql"
	"encoding/json"
	"fmt"
	"path"
	"sort"
	"strings"
	"time"
)

// BookEditionMemberRow represents one edition row fetched from SQLite before
// handler/service layer permission & path enrichment.
type BookEditionMemberRow struct {
	GroupID         string
	ComicID         string
	LibraryID       string
	LibraryName     string
	Title           string
	Filename        string
	RelativePath    string
	Author          string
	ComicType       string
	Format          string
	EditionLabel    string
	FormatPriority  int
	IsFormatPrimary bool
	IsPreferred     bool
	DetectionSource string
	FileSize        int64
	PageCount       int
	LastReadPage    int
	LastReadAt      *string
	ReadingStatus   string
	TotalReadTime   int
}

// EnsureComicEditionKeysPopulated lazily backfills format / editionStemKey /
// editionMatchKey / editionLabel for existing Comic rows that lack them.
func EnsureComicEditionKeysPopulated() error {
	var missing int
	if err := db.QueryRow(`SELECT COUNT(*) FROM "Comic" WHERE "format" = ''`).Scan(&missing); err != nil {
		return err
	}
	if missing == 0 {
		return nil
	}

	type pendingKey struct {
		ID       string
		Format   string
		StemKey  string
		MatchKey string
		Label    string
	}

	rows, err := db.Query(`SELECT "id", COALESCE(NULLIF("relativePath", ''), "filename"), COALESCE("title", '') FROM "Comic" WHERE "format" = ''`)
	if err != nil {
		return err
	}
	var updates []pendingKey
	for rows.Next() {
		var id, relPath, title string
		if rows.Scan(&id, &relPath, &title) != nil {
			continue
		}
		updates = append(updates, pendingKey{
			ID:       id,
			Format:   ExtractFileFormat(relPath),
			StemKey:  BuildEditionStemKey(relPath),
			MatchKey: BuildEditionMatchKey(relPath, title),
			Label:    ExtractEditionLabel(relPath),
		})
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	rows.Close()

	if len(updates) == 0 {
		return nil
	}

	const keyBatchSize = 500
	for start := 0; start < len(updates); start += keyBatchSize {
		end := start + keyBatchSize
		if end > len(updates) {
			end = len(updates)
		}
		batch := updates[start:end]
		if err := runSerializedDBWrite("backfill-comic-edition-keys", func() error {
			tx, err := db.Begin()
			if err != nil {
				return err
			}
			defer tx.Rollback()

			stmt, err := tx.Prepare(`UPDATE "Comic" SET "format" = ?, "editionStemKey" = ?, "editionMatchKey" = ?, "editionLabel" = ? WHERE "id" = ?`)
			if err != nil {
				return err
			}
			defer stmt.Close()

			for _, item := range batch {
				if _, err := stmt.Exec(item.Format, item.StemKey, item.MatchKey, item.Label, item.ID); err != nil {
					return err
				}
			}
			return tx.Commit()
		}); err != nil {
			return err
		}
	}
	return nil
}

type editionRebuildCandidate struct {
	ID              string
	LibraryID       string
	ComicType       string
	Title           string
	Filename        string
	RelPath         string
	Author          string
	FileSize        int64
	AddedAt         time.Time
	MetadataSource  string
	Format          string
	EditionStemKey  string
	EditionMatchKey string
	EditionLabel    string
	MergeScope      string
}

type builtEditionGroup struct {
	ID             string
	ContentType    string
	MergeScope     string
	MatchKey       string
	Title          string
	SortTitle      string
	DefaultComicID string
	FormatsJSON    string
	EditionCount   int
	Items          []builtEditionItem
}

type builtEditionItem struct {
	ComicID         string
	LibraryID       string
	Format          string
	EditionLabel    string
	FormatPriority  int
	IsFormatPrimary bool
	SortIndex       int
}

// RebuildBookEditionGroups rebuilds automatic BookEditionGroup projections
// using SQLite index pre-filtering (`HAVING COUNT(*) >= 2`) so 100k+ book
// libraries execute in O(N log N) without scanning unrelated single-format books.
func RebuildBookEditionGroups() error {
	if err := EnsureComicEditionKeysPopulated(); err != nil {
		return fmt.Errorf("populate comic edition keys: %w", err)
	}

	lockedGroupIDs := make(map[string]bool)
	lockedComicIDs := make(map[string]bool)
	lockedRows, err := db.Query(`
		SELECT g."id", COALESCE(i."comicId", '')
		FROM "BookEditionGroup" g
		LEFT JOIN "BookEditionItem" i ON i."groupId" = g."id"
		WHERE g."manualLocked" = 1
	`)
	if err != nil {
		return fmt.Errorf("query manual locked edition groups: %w", err)
	}
	for lockedRows.Next() {
		var gid, cid string
		if lockedRows.Scan(&gid, &cid) == nil {
			lockedGroupIDs[gid] = true
			if cid != "" {
				lockedComicIDs[cid] = true
			}
		}
	}
	if err := lockedRows.Err(); err != nil {
		lockedRows.Close()
		return err
	}
	lockedRows.Close()

	candidateRows, err := db.Query(`
		WITH multi_stem AS (
			SELECT "libraryId", "editionStemKey"
			FROM "Comic"
			WHERE "editionSplitLocked" = 0 AND "editionStemKey" != ''
			GROUP BY "libraryId", "editionStemKey"
			HAVING COUNT(*) >= 2
		),
		multi_match AS (
			SELECT c."type", c."editionMatchKey"
			FROM "Comic" c
			JOIN "Library" l ON l."id" = c."libraryId"
			WHERE c."editionSplitLocked" = 0 AND c."editionMatchKey" != ''
			  AND l."enabled" = 1 AND COALESCE(l."editionMergeScope", 'directory') IN ('library', 'global')
			GROUP BY c."type", c."editionMatchKey"
			HAVING COUNT(*) >= 2
		)
		SELECT c."id", c."libraryId", c."type", c."title", c."filename",
		       COALESCE(NULLIF(c."relativePath", ''), c."filename") AS relPath,
		       COALESCE(c."author", ''), c."fileSize", c."addedAt", COALESCE(c."metadataSource", ''),
		       c."format", c."editionStemKey", c."editionMatchKey", c."editionLabel",
		       COALESCE(l."editionMergeScope", 'directory')
		FROM "Comic" c
		JOIN "Library" l ON l."id" = c."libraryId"
		WHERE l."enabled" = 1 AND c."editionSplitLocked" = 0
		  AND (
			  (c."libraryId", c."editionStemKey") IN (SELECT "libraryId", "editionStemKey" FROM multi_stem)
			  OR (
				  COALESCE(l."editionMergeScope", 'directory') IN ('library', 'global')
				  AND (c."type", c."editionMatchKey") IN (SELECT "type", "editionMatchKey" FROM multi_match)
			  )
		  )
		ORDER BY c."libraryId", relPath, c."id"
	`)
	if err != nil {
		return fmt.Errorf("query edition candidates: %w", err)
	}

	buckets := make(map[string][]editionRebuildCandidate)
	for candidateRows.Next() {
		var c editionRebuildCandidate
		if err := candidateRows.Scan(
			&c.ID, &c.LibraryID, &c.ComicType, &c.Title, &c.Filename,
			&c.RelPath, &c.Author, &c.FileSize, &c.AddedAt, &c.MetadataSource,
			&c.Format, &c.EditionStemKey, &c.EditionMatchKey, &c.EditionLabel, &c.MergeScope,
		); err != nil {
			continue
		}
		if lockedComicIDs[c.ID] {
			continue
		}
		c.MergeScope = NormalizeEditionMergeScope(c.MergeScope)
		if c.ComicType != "novel" {
			c.ComicType = "comic"
		}
		if c.Format == "" {
			c.Format = ExtractFileFormat(c.RelPath)
		}

		bucketKey := candidateBucketKey(c)
		if bucketKey == "" {
			continue
		}
		buckets[bucketKey] = append(buckets[bucketKey], c)
	}
	if err := candidateRows.Err(); err != nil {
		candidateRows.Close()
		return err
	}
	candidateRows.Close()

	// Fallback: any singleton from cross-dir bucket that actually has same-dir twins
	// (e.g. a directory with 2 files where one had conflicting author) should still
	// evaluate under directory scope.
	finalBuckets := make(map[string][]editionRebuildCandidate)
	var fallbackDirCandidates []editionRebuildCandidate
	for bKey, members := range buckets {
		if len(members) < 2 {
			fallbackDirCandidates = append(fallbackDirCandidates, members...)
			continue
		}
		subGroups := splitCandidatesByAuthorConflict(bKey, members)
		for subKey, subMembers := range subGroups {
			if len(subMembers) >= 2 {
				finalBuckets[subKey] = subMembers
			} else if !strings.HasPrefix(subKey, EditionMergeScopeDirectory+"\x00") {
				fallbackDirCandidates = append(fallbackDirCandidates, subMembers...)
			}
		}
	}
	if len(fallbackDirCandidates) >= 2 {
		dirOnly := make(map[string][]editionRebuildCandidate)
		for _, c := range fallbackDirCandidates {
			if c.EditionStemKey == "" {
				continue
			}
			dk := EditionMergeScopeDirectory + "\x00" + c.LibraryID + "\x00" + c.ComicType + "\x00" + c.EditionStemKey
			dirOnly[dk] = append(dirOnly[dk], c)
		}
		for dk, members := range dirOnly {
			if len(members) < 2 {
				continue
			}
			subGroups := splitCandidatesByAuthorConflict(dk, members)
			for subKey, subMembers := range subGroups {
				if len(subMembers) >= 2 {
					finalBuckets[subKey] = subMembers
				}
			}
		}
	}

	keys := make([]string, 0, len(finalBuckets))
	for k := range finalBuckets {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	assignedComicIDs := make(map[string]bool)
	var builtGroups []builtEditionGroup
	for _, k := range keys {
		members := finalBuckets[k]
		deduped := make([]editionRebuildCandidate, 0, len(members))
		for _, m := range members {
			if !assignedComicIDs[m.ID] {
				assignedComicIDs[m.ID] = true
				deduped = append(deduped, m)
			}
		}
		if len(deduped) < 2 {
			continue
		}
		group := buildEditionGroupFromCandidates(k, deduped, lockedGroupIDs)
		builtGroups = append(builtGroups, group)
	}

	return runSerializedDBWrite("rebuild-book-editions", func() error {
		tx, err := db.Begin()
		if err != nil {
			return err
		}
		defer tx.Rollback()

		if _, err := tx.Exec(`DELETE FROM "BookEditionItem" WHERE "groupId" IN (SELECT "id" FROM "BookEditionGroup" WHERE "manualLocked" = 0)`); err != nil {
			return err
		}
		if _, err := tx.Exec(`DELETE FROM "BookEditionGroup" WHERE "manualLocked" = 0`); err != nil {
			return err
		}

		if len(builtGroups) > 0 {
			groupStmt, err := tx.Prepare(`
				INSERT INTO "BookEditionGroup"
					("id", "contentType", "mergeScope", "matchKey", "title", "sortTitle", "defaultComicId", "formatsJson", "editionCount", "manualLocked", "createdAt", "updatedAt")
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
			`)
			if err != nil {
				return err
			}
			defer groupStmt.Close()

			itemStmt, err := tx.Prepare(`
				INSERT INTO "BookEditionItem"
					("groupId", "comicId", "libraryId", "format", "editionLabel", "formatPriority", "isFormatPrimary", "sortIndex", "detectionSource")
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'auto')
			`)
			if err != nil {
				return err
			}
			defer itemStmt.Close()

			for _, g := range builtGroups {
				if _, err := groupStmt.Exec(g.ID, g.ContentType, g.MergeScope, g.MatchKey, g.Title, g.SortTitle, g.DefaultComicID, g.FormatsJSON, g.EditionCount); err != nil {
					return err
				}
				for _, item := range g.Items {
					primary := 0
					if item.IsFormatPrimary {
						primary = 1
					}
					if _, err := itemStmt.Exec(g.ID, item.ComicID, item.LibraryID, item.Format, item.EditionLabel, item.FormatPriority, primary, item.SortIndex); err != nil {
						return err
					}
				}
			}
		}

		// Reconcile manual-locked groups in case some member comics were deleted.
		for gid := range lockedGroupIDs {
			if err := refreshEditionGroupMetadataTx(tx, gid); err != nil {
				return err
			}
		}

		return tx.Commit()
	})
}

func candidateBucketKey(c editionRebuildCandidate) string {
	switch c.MergeScope {
	case EditionMergeScopeGlobal:
		if c.EditionMatchKey != "" {
			return EditionMergeScopeGlobal + "\x00" + c.ComicType + "\x00" + c.EditionMatchKey
		}
	case EditionMergeScopeLibrary:
		if c.EditionMatchKey != "" {
			return EditionMergeScopeLibrary + "\x00" + c.LibraryID + "\x00" + c.ComicType + "\x00" + c.EditionMatchKey
		}
	}
	if c.EditionStemKey == "" {
		return ""
	}
	return EditionMergeScopeDirectory + "\x00" + c.LibraryID + "\x00" + c.ComicType + "\x00" + c.EditionStemKey
}

func splitCandidatesByAuthorConflict(bucketKey string, members []editionRebuildCandidate) map[string][]editionRebuildCandidate {
	if len(members) < 2 {
		return map[string][]editionRebuildCandidate{bucketKey: members}
	}

	resolvedAuthors := make([]string, len(members))
	distinct := make([]string, 0, 2)
	for i, m := range members {
		rawAuthor := strings.TrimSpace(m.Author)
		if rawAuthor == "" {
			rawAuthor = ExtractAuthorFromFilename(m.RelPath)
		}
		normAuthor := normalizeEditionText(rawAuthor)
		resolvedAuthors[i] = normAuthor
		if normAuthor == "" {
			continue
		}
		matchedExisting := false
		for idx, existing := range distinct {
			if existing == normAuthor || strings.Contains(existing, normAuthor) || strings.Contains(normAuthor, existing) {
				if len(normAuthor) < len(existing) {
					distinct[idx] = normAuthor
				}
				matchedExisting = true
				break
			}
		}
		if !matchedExisting {
			distinct = append(distinct, normAuthor)
		}
	}

	if len(distinct) <= 1 {
		return map[string][]editionRebuildCandidate{bucketKey: members}
	}

	out := make(map[string][]editionRebuildCandidate)
	for i, m := range members {
		a := resolvedAuthors[i]
		canonical := ""
		for _, d := range distinct {
			if a != "" && (a == d || strings.Contains(a, d) || strings.Contains(d, a)) {
				canonical = d
				break
			}
		}
		subKey := bucketKey + "\x00author:" + canonical
		out[subKey] = append(out[subKey], m)
	}
	return out
}

func buildEditionGroupFromCandidates(bucketKey string, members []editionRebuildCandidate, lockedGroupIDs map[string]bool) builtEditionGroup {
	sort.SliceStable(members, func(i, j int) bool {
		pi := FormatPriority(members[i].ComicType, members[i].Format)
		pj := FormatPriority(members[j].ComicType, members[j].Format)
		if pi != pj {
			return pi < pj
		}
		mi := strings.TrimSpace(members[i].MetadataSource) != ""
		mj := strings.TrimSpace(members[j].MetadataSource) != ""
		if mi != mj {
			return mi
		}
		if members[i].FileSize != members[j].FileSize {
			return members[i].FileSize > members[j].FileSize
		}
		if !members[i].AddedAt.Equal(members[j].AddedAt) {
			return members[i].AddedAt.Before(members[j].AddedAt)
		}
		return members[i].ID < members[j].ID
	})

	sum := sha1.Sum([]byte(bucketKey))
	groupID := fmt.Sprintf("edg_%x", sum[:10])
	for lockedGroupIDs[groupID] {
		groupID += "_a"
	}

	parts := strings.SplitN(bucketKey, "\x00", 3)
	scope := parts[0]
	matchKey := bucketKey
	if len(parts) == 3 {
		matchKey = parts[2]
	}

	seenFormat := make(map[string]bool)
	formats := make([]string, 0, len(members))
	items := make([]builtEditionItem, 0, len(members))
	for idx, m := range members {
		fmtUpper := strings.ToUpper(m.Format)
		isPrimary := false
		if !seenFormat[fmtUpper] {
			seenFormat[fmtUpper] = true
			formats = append(formats, fmtUpper)
			isPrimary = true
		}
		items = append(items, builtEditionItem{
			ComicID:         m.ID,
			LibraryID:       m.LibraryID,
			Format:          fmtUpper,
			EditionLabel:    m.EditionLabel,
			FormatPriority:  FormatPriority(m.ComicType, m.Format),
			IsFormatPrimary: isPrimary,
			SortIndex:       idx,
		})
	}
	formatsBytes, _ := json.Marshal(formats)

	title := strings.TrimSpace(members[0].Title)
	if title == "" {
		title = strings.TrimSuffix(path.Base(members[0].RelPath), path.Ext(members[0].RelPath))
	}

	return builtEditionGroup{
		ID:             groupID,
		ContentType:    members[0].ComicType,
		MergeScope:     scope,
		MatchKey:       matchKey,
		Title:          title,
		SortTitle:      BuildTitleSortKey(title),
		DefaultComicID: members[0].ID,
		FormatsJSON:    string(formatsBytes),
		EditionCount:   len(items),
		Items:          items,
	}
}

// BindBookEditions manually links two or more same-type comics into a single
// manual-locked BookEditionGroup so future scans preserve the link.
func BindBookEditions(comicIDs []string) (string, error) {
	uniqueIDs := normalizeUniqueIDs(comicIDs)
	if len(uniqueIDs) < 2 {
		return "", fmt.Errorf("at least two distinct comic IDs are required to bind editions")
	}

	placeholders := make([]string, len(uniqueIDs))
	args := make([]interface{}, len(uniqueIDs))
	for i, id := range uniqueIDs {
		placeholders[i] = "?"
		args[i] = id
	}
	in := strings.Join(placeholders, ",")

	type targetRow struct {
		ID           string
		LibraryID    string
		Type         string
		Title        string
		RelPath      string
		Format       string
		EditionLabel string
		FileSize     int64
		OldGroupID   string
	}

	rows, err := db.Query(fmt.Sprintf(`
		SELECT c."id", COALESCE(c."libraryId", ''), c."type", c."title",
		       COALESCE(NULLIF(c."relativePath", ''), c."filename"),
		       COALESCE(c."format", ''), COALESCE(c."editionLabel", ''), c."fileSize",
		       COALESCE(bei."groupId", '')
		FROM "Comic" c
		LEFT JOIN "BookEditionItem" bei ON bei."comicId" = c."id"
		WHERE c."id" IN (%s)
	`, in), args...)
	if err != nil {
		return "", err
	}

	byID := make(map[string]targetRow, len(uniqueIDs))
	var contentType string
	var reusedGroupID string
	oldGroupIDs := make(map[string]bool)
	for rows.Next() {
		var r targetRow
		if err := rows.Scan(&r.ID, &r.LibraryID, &r.Type, &r.Title, &r.RelPath, &r.Format, &r.EditionLabel, &r.FileSize, &r.OldGroupID); err != nil {
			rows.Close()
			return "", err
		}
		if r.Format == "" {
			r.Format = ExtractFileFormat(r.RelPath)
		}
		if r.EditionLabel == "" {
			r.EditionLabel = ExtractEditionLabel(r.RelPath)
		}
		if contentType == "" {
			contentType = r.Type
		} else if r.Type != contentType {
			rows.Close()
			return "", fmt.Errorf("cannot bind comic and novel items into the same edition group")
		}
		if r.OldGroupID != "" {
			oldGroupIDs[r.OldGroupID] = true
			if reusedGroupID == "" {
				reusedGroupID = r.OldGroupID
			}
		}
		byID[r.ID] = r
	}
	rows.Close()

	if len(byID) != len(uniqueIDs) {
		return "", fmt.Errorf("one or more comic IDs were not found")
	}

	groupID := reusedGroupID
	if groupID == "" {
		sorted := append([]string(nil), uniqueIDs...)
		sort.Strings(sorted)
		sum := sha1.Sum([]byte("manual\x00" + strings.Join(sorted, ",")))
		groupID = fmt.Sprintf("edg_m_%x", sum[:9])
	}

	err = runSerializedDBWrite("bind-book-editions", func() error {
		tx, err := db.Begin()
		if err != nil {
			return err
		}
		defer tx.Rollback()

		// Clear split lock on all explicitly bound comics
		if _, err := tx.Exec(fmt.Sprintf(`UPDATE "Comic" SET "editionSplitLocked" = 0 WHERE "id" IN (%s)`, in), args...); err != nil {
			return err
		}

		// Ensure target group exists and is locked
		primaryTitle := byID[uniqueIDs[0]].Title
		if _, err := tx.Exec(`
			INSERT INTO "BookEditionGroup" ("id", "contentType", "mergeScope", "matchKey", "title", "sortTitle", "manualLocked", "createdAt", "updatedAt")
			VALUES (?, ?, 'manual', ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
			ON CONFLICT("id") DO UPDATE SET
				"mergeScope" = 'manual',
				"manualLocked" = 1,
				"updatedAt" = CURRENT_TIMESTAMP
		`, groupID, contentType, groupID, primaryTitle, BuildTitleSortKey(primaryTitle)); err != nil {
			return err
		}

		// Move specified items into groupID
		for _, id := range uniqueIDs {
			r := byID[id]
			fmtUpper := strings.ToUpper(r.Format)
			prio := FormatPriority(r.Type, r.Format)
			if _, err := tx.Exec(`DELETE FROM "BookEditionItem" WHERE "comicId" = ?`, id); err != nil {
				return err
			}
			if _, err := tx.Exec(`
				INSERT INTO "BookEditionItem"
					("groupId", "comicId", "libraryId", "format", "editionLabel", "formatPriority", "isFormatPrimary", "sortIndex", "detectionSource")
				VALUES (?, ?, ?, ?, ?, ?, 0, 0, 'manual')
			`, groupID, r.ID, r.LibraryID, fmtUpper, r.EditionLabel, prio); err != nil {
				return err
			}
		}

		// Refresh target group and any old groups that lost members
		if err := refreshEditionGroupMetadataTx(tx, groupID); err != nil {
			return err
		}
		for oldGID := range oldGroupIDs {
			if oldGID == groupID {
				continue
			}
			if err := refreshEditionGroupMetadataTx(tx, oldGID); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(`UPDATE "ComicSeriesSourceRevision" SET "revision" = "revision" + 1 WHERE "id" = 1`); err != nil {
			return err
		}
		return tx.Commit()
	})
	if err != nil {
		return "", err
	}
	return groupID, nil
}

// SplitBookEdition detaches the specified comic IDs from their BookEditionGroup
// and marks them editionSplitLocked=1 so auto rebuild will not re-merge them.
func SplitBookEdition(comicIDs []string) error {
	uniqueIDs := normalizeUniqueIDs(comicIDs)
	if len(uniqueIDs) == 0 {
		return nil
	}
	placeholders := make([]string, len(uniqueIDs))
	args := make([]interface{}, len(uniqueIDs))
	for i, id := range uniqueIDs {
		placeholders[i] = "?"
		args[i] = id
	}
	in := strings.Join(placeholders, ",")

	return runSerializedDBWrite("split-book-editions", func() error {
		tx, err := db.Begin()
		if err != nil {
			return err
		}
		defer tx.Rollback()

		rows, err := tx.Query(fmt.Sprintf(`SELECT DISTINCT "groupId" FROM "BookEditionItem" WHERE "comicId" IN (%s)`, in), args...)
		if err != nil {
			return err
		}
		var affectedGroups []string
		for rows.Next() {
			var gid string
			if rows.Scan(&gid) == nil && gid != "" {
				affectedGroups = append(affectedGroups, gid)
			}
		}
		rows.Close()

		if _, err := tx.Exec(fmt.Sprintf(`DELETE FROM "BookEditionItem" WHERE "comicId" IN (%s)`, in), args...); err != nil {
			return err
		}
		if _, err := tx.Exec(fmt.Sprintf(`UPDATE "Comic" SET "editionSplitLocked" = 1 WHERE "id" IN (%s)`, in), args...); err != nil {
			return err
		}
		for _, gid := range affectedGroups {
			if err := refreshEditionGroupMetadataTx(tx, gid); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(`UPDATE "ComicSeriesSourceRevision" SET "revision" = "revision" + 1 WHERE "id" = 1`); err != nil {
			return err
		}
		return tx.Commit()
	})
}

func refreshEditionGroupMetadataTx(tx *sql.Tx, groupID string) error {
	rows, err := tx.Query(`
		SELECT i."comicId", i."format", i."formatPriority", c."title", c."fileSize"
		FROM "BookEditionItem" i
		JOIN "Comic" c ON c."id" = i."comicId"
		WHERE i."groupId" = ?
		ORDER BY i."formatPriority" ASC, c."fileSize" DESC, i."comicId" ASC
	`, groupID)
	if err != nil {
		return err
	}
	type itemMeta struct {
		ComicID  string
		Format   string
		Priority int
		Title    string
	}
	var items []itemMeta
	for rows.Next() {
		var m itemMeta
		var fileSize int64
		if rows.Scan(&m.ComicID, &m.Format, &m.Priority, &m.Title, &fileSize) == nil {
			items = append(items, m)
		}
	}
	rows.Close()

	if len(items) < 2 {
		if _, err := tx.Exec(`DELETE FROM "BookEditionItem" WHERE "groupId" = ?`, groupID); err != nil {
			return err
		}
		if _, err := tx.Exec(`DELETE FROM "BookEditionGroup" WHERE "id" = ?`, groupID); err != nil {
			return err
		}
		return nil
	}

	seenFormat := make(map[string]bool)
	formats := make([]string, 0, len(items))
	for idx, m := range items {
		fmtUpper := strings.ToUpper(m.Format)
		isPrimary := 0
		if !seenFormat[fmtUpper] {
			seenFormat[fmtUpper] = true
			formats = append(formats, fmtUpper)
			isPrimary = 1
		}
		if _, err := tx.Exec(`
			UPDATE "BookEditionItem"
			SET "isFormatPrimary" = ?, "sortIndex" = ?
			WHERE "groupId" = ? AND "comicId" = ?
		`, isPrimary, idx, groupID, m.ComicID); err != nil {
			return err
		}
	}
	formatsBytes, _ := json.Marshal(formats)
	_, err = tx.Exec(`
		UPDATE "BookEditionGroup"
		SET "defaultComicId" = ?, "formatsJson" = ?, "editionCount" = ?, "updatedAt" = CURRENT_TIMESTAMP
		WHERE "id" = ?
	`, items[0].ComicID, string(formatsBytes), len(items), groupID)
	return err
}

func normalizeUniqueIDs(raw []string) []string {
	seen := make(map[string]struct{}, len(raw))
	out := make([]string, 0, len(raw))
	for _, id := range raw {
		trimmed := strings.TrimSpace(id)
		if trimmed == "" {
			continue
		}
		if _, ok := seen[trimmed]; ok {
			continue
		}
		seen[trimmed] = struct{}{}
		out = append(out, trimmed)
	}
	return out
}

// GetComicEditionsForUser returns visible edition variants for a comic, filtered by
// accessibleLibraryIDs when filterLibraries is true, with preferredComicID selected
// by latest reading activity then formatPriority.
func GetComicEditionsForUser(comicID, userID string, accessibleLibraryIDs []string, filterLibraries bool) (editionGroupID string, formats []string, preferredComicID string, rows []BookEditionMemberRow, err error) {
	if filterLibraries && len(accessibleLibraryIDs) == 0 {
		return "", nil, "", nil, nil
	}

	var rawGroupID sql.NullString
	_ = db.QueryRow(`SELECT "groupId" FROM "BookEditionItem" WHERE "comicId" = ?`, comicID).Scan(&rawGroupID)

	userJoin := ""
	lastReadExpr := `c."lastReadAt"`
	lastPageExpr := `c."lastReadPage"`
	statusExpr := `c."readingStatus"`
	readTimeExpr := `c."totalReadTime"`
	var queryArgs []interface{}
	if userID != "" {
		userJoin = ` LEFT JOIN "UserComicState" ucs ON ucs."comicId" = c."id" AND ucs."userId" = ? `
		lastReadExpr = `ucs."lastReadAt"`
		lastPageExpr = `COALESCE(ucs."lastReadPage", 0)`
		statusExpr = `COALESCE(ucs."readingStatus", '')`
		readTimeExpr = `COALESCE(ucs."totalReadTime", 0)`
		queryArgs = append(queryArgs, userID)
	}

	var where string
	if rawGroupID.Valid && rawGroupID.String != "" {
		where = `bei."groupId" = ? AND l."enabled" = 1`
		queryArgs = append(queryArgs, rawGroupID.String)
		if filterLibraries && len(accessibleLibraryIDs) > 0 {
			ph := make([]string, len(accessibleLibraryIDs))
			for i, lid := range accessibleLibraryIDs {
				ph[i] = "?"
				queryArgs = append(queryArgs, lid)
			}
			where += fmt.Sprintf(` AND c."libraryId" IN (%s)`, strings.Join(ph, ","))
		}

		q := fmt.Sprintf(`
			SELECT bei."groupId", c."id", COALESCE(c."libraryId", ''), COALESCE(l."name", ''),
			       c."title", c."filename", COALESCE(NULLIF(c."relativePath", ''), c."filename"),
			       COALESCE(c."author", ''), c."type",
			       COALESCE(NULLIF(bei."format", ''), UPPER(c."format")),
			       COALESCE(NULLIF(bei."editionLabel", ''), c."editionLabel"),
			       bei."formatPriority", bei."isFormatPrimary", bei."detectionSource",
			       c."fileSize", c."pageCount", %s, %s, %s, %s
			FROM "BookEditionItem" bei
			JOIN "Comic" c ON c."id" = bei."comicId"
			JOIN "Library" l ON l."id" = c."libraryId"
			%s
			WHERE %s
			ORDER BY bei."formatPriority" ASC, bei."isFormatPrimary" DESC, bei."sortIndex" ASC, c."fileSize" DESC, c."id" ASC
		`, lastPageExpr, lastReadExpr, statusExpr, readTimeExpr, userJoin, where)

		dbRows, qErr := db.Query(q, queryArgs...)
		if qErr != nil {
			return "", nil, "", nil, qErr
		}
		scanned, scanErr := scanBookEditionMemberRows(dbRows)
		dbRows.Close()
		if scanErr != nil {
			return "", nil, "", nil, scanErr
		}
		rows = append(rows, scanned...)
	}

	// If not in any group or filtered down to 0 rows, fall back to the single comic itself.
	if len(rows) == 0 {
		singleArgs := []interface{}{}
		if userID != "" {
			singleArgs = append(singleArgs, userID)
		}
		singleArgs = append(singleArgs, comicID)
		q := fmt.Sprintf(`
			SELECT '', c."id", COALESCE(c."libraryId", ''), COALESCE(l."name", ''),
			       c."title", c."filename", COALESCE(NULLIF(c."relativePath", ''), c."filename"),
			       COALESCE(c."author", ''), c."type", COALESCE(c."format", ''), COALESCE(c."editionLabel", ''),
			       0, 1, '',
			       c."fileSize", c."pageCount", %s, %s, %s, %s
			FROM "Comic" c
			LEFT JOIN "Library" l ON l."id" = c."libraryId"
			%s
			WHERE c."id" = ?
		`, lastPageExpr, lastReadExpr, statusExpr, readTimeExpr, userJoin)
		var r BookEditionMemberRow
		var lastReadAtStr sql.NullString
		var primaryInt int
		scanErr := db.QueryRow(q, singleArgs...).Scan(
			&r.GroupID, &r.ComicID, &r.LibraryID, &r.LibraryName,
			&r.Title, &r.Filename, &r.RelativePath,
			&r.Author, &r.ComicType, &r.Format, &r.EditionLabel,
			&r.FormatPriority, &primaryInt, &r.DetectionSource,
			&r.FileSize, &r.PageCount, &r.LastReadPage, &lastReadAtStr, &r.ReadingStatus, &r.TotalReadTime,
		)
		if scanErr == sql.ErrNoRows {
			return "", nil, "", nil, nil
		}
		if scanErr != nil {
			return "", nil, "", nil, scanErr
		}
		r.IsFormatPrimary = true
		if r.Format == "" {
			r.Format = ExtractFileFormat(r.RelativePath)
		}
		r.Format = strings.ToUpper(r.Format)
		if r.EditionLabel == "" {
			r.EditionLabel = ExtractEditionLabel(r.RelativePath)
		}
		r.FormatPriority = FormatPriority(r.ComicType, r.Format)
		if lastReadAtStr.Valid && lastReadAtStr.String != "" {
			s := strings.TrimSpace(lastReadAtStr.String)
			if parsed := parseSQLiteTime(s); !parsed.IsZero() {
				v := parsed.UTC().Format(time.RFC3339Nano)
				r.LastReadAt = &v
			} else {
				r.LastReadAt = &s
			}
		}
		rows = []BookEditionMemberRow{r}
	}

	if len(rows) >= 2 && rawGroupID.Valid {
		editionGroupID = rawGroupID.String
	}

	preferredIdx := pickPreferredEditionIndex(rows)
	rows[preferredIdx].IsPreferred = true
	preferredComicID = rows[preferredIdx].ComicID
	formats = collectEditionFormats(rows)
	return editionGroupID, formats, preferredComicID, rows, nil
}

// BookEditionSummary describes the edition group a comic belongs to along with
// all accessible sibling members ordered by format priority.
type BookEditionSummary struct {
	GroupID          string
	Formats          []string
	EditionCount     int
	PreferredComicID string
	Members          []BookEditionMemberRow
}

func pickPreferredEditionIndex(rows []BookEditionMemberRow) int {
	if len(rows) == 0 {
		return 0
	}
	preferredIdx := 0
	bestReadTime := time.Time{}
	hasAnyTimestamp := false
	hasAnyProgress := false
	for i, r := range rows {
		if r.LastReadAt != nil && *r.LastReadAt != "" {
			t := parseSQLiteTime(*r.LastReadAt)
			if !hasAnyTimestamp || (!t.IsZero() && t.After(bestReadTime)) {
				bestReadTime = t
				hasAnyTimestamp = true
				preferredIdx = i
			}
		} else if !hasAnyTimestamp && (r.LastReadPage > 0 || r.ReadingStatus == "reading" || r.ReadingStatus == "finished") {
			if !hasAnyProgress {
				hasAnyProgress = true
				preferredIdx = i
			}
		}
	}
	return preferredIdx
}

func collectEditionFormats(rows []BookEditionMemberRow) []string {
	seenFmt := make(map[string]bool, len(rows))
	formats := make([]string, 0, len(rows))
	for _, r := range rows {
		if r.Format != "" && !seenFmt[r.Format] {
			seenFmt[r.Format] = true
			formats = append(formats, r.Format)
		}
	}
	return formats
}

func scanBookEditionMemberRows(dbRows *sql.Rows) ([]BookEditionMemberRow, error) {
	var result []BookEditionMemberRow
	for dbRows.Next() {
		var r BookEditionMemberRow
		var lastReadAtStr sql.NullString
		var primaryInt int
		if scanErr := dbRows.Scan(
			&r.GroupID, &r.ComicID, &r.LibraryID, &r.LibraryName,
			&r.Title, &r.Filename, &r.RelativePath,
			&r.Author, &r.ComicType, &r.Format, &r.EditionLabel,
			&r.FormatPriority, &primaryInt, &r.DetectionSource,
			&r.FileSize, &r.PageCount, &r.LastReadPage, &lastReadAtStr, &r.ReadingStatus, &r.TotalReadTime,
		); scanErr != nil {
			continue
		}
		r.IsFormatPrimary = primaryInt != 0
		r.Format = strings.ToUpper(r.Format)
		if r.Format == "" {
			r.Format = strings.ToUpper(ExtractFileFormat(r.RelativePath))
		}
		if lastReadAtStr.Valid && lastReadAtStr.String != "" {
			s := strings.TrimSpace(lastReadAtStr.String)
			if parsed := parseSQLiteTime(s); !parsed.IsZero() {
				v := parsed.UTC().Format(time.RFC3339Nano)
				r.LastReadAt = &v
			} else {
				r.LastReadAt = &s
			}
		}
		result = append(result, r)
	}
	return result, dbRows.Err()
}

// GetEditionGroupsForComicIDs returns comicId -> BookEditionSummary (including
// all accessible sibling editions in the same group) for a set of comic IDs.
func GetEditionGroupsForComicIDs(comicIDs []string, userID string, accessibleLibraryIDs []string, filterLibraries bool) (map[string]BookEditionSummary, error) {
	result := make(map[string]BookEditionSummary)
	if len(comicIDs) == 0 {
		return result, nil
	}
	if filterLibraries && len(accessibleLibraryIDs) == 0 {
		return result, nil
	}

	comicToGroup := make(map[string]string)
	groupSet := make(map[string]struct{})
	for start := 0; start < len(comicIDs); start += batchSize {
		end := start + batchSize
		if end > len(comicIDs) {
			end = len(comicIDs)
		}
		batch := comicIDs[start:end]
		ph := make([]string, len(batch))
		args := make([]interface{}, len(batch))
		for i, id := range batch {
			ph[i] = "?"
			args[i] = id
		}
		rows, err := db.Query(fmt.Sprintf(`
			SELECT "comicId", "groupId"
			FROM "BookEditionItem"
			WHERE "comicId" IN (%s)
		`, strings.Join(ph, ",")), args...)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var cid, gid string
			if rows.Scan(&cid, &gid) == nil && gid != "" {
				comicToGroup[cid] = gid
				groupSet[gid] = struct{}{}
			}
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, err
		}
		rows.Close()
	}
	if len(groupSet) == 0 {
		return result, nil
	}

	groupIDs := make([]string, 0, len(groupSet))
	for gid := range groupSet {
		groupIDs = append(groupIDs, gid)
	}

	userJoin := ""
	lastReadExpr := `c."lastReadAt"`
	lastPageExpr := `c."lastReadPage"`
	statusExpr := `c."readingStatus"`
	readTimeExpr := `c."totalReadTime"`
	if userID != "" {
		userJoin = ` LEFT JOIN "UserComicState" ucs ON ucs."comicId" = c."id" AND ucs."userId" = ? `
		lastReadExpr = `ucs."lastReadAt"`
		lastPageExpr = `COALESCE(ucs."lastReadPage", 0)`
		statusExpr = `COALESCE(ucs."readingStatus", '')`
		readTimeExpr = `COALESCE(ucs."totalReadTime", 0)`
	}

	libClause := ""
	var libArgs []interface{}
	if filterLibraries && len(accessibleLibraryIDs) > 0 {
		lPh := make([]string, len(accessibleLibraryIDs))
		for i, lid := range accessibleLibraryIDs {
			lPh[i] = "?"
			libArgs = append(libArgs, lid)
		}
		libClause = ` AND c."libraryId" IN (` + strings.Join(lPh, ",") + `)`
	}

	membersByGroup := make(map[string][]BookEditionMemberRow, len(groupIDs))
	for start := 0; start < len(groupIDs); start += batchSize {
		end := start + batchSize
		if end > len(groupIDs) {
			end = len(groupIDs)
		}
		batch := groupIDs[start:end]
		gPh := make([]string, len(batch))
		qArgs := make([]interface{}, 0, len(batch)+len(libArgs)+1)
		if userID != "" {
			qArgs = append(qArgs, userID)
		}
		for i, gid := range batch {
			gPh[i] = "?"
			qArgs = append(qArgs, gid)
		}
		qArgs = append(qArgs, libArgs...)

		q := fmt.Sprintf(`
			SELECT bei."groupId", c."id", COALESCE(c."libraryId", ''), COALESCE(l."name", ''),
			       c."title", c."filename", COALESCE(NULLIF(c."relativePath", ''), c."filename"),
			       COALESCE(c."author", ''), c."type",
			       COALESCE(NULLIF(bei."format", ''), UPPER(c."format")),
			       COALESCE(NULLIF(bei."editionLabel", ''), c."editionLabel"),
			       bei."formatPriority", bei."isFormatPrimary", bei."detectionSource",
			       c."fileSize", c."pageCount", %s, %s, %s, %s
			FROM "BookEditionItem" bei
			JOIN "Comic" c ON c."id" = bei."comicId"
			JOIN "Library" l ON l."id" = c."libraryId" AND l."enabled" = 1
			%s
			WHERE bei."groupId" IN (%s)%s
			ORDER BY bei."groupId" ASC, bei."formatPriority" ASC, bei."isFormatPrimary" DESC, bei."sortIndex" ASC, c."fileSize" DESC, c."id" ASC
		`, lastPageExpr, lastReadExpr, statusExpr, readTimeExpr, userJoin, strings.Join(gPh, ","), libClause)

		dbRows, err := db.Query(q, qArgs...)
		if err != nil {
			return nil, err
		}
		scanned, scanErr := scanBookEditionMemberRows(dbRows)
		dbRows.Close()
		if scanErr != nil {
			return nil, scanErr
		}
		for _, r := range scanned {
			membersByGroup[r.GroupID] = append(membersByGroup[r.GroupID], r)
		}
	}

	summariesByGroup := make(map[string]BookEditionSummary, len(membersByGroup))
	for gid, members := range membersByGroup {
		if len(members) < 2 {
			continue
		}
		copied := make([]BookEditionMemberRow, len(members))
		copy(copied, members)
		prefIdx := pickPreferredEditionIndex(copied)
		copied[prefIdx].IsPreferred = true
		summariesByGroup[gid] = BookEditionSummary{
			GroupID:          gid,
			Formats:          collectEditionFormats(copied),
			EditionCount:     len(copied),
			PreferredComicID: copied[prefIdx].ComicID,
			Members:          copied,
		}
	}

	for cid, gid := range comicToGroup {
		if summary, ok := summariesByGroup[gid]; ok {
			result[cid] = summary
		}
	}
	return result, nil
}

// hydrateComicEditionSummaries batch-loads Formats and EditionCount for a single page
// of shelf items in one query, respecting library/directory visibility filters.
func hydrateComicEditionSummaries(comics []ComicListItem, opts ComicListOptions) error {
	if len(comics) == 0 {
		return nil
	}

	comicIdx := make(map[string]int, len(comics))
	regularIDs := make([]string, 0, len(comics))
	for i := range comics {
		if strings.HasPrefix(comics[i].ID, SeriesShelfIDPrefix) {
			continue
		}
		if comics[i].Format == "" {
			comics[i].Format = strings.ToUpper(ExtractFileFormat(comics[i].Filename))
		}
		if comics[i].EditionLabel == "" {
			comics[i].EditionLabel = ExtractEditionLabel(comics[i].Filename)
		}
		comics[i].Formats = []string{comics[i].Format}
		comics[i].EditionCount = 1
		comicIdx[comics[i].ID] = i
		regularIDs = append(regularIDs, comics[i].ID)
	}
	if len(regularIDs) == 0 {
		return nil
	}

	// Step 1: map regular comicID -> groupId for this page (at most PageSize IDs).
	ph := make([]string, len(regularIDs))
	args := make([]interface{}, len(regularIDs))
	for i, id := range regularIDs {
		ph[i] = "?"
		args[i] = id
	}
	comicToGroup := make(map[string]string)
	groupSet := make(map[string]struct{})
	rows, err := db.Query(fmt.Sprintf(`
		SELECT "comicId", "groupId"
		FROM "BookEditionItem"
		WHERE "comicId" IN (%s)
	`, strings.Join(ph, ",")), args...)
	if err != nil {
		return err
	}
	for rows.Next() {
		var cid, gid string
		if rows.Scan(&cid, &gid) == nil && gid != "" {
			comicToGroup[cid] = gid
			groupSet[gid] = struct{}{}
		}
	}
	rows.Close()
	if len(groupSet) == 0 {
		return nil
	}

	groupIDs := make([]string, 0, len(groupSet))
	for gid := range groupSet {
		groupIDs = append(groupIDs, gid)
	}
	gPh := make([]string, len(groupIDs))
	gArgs := make([]interface{}, 0, len(groupIDs)+len(opts.LibraryIDs)+3)
	for i, gid := range groupIDs {
		gPh[i] = "?"
		gArgs = append(gArgs, gid)
	}

	scopeWhere := `bei."groupId" IN (` + strings.Join(gPh, ",") + `) AND l."enabled" = 1`
	if opts.FilterLibraryIDs {
		if len(opts.LibraryIDs) == 0 {
			scopeWhere += ` AND 1=0`
		} else if len(opts.LibraryIDs) <= seriesMembershipBatchSize {
			lPh := make([]string, len(opts.LibraryIDs))
			for i, lid := range opts.LibraryIDs {
				lPh[i] = "?"
				gArgs = append(gArgs, lid)
			}
			scopeWhere += ` AND c."libraryId" IN (` + strings.Join(lPh, ",") + `)`
		}
	} else if len(opts.LibraryIDs) > 0 && len(opts.LibraryIDs) <= seriesMembershipBatchSize {
		lPh := make([]string, len(opts.LibraryIDs))
		for i, lid := range opts.LibraryIDs {
			lPh[i] = "?"
			gArgs = append(gArgs, lid)
		}
		scopeWhere += ` AND c."libraryId" IN (` + strings.Join(lPh, ",") + `)`
	}
	if opts.DirectoryPath != "" {
		if cleanDir, vErr := ValidateDirectoryRelativePath(opts.DirectoryPath); vErr == nil && cleanDir != "" {
			lower, upper := DirectoryPrefixRange(cleanDir)
			scopeWhere += ` AND c."relativePath" > ? AND c."relativePath" < ?`
			gArgs = append(gArgs, lower, upper)
		}
	}
	if opts.ContentType == "novel" || opts.ContentType == "comic" {
		scopeWhere += ` AND c."type" = ?`
		gArgs = append(gArgs, opts.ContentType)
	}

	mRows, err := db.Query(fmt.Sprintf(`
		SELECT bei."groupId", COALESCE(NULLIF(bei."format", ''), UPPER(c."format")), bei."formatPriority"
		FROM "BookEditionItem" bei
		JOIN "Comic" c ON c."id" = bei."comicId"
		JOIN "Library" l ON l."id" = c."libraryId"
		WHERE %s
		ORDER BY bei."groupId", bei."formatPriority" ASC, bei."sortIndex" ASC, bei."comicId" ASC
	`, scopeWhere), gArgs...)
	if err != nil {
		return err
	}
	defer mRows.Close()

	type groupSummary struct {
		count   int
		formats []string
		seen    map[string]bool
	}
	summaries := make(map[string]*groupSummary, len(groupIDs))
	for mRows.Next() {
		var gid, format string
		var prio int
		if mRows.Scan(&gid, &format, &prio) != nil {
			continue
		}
		format = strings.ToUpper(strings.TrimSpace(format))
		gs := summaries[gid]
		if gs == nil {
			gs = &groupSummary{seen: make(map[string]bool)}
			summaries[gid] = gs
		}
		gs.count++
		if format != "" && !gs.seen[format] {
			gs.seen[format] = true
			gs.formats = append(gs.formats, format)
		}
	}

	for cid, gid := range comicToGroup {
		idx, ok := comicIdx[cid]
		if !ok {
			continue
		}
		gs := summaries[gid]
		if gs == nil || gs.count < 2 {
			continue
		}
		comics[idx].EditionGroupID = gid
		comics[idx].Formats = gs.formats
		comics[idx].EditionCount = gs.count
	}
	return nil
}

// CheckBookEditionsExist reports whether any BookEditionItem exists in the
// given library scope (or globally when filterLibraries is false).
func CheckBookEditionsExist(libraryIDs []string, filterLibraries bool) (bool, error) {
	if !filterLibraries {
		var exists int
		if err := db.QueryRow(`SELECT EXISTS(SELECT 1 FROM "BookEditionItem" LIMIT 1)`).Scan(&exists); err != nil {
			return false, err
		}
		return exists != 0, nil
	}
	if len(libraryIDs) == 0 {
		return false, nil
	}
	for i := 0; i < len(libraryIDs); i += seriesMembershipBatchSize {
		end := i + seriesMembershipBatchSize
		if end > len(libraryIDs) {
			end = len(libraryIDs)
		}
		batch := libraryIDs[i:end]
		ph := make([]string, len(batch))
		args := make([]interface{}, len(batch))
		for j, id := range batch {
			ph[j] = "?"
			args[j] = id
		}
		var exists int
		if err := db.QueryRow(fmt.Sprintf(`
			SELECT EXISTS(
				SELECT 1
				FROM "BookEditionItem" bei
				JOIN "Comic" c ON c."id" = bei."comicId"
				WHERE c."libraryId" IN (%s)
				LIMIT 1
			)
		`, strings.Join(ph, ",")), args...).Scan(&exists); err != nil {
			return false, err
		}
		if exists != 0 {
			return true, nil
		}
	}
	return false, nil
}

// ExpandDeleteTargetComicIDs expands mixed shelf/detail IDs (including `series-<id>`
// and optionally sibling editions in the same BookEditionGroup) into deduplicated
// physical Comic IDs plus any matched ComicSeries IDs.
func ExpandDeleteTargetComicIDs(rawIDs []string, includeEditions bool) (expandedComicIDs []string, seriesIDs []string, err error) {
	seenSeries := make(map[string]struct{})
	seenComics := make(map[string]struct{})
	var baseComicIDs []string

	for _, raw := range rawIDs {
		trimmed := strings.TrimSpace(raw)
		if trimmed == "" {
			continue
		}
		if strings.HasPrefix(trimmed, SeriesShelfIDPrefix) {
			sid := strings.TrimPrefix(trimmed, SeriesShelfIDPrefix)
			if sid != "" {
				if _, ok := seenSeries[sid]; !ok {
					seenSeries[sid] = struct{}{}
					seriesIDs = append(seriesIDs, sid)
				}
			}
			continue
		}
		if _, ok := seenComics[trimmed]; !ok {
			seenComics[trimmed] = struct{}{}
			baseComicIDs = append(baseComicIDs, trimmed)
		}
	}

	if len(seriesIDs) > 0 {
		for start := 0; start < len(seriesIDs); start += batchSize {
			end := start + batchSize
			if end > len(seriesIDs) {
				end = len(seriesIDs)
			}
			batch := seriesIDs[start:end]
			ph := make([]string, len(batch))
			args := make([]interface{}, len(batch))
			for i, sid := range batch {
				ph[i] = "?"
				args[i] = sid
			}
			rows, qErr := db.Query(fmt.Sprintf(`
				SELECT si."comicId"
				FROM "ComicSeriesItem" si
				JOIN "Comic" c ON c."id" = si."comicId"
				WHERE si."seriesId" IN (%s)
				ORDER BY si."sortIndex", si."comicId"
			`, strings.Join(ph, ",")), args...)
			if qErr != nil {
				return nil, nil, qErr
			}
			for rows.Next() {
				var cid string
				if rows.Scan(&cid) == nil && cid != "" {
					if _, ok := seenComics[cid]; !ok {
						seenComics[cid] = struct{}{}
						baseComicIDs = append(baseComicIDs, cid)
					}
				}
			}
			if rowsErr := rows.Err(); rowsErr != nil {
				rows.Close()
				return nil, nil, rowsErr
			}
			rows.Close()
		}
	}

	expandedComicIDs = append([]string{}, baseComicIDs...)
	if includeEditions && len(baseComicIDs) > 0 {
		for start := 0; start < len(baseComicIDs); start += batchSize {
			end := start + batchSize
			if end > len(baseComicIDs) {
				end = len(baseComicIDs)
			}
			batch := baseComicIDs[start:end]
			ph := make([]string, len(batch))
			args := make([]interface{}, len(batch))
			for i, cid := range batch {
				ph[i] = "?"
				args[i] = cid
			}
			rows, qErr := db.Query(fmt.Sprintf(`
				SELECT DISTINCT bei2."comicId"
				FROM "BookEditionItem" bei1
				JOIN "BookEditionItem" bei2 ON bei2."groupId" = bei1."groupId"
				JOIN "Comic" c ON c."id" = bei2."comicId"
				WHERE bei1."comicId" IN (%s)
			`, strings.Join(ph, ",")), args...)
			if qErr != nil {
				return nil, nil, qErr
			}
			for rows.Next() {
				var sibID string
				if rows.Scan(&sibID) == nil && sibID != "" {
					if _, ok := seenComics[sibID]; !ok {
						seenComics[sibID] = struct{}{}
						expandedComicIDs = append(expandedComicIDs, sibID)
					}
				}
			}
			if rowsErr := rows.Err(); rowsErr != nil {
				rows.Close()
				return nil, nil, rowsErr
			}
			rows.Close()
		}
	}

	return expandedComicIDs, seriesIDs, nil
}
