package store

import (
	"database/sql"
	"fmt"
)

type GroupMetadataPolicy struct {
	DirectComicCount int
	SeriesCount      int
	SingleSeriesID   string
}

func (policy GroupMetadataPolicy) AllowsMemberSync() bool {
	return policy.SeriesCount == 0
}

func GetGroupMetadataPolicy(groupID int) (*GroupMetadataPolicy, error) {
	var policy GroupMetadataPolicy
	err := db.QueryRow(`
		SELECT
			(SELECT COUNT(*) FROM "ComicGroupItem" WHERE "groupId" = g."id"),
			(SELECT COUNT(*) FROM "ComicGroupSeries" WHERE "groupId" = g."id"),
			COALESCE((
				SELECT "seriesId" FROM "ComicGroupSeries"
				WHERE "groupId" = g."id"
				ORDER BY "sortIndex", "seriesId"
				LIMIT 1
			), '')
		FROM "ComicGroup" g
		WHERE g."id" = ?
	`, groupID).Scan(&policy.DirectComicCount, &policy.SeriesCount, &policy.SingleSeriesID)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &policy, nil
}

type GroupMetadataInheritanceResult struct {
	SourceType    string   `json:"sourceType"`
	SourceID      string   `json:"sourceId"`
	UpdatedFields []string `json:"updatedFields"`
	TagsCopied    int      `json:"tagsCopied"`
}

func InheritGroupMetadata(groupID int) (*GroupMetadataInheritanceResult, error) {
	policy, err := GetGroupMetadataPolicy(groupID)
	if err != nil {
		return nil, err
	}
	if policy == nil {
		return nil, fmt.Errorf("合集不存在")
	}
	if policy.DirectComicCount == 0 && policy.SeriesCount == 1 {
		return inheritGroupMetadataFromSeries(groupID, policy.SingleSeriesID)
	}
	if policy.DirectComicCount == 0 {
		return nil, fmt.Errorf("合集没有可继承的直属阅读单元")
	}
	if err := InheritGroupMetadataFromFirstComic(groupID); err != nil {
		return nil, err
	}
	group, err := GetGroupByID(groupID)
	if err != nil || group == nil || len(group.Comics) == 0 {
		return nil, fmt.Errorf("合集直属阅读单元不可用")
	}
	return &GroupMetadataInheritanceResult{
		SourceType:    "comic",
		SourceID:      group.Comics[0].ComicID,
		UpdatedFields: []string{"author", "publisher", "language", "genre", "description", "year"},
	}, nil
}

func inheritGroupMetadataFromSeries(groupID int, seriesID string) (*GroupMetadataInheritanceResult, error) {
	group, err := GetGroupByID(groupID)
	if err != nil || group == nil {
		return nil, fmt.Errorf("合集不存在")
	}
	detail, err := GetSeriesDetail(seriesID, "")
	if err != nil || detail == nil {
		return nil, fmt.Errorf("目录作品不存在")
	}
	series := detail.Series
	update := GroupMetadataUpdate{}
	updatedFields := make([]string, 0, 8)

	if group.Author == "" && series.Author != "" {
		update.Author = &series.Author
		updatedFields = append(updatedFields, "author")
	}
	if group.Description == "" && series.Description != "" {
		update.Description = &series.Description
		updatedFields = append(updatedFields, "description")
	}
	if group.Year == nil && series.Year != nil {
		update.Year = series.Year
		updatedFields = append(updatedFields, "year")
	}
	if group.Publisher == "" && series.Publisher != "" {
		update.Publisher = &series.Publisher
		updatedFields = append(updatedFields, "publisher")
	}
	if group.Language == "" && series.Language != "" {
		update.Language = &series.Language
		updatedFields = append(updatedFields, "language")
	}
	if group.Genre == "" && series.Genre != "" {
		update.Genre = &series.Genre
		updatedFields = append(updatedFields, "genre")
	}
	if group.Status == "" && series.Status != "" {
		update.Status = &series.Status
		updatedFields = append(updatedFields, "status")
	}

	var groupRating sql.NullFloat64
	if err := db.QueryRow(`SELECT "externalRating" FROM "ComicGroup" WHERE "id" = ?`, groupID).Scan(&groupRating); err != nil {
		return nil, err
	}
	if !groupRating.Valid && series.ExternalRating != nil {
		update.ExternalRating = series.ExternalRating
		update.ExternalRatingMax = series.ExternalRatingMax
		update.ExternalRatingSource = &series.ExternalRatingSource
		update.ExternalRatingUpdatedAt = series.ExternalRatingUpdatedAt
		updatedFields = append(updatedFields, "rating")
	}
	if err := UpdateGroupMetadata(groupID, update); err != nil {
		return nil, err
	}

	tagsCopied := 0
	groupTags, err := GetGroupTags(groupID)
	if err != nil {
		return nil, err
	}
	if len(groupTags) == 0 && len(series.Tags) > 0 {
		names := make([]string, 0, len(series.Tags))
		for _, tag := range series.Tags {
			names = append(names, tag.Name)
		}
		if err := SetGroupTags(groupID, names); err != nil {
			return nil, err
		}
		tagsCopied = len(names)
	}

	return &GroupMetadataInheritanceResult{
		SourceType:    "series",
		SourceID:      seriesID,
		UpdatedFields: updatedFields,
		TagsCopied:    tagsCopied,
	}, nil
}
