package store

import (
	"errors"
	"fmt"
	"sort"
	"strings"
)

var (
	ErrInvalidDirectoryPath     = errors.New("invalid directory relative path")
	ErrInvalidDirectoryDepth    = errors.New("directory path exceeds library category depth")
	ErrDirectoryLibraryNotFound = errors.New("library not found")
)

type LibraryDirectoryBreadcrumb struct {
	Name string `json:"name"`
	Path string `json:"path"`
}

type LibraryDirectoryNode struct {
	Name        string `json:"name"`
	Path        string `json:"path"`
	Depth       int    `json:"depth"`
	WorkCount   int    `json:"workCount"`
	HasChildren bool   `json:"hasChildren"`
	CoverURL    string `json:"coverUrl"`
	sortKey     string
}

type LibraryDirectoryQueryOptions struct {
	LibraryID string
	UserID    string
	Parent    string
	Page      int
	PageSize  int
}

type LibraryDirectoryListResult struct {
	LibraryID         string                       `json:"libraryId"`
	SeriesDepth       int                          `json:"seriesDepth"`
	MaxDirectoryDepth int                          `json:"maxDirectoryDepth"`
	Parent            string                       `json:"parent"`
	Breadcrumbs       []LibraryDirectoryBreadcrumb `json:"breadcrumbs"`
	Directories       []LibraryDirectoryNode       `json:"directories"`
	Total             int                          `json:"total"`
	Page              int                          `json:"page"`
	PageSize          int                          `json:"pageSize"`
	TotalPages        int                          `json:"totalPages"`
}

func isASCIIDriveLetter(b byte) bool {
	return (b >= 'a' && b <= 'z') || (b >= 'A' && b <= 'Z')
}

// ValidateDirectoryRelativePath validates that raw is either "" (library root)
// or a clean POSIX library-relative directory path without leading/trailing
// slashes, backslashes, control characters, drive prefixes, empty segments, or
// dot-segments ("." / ".."). It never accesses the host filesystem.
func ValidateDirectoryRelativePath(raw string) (string, error) {
	if raw == "" {
		return "", nil
	}
	if strings.HasPrefix(raw, "/") || strings.HasSuffix(raw, "/") || strings.ContainsRune(raw, '\\') {
		return "", ErrInvalidDirectoryPath
	}
	for _, r := range raw {
		if r < 0x20 || r == 0x7f {
			return "", ErrInvalidDirectoryPath
		}
	}
	segments := strings.Split(raw, "/")
	for idx, seg := range segments {
		if seg == "" || seg == "." || seg == ".." || strings.TrimSpace(seg) == "" {
			return "", ErrInvalidDirectoryPath
		}
		if idx == 0 && len(seg) >= 2 && isASCIIDriveLetter(seg[0]) && seg[1] == ':' {
			return "", ErrInvalidDirectoryPath
		}
	}
	return strings.Join(segments, "/"), nil
}

// DirectoryPrefixRange returns strict lower and upper bounds in SQLite BINARY
// collation for matching paths strictly inside cleanDir ("cleanDir/...").
// Because '/' is ASCII 0x2F and '0' is ASCII 0x30:
//   - "韩漫/..." satisfies > "韩漫/" and < "韩漫0"
//   - "韩漫/" (a root-level image-folder comic) is excluded by strict >
//   - "韩漫备份/...", "韩漫_2/...", "韩漫%2/..." are excluded without LIKE wildcards.
func DirectoryPrefixRange(cleanDir string) (lower, upper string) {
	return cleanDir + "/", cleanDir + "0"
}

// ListLibraryDirectories derives immediate child classification directories,
// logical work counts, and representative cover URLs under opts.Parent without
// touching the host filesystem or creating manual Category records.
// Classification directories stop at depth (seriesDepth - 1) so works and
// chapters are never exposed as directory categories.
func ListLibraryDirectories(opts LibraryDirectoryQueryOptions) (*LibraryDirectoryListResult, error) {
	libraryID := strings.TrimSpace(opts.LibraryID)
	if libraryID == "" {
		return nil, ErrDirectoryLibraryNotFound
	}
	lib, err := GetLibraryByID(libraryID)
	if err != nil {
		return nil, err
	}
	if lib == nil {
		return nil, ErrDirectoryLibraryNotFound
	}

	cleanParent, err := ValidateDirectoryRelativePath(opts.Parent)
	if err != nil {
		return nil, err
	}

	seriesDepth := NormalizeSeriesDepth(lib.SeriesDepth)
	maxDirectoryDepth := 0
	if lib.Type == "comic" && seriesDepth > 1 {
		maxDirectoryDepth = seriesDepth - 1
	}

	var parentSegments []string
	if cleanParent != "" {
		parentSegments = strings.Split(cleanParent, "/")
	}
	parentDepth := len(parentSegments)
	if parentDepth > maxDirectoryDepth {
		return nil, ErrInvalidDirectoryDepth
	}

	breadcrumbs := make([]LibraryDirectoryBreadcrumb, 0, parentDepth)
	for i, seg := range parentSegments {
		breadcrumbs = append(breadcrumbs, LibraryDirectoryBreadcrumb{
			Name: seg,
			Path: strings.Join(parentSegments[:i+1], "/"),
		})
	}

	page := opts.Page
	if page < 1 {
		page = 1
	}
	defaultPageSize := opts.PageSize
	if defaultPageSize <= 0 {
		defaultPageSize = 50
	}

	result := &LibraryDirectoryListResult{
		LibraryID:         lib.ID,
		SeriesDepth:       seriesDepth,
		MaxDirectoryDepth: maxDirectoryDepth,
		Parent:            cleanParent,
		Breadcrumbs:       breadcrumbs,
		Directories:       []LibraryDirectoryNode{},
		Total:             0,
		Page:              page,
		PageSize:          defaultPageSize,
		TotalPages:        1,
	}

	if maxDirectoryDepth == 0 || parentDepth == maxDirectoryDepth {
		return result, nil
	}

	childDepth := parentDepth + 1
	args := []interface{}{lib.ID}

	restExpr := `RTRIM(c."relativePath", '/')`
	pathWhere := `c."libraryId" != '' AND c."relativePath" != '' AND c."libraryId" = ? AND c."type" = 'comic'`
	if cleanParent != "" {
		lower, upper := DirectoryPrefixRange(cleanParent)
		restExpr = `SUBSTR(RTRIM(c."relativePath", '/'), LENGTH(?) + 1)`
		args = append(args, lower)
		pathWhere += ` AND c."relativePath" > ? AND c."relativePath" < ?`
		args = append(args, lib.ID, lower, upper)
	} else {
		args = append(args, lib.ID)
	}

	query := fmt.Sprintf(`
		WITH valid_series AS (
			SELECT s."id", s."libraryId", s."coverUrl",
			       COALESCE(NULLIF(s."coverComicId", ''), MIN(si."comicId")) AS "coverComicId"
			FROM "ComicSeries" s
			JOIN "Library" l ON l."id" = s."libraryId"
			JOIN "ComicSeriesItem" si ON si."seriesId" = s."id"
			CROSS JOIN "Comic" c ON c."id" = si."comicId" AND c."libraryId" = s."libraryId"
			WHERE s."libraryId" = ? AND c."type" = 'comic'
			GROUP BY s."id"
			HAVING COUNT(*) >= %s
		),
		scoped AS (
			SELECT c."id" AS "comicId",
			       RTRIM(c."relativePath", '/') AS "cleanRel",
			       %s AS "rest",
			       vs."id" AS "seriesId",
			       vs."coverUrl" AS "seriesCoverUrl",
			       vs."coverComicId" AS "seriesCoverComicId"
			FROM "Comic" c
			LEFT JOIN "ComicSeriesItem" si ON si."comicId" = c."id"
			LEFT JOIN valid_series vs ON vs."id" = si."seriesId" AND vs."libraryId" = c."libraryId"
			WHERE %s
		),
		categorized AS (
			SELECT SUBSTR("rest", 1, INSTR("rest", '/') - 1) AS "dirName",
			       SUBSTR("rest", INSTR("rest", '/') + 1) AS "afterChild",
			       CASE WHEN "seriesId" IS NULL THEN 'c:' || "comicId" ELSE 's:' || "seriesId" END AS "logicalKey",
			       "cleanRel",
			       CASE
			           WHEN "seriesId" IS NOT NULL AND COALESCE("seriesCoverUrl", '') != '' THEN 's:' || "seriesId"
			           WHEN "seriesId" IS NOT NULL AND COALESCE("seriesCoverComicId", '') != '' THEN 'c:' || "seriesCoverComicId"
			           ELSE 'c:' || "comicId"
			       END AS "coverToken"
			FROM scoped
			WHERE INSTR("rest", '/') > 1
		)
		SELECT "dirName",
		       COUNT(DISTINCT "logicalKey") AS "workCount",
		       MAX(CASE WHEN INSTR("afterChild", '/') > 1 THEN 1 ELSE 0 END) AS "hasDeeperDir",
		       MIN("cleanRel" || char(31) || "coverToken") AS "firstCover"
		FROM categorized
		GROUP BY "dirName"
	`, effectiveSeriesMinMembersSQL("l"), restExpr, pathWhere)

	rows, err := db.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("query library directories: %w", err)
	}
	defer rows.Close()

	nodes := make([]LibraryDirectoryNode, 0)
	for rows.Next() {
		var dirName string
		var workCount int
		var hasDeeper int
		var firstCover string
		if err := rows.Scan(&dirName, &workCount, &hasDeeper, &firstCover); err != nil {
			return nil, fmt.Errorf("scan library directory node: %w", err)
		}
		if dirName == "" || workCount <= 0 {
			continue
		}
		nodePath := dirName
		if cleanParent != "" {
			nodePath = cleanParent + "/" + dirName
		}
		coverURL := resolveDirectoryCoverToken(firstCover)
		nodes = append(nodes, LibraryDirectoryNode{
			Name:        dirName,
			Path:        nodePath,
			Depth:       childDepth,
			WorkCount:   workCount,
			HasChildren: childDepth < maxDirectoryDepth && hasDeeper == 1,
			CoverURL:    coverURL,
			sortKey:     BuildTitleSortKey(dirName),
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate library directories: %w", err)
	}

	sort.SliceStable(nodes, func(i, j int) bool {
		if nodes[i].sortKey != nodes[j].sortKey {
			return nodes[i].sortKey < nodes[j].sortKey
		}
		return nodes[i].Name < nodes[j].Name
	})

	total := len(nodes)
	result.Total = total
	if opts.PageSize <= 0 {
		result.PageSize = total
		if result.PageSize == 0 {
			result.PageSize = 50
		}
		result.Directories = nodes
		return result, nil
	}

	result.PageSize = opts.PageSize
	if total > 0 {
		result.TotalPages = (total + opts.PageSize - 1) / opts.PageSize
	}
	offset := (page - 1) * opts.PageSize
	if offset >= total {
		return result, nil
	}
	end := offset + opts.PageSize
	if end > total {
		end = total
	}
	result.Directories = nodes[offset:end]
	return result, nil
}

func resolveDirectoryCoverToken(encoded string) string {
	sep := strings.LastIndexByte(encoded, 0x1f)
	if sep < 0 || sep+1 >= len(encoded) {
		return ""
	}
	token := encoded[sep+1:]
	switch {
	case strings.HasPrefix(token, "s:"):
		id := token[2:]
		if id != "" {
			return BuildSeriesCoverURL(id)
		}
	case strings.HasPrefix(token, "c:"):
		id := token[2:]
		if id != "" {
			return BuildComicCoverURL(id)
		}
	}
	return ""
}
