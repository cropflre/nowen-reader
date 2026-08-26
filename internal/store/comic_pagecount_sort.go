package store

// GetAllComicsSortedByPageCount sorts and paginates inside SQLite. The previous
// implementation loaded every matching Comic/Series into Go and sorted the
// entire slice, which could exhaust 4 GB NAS devices with 50k+ libraries.
func GetAllComicsSortedByPageCount(opts ComicListOptions) (*ComicListResult, error) {
	return getAllComicsPageCountSQL(opts)
}
