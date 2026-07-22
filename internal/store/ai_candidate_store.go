package store

import (
	"fmt"
	"strings"
)

const maxAICandidateLimit = 30

// AICandidateOptions describes the server-side selection used by AI batch jobs.
type AICandidateOptions struct {
	Filter           string
	ContentType      string
	LibraryIDs       []string
	FilterLibraryIDs bool
	Limit            int
}

// AICandidateResult contains only the IDs needed by the AI batch handlers.
type AICandidateResult struct {
	ComicIDs []string
	Total    int
}

// GetAICandidateComicIDs selects a bounded set of concrete comic rows without
// loading the full library payload into the client.
func GetAICandidateComicIDs(opts AICandidateOptions) (*AICandidateResult, error) {
	var conditions []string
	var args []interface{}

	switch opts.Filter {
	case "", "all":
	case "untagged":
		conditions = append(conditions, `NOT EXISTS (SELECT 1 FROM "ComicTag" ct WHERE ct."comicId" = c."id")`)
	case "uncategorized":
		conditions = append(conditions, `NOT EXISTS (SELECT 1 FROM "ComicCategory" cc WHERE cc."comicId" = c."id")`)
	default:
		return nil, fmt.Errorf("unsupported AI candidate filter %q", opts.Filter)
	}

	switch opts.ContentType {
	case "":
	case "comic", "novel":
		conditions = append(conditions, `c."type" = ?`)
		args = append(args, opts.ContentType)
	default:
		return nil, fmt.Errorf("unsupported content type %q", opts.ContentType)
	}

	libraryIDs := uniqueNonEmptyStrings(opts.LibraryIDs)
	if opts.FilterLibraryIDs {
		if len(libraryIDs) == 0 {
			conditions = append(conditions, "1=0")
		} else {
			placeholders := make([]string, len(libraryIDs))
			for i, libraryID := range libraryIDs {
				placeholders[i] = "?"
				args = append(args, libraryID)
			}
			conditions = append(conditions, fmt.Sprintf(`c."libraryId" IN (%s)`, strings.Join(placeholders, ",")))
		}
	}

	whereClause := ""
	if len(conditions) > 0 {
		whereClause = "WHERE " + strings.Join(conditions, " AND ")
	}

	result := &AICandidateResult{ComicIDs: []string{}}
	if err := db.QueryRow(`SELECT COUNT(*) FROM "Comic" c `+whereClause, args...).Scan(&result.Total); err != nil {
		return nil, fmt.Errorf("count AI candidates: %w", err)
	}

	limit := opts.Limit
	if limit <= 0 || limit > maxAICandidateLimit {
		limit = maxAICandidateLimit
	}
	queryArgs := append(append([]interface{}{}, args...), limit)
	rows, err := db.Query(`SELECT c."id" FROM "Comic" c `+whereClause+` ORDER BY c."addedAt" DESC, c."id" ASC LIMIT ?`, queryArgs...)
	if err != nil {
		return nil, fmt.Errorf("query AI candidates: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var comicID string
		if err := rows.Scan(&comicID); err != nil {
			return nil, fmt.Errorf("scan AI candidate: %w", err)
		}
		result.ComicIDs = append(result.ComicIDs, comicID)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate AI candidates: %w", err)
	}
	return result, nil
}

func uniqueNonEmptyStrings(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result
}
