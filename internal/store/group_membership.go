package store

// GetExpandedGroupedComicIDs returns every comic that belongs to a custom group,
// including comics inherited through a directory series (ComicGroupSeries).
//
// A comic may be attached directly and through a series at the same time. UNION
// keeps the (comicId, groupId) pair unique so clients can safely use the result
// to hide grouped volumes without producing duplicate group IDs.
func GetExpandedGroupedComicIDs() (map[string][]int, error) {
	rows, err := db.Query(`
		SELECT membership."comicId", membership."groupId"
		FROM (
			SELECT gi."comicId", gi."groupId"
			FROM "ComicGroupItem" gi

			UNION

			SELECT csi."comicId", cgs."groupId"
			FROM "ComicGroupSeries" cgs
			JOIN "ComicSeries" cs ON cs."id" = cgs."seriesId"
			JOIN "ComicSeriesItem" csi ON csi."seriesId" = cs."id"
			JOIN "Comic" c ON c."id" = csi."comicId" AND c."libraryId" = cs."libraryId"
		) membership
		INNER JOIN "ComicGroup" g ON g."id" = membership."groupId"
		ORDER BY membership."comicId" ASC, membership."groupId" ASC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make(map[string][]int)
	for rows.Next() {
		var comicID string
		var groupID int
		if err := rows.Scan(&comicID, &groupID); err != nil {
			return nil, err
		}
		result[comicID] = append(result[comicID], groupID)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}
