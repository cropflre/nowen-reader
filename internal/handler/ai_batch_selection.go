package handler

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

const maxAIBatchSize = 30

type aiBatchSelector struct {
	Scope       string   `json:"scope"`
	ContentType string   `json:"contentType"`
	LibraryIDs  []string `json:"libraryIds"`
	Limit       int      `json:"limit"`
}

type aiBatchRequest struct {
	ComicIDs   []string         `json:"comicIds"`
	Selector   *aiBatchSelector `json:"selector"`
	TargetLang string           `json:"targetLang"`
	Apply      bool             `json:"apply"`
}

type aiBatchSelection struct {
	ComicIDs []string
	Eligible int
}

type aiBatchRequestError struct {
	Status  int
	Message string
}

func (e *aiBatchRequestError) Error() string { return e.Message }

func resolveAIBatchSelection(c *gin.Context, body *aiBatchRequest, kind string) (*aiBatchSelection, error) {
	if len(body.ComicIDs) > 0 && body.Selector != nil {
		return nil, &aiBatchRequestError{Status: http.StatusBadRequest, Message: "comicIds and selector are mutually exclusive"}
	}
	if len(body.ComicIDs) > 0 {
		ids := uniqueComicIDs(body.ComicIDs)
		if len(ids) > maxAIBatchSize {
			ids = ids[:maxAIBatchSize]
		}
		return &aiBatchSelection{ComicIDs: ids, Eligible: len(ids)}, nil
	}
	if body.Selector == nil {
		return nil, &aiBatchRequestError{Status: http.StatusBadRequest, Message: "comicIds or selector is required"}
	}

	filter, err := aiCandidateFilter(kind, body.Selector.Scope)
	if err != nil {
		return nil, err
	}
	contentType := strings.TrimSpace(body.Selector.ContentType)
	if contentType != "" && contentType != "comic" && contentType != "novel" {
		return nil, &aiBatchRequestError{Status: http.StatusBadRequest, Message: "selector.contentType must be comic or novel"}
	}

	userID := getUserID(c)
	if userID == "" {
		return nil, &aiBatchRequestError{Status: http.StatusUnauthorized, Message: "Unauthorized"}
	}
	accessibleLibraryIDs, err := store.GetUserAccessibleLibraryIDs(userID)
	if err != nil {
		return nil, fmt.Errorf("resolve accessible libraries: %w", err)
	}
	libraryIDs := accessibleLibraryIDs
	if body.Selector.LibraryIDs != nil {
		libraryIDs = intersectIDs(body.Selector.LibraryIDs, accessibleLibraryIDs)
	}

	result, err := store.GetAICandidateComicIDs(store.AICandidateOptions{
		Filter:           filter,
		ContentType:      contentType,
		LibraryIDs:       libraryIDs,
		FilterLibraryIDs: true,
		Limit:            body.Selector.Limit,
	})
	if err != nil {
		return nil, fmt.Errorf("select AI candidates: %w", err)
	}
	return &aiBatchSelection{ComicIDs: result.ComicIDs, Eligible: result.Total}, nil
}

func aiCandidateFilter(kind, scope string) (string, error) {
	scope = strings.TrimSpace(scope)
	switch kind {
	case "tags":
		switch scope {
		case "", "missing":
			return "untagged", nil
		case "all":
			return "all", nil
		}
	case "categories":
		switch scope {
		case "", "missing", "uncategorized":
			return "uncategorized", nil
		case "all":
			return "all", nil
		}
	default:
		return "", fmt.Errorf("unknown AI batch kind %q", kind)
	}
	return "", &aiBatchRequestError{Status: http.StatusBadRequest, Message: "unsupported selector.scope"}
}

func uniqueComicIDs(values []string) []string {
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

func intersectIDs(requested, accessible []string) []string {
	allowed := make(map[string]struct{}, len(accessible))
	for _, id := range accessible {
		allowed[id] = struct{}{}
	}
	result := make([]string, 0, len(requested))
	seen := make(map[string]struct{}, len(requested))
	for _, id := range requested {
		id = strings.TrimSpace(id)
		if _, ok := allowed[id]; !ok {
			continue
		}
		if _, exists := seen[id]; exists {
			continue
		}
		seen[id] = struct{}{}
		result = append(result, id)
	}
	return result
}

func writeAIBatchSelectionError(c *gin.Context, err error) {
	if requestErr, ok := err.(*aiBatchRequestError); ok {
		c.JSON(requestErr.Status, gin.H{"error": requestErr.Message})
		return
	}
	c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to select AI candidates"})
}
