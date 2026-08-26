package service

import (
	"crypto/sha1"
	"fmt"
	"path"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"

	"github.com/nowen-reader/nowen-reader/internal/store"
)

var (
	seriesRefreshMu         sync.Mutex
	seriesRefreshedAt       time.Time
	seriesSourceFingerprint string
)

var (
	seasonCNPattern = regexp.MustCompile(`(?i)^第?\s*([一二三四五六七八九十百零〇两0-9]+)\s*季$`)
	seasonENPattern = regexp.MustCompile(`(?i)^(?:season\s*|s\s*0*)([0-9]+)$`)
	partCNPattern   = regexp.MustCompile(`(?i)^第?\s*([一二三四五六七八九十百零〇两0-9]+)\s*(?:部|篇)$`)
	partENPattern   = regexp.MustCompile(`(?i)^part\s*0*([0-9]+)$`)
	specialPattern  = regexp.MustCompile(`(?i)^(?:前传|正传|后传|番外|番外篇|特别篇|特別篇|special|extras?)$`)
)

// EnsureComicSeriesFresh is kept for compatibility with older call sites, but
// it is intentionally non-blocking: it performs only a compact fingerprint
// check and schedules background maintenance when content changed. A read
// request must never rebuild an entire library in its own goroutine.
func EnsureComicSeriesFresh() error {
	seriesRefreshMu.Lock()
	if time.Since(seriesRefreshedAt) < 15*time.Second {
		seriesRefreshMu.Unlock()
		return nil
	}
	fingerprint, err := store.GetComicSeriesSourceFingerprint()
	if err != nil {
		seriesRefreshMu.Unlock()
		return err
	}
	changed := fingerprint != seriesSourceFingerprint
	seriesSourceFingerprint = fingerprint
	seriesRefreshedAt = time.Now()
	seriesRefreshMu.Unlock()

	if changed {
		ScheduleComicSeriesRebuild("")
	}
	return nil
}

func RebuildAllComicSeries() error {
	seriesRefreshMu.Lock()
	defer seriesRefreshMu.Unlock()
	if err := rebuildAllComicSeriesLocked(); err != nil {
		return err
	}
	seriesSourceFingerprint, _ = store.GetComicSeriesSourceFingerprint()
	seriesRefreshedAt = time.Now()
	return nil
}

func rebuildAllComicSeriesLocked() error {
	libraries, err := store.GetAllLibraries()
	if err != nil {
		return err
	}
	for _, library := range libraries {
		if !library.Enabled || library.Type != "comic" {
			continue
		}
		itemCount, tooLarge, sizeErr := ComicSeriesLibrarySize(library.ID)
		if sizeErr != nil {
			return sizeErr
		}
		if tooLarge {
			return fmt.Errorf("series rebuild for library %s requires %d items, above safe in-memory limit %d", library.ID, itemCount, seriesAutoRebuildItemLimit)
		}
		if err := rebuildComicSeriesForLibraryLocked(library.ID); err != nil {
			return fmt.Errorf("rebuild series for library %s: %w", library.ID, err)
		}
	}
	return nil
}

func RebuildComicSeriesForLibrary(libraryID string) error {
	itemCount, tooLarge, err := ComicSeriesLibrarySize(libraryID)
	if err != nil {
		return err
	}
	if tooLarge {
		return fmt.Errorf("series rebuild requires %d items, above safe in-memory limit %d", itemCount, seriesAutoRebuildItemLimit)
	}
	seriesRefreshMu.Lock()
	defer seriesRefreshMu.Unlock()
	if err := rebuildComicSeriesForLibraryLocked(libraryID); err != nil {
		return err
	}
	seriesSourceFingerprint, _ = store.GetComicSeriesSourceFingerprint()
	seriesRefreshedAt = time.Now()
	return nil
}

func rebuildComicSeriesForLibraryLocked(libraryID string) error {
	items, err := store.GetSeriesSourceItems(libraryID)
	if err != nil {
		return err
	}
	detected := DetectComicSeries(libraryID, items)
	return store.ReplaceDetectedSeries(libraryID, detected)
}

// DetectComicSeries turns flat readable items into the V1 hierarchy:
// Series -> optional Section -> Item. Root-level and single-item directories
// remain standalone; a series is only created when it can actually collapse
// at least two shelf entries.
func DetectComicSeries(libraryID string, items []store.SeriesSourceItem) []store.DetectedSeries {
	type candidateItem struct {
		source  store.SeriesSourceItem
		parts   []string
		cleaned string
	}
	groups := make(map[string][]candidateItem)
	for _, item := range items {
		cleaned := normalizeSeriesPath(item.RelativePath)
		if cleaned == "" {
			continue
		}
		parts := strings.Split(cleaned, "/")
		if len(parts) < 2 {
			// A file at the library root or a directory that is itself a single
			// image-folder comic stays as a standalone shelf item.
			continue
		}
		groups[parts[0]] = append(groups[parts[0]], candidateItem{source: item, parts: parts, cleaned: cleaned})
	}

	roots := make([]string, 0, len(groups))
	for root := range groups {
		roots = append(roots, root)
	}
	sort.Slice(roots, func(i, j int) bool { return naturalLess(roots[i], roots[j]) })

	result := make([]store.DetectedSeries, 0, len(roots))
	for _, root := range roots {
		members := groups[root]
		if len(members) < 2 {
			continue
		}

		sort.SliceStable(members, func(i, j int) bool { return naturalLess(members[i].cleaned, members[j].cleaned) })
		seriesID := stableSeriesID("series", libraryID, root)
		series := store.DetectedSeries{
			ID:               seriesID,
			LibraryID:        libraryID,
			RootRelativePath: root,
			Title:            root,
			SortTitle:        store.BuildTitleSortKey(root),
			CoverComicID:     members[0].source.ID,
		}

		sectionByPath := make(map[string]store.DetectedSeriesSection)
		sectionOrder := make([]string, 0)
		for _, member := range members {
			sectionID := ""
			if len(member.parts) >= 3 {
				sectionTitle, kind, number, ok := classifySection(member.parts[1])
				if ok {
					relativePath := path.Join(root, member.parts[1])
					section, exists := sectionByPath[relativePath]
					if !exists {
						section = store.DetectedSeriesSection{
							ID:              stableSeriesID("section", libraryID, relativePath),
							Title:           sectionTitle,
							RelativePath:    relativePath,
							Kind:            kind,
							SeasonNumber:    number,
							DetectionSource: "directory",
						}
						sectionByPath[relativePath] = section
						sectionOrder = append(sectionOrder, relativePath)
					}
					sectionID = section.ID
				}
			}
			series.Items = append(series.Items, store.DetectedSeriesItem{
				ComicID:      member.source.ID,
				SectionID:    sectionID,
				DisplayLabel: itemDisplayLabel(root, member.parts, member.source),
			})
		}

		sort.SliceStable(sectionOrder, func(i, j int) bool {
			a, b := sectionByPath[sectionOrder[i]], sectionByPath[sectionOrder[j]]
			if a.SeasonNumber != nil && b.SeasonNumber != nil && *a.SeasonNumber != *b.SeasonNumber {
				return *a.SeasonNumber < *b.SeasonNumber
			}
			if a.SeasonNumber != nil && b.SeasonNumber == nil {
				return true
			}
			if a.SeasonNumber == nil && b.SeasonNumber != nil {
				return false
			}
			return naturalLess(a.Title, b.Title)
		})
		for index, relativePath := range sectionOrder {
			section := sectionByPath[relativePath]
			section.SortIndex = index
			sectionByPath[relativePath] = section
			series.Sections = append(series.Sections, section)
		}

		sectionRank := make(map[string]int, len(series.Sections))
		for _, section := range series.Sections {
			sectionRank[section.ID] = section.SortIndex
		}
		sort.SliceStable(series.Items, func(i, j int) bool {
			a, b := series.Items[i], series.Items[j]
			if a.SectionID != b.SectionID {
				if a.SectionID == "" {
					return true
				}
				if b.SectionID == "" {
					return false
				}
				return sectionRank[a.SectionID] < sectionRank[b.SectionID]
			}
			return naturalLess(a.DisplayLabel, b.DisplayLabel)
		})
		for index := range series.Items {
			series.Items[index].SortIndex = index
		}
		result = append(result, series)
	}
	return result
}

func normalizeSeriesPath(value string) string {
	value = strings.TrimSpace(strings.ReplaceAll(value, "\\", "/"))
	value = strings.Trim(value, "/")
	cleaned := path.Clean(value)
	if cleaned == "." || cleaned == ".." || strings.HasPrefix(cleaned, "../") {
		return ""
	}
	return cleaned
}

func stableSeriesID(kind, libraryID, relativePath string) string {
	sum := sha1.Sum([]byte(kind + "\x00" + libraryID + "\x00" + relativePath))
	prefix := "ser_"
	if kind == "section" {
		prefix = "sec_"
	}
	return fmt.Sprintf("%s%x", prefix, sum[:10])
}

func classifySection(name string) (title, kind string, number *int, ok bool) {
	trimmed := strings.TrimSpace(name)
	if match := seasonCNPattern.FindStringSubmatch(trimmed); len(match) == 2 {
		n := parseLooseNumber(match[1])
		return trimmed, "season", n, true
	}
	if match := seasonENPattern.FindStringSubmatch(trimmed); len(match) == 2 {
		n, _ := strconv.Atoi(match[1])
		return trimmed, "season", &n, true
	}
	if match := partCNPattern.FindStringSubmatch(trimmed); len(match) == 2 {
		n := parseLooseNumber(match[1])
		return trimmed, "arc", n, true
	}
	if match := partENPattern.FindStringSubmatch(trimmed); len(match) == 2 {
		n, _ := strconv.Atoi(match[1])
		return trimmed, "arc", &n, true
	}
	if specialPattern.MatchString(trimmed) {
		return trimmed, "special", nil, true
	}
	return "", "", nil, false
}

func parseLooseNumber(value string) *int {
	if n, err := strconv.Atoi(value); err == nil {
		return &n
	}
	values := map[rune]int{'零': 0, '〇': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9}
	if value == "十" {
		n := 10
		return &n
	}
	total, current := 0, 0
	for _, r := range value {
		if r == '十' {
			if current == 0 {
				current = 1
			}
			total += current * 10
			current = 0
			continue
		}
		if r == '百' {
			if current == 0 {
				current = 1
			}
			total += current * 100
			current = 0
			continue
		}
		v, exists := values[r]
		if !exists {
			return nil
		}
		current = v
	}
	total += current
	if total <= 0 {
		return nil
	}
	return &total
}

func itemDisplayLabel(root string, parts []string, item store.SeriesSourceItem) string {
	name := item.Title
	if len(parts) > 0 {
		name = parts[len(parts)-1]
	}
	name = strings.TrimSuffix(name, path.Ext(name))
	name = strings.TrimSpace(name)
	lowerRoot := strings.ToLower(root)
	if strings.HasPrefix(strings.ToLower(name), lowerRoot) {
		name = cleanSeriesItemSuffix(name[len(root):])
	}
	if name == "" {
		name = item.Title
	}
	return name
}

const seriesItemLeadingSeparators = "-_‐‑‒–—―－!！:：·|｜/\\"

func cleanSeriesItemSuffix(value string) string {
	value = strings.TrimLeftFunc(value, func(r rune) bool {
		return unicode.IsSpace(r) || strings.ContainsRune(seriesItemLeadingSeparators, r)
	})
	value = strings.TrimSpace(value)

	for {
		unwrapped, ok := unwrapSeriesItemLabel(value)
		if !ok {
			return value
		}
		value = strings.TrimSpace(unwrapped)
	}
}

func unwrapSeriesItemLabel(value string) (string, bool) {
	runes := []rune(value)
	if len(runes) < 2 {
		return value, false
	}

	open := runes[0]
	close, ok := seriesItemClosingPair(open)
	if !ok || runes[len(runes)-1] != close {
		return value, false
	}

	depth := 0
	for index, current := range runes {
		switch current {
		case open:
			depth++
		case close:
			depth--
			if depth == 0 && index != len(runes)-1 {
				return value, false
			}
			if depth < 0 {
				return value, false
			}
		}
	}
	if depth != 0 {
		return value, false
	}
	return string(runes[1 : len(runes)-1]), true
}

func seriesItemClosingPair(open rune) (rune, bool) {
	switch open {
	case '(':
		return ')', true
	case '（':
		return '）', true
	case '[':
		return ']', true
	case '【':
		return '】', true
	default:
		return 0, false
	}
}

func naturalLess(a, b string) bool {
	ra, rb := []rune(strings.ToLower(a)), []rune(strings.ToLower(b))
	for ia, ib := 0, 0; ia < len(ra) && ib < len(rb); {
		if unicode.IsDigit(ra[ia]) && unicode.IsDigit(rb[ib]) {
			ja, jb := ia, ib
			for ja < len(ra) && unicode.IsDigit(ra[ja]) {
				ja++
			}
			for jb < len(rb) && unicode.IsDigit(rb[jb]) {
				jb++
			}
			na, _ := strconv.ParseUint(string(ra[ia:ja]), 10, 64)
			nb, _ := strconv.ParseUint(string(rb[ib:jb]), 10, 64)
			if na != nb {
				return na < nb
			}
			ia, ib = ja, jb
			continue
		}
		if ra[ia] != rb[ib] {
			return ra[ia] < rb[ib]
		}
		ia++
		ib++
	}
	return len(ra) < len(rb)
}
