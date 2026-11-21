package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/nowen-reader/nowen-reader/internal/model"
)

var (
	ErrBookmarkNotFound         = errors.New("bookmark not found")
	ErrHighlightNotFound        = errors.New("highlight not found")
	ErrInvalidHighlightText     = errors.New("highlight text is required")
	ErrInvalidPreferenceScope   = errors.New("invalid reader preference scope")
	ErrPreferencePayloadTooLarge = errors.New("reader preference payload exceeds 16KB limit")
)

const maxPreferenceJSONBytes = 16 * 1024

// ComicLayoutOverrideKeys lists the core layout fields that can be overridden per series or per comic.
var ComicLayoutOverrideKeys = []string{
	"mode",
	"direction",
	"doubleCoverAlone",
	"doublePageNoGap",
	"fitMode",
}

func truncateRunes(s string, max int) string {
	s = strings.TrimSpace(s)
	if max <= 0 || utf8.RuneCountInString(s) <= max {
		return s
	}
	var b strings.Builder
	count := 0
	for _, r := range s {
		if count >= max {
			break
		}
		b.WriteRune(r)
		count++
	}
	return b.String()
}

func normalizeRatioValue(v float64) float64 {
	if math.IsNaN(v) || math.IsInf(v, 0) || v < 0 {
		return 0
	}
	if v > 1 {
		return 1
	}
	return v
}

func normalizeBookmarkInput(userID, comicID string, bm model.UserBookmark) model.UserBookmark {
	nowMs := time.Now().UnixMilli()
	id := strings.TrimSpace(bm.ID)
	if id == "" || len(id) > 128 {
		id = "bm-" + uuid.New().String()
	}
	pageIndex := bm.PageIndex
	if pageIndex < 0 {
		pageIndex = 0
	}
	createdAt := bm.CreatedAt
	if createdAt <= 0 {
		createdAt = nowMs
	}
	updatedAt := bm.UpdatedAt
	if updatedAt <= 0 {
		updatedAt = createdAt
	}
	return model.UserBookmark{
		ID:            id,
		UserID:        userID,
		ComicID:       comicID,
		PageIndex:     pageIndex,
		PositionRatio: normalizeRatioValue(bm.PositionRatio),
		ChapterTitle:  truncateRunes(bm.ChapterTitle, 200),
		Name:          truncateRunes(bm.Name, 80),
		Note:          truncateRunes(bm.Note, 500),
		CreatedAt:     createdAt,
		UpdatedAt:     updatedAt,
	}
}

func normalizeHighlightInput(userID, comicID string, hl model.UserHighlight) model.UserHighlight {
	nowMs := time.Now().UnixMilli()
	id := strings.TrimSpace(hl.ID)
	if id == "" || len(id) > 128 {
		id = "hl-" + uuid.New().String()
	}
	chapterIndex := hl.ChapterIndex
	if chapterIndex < 0 {
		chapterIndex = 0
	}
	color := strings.TrimSpace(hl.Color)
	if color == "" {
		color = "#fbbf24"
	} else if len(color) > 32 {
		color = color[:32]
	}
	createdAt := hl.CreatedAt
	if createdAt <= 0 {
		createdAt = nowMs
	}
	updatedAt := hl.UpdatedAt
	if updatedAt <= 0 {
		updatedAt = createdAt
	}
	return model.UserHighlight{
		ID:           id,
		UserID:       userID,
		ComicID:      comicID,
		ChapterIndex: chapterIndex,
		ChapterTitle: truncateRunes(hl.ChapterTitle, 200),
		Text:         truncateRunes(hl.Text, 4000),
		Note:         truncateRunes(hl.Note, 1000),
		Color:        color,
		StartOffset:  hl.StartOffset,
		CreatedAt:    createdAt,
		UpdatedAt:    updatedAt,
	}
}

// ============================================================
// Bookmarks
// ============================================================

func ListUserBookmarks(userID, comicID string) ([]model.UserBookmark, error) {
	rows, err := db.Query(`
		SELECT "id", "comicId", "pageIndex", "positionRatio", "chapterTitle", "name", "note", "createdAt", "updatedAt"
		FROM "UserBookmark"
		WHERE "userId" = ? AND "comicId" = ?
		ORDER BY "pageIndex" ASC, "positionRatio" ASC, "createdAt" ASC
	`, userID, comicID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]model.UserBookmark, 0)
	for rows.Next() {
		var bm model.UserBookmark
		if err := rows.Scan(&bm.ID, &bm.ComicID, &bm.PageIndex, &bm.PositionRatio, &bm.ChapterTitle, &bm.Name, &bm.Note, &bm.CreatedAt, &bm.UpdatedAt); err != nil {
			return nil, err
		}
		result = append(result, bm)
	}
	return result, rows.Err()
}

func UpsertUserBookmark(userID, comicID string, input model.UserBookmark) (*model.UserBookmark, error) {
	bm := normalizeBookmarkInput(userID, comicID, input)

	// Guard against overwriting a bookmark belonging to a different comic under the same user.
	var existingComicID string
	err := db.QueryRow(`SELECT "comicId" FROM "UserBookmark" WHERE "userId" = ? AND "id" = ?`, userID, bm.ID).Scan(&existingComicID)
	if err == nil && existingComicID != comicID {
		bm.ID = "bm-" + uuid.New().String()
	}

	_, err = db.Exec(`
		INSERT INTO "UserBookmark" ("id", "userId", "comicId", "pageIndex", "positionRatio", "chapterTitle", "name", "note", "createdAt", "updatedAt")
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT("userId", "id") DO UPDATE SET
			"pageIndex" = excluded."pageIndex",
			"positionRatio" = excluded."positionRatio",
			"chapterTitle" = excluded."chapterTitle",
			"name" = excluded."name",
			"note" = excluded."note",
			"updatedAt" = excluded."updatedAt"
	`, bm.ID, userID, comicID, bm.PageIndex, bm.PositionRatio, bm.ChapterTitle, bm.Name, bm.Note, bm.CreatedAt, bm.UpdatedAt)
	if err != nil {
		return nil, err
	}
	bm.UserID = ""
	return &bm, nil
}

func UpdateUserBookmark(userID, comicID, bookmarkID, name, note string) (*model.UserBookmark, error) {
	nowMs := time.Now().UnixMilli()
	trimmedName := truncateRunes(name, 80)
	trimmedNote := truncateRunes(note, 500)

	res, err := db.Exec(`
		UPDATE "UserBookmark"
		SET "name" = ?, "note" = ?, "updatedAt" = ?
		WHERE "userId" = ? AND "comicId" = ? AND "id" = ?
	`, trimmedName, trimmedNote, nowMs, userID, comicID, bookmarkID)
	if err != nil {
		return nil, err
	}
	affected, _ := res.RowsAffected()
	if affected == 0 {
		return nil, ErrBookmarkNotFound
	}

	var bm model.UserBookmark
	err = db.QueryRow(`
		SELECT "id", "comicId", "pageIndex", "positionRatio", "chapterTitle", "name", "note", "createdAt", "updatedAt"
		FROM "UserBookmark"
		WHERE "userId" = ? AND "comicId" = ? AND "id" = ?
	`, userID, comicID, bookmarkID).Scan(&bm.ID, &bm.ComicID, &bm.PageIndex, &bm.PositionRatio, &bm.ChapterTitle, &bm.Name, &bm.Note, &bm.CreatedAt, &bm.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &bm, nil
}

func DeleteUserBookmark(userID, comicID, bookmarkID string) error {
	_, err := db.Exec(`
		DELETE FROM "UserBookmark"
		WHERE "userId" = ? AND "comicId" = ? AND "id" = ?
	`, userID, comicID, bookmarkID)
	return err
}

func ImportUserBookmarks(userID, comicID string, items []model.UserBookmark) ([]model.UserBookmark, error) {
	if len(items) == 0 {
		return ListUserBookmarks(userID, comicID)
	}

	existing, err := ListUserBookmarks(userID, comicID)
	if err != nil {
		return nil, err
	}

	tx, err := db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	byID := make(map[string]model.UserBookmark, len(existing))
	for _, b := range existing {
		byID[b.ID] = b
	}

	for _, raw := range items {
		incomingUpdatedAt := raw.UpdatedAt
		if incomingUpdatedAt <= 0 {
			incomingUpdatedAt = raw.CreatedAt
		}
		bm := normalizeBookmarkInput(userID, comicID, raw)
		if prev, ok := byID[bm.ID]; ok {
			if incomingUpdatedAt > prev.UpdatedAt {
				if _, err := tx.Exec(`
					UPDATE "UserBookmark"
					SET "pageIndex" = ?, "positionRatio" = ?, "chapterTitle" = ?, "name" = ?, "note" = ?, "updatedAt" = ?
					WHERE "userId" = ? AND "comicId" = ? AND "id" = ?
				`, bm.PageIndex, bm.PositionRatio, bm.ChapterTitle, bm.Name, bm.Note, bm.UpdatedAt, userID, comicID, bm.ID); err != nil {
					return nil, err
				}
				byID[bm.ID] = bm
			}
			continue
		}

		// Deduplicate by pageIndex + positionRatio within tolerance
		var matchedExisting *model.UserBookmark
		for i := range existing {
			if existing[i].PageIndex == bm.PageIndex && math.Abs(existing[i].PositionRatio-bm.PositionRatio) <= 0.001 {
				matchedExisting = &existing[i]
				break
			}
		}
		if matchedExisting != nil {
			if incomingUpdatedAt > matchedExisting.UpdatedAt && (bm.Name != "" || bm.Note != "") {
				if _, err := tx.Exec(`
					UPDATE "UserBookmark"
					SET "name" = ?, "note" = ?, "updatedAt" = ?
					WHERE "userId" = ? AND "comicId" = ? AND "id" = ?
				`, bm.Name, bm.Note, bm.UpdatedAt, userID, comicID, matchedExisting.ID); err != nil {
					return nil, err
				}
				matchedExisting.Name = bm.Name
				matchedExisting.Note = bm.Note
				matchedExisting.UpdatedAt = bm.UpdatedAt
			}
			continue
		}

		var ownerComic string
		if qErr := tx.QueryRow(`SELECT "comicId" FROM "UserBookmark" WHERE "userId" = ? AND "id" = ?`, userID, bm.ID).Scan(&ownerComic); qErr == nil && ownerComic != comicID {
			bm.ID = "bm-" + uuid.New().String()
		}

		if _, err := tx.Exec(`
			INSERT INTO "UserBookmark" ("id", "userId", "comicId", "pageIndex", "positionRatio", "chapterTitle", "name", "note", "createdAt", "updatedAt")
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`, bm.ID, userID, comicID, bm.PageIndex, bm.PositionRatio, bm.ChapterTitle, bm.Name, bm.Note, bm.CreatedAt, bm.UpdatedAt); err != nil {
			return nil, err
		}
		existing = append(existing, bm)
		byID[bm.ID] = bm
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return ListUserBookmarks(userID, comicID)
}

// ============================================================
// Highlights
// ============================================================

func ListUserHighlights(userID, comicID string) ([]model.UserHighlight, error) {
	rows, err := db.Query(`
		SELECT "id", "comicId", "chapterIndex", "chapterTitle", "text", "note", "color", "startOffset", "createdAt", "updatedAt"
		FROM "UserHighlight"
		WHERE "userId" = ? AND "comicId" = ?
		ORDER BY "chapterIndex" ASC, "createdAt" ASC
	`, userID, comicID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]model.UserHighlight, 0)
	for rows.Next() {
		var hl model.UserHighlight
		if err := rows.Scan(&hl.ID, &hl.ComicID, &hl.ChapterIndex, &hl.ChapterTitle, &hl.Text, &hl.Note, &hl.Color, &hl.StartOffset, &hl.CreatedAt, &hl.UpdatedAt); err != nil {
			return nil, err
		}
		result = append(result, hl)
	}
	return result, rows.Err()
}

func UpsertUserHighlight(userID, comicID string, input model.UserHighlight) (*model.UserHighlight, error) {
	hl := normalizeHighlightInput(userID, comicID, input)
	if hl.Text == "" {
		return nil, ErrInvalidHighlightText
	}

	var existingComicID string
	err := db.QueryRow(`SELECT "comicId" FROM "UserHighlight" WHERE "userId" = ? AND "id" = ?`, userID, hl.ID).Scan(&existingComicID)
	if err == nil && existingComicID != comicID {
		hl.ID = "hl-" + uuid.New().String()
	}

	_, err = db.Exec(`
		INSERT INTO "UserHighlight" ("id", "userId", "comicId", "chapterIndex", "chapterTitle", "text", "note", "color", "startOffset", "createdAt", "updatedAt")
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT("userId", "id") DO UPDATE SET
			"chapterIndex" = excluded."chapterIndex",
			"chapterTitle" = excluded."chapterTitle",
			"text" = excluded."text",
			"note" = excluded."note",
			"color" = excluded."color",
			"startOffset" = excluded."startOffset",
			"updatedAt" = excluded."updatedAt"
	`, hl.ID, userID, comicID, hl.ChapterIndex, hl.ChapterTitle, hl.Text, hl.Note, hl.Color, hl.StartOffset, hl.CreatedAt, hl.UpdatedAt)
	if err != nil {
		return nil, err
	}
	hl.UserID = ""
	return &hl, nil
}

func UpdateUserHighlight(userID, comicID, highlightID, note, color string) (*model.UserHighlight, error) {
	nowMs := time.Now().UnixMilli()
	trimmedNote := truncateRunes(note, 1000)
	trimmedColor := strings.TrimSpace(color)
	if len(trimmedColor) > 32 {
		trimmedColor = trimmedColor[:32]
	}

	var res sql.Result
	var err error
	if trimmedColor != "" {
		res, err = db.Exec(`
			UPDATE "UserHighlight"
			SET "note" = ?, "color" = ?, "updatedAt" = ?
			WHERE "userId" = ? AND "comicId" = ? AND "id" = ?
		`, trimmedNote, trimmedColor, nowMs, userID, comicID, highlightID)
	} else {
		res, err = db.Exec(`
			UPDATE "UserHighlight"
			SET "note" = ?, "updatedAt" = ?
			WHERE "userId" = ? AND "comicId" = ? AND "id" = ?
		`, trimmedNote, nowMs, userID, comicID, highlightID)
	}
	if err != nil {
		return nil, err
	}
	affected, _ := res.RowsAffected()
	if affected == 0 {
		return nil, ErrHighlightNotFound
	}

	var hl model.UserHighlight
	err = db.QueryRow(`
		SELECT "id", "comicId", "chapterIndex", "chapterTitle", "text", "note", "color", "startOffset", "createdAt", "updatedAt"
		FROM "UserHighlight"
		WHERE "userId" = ? AND "comicId" = ? AND "id" = ?
	`, userID, comicID, highlightID).Scan(&hl.ID, &hl.ComicID, &hl.ChapterIndex, &hl.ChapterTitle, &hl.Text, &hl.Note, &hl.Color, &hl.StartOffset, &hl.CreatedAt, &hl.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return &hl, nil
}

func DeleteUserHighlight(userID, comicID, highlightID string) error {
	_, err := db.Exec(`
		DELETE FROM "UserHighlight"
		WHERE "userId" = ? AND "comicId" = ? AND "id" = ?
	`, userID, comicID, highlightID)
	return err
}

func ImportUserHighlights(userID, comicID string, items []model.UserHighlight) ([]model.UserHighlight, error) {
	if len(items) == 0 {
		return ListUserHighlights(userID, comicID)
	}

	existing, err := ListUserHighlights(userID, comicID)
	if err != nil {
		return nil, err
	}

	tx, err := db.Begin()
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	byID := make(map[string]model.UserHighlight, len(existing))
	byKey := make(map[string]model.UserHighlight, len(existing))
	makeKey := func(chapter int, text string) string {
		return fmt.Sprintf("%d\x00%s", chapter, text)
	}
	for _, h := range existing {
		byID[h.ID] = h
		byKey[makeKey(h.ChapterIndex, h.Text)] = h
	}

	for _, raw := range items {
		incomingUpdatedAt := raw.UpdatedAt
		if incomingUpdatedAt <= 0 {
			incomingUpdatedAt = raw.CreatedAt
		}
		hl := normalizeHighlightInput(userID, comicID, raw)
		if hl.Text == "" {
			continue
		}
		if prev, ok := byID[hl.ID]; ok {
			if incomingUpdatedAt > prev.UpdatedAt {
				if _, err := tx.Exec(`
					UPDATE "UserHighlight"
					SET "note" = ?, "color" = ?, "chapterTitle" = ?, "updatedAt" = ?
					WHERE "userId" = ? AND "comicId" = ? AND "id" = ?
				`, hl.Note, hl.Color, hl.ChapterTitle, hl.UpdatedAt, userID, comicID, hl.ID); err != nil {
					return nil, err
				}
				byID[hl.ID] = hl
			}
			continue
		}
		key := makeKey(hl.ChapterIndex, hl.Text)
		if prev, ok := byKey[key]; ok {
			if incomingUpdatedAt > prev.UpdatedAt && hl.Note != "" && prev.Note == "" {
				if _, err := tx.Exec(`
					UPDATE "UserHighlight"
					SET "note" = ?, "updatedAt" = ?
					WHERE "userId" = ? AND "comicId" = ? AND "id" = ?
				`, hl.Note, hl.UpdatedAt, userID, comicID, prev.ID); err != nil {
					return nil, err
				}
			}
			continue
		}

		var ownerComic string
		if qErr := tx.QueryRow(`SELECT "comicId" FROM "UserHighlight" WHERE "userId" = ? AND "id" = ?`, userID, hl.ID).Scan(&ownerComic); qErr == nil && ownerComic != comicID {
			hl.ID = "hl-" + uuid.New().String()
		}

		if _, err := tx.Exec(`
			INSERT INTO "UserHighlight" ("id", "userId", "comicId", "chapterIndex", "chapterTitle", "text", "note", "color", "startOffset", "createdAt", "updatedAt")
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`, hl.ID, userID, comicID, hl.ChapterIndex, hl.ChapterTitle, hl.Text, hl.Note, hl.Color, hl.StartOffset, hl.CreatedAt, hl.UpdatedAt); err != nil {
			return nil, err
		}
		byID[hl.ID] = hl
		byKey[key] = hl
	}

	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return ListUserHighlights(userID, comicID)
}

// ============================================================
// Reader Preferences
// ============================================================

func ValidateReaderPreferenceScope(scope string) bool {
	if len(scope) == 0 || len(scope) > 160 {
		return false
	}
	if scope == "global_comic" || scope == "global_novel" {
		return true
	}
	if strings.HasPrefix(scope, "series:") && len(scope) > len("series:") {
		return strings.TrimSpace(scope[len("series:"):]) != ""
	}
	if strings.HasPrefix(scope, "comic:") && len(scope) > len("comic:") {
		return strings.TrimSpace(scope[len("comic:"):]) != ""
	}
	return false
}

type ScopedReaderPreferences struct {
	GlobalComic    map[string]interface{} `json:"globalComic"`
	GlobalNovel    map[string]interface{} `json:"globalNovel"`
	SeriesOverride map[string]interface{} `json:"seriesOverride"`
	ComicOverride  map[string]interface{} `json:"comicOverride"`
	ResolvedComic  map[string]interface{} `json:"resolvedComic"`
}

func getReaderPreferenceByScope(userID, scope string) (map[string]interface{}, error) {
	var raw string
	err := db.QueryRow(`
		SELECT "prefsJson" FROM "UserReaderPreference"
		WHERE "userId" = ? AND "scope" = ?
	`, userID, scope).Scan(&raw)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var parsed map[string]interface{}
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
		return nil, nil
	}
	return parsed, nil
}

// MergeComicReaderPreferences merges global_comic + core layout keys from seriesOverride + core layout keys from comicOverride.
func MergeComicReaderPreferences(globalComic, seriesOverride, comicOverride map[string]interface{}) map[string]interface{} {
	merged := make(map[string]interface{})
	for k, v := range globalComic {
		merged[k] = v
	}
	applyCoreLayout := func(override map[string]interface{}) {
		if override == nil {
			return
		}
		for _, key := range ComicLayoutOverrideKeys {
			if val, ok := override[key]; ok {
				merged[key] = val
			}
		}
	}
	applyCoreLayout(seriesOverride)
	applyCoreLayout(comicOverride)
	return merged
}

func GetUserReaderPreferences(userID, comicID, seriesID string) (*ScopedReaderPreferences, error) {
	scopes := []string{"global_comic", "global_novel"}
	seriesScope := ""
	comicScope := ""
	if strings.TrimSpace(seriesID) != "" {
		seriesScope = "series:" + strings.TrimSpace(seriesID)
		scopes = append(scopes, seriesScope)
	}
	if strings.TrimSpace(comicID) != "" {
		comicScope = "comic:" + strings.TrimSpace(comicID)
		scopes = append(scopes, comicScope)
	}

	placeholders := make([]string, len(scopes))
	args := make([]interface{}, 0, 1+len(scopes))
	args = append(args, userID)
	for i, sc := range scopes {
		placeholders[i] = "?"
		args = append(args, sc)
	}

	rows, err := db.Query(fmt.Sprintf(`
		SELECT "scope", "prefsJson" FROM "UserReaderPreference"
		WHERE "userId" = ? AND "scope" IN (%s)
	`, strings.Join(placeholders, ",")), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	byScope := make(map[string]map[string]interface{})
	for rows.Next() {
		var scope, raw string
		if err := rows.Scan(&scope, &raw); err != nil {
			continue
		}
		var parsed map[string]interface{}
		if json.Unmarshal([]byte(raw), &parsed) == nil && parsed != nil {
			byScope[scope] = parsed
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	globalComic := byScope["global_comic"]
	if globalComic == nil {
		globalComic = map[string]interface{}{}
	}
	globalNovel := byScope["global_novel"]
	if globalNovel == nil {
		globalNovel = map[string]interface{}{}
	}
	seriesOverride := byScope[seriesScope]
	comicOverride := byScope[comicScope]

	return &ScopedReaderPreferences{
		GlobalComic:    globalComic,
		GlobalNovel:    globalNovel,
		SeriesOverride: seriesOverride,
		ComicOverride:  comicOverride,
		ResolvedComic:  MergeComicReaderPreferences(globalComic, seriesOverride, comicOverride),
	}, nil
}

func SetUserReaderPreference(userID, scope string, prefs map[string]interface{}) error {
	if !ValidateReaderPreferenceScope(scope) {
		return ErrInvalidPreferenceScope
	}
	if prefs == nil {
		prefs = map[string]interface{}{}
	}
	// Restrict series/comic overrides strictly to core layout keys so global preferences don't leak into overrides.
	if strings.HasPrefix(scope, "series:") || strings.HasPrefix(scope, "comic:") {
		filtered := make(map[string]interface{})
		for _, key := range ComicLayoutOverrideKeys {
			if val, ok := prefs[key]; ok {
				filtered[key] = val
			}
		}
		prefs = filtered
	}
	raw, err := json.Marshal(prefs)
	if err != nil {
		return err
	}
	if len(raw) > maxPreferenceJSONBytes {
		return ErrPreferencePayloadTooLarge
	}

	now := time.Now().UTC()
	_, err = db.Exec(`
		INSERT INTO "UserReaderPreference" ("userId", "scope", "prefsJson", "updatedAt")
		VALUES (?, ?, ?, ?)
		ON CONFLICT("userId", "scope") DO UPDATE SET
			"prefsJson" = excluded."prefsJson",
			"updatedAt" = excluded."updatedAt"
	`, userID, scope, string(raw), now)
	return err
}

func DeleteUserReaderPreference(userID, scope string) error {
	if !ValidateReaderPreferenceScope(scope) {
		return ErrInvalidPreferenceScope
	}
	_, err := db.Exec(`
		DELETE FROM "UserReaderPreference"
		WHERE "userId" = ? AND "scope" = ?
	`, userID, scope)
	return err
}
