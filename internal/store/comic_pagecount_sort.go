package store

// GetAllComicsSortedByPageCount keeps page-count sorting in SQLite, including
// the logical work's member count, and only hydrates the requested page.
func GetAllComicsSortedByPageCount(opts ComicListOptions) (*ComicListResult, error) {
	opts.SortBy = "pageCount"
	return GetAllComicsShelfSafe(opts)
}
