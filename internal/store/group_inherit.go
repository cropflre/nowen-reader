package store

import (
	"database/sql"
	"fmt"
)

// ============================================================
// 元数据继承：从首卷继承到系列所有卷
// ============================================================

// InheritField 描述一个将要被继承的字段变更。
type InheritField struct {
	Field    string `json:"field"`    // 字段名
	Label    string `json:"label"`    // 显示名称
	Value    string `json:"value"`    // 将要设置的值
	OldValue string `json:"oldValue"` // 当前值（空表示未设置）
}

// InheritPreview 继承预览结果。
type InheritPreview struct {
	SourceComicID    string         `json:"sourceComicId"`    // 首卷漫画ID
	SourceComicTitle string         `json:"sourceComicTitle"` // 首卷标题
	GroupChanges     []InheritField `json:"groupChanges"`     // 系列级别的变更
	VolumeCount      int            `json:"volumeCount"`      // 将受影响的卷数
	VolumeChanges    []InheritField `json:"volumeChanges"`    // 卷级别的变更（汇总）
}

// PreviewInheritMetadata 预览从首卷继承元数据的结果，不实际执行变更。
// 返回将要变更的字段列表，供用户确认。
func PreviewInheritMetadata(groupID int) (*InheritPreview, error) {
	group, err := GetGroupByID(groupID)
	if err != nil || group == nil || len(group.Comics) == 0 {
		return nil, fmt.Errorf("系列不存在或没有漫画")
	}

	firstComicID := group.Comics[0].ComicID
	var author, publisher, language, genre, description, title string
	var year sql.NullInt64
	err = db.QueryRow(`
		SELECT COALESCE("title",''), COALESCE("author",''), COALESCE("publisher",''),
		       COALESCE("language",''), COALESCE("genre",''), COALESCE("description",''), "year"
		FROM "Comic" WHERE "id" = ?
	`, firstComicID).Scan(&title, &author, &publisher, &language, &genre, &description, &year)
	if err != nil {
		return nil, err
	}

	preview := &InheritPreview{
		SourceComicID:    firstComicID,
		SourceComicTitle: title,
	}

	// 系列级别变更预览
	if group.Author == "" && author != "" {
		preview.GroupChanges = append(preview.GroupChanges, InheritField{
			Field: "author", Label: "作者", Value: author, OldValue: group.Author,
		})
	}
	if group.Publisher == "" && publisher != "" {
		preview.GroupChanges = append(preview.GroupChanges, InheritField{
			Field: "publisher", Label: "出版商", Value: publisher, OldValue: group.Publisher,
		})
	}
	if group.Language == "" && language != "" {
		preview.GroupChanges = append(preview.GroupChanges, InheritField{
			Field: "language", Label: "语言", Value: language, OldValue: group.Language,
		})
	}
	if group.Genre == "" && genre != "" {
		preview.GroupChanges = append(preview.GroupChanges, InheritField{
			Field: "genre", Label: "类型", Value: genre, OldValue: group.Genre,
		})
	}
	if group.Description == "" && description != "" {
		preview.GroupChanges = append(preview.GroupChanges, InheritField{
			Field: "description", Label: "简介", Value: description, OldValue: group.Description,
		})
	}
	if group.Year == nil && year.Valid {
		preview.GroupChanges = append(preview.GroupChanges, InheritField{
			Field: "year", Label: "年份", Value: fmt.Sprintf("%d", year.Int64), OldValue: "",
		})
	}

	// 卷级别变更预览：统计有多少卷的空字段会被填充
	affectedCount := 0
	var volumeFieldChanges = map[string]int{} // field → 受影响的卷数
	for _, comic := range group.Comics {
		if comic.ComicID == firstComicID {
			continue // 跳过首卷自身
		}
		var cAuthor, cPublisher, cLanguage, cGenre, cDescription string
		var cYear sql.NullInt64
		err := db.QueryRow(`
			SELECT COALESCE("author",''), COALESCE("publisher",''), COALESCE("language",''),
			       COALESCE("genre",''), COALESCE("description",''), "year"
			FROM "Comic" WHERE "id" = ?
		`, comic.ComicID).Scan(&cAuthor, &cPublisher, &cLanguage, &cGenre, &cDescription, &cYear)
		if err != nil {
			continue
		}
		changed := false
		if cAuthor == "" && author != "" {
			volumeFieldChanges["author"]++
			changed = true
		}
		if cPublisher == "" && publisher != "" {
			volumeFieldChanges["publisher"]++
			changed = true
		}
		if cLanguage == "" && language != "" {
			volumeFieldChanges["language"]++
			changed = true
		}
		if cGenre == "" && genre != "" {
			volumeFieldChanges["genre"]++
			changed = true
		}
		if cDescription == "" && description != "" {
			volumeFieldChanges["description"]++
			changed = true
		}
		if !cYear.Valid && year.Valid {
			volumeFieldChanges["year"]++
			changed = true
		}
		if changed {
			affectedCount++
		}
	}
	preview.VolumeCount = affectedCount

	// 汇总卷级别变更
	fieldLabels := map[string]string{
		"author": "作者", "publisher": "出版商", "language": "语言",
		"genre": "类型", "description": "简介", "year": "年份",
	}
	fieldValues := map[string]string{
		"author": author, "publisher": publisher, "language": language,
		"genre": genre, "description": description,
	}
	if year.Valid {
		fieldValues["year"] = fmt.Sprintf("%d", year.Int64)
	}
	for field, count := range volumeFieldChanges {
		preview.VolumeChanges = append(preview.VolumeChanges, InheritField{
			Field:    field,
			Label:    fieldLabels[field],
			Value:    fieldValues[field],
			OldValue: fmt.Sprintf("%d 卷将被更新", count),
		})
	}

	return preview, nil
}

// InheritMetadataToAllVolumes 将首卷的元数据继承到系列中所有卷。
// 仅填充各卷中为空的字段，不覆盖已有数据。
// 同时也会继承到系列（ComicGroup）本身。
func InheritMetadataToAllVolumes(groupID int) error {
	group, err := GetGroupByID(groupID)
	if err != nil || group == nil || len(group.Comics) == 0 {
		return fmt.Errorf("系列不存在或没有漫画")
	}

	// 先继承到系列本身
	if err := InheritGroupMetadataFromFirstComic(groupID); err != nil {
		return fmt.Errorf("继承到系列失败: %w", err)
	}

	// 获取首卷元数据
	firstComicID := group.Comics[0].ComicID
	var author, publisher, language, genre, description string
	var year sql.NullInt64
	err = db.QueryRow(`
		SELECT COALESCE("author",''), COALESCE("publisher",''), COALESCE("language",''),
		       COALESCE("genre",''), COALESCE("description",''), "year"
		FROM "Comic" WHERE "id" = ?
	`, firstComicID).Scan(&author, &publisher, &language, &genre, &description, &year)
	if err != nil {
		return fmt.Errorf("读取首卷元数据失败: %w", err)
	}

	// 遍历所有卷，填充空字段
	for _, comic := range group.Comics {
		if comic.ComicID == firstComicID {
			continue // 跳过首卷自身
		}

		var cAuthor, cPublisher, cLanguage, cGenre, cDescription string
		var cYear sql.NullInt64
		err := db.QueryRow(`
			SELECT COALESCE("author",''), COALESCE("publisher",''), COALESCE("language",''),
			       COALESCE("genre",''), COALESCE("description",''), "year"
			FROM "Comic" WHERE "id" = ?
		`, comic.ComicID).Scan(&cAuthor, &cPublisher, &cLanguage, &cGenre, &cDescription, &cYear)
		if err != nil {
			continue
		}

		updates := map[string]interface{}{}
		if cAuthor == "" && author != "" {
			updates["author"] = author
		}
		if cPublisher == "" && publisher != "" {
			updates["publisher"] = publisher
		}
		if cLanguage == "" && language != "" {
			updates["language"] = language
		}
		if cGenre == "" && genre != "" {
			updates["genre"] = genre
		}
		if cDescription == "" && description != "" {
			updates["description"] = description
		}
		if !cYear.Valid && year.Valid {
			updates["year"] = year.Int64
		}

		if len(updates) > 0 {
			UpdateComicFields(comic.ComicID, updates)
		}
	}

	return nil
}
