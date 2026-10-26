package service

import (
	"fmt"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/nowen-reader/nowen-reader/internal/model"
	"github.com/nowen-reader/nowen-reader/internal/store"
)

const maxSeriesLayoutPreviewSamples = 8

type SeriesLayoutWorkSample struct {
	Title            string `json:"title"`
	RootRelativePath string `json:"rootRelativePath"`
	ItemCount        int    `json:"itemCount"`
	SectionCount     int    `json:"sectionCount"`
	SingleChapter    bool   `json:"singleChapter"`
	MatchKind        string `json:"matchKind"` // "exact_path" | "member_set_1to1" | "restored_history" | "created"
}

type SeriesLayoutArchivedSample struct {
	ID                string `json:"id"`
	Title             string `json:"title"`
	RootRelativePath  string `json:"rootRelativePath"`
	ItemCount         int    `json:"itemCount"`
	HasManualMetadata bool   `json:"hasManualMetadata"`
}

type SeriesLayoutShallowSample struct {
	ComicID      string `json:"comicId"`
	Title        string `json:"title"`
	RelativePath string `json:"relativePath"`
}

type SeriesLayoutPreviewSamples struct {
	Works          []SeriesLayoutWorkSample     `json:"works"`
	ArchivedSeries []SeriesLayoutArchivedSample `json:"archivedSeries"`
	ShallowItems   []SeriesLayoutShallowSample  `json:"shallowItems"`
}

type SeriesLayoutPreview struct {
	LibraryID                 string                           `json:"libraryId"`
	LibraryName               string                           `json:"libraryName"`
	CurrentSeriesDepth        int                              `json:"currentSeriesDepth"`
	TargetSeriesDepth         int                              `json:"targetSeriesDepth"`
	Unchanged                 bool                             `json:"unchanged"`
	SourceRevision            string                           `json:"sourceRevision"`
	TotalComicFiles           int                              `json:"totalComicFiles"`
	OldSeriesCount            int                              `json:"oldSeriesCount"`
	NewSeriesCount            int                              `json:"newSeriesCount"`
	OldShelfCount             int                              `json:"oldShelfCount"`
	NewShelfCount             int                              `json:"newShelfCount"`
	SingleChapterSeriesCount  int                              `json:"singleChapterSeriesCount"`
	ShallowStandaloneCount    int                              `json:"shallowStandaloneCount"`
	MatchedSeriesCount        int                              `json:"matchedSeriesCount"`
	RestoredFromHistoryCount  int                              `json:"restoredFromHistoryCount"`
	CreatedSeriesCount        int                              `json:"createdSeriesCount"`
	ArchivedSeriesCount       int                              `json:"archivedSeriesCount"`
	ArchivedWithMetadataCount int                              `json:"archivedWithMetadataCount"`
	HasLockConflicts          bool                             `json:"hasLockConflicts"`
	LockConflicts             []store.SeriesLayoutLockConflict `json:"lockConflicts"`
	Warnings                  []string                         `json:"warnings"`
	Samples                   SeriesLayoutPreviewSamples       `json:"samples"`
}

type computedSeriesLayoutPlan struct {
	preview       SeriesLayoutPreview
	nextRecords   []store.ArchivedSeriesRecord
	lockConflicts []store.SeriesLayoutLockConflict
	archivedCount int
	matchedCount  int
}

// PreviewLibrarySeriesLayout computes a bounded preview for switching libraryID to targetDepth.
func PreviewLibrarySeriesLayout(libraryID string, targetDepth int) (*SeriesLayoutPreview, error) {
	if err := EnsureComicSeriesFresh(); err != nil {
		return nil, err
	}
	lib, err := store.GetLibraryByID(libraryID)
	if err != nil {
		return nil, err
	}
	if lib == nil {
		return nil, nil
	}
	if lib.Type != "comic" {
		return nil, fmt.Errorf("only comic libraries support series layout preview")
	}

	targetDepth = store.NormalizeSeriesDepth(targetDepth)
	currentDepth := store.NormalizeSeriesDepth(lib.SeriesDepth)

	sourceRevision, err := store.GetComicSeriesSourceFingerprint()
	if err != nil {
		return nil, err
	}
	existing, err := store.LoadLibrarySeriesRecords(libraryID)
	if err != nil {
		return nil, err
	}
	items, err := store.GetSeriesSourceItems(libraryID)
	if err != nil {
		return nil, err
	}
	var historical *store.SeriesLayoutSnapshotPayload
	if targetDepth != currentDepth {
		historical, err = store.FindLatestHistoricalSnapshotPayload(libraryID, targetDepth)
		if err != nil {
			return nil, err
		}
	}

	plan := buildSeriesLayoutPlan(lib, currentDepth, targetDepth, sourceRevision, existing, items, historical)
	plan.preview.Warnings = inspectMultiRootOverlapWarnings(lib.RootPaths, targetDepth)
	return &plan.preview, nil
}

// ApplyLibrarySeriesDepthUpdate atomically validates sourceRevision and manual locks,
// persists a full pre-change snapshot, updates Library configuration, and applies the
// new series structure inside a single serialized transaction.
func ApplyLibrarySeriesDepthUpdate(updatedLib *model.Library, expectedSourceRevision, userID string) (*store.SeriesLayoutTxResult, error) {
	seriesRefreshMu.Lock()
	defer seriesRefreshMu.Unlock()

	if fingerprint, err := store.GetComicSeriesSourceFingerprint(); err == nil {
		if built, bErr := store.GetBuiltComicSeriesFingerprint(); bErr == nil && fingerprint != built {
			// Ensure pre-change series projection is materialized before snapshotting.
			// Rebuilding does not alter ComicSeriesSourceRevision.revision.
			_ = rebuildAndMarkComicSeriesLocked(fingerprint)
		}
	}

	targetDepth := store.NormalizeSeriesDepth(updatedLib.SeriesDepth)
	updatedLib.SeriesDepth = targetDepth

	return store.ExecuteLibrarySeriesDepthChange(store.SeriesLayoutTxPlanInput{
		UpdatedLibrary:         updatedLib,
		ExpectedSourceRevision: strings.TrimSpace(expectedSourceRevision),
		CreatedByUserID:        userID,
		BuildPlan: func(currentDepth int, existing []store.ArchivedSeriesRecord, items []store.SeriesSourceItem, historical *store.SeriesLayoutSnapshotPayload) ([]store.ArchivedSeriesRecord, []store.SeriesLayoutLockConflict, int, int, error) {
			plan := buildSeriesLayoutPlan(updatedLib, currentDepth, targetDepth, "", existing, items, historical)
			return plan.nextRecords, plan.lockConflicts, plan.archivedCount, plan.matchedCount, nil
		},
	})
}

// RestoreLibrarySeriesSnapshot restores a previous snapshot under seriesRefreshMu + transaction.
func RestoreLibrarySeriesSnapshot(libraryID, snapshotID, userID string) (*store.SeriesLayoutTxResult, error) {
	seriesRefreshMu.Lock()
	defer seriesRefreshMu.Unlock()
	return store.ExecuteRestoreLibrarySeriesSnapshot(libraryID, snapshotID, userID)
}

func buildSeriesLayoutPlan(
	lib *model.Library,
	currentDepth int,
	targetDepth int,
	sourceRevision string,
	existing []store.ArchivedSeriesRecord,
	items []store.SeriesSourceItem,
	historical *store.SeriesLayoutSnapshotPayload,
) computedSeriesLayoutPlan {
	detected := DetectComicSeriesWithDepth(lib.ID, targetDepth, items)

	candByRoot := make(map[string]int, len(detected))
	groupedComics := make(map[string]bool)
	singleChapterCount := 0
	newSavings := 0
	for idx, cand := range detected {
		candByRoot[cand.RootRelativePath] = idx
		if len(cand.Items) == 1 {
			singleChapterCount++
		}
		if len(cand.Items) >= store.MinEffectiveSeriesMembers(targetDepth) {
			newSavings += len(cand.Items) - 1
		}
		for _, it := range cand.Items {
			groupedComics[it.ComicID] = true
		}
	}

	oldEffectiveCount := 0
	oldSavings := 0
	oldByRoot := make(map[string]int, len(existing))
	for idx, old := range existing {
		oldByRoot[old.RootRelativePath] = idx
		if store.IsEffectiveSeriesCount(len(old.Items), currentDepth) {
			oldEffectiveCount++
			oldSavings += len(old.Items) - 1
		}
	}

	shallowCount := 0
	shallowSamples := make([]SeriesLayoutShallowSample, 0, maxSeriesLayoutPreviewSamples)
	for _, it := range items {
		if !groupedComics[it.ID] {
			shallowCount++
			if len(shallowSamples) < maxSeriesLayoutPreviewSamples {
				shallowSamples = append(shallowSamples, SeriesLayoutShallowSample{
					ComicID:      it.ID,
					Title:        it.Title,
					RelativePath: it.RelativePath,
				})
			}
		}
	}

	// Detect manualLocked structure conflicts (series-level and section-level).
	lockConflicts := detectManualLockConflicts(existing, detected, candByRoot, targetDepth)

	// Identity matching:
	// 1. Exact (libraryId, rootRelativePath)
	// 2. Unique 1-to-1 non-empty comicId set
	// 3. Verified historical snapshot identity (same rootRelativePath + identical comicId set)
	// 4. Fresh series identity without copying category metadata
	usedOld := make(map[int]bool, len(existing))
	usedCand := make(map[int]bool, len(detected))
	usedSeriesIDs := make(map[string]bool, len(existing)+len(detected))

	type candResolution struct {
		matchKind string
		record    store.ArchivedSeriesRecord
	}
	resolutions := make([]candResolution, len(detected))

	// Tier 1: Exact rootRelativePath match
	for candIdx, cand := range detected {
		oldIdx, ok := oldByRoot[cand.RootRelativePath]
		if !ok {
			continue
		}
		old := existing[oldIdx]
		usedOld[oldIdx] = true
		usedCand[candIdx] = true
		usedSeriesIDs[old.ID] = true
		resolutions[candIdx] = candResolution{
			matchKind: "exact_path",
			record:    mergeBaseWithCandidate(old, cand, "exact_path"),
		}
	}

	// Tier 2: Unique 1-to-1 non-empty comicId set match
	oldKeyToIndices := make(map[string][]int)
	for oldIdx, old := range existing {
		if usedOld[oldIdx] || len(old.Items) == 0 {
			continue
		}
		key := archivedItemsSetKey(old.Items)
		oldKeyToIndices[key] = append(oldKeyToIndices[key], oldIdx)
	}
	candKeyToIndices := make(map[string][]int)
	for candIdx, cand := range detected {
		if usedCand[candIdx] || len(cand.Items) == 0 {
			continue
		}
		key := detectedItemsSetKey(cand.Items)
		candKeyToIndices[key] = append(candKeyToIndices[key], candIdx)
	}
	for key, candIndices := range candKeyToIndices {
		oldIndices := oldKeyToIndices[key]
		if len(candIndices) != 1 || len(oldIndices) != 1 {
			continue
		}
		candIdx := candIndices[0]
		oldIdx := oldIndices[0]
		old := existing[oldIdx]
		if usedSeriesIDs[old.ID] {
			continue
		}
		usedOld[oldIdx] = true
		usedCand[candIdx] = true
		usedSeriesIDs[old.ID] = true
		resolutions[candIdx] = candResolution{
			matchKind: "member_set_1to1",
			record:    mergeBaseWithCandidate(old, detected[candIdx], "member_set_1to1"),
		}
	}

	// Tier 3: Historical snapshot recovery (when switching back to a prior depth)
	var histByRoot map[string]store.ArchivedSeriesRecord
	if historical != nil {
		histByRoot = make(map[string]store.ArchivedSeriesRecord, len(historical.Series))
		for _, h := range historical.Series {
			histByRoot[h.RootRelativePath] = h
		}
	}
	for candIdx, cand := range detected {
		if usedCand[candIdx] || histByRoot == nil || len(cand.Items) == 0 {
			continue
		}
		hist, ok := histByRoot[cand.RootRelativePath]
		if !ok || usedSeriesIDs[hist.ID] {
			continue
		}
		if archivedItemsSetKey(hist.Items) != detectedItemsSetKey(cand.Items) {
			continue
		}
		usedCand[candIdx] = true
		usedSeriesIDs[hist.ID] = true
		resolutions[candIdx] = candResolution{
			matchKind: "restored_history",
			record:    mergeBaseWithCandidate(hist, cand, "restored_history"),
		}
	}

	// Tier 4: Brand-new series identity (never inherits split/merged parent metadata)
	now := time.Now().UTC()
	for candIdx, cand := range detected {
		if usedCand[candIdx] {
			continue
		}
		seriesID := cand.ID
		if usedSeriesIDs[seriesID] {
			seriesID = stableSeriesID("series", lib.ID, cand.RootRelativePath+"#"+fmt.Sprintf("%d", now.UnixNano()))
		}
		usedSeriesIDs[seriesID] = true
		resolutions[candIdx] = candResolution{
			matchKind: "created",
			record:    candidateToFreshRecord(cand, seriesID, now),
		}
	}

	matchedCount := 0
	restoredHistoryCount := 0
	createdCount := 0
	nextRecords := make([]store.ArchivedSeriesRecord, 0, len(resolutions))
	workSamples := make([]SeriesLayoutWorkSample, 0, maxSeriesLayoutPreviewSamples)
	for idx, res := range resolutions {
		nextRecords = append(nextRecords, res.record)
		switch res.matchKind {
		case "exact_path", "member_set_1to1":
			matchedCount++
		case "restored_history":
			restoredHistoryCount++
		default:
			createdCount++
		}
		if len(workSamples) < maxSeriesLayoutPreviewSamples {
			cand := detected[idx]
			workSamples = append(workSamples, SeriesLayoutWorkSample{
				Title:            res.record.Title,
				RootRelativePath: res.record.RootRelativePath,
				ItemCount:        len(cand.Items),
				SectionCount:     len(cand.Sections),
				SingleChapter:    len(cand.Items) == 1,
				MatchKind:        res.matchKind,
			})
		}
	}

	archivedCount := 0
	archivedWithMetadataCount := 0
	archivedSamples := make([]SeriesLayoutArchivedSample, 0, maxSeriesLayoutPreviewSamples)
	for oldIdx, old := range existing {
		if usedOld[oldIdx] {
			continue
		}
		archivedCount++
		hasMeta := old.HasManualMetadata()
		if hasMeta {
			archivedWithMetadataCount++
		}
		if len(archivedSamples) < maxSeriesLayoutPreviewSamples {
			archivedSamples = append(archivedSamples, SeriesLayoutArchivedSample{
				ID:                old.ID,
				Title:             old.Title,
				RootRelativePath:  old.RootRelativePath,
				ItemCount:         len(old.Items),
				HasManualMetadata: hasMeta,
			})
		}
	}

	preview := SeriesLayoutPreview{
		LibraryID:                 lib.ID,
		LibraryName:               lib.Name,
		CurrentSeriesDepth:        currentDepth,
		TargetSeriesDepth:         targetDepth,
		Unchanged:                 currentDepth == targetDepth,
		SourceRevision:            sourceRevision,
		TotalComicFiles:           len(items),
		OldSeriesCount:            oldEffectiveCount,
		NewSeriesCount:            len(detected),
		OldShelfCount:             len(items) - oldSavings,
		NewShelfCount:             len(items) - newSavings,
		SingleChapterSeriesCount:  singleChapterCount,
		ShallowStandaloneCount:    shallowCount,
		MatchedSeriesCount:        matchedCount,
		RestoredFromHistoryCount:  restoredHistoryCount,
		CreatedSeriesCount:        createdCount,
		ArchivedSeriesCount:       archivedCount,
		ArchivedWithMetadataCount: archivedWithMetadataCount,
		HasLockConflicts:          len(lockConflicts) > 0,
		LockConflicts:             lockConflicts,
		Warnings:                  []string{},
		Samples: SeriesLayoutPreviewSamples{
			Works:          workSamples,
			ArchivedSeries: archivedSamples,
			ShallowItems:   shallowSamples,
		},
	}

	return computedSeriesLayoutPlan{
		preview:       preview,
		nextRecords:   nextRecords,
		lockConflicts: lockConflicts,
		archivedCount: archivedCount,
		matchedCount:  matchedCount + restoredHistoryCount,
	}
}

func detectManualLockConflicts(
	existing []store.ArchivedSeriesRecord,
	detected []store.DetectedSeries,
	candByRoot map[string]int,
	targetDepth int,
) []store.SeriesLayoutLockConflict {
	conflicts := make([]store.SeriesLayoutLockConflict, 0)
	for _, old := range existing {
		if old.ManualLocked {
			candIdx, ok := candByRoot[old.RootRelativePath]
			if !ok || archivedItemsSetKey(old.Items) != detectedItemsSetKey(detected[candIdx].Items) {
				conflicts = append(conflicts, store.SeriesLayoutLockConflict{
					Kind:             "series",
					SeriesID:         old.ID,
					Title:            old.Title,
					RootRelativePath: old.RootRelativePath,
					Reason:           fmt.Sprintf("作品「%s」已开启人工结构锁，切换至深度 %d 将拆分、合并或改写其目录与章节结构", old.Title, targetDepth),
				})
			}
			continue
		}

		for _, sec := range old.Sections {
			if !sec.ManualLocked {
				continue
			}
			secMemberIDs := make([]string, 0)
			for _, it := range old.Items {
				if it.SectionID == sec.ID {
					secMemberIDs = append(secMemberIDs, it.ComicID)
				}
			}
			sort.Strings(secMemberIDs)
			secKey := strings.Join(secMemberIDs, "\x00")

			candIdx, ok := candByRoot[old.RootRelativePath]
			preserved := false
			if ok {
				cand := detected[candIdx]
				for _, candSec := range cand.Sections {
					if candSec.RelativePath != sec.RelativePath {
						continue
					}
					candSecMembers := make([]string, 0)
					for _, it := range cand.Items {
						if it.SectionID == candSec.ID {
							candSecMembers = append(candSecMembers, it.ComicID)
						}
					}
					sort.Strings(candSecMembers)
					if strings.Join(candSecMembers, "\x00") == secKey {
						preserved = true
					}
					break
				}
			}
			if !preserved {
				conflicts = append(conflicts, store.SeriesLayoutLockConflict{
					Kind:             "section",
					SeriesID:         old.ID,
					SectionID:        sec.ID,
					Title:            old.Title + " / " + sec.Title,
					RootRelativePath: sec.RelativePath,
					Reason:           fmt.Sprintf("分段「%s / %s」已开启人工结构锁，切换至深度 %d 将改写该分段结构", old.Title, sec.Title, targetDepth),
				})
			}
		}
	}
	return conflicts
}

func mergeBaseWithCandidate(base store.ArchivedSeriesRecord, cand store.DetectedSeries, matchKind string) store.ArchivedSeriesRecord {
	if base.ManualLocked {
		return base
	}

	now := time.Now().UTC()
	createdAt := base.CreatedAt
	if createdAt.IsZero() {
		createdAt = now
	}

	// Keep custom/locked title; if title was merely auto-derived from the old directory path,
	// update it to the new work folder name (e.g. 1-to-1 "韩漫" -> "书A").
	oldAutoBase := path.Base(strings.Trim(base.RootRelativePath, "/"))
	hasCustomTitle := base.MetadataLocked || (base.Title != "" && base.Title != base.RootRelativePath && base.Title != oldAutoBase)
	title := cand.Title
	if hasCustomTitle {
		title = base.Title
	}
	sortTitle := store.BuildTitleSortKey(title)

	candMemberSet := make(map[string]bool, len(cand.Items))
	for _, it := range cand.Items {
		candMemberSet[it.ComicID] = true
	}
	coverComicID := cand.CoverComicID
	if base.CoverComicID != "" && candMemberSet[base.CoverComicID] {
		coverComicID = base.CoverComicID
	}

	baseSecByRelPath := make(map[string]store.ArchivedSeriesSection, len(base.Sections))
	for _, sec := range base.Sections {
		baseSecByRelPath[sec.RelativePath] = sec
	}

	sections := make([]store.ArchivedSeriesSection, 0, len(cand.Sections))
	candSecToFinalID := make(map[string]string, len(cand.Sections))
	for _, candSec := range cand.Sections {
		if existingSec, ok := baseSecByRelPath[candSec.RelativePath]; ok {
			candSecToFinalID[candSec.ID] = existingSec.ID
			if existingSec.ManualLocked {
				sections = append(sections, existingSec)
			} else {
				sections = append(sections, store.ArchivedSeriesSection{
					ID:              existingSec.ID,
					Title:           candSec.Title,
					RelativePath:    candSec.RelativePath,
					Kind:            candSec.Kind,
					SeasonNumber:    candSec.SeasonNumber,
					SortIndex:       candSec.SortIndex,
					DetectionSource: candSec.DetectionSource,
					ManualLocked:    false,
				})
			}
			continue
		}
		candSecToFinalID[candSec.ID] = candSec.ID
		sections = append(sections, store.ArchivedSeriesSection{
			ID:              candSec.ID,
			Title:           candSec.Title,
			RelativePath:    candSec.RelativePath,
			Kind:            candSec.Kind,
			SeasonNumber:    candSec.SeasonNumber,
			SortIndex:       candSec.SortIndex,
			DetectionSource: candSec.DetectionSource,
			ManualLocked:    false,
		})
	}

	items := make([]store.ArchivedSeriesItem, 0, len(cand.Items))
	for _, candItem := range cand.Items {
		secID := ""
		if candItem.SectionID != "" {
			secID = candSecToFinalID[candItem.SectionID]
		}
		items = append(items, store.ArchivedSeriesItem{
			ComicID:      candItem.ComicID,
			SectionID:    secID,
			SortIndex:    candItem.SortIndex,
			DisplayLabel: candItem.DisplayLabel,
		})
	}

	_ = matchKind
	return store.ArchivedSeriesRecord{
		ID:                      base.ID,
		LibraryID:               cand.LibraryID,
		RootRelativePath:        cand.RootRelativePath,
		Title:                   title,
		SortTitle:               sortTitle,
		CoverComicID:            coverComicID,
		CoverURL:                base.CoverURL,
		DetectionSource:         "directory",
		Author:                  base.Author,
		Description:             base.Description,
		TagsText:                base.TagsText,
		Year:                    base.Year,
		Publisher:               base.Publisher,
		Language:                base.Language,
		Genre:                   base.Genre,
		Status:                  base.Status,
		ExternalRating:          base.ExternalRating,
		ExternalRatingMax:       base.ExternalRatingMax,
		ExternalRatingSource:    base.ExternalRatingSource,
		ExternalRatingUpdatedAt: base.ExternalRatingUpdatedAt,
		MetadataLocked:          base.MetadataLocked,
		ManualLocked:            false,
		CreatedAt:               createdAt,
		UpdatedAt:               now,
		Sections:                sections,
		Items:                   items,
		Tags:                    append([]store.ArchivedSeriesTag{}, base.Tags...),
		Categories:              append([]store.ArchivedSeriesCategory{}, base.Categories...),
		GroupLinks:              append([]store.ArchivedGroupSeriesLink{}, base.GroupLinks...),
	}
}

func candidateToFreshRecord(cand store.DetectedSeries, seriesID string, now time.Time) store.ArchivedSeriesRecord {
	sections := make([]store.ArchivedSeriesSection, 0, len(cand.Sections))
	for _, sec := range cand.Sections {
		sections = append(sections, store.ArchivedSeriesSection{
			ID:              sec.ID,
			Title:           sec.Title,
			RelativePath:    sec.RelativePath,
			Kind:            sec.Kind,
			SeasonNumber:    sec.SeasonNumber,
			SortIndex:       sec.SortIndex,
			DetectionSource: sec.DetectionSource,
			ManualLocked:    false,
		})
	}
	items := make([]store.ArchivedSeriesItem, 0, len(cand.Items))
	for _, it := range cand.Items {
		items = append(items, store.ArchivedSeriesItem{
			ComicID:      it.ComicID,
			SectionID:    it.SectionID,
			SortIndex:    it.SortIndex,
			DisplayLabel: it.DisplayLabel,
		})
	}
	return store.ArchivedSeriesRecord{
		ID:               seriesID,
		LibraryID:        cand.LibraryID,
		RootRelativePath: cand.RootRelativePath,
		Title:            cand.Title,
		SortTitle:        cand.SortTitle,
		CoverComicID:     cand.CoverComicID,
		DetectionSource:  "directory",
		CreatedAt:        now,
		UpdatedAt:        now,
		Sections:         sections,
		Items:            items,
		Tags:             []store.ArchivedSeriesTag{},
		Categories:       []store.ArchivedSeriesCategory{},
		GroupLinks:       []store.ArchivedGroupSeriesLink{},
	}
}

func archivedItemsSetKey(items []store.ArchivedSeriesItem) string {
	ids := make([]string, len(items))
	for i, it := range items {
		ids[i] = it.ComicID
	}
	sort.Strings(ids)
	return strings.Join(ids, "\x00")
}

func detectedItemsSetKey(items []store.DetectedSeriesItem) string {
	ids := make([]string, len(items))
	for i, it := range items {
		ids[i] = it.ComicID
	}
	sort.Strings(ids)
	return strings.Join(ids, "\x00")
}

func inspectMultiRootOverlapWarnings(rootPaths []string, targetDepth int) []string {
	if len(rootPaths) <= 1 {
		return []string{}
	}
	seenPrefixOwner := make(map[string]string)
	duplicatePrefixes := make(map[string]bool)
	const maxVisitedDirs = 1500
	visited := 0

	var walkDir func(root string, currentRel string, depth int)
	walkDir = func(root string, currentRel string, depth int) {
		if depth > targetDepth || visited >= maxVisitedDirs {
			return
		}
		absDir := root
		if currentRel != "" {
			absDir = filepath.Join(root, filepath.FromSlash(currentRel))
		}
		entries, err := os.ReadDir(absDir)
		if err != nil {
			return
		}
		for _, entry := range entries {
			if !entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
				continue
			}
			visited++
			if visited > maxVisitedDirs {
				return
			}
			nextRel := entry.Name()
			if currentRel != "" {
				nextRel = currentRel + "/" + entry.Name()
			}
			if depth == targetDepth {
				if prevRoot, exists := seenPrefixOwner[nextRel]; exists && prevRoot != root {
					duplicatePrefixes[nextRel] = true
				} else {
					seenPrefixOwner[nextRel] = root
				}
			}
			if depth < targetDepth {
				walkDir(root, nextRel, depth+1)
			}
		}
	}

	for _, r := range rootPaths {
		cleaned := strings.TrimSpace(r)
		if cleaned != "" {
			walkDir(cleaned, "", 1)
		}
	}

	if len(duplicatePrefixes) == 0 {
		return []string{}
	}
	overlaps := make([]string, 0, len(duplicatePrefixes))
	for p := range duplicatePrefixes {
		overlaps = append(overlaps, p)
	}
	sort.Strings(overlaps)
	if len(overlaps) > 5 {
		overlaps = append(overlaps[:5], "...")
	}
	return []string{
		fmt.Sprintf("检测到多根目录存在相同的深度 %d 相对路径（%s），将按逻辑相对路径聚合至同一作品；若它们并非同一作品，建议拆分书库或调整目录前缀", targetDepth, strings.Join(overlaps, "、")),
	}
}
