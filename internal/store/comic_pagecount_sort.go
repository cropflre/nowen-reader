package store

import (
	"sort"
	"strings"
)

// GetAllComicsSortedByPageCount reuses the canonical comic filtering and
// permission-aware query, then applies page-count ordering before pagination.
// This keeps the Android compatibility path aligned with GetAllComics without
// duplicating its SQL filters.
func GetAllComicsSortedByPageCount(opts ComicListOptions) (*ComicListResult, error) {
	requestedPage := opts.Page
	requestedPageSize := opts.PageSize
	if requestedPage < 1 {
		requestedPage = 1
	}

	allOpts := opts
	allOpts.Page = 1
	allOpts.PageSize = 0
	allOpts.SortBy = "title"
	all, err := GetAllComics(allOpts)
	if err != nil {
		return nil, err
	}

	descending := strings.EqualFold(opts.SortOrder, "desc")
	sort.SliceStable(all.Comics, func(i, j int) bool {
		left := all.Comics[i]
		right := all.Comics[j]
		if left.PageCount != right.PageCount {
			if descending {
				return left.PageCount > right.PageCount
			}
			return left.PageCount < right.PageCount
		}
		leftTitle := strings.ToLower(left.TitleSortKey)
		if leftTitle == "" {
			leftTitle = strings.ToLower(left.Title)
		}
		rightTitle := strings.ToLower(right.TitleSortKey)
		if rightTitle == "" {
			rightTitle = strings.ToLower(right.Title)
		}
		if leftTitle != rightTitle {
			return leftTitle < rightTitle
		}
		return left.ID < right.ID
	})

	total := len(all.Comics)
	if requestedPageSize <= 0 {
		return &ComicListResult{
			Comics:     all.Comics,
			Total:      total,
			Page:       requestedPage,
			PageSize:   total,
			TotalPages: 1,
		}, nil
	}

	totalPages := 1
	if total > 0 {
		totalPages = (total + requestedPageSize - 1) / requestedPageSize
	}
	start := (requestedPage - 1) * requestedPageSize
	if start >= total {
		return &ComicListResult{
			Comics:     []ComicListItem{},
			Total:      total,
			Page:       requestedPage,
			PageSize:   requestedPageSize,
			TotalPages: totalPages,
		}, nil
	}
	end := start + requestedPageSize
	if end > total {
		end = total
	}

	pageItems := append([]ComicListItem(nil), all.Comics[start:end]...)
	return &ComicListResult{
		Comics:     pageItems,
		Total:      total,
		Page:       requestedPage,
		PageSize:   requestedPageSize,
		TotalPages: totalPages,
	}, nil
}
