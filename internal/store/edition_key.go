package store

import (
	"path"
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"

	"golang.org/x/text/unicode/norm"
	"golang.org/x/text/width"
)

const (
	EditionMergeScopeDirectory = "directory"
	EditionMergeScopeLibrary   = "library"
	EditionMergeScopeGlobal    = "global"
)

// NormalizeEditionMergeScope normalizes a library's edition merge scope.
func NormalizeEditionMergeScope(raw string) string {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case EditionMergeScopeLibrary:
		return EditionMergeScopeLibrary
	case EditionMergeScopeGlobal:
		return EditionMergeScopeGlobal
	default:
		return EditionMergeScopeDirectory
	}
}

// IsValidEditionMergeScope validates client-provided editionMergeScope values.
func IsValidEditionMergeScope(raw string) bool {
	switch strings.TrimSpace(raw) {
	case EditionMergeScopeDirectory, EditionMergeScopeLibrary, EditionMergeScopeGlobal:
		return true
	default:
		return false
	}
}

// ExtractFileFormat derives a normalized lowercase format code from a filename or relative path.
func ExtractFileFormat(filenameOrRelPath string) string {
	cleaned := strings.TrimSpace(strings.ReplaceAll(filenameOrRelPath, "\\", "/"))
	if cleaned == "" {
		return "book"
	}
	if strings.HasSuffix(cleaned, "/") {
		return "folder"
	}
	base := path.Base(cleaned)
	ext := strings.ToLower(strings.TrimPrefix(path.Ext(base), "."))
	switch ext {
	case "":
		return "book"
	case "htm":
		return "html"
	default:
		return ext
	}
}

// FormatPriority returns the default selection rank for a format within a content type
// (smaller values mean higher priority).
func FormatPriority(contentType, format string) int {
	fmtLower := strings.ToLower(strings.TrimSpace(format))
	if contentType == "novel" {
		switch fmtLower {
		case "epub":
			return 1
		case "azw3":
			return 2
		case "mobi":
			return 3
		case "pdf":
			return 4
		case "html":
			return 5
		case "txt":
			return 6
		case "cbz":
			return 10
		case "zip":
			return 11
		default:
			return 99
		}
	}

	switch fmtLower {
	case "cbz":
		return 1
	case "zip":
		return 2
	case "cb7":
		return 3
	case "7z":
		return 4
	case "cbr":
		return 5
	case "rar":
		return 6
	case "folder":
		return 7
	case "pdf":
		return 8
	case "epub":
		return 9
	case "azw3":
		return 10
	case "mobi":
		return 11
	default:
		return 99
	}
}

var editionModifierTags = map[string]struct{}{
	"精校版": {}, "精校": {}, "精排": {}, "精排版": {}, "精排校对版": {}, "精校精排": {},
	"原版": {}, "初版": {}, "扫描版": {}, "扫描": {}, "影印版": {}, "文字版": {},
	"插图版": {}, "带插图": {}, "全插图": {}, "典藏版": {}, "珍藏版": {}, "纪念版": {},
	"修订版": {}, "增订版": {}, "全本": {}, "校对版": {}, "校对": {}, "精修版": {},
	"ocr": {}, "高清版": {}, "超清版": {}, "双语版": {}, "中英双语": {},
	"z-library": {}, "zlibrary": {}, "zlib": {}, "kindle": {}, "kindle版": {},
	"实体书扫描": {}, "排版版": {}, "无删减": {}, "完整版": {}, "未删节": {},
	"simplified": {}, "traditional": {}, "raw": {}, "digital": {},
}

var editionGenericPlaceholders = map[string]struct{}{
	"正文": {}, "全集": {}, "合集": {}, "未命名": {}, "新建文本文档": {},
	"readme": {}, "index": {}, "book": {}, "novel": {}, "comic": {}, "manga": {},
	"ebook": {}, "books": {}, "text": {}, "cover": {},
}

var (
	editionAuthorColonRe = regexp.MustCompile(`(?i)(?:作者|著|author|by)\s*[:：]\s*([^\]】\)）〕\s/|]+(?:\s+[^\]】\)）〕\s/|]+)?)`)
	editionTailAuthorRe  = regexp.MustCompile(`(?i)\s*(?:作者|author)\s*[:：]\s*.+$`)
)

func isEditionModifierTag(s string) bool {
	trimmed := strings.TrimSpace(s)
	if trimmed == "" {
		return false
	}
	lower := strings.ToLower(toSimplified(trimmed))
	if _, ok := editionModifierTags[lower]; ok {
		return true
	}
	return false
}

// ExtractEditionLabel extracts edition modifiers (e.g. "精校版", "精排", "插图版") from a path.
func ExtractEditionLabel(relPath string) string {
	cleaned := normalizeSeriesLikePath(relPath)
	if cleaned == "" || strings.HasSuffix(cleaned, "/") {
		return ""
	}
	base := path.Base(cleaned)
	baseNoExt := strings.TrimSuffix(base, path.Ext(base))

	_, labels := stripEditionModifiersAndCollectLabels(baseNoExt)
	if len(labels) == 0 {
		return ""
	}
	return strings.Join(labels, "·")
}

// ExtractAuthorFromFilename tries to parse an explicit author annotation from a filename/path.
func ExtractAuthorFromFilename(relPath string) string {
	cleaned := normalizeSeriesLikePath(relPath)
	if cleaned == "" {
		return ""
	}
	base := path.Base(strings.TrimSuffix(cleaned, "/"))
	baseNoExt := strings.TrimSuffix(base, path.Ext(base))
	if matches := editionAuthorColonRe.FindStringSubmatch(baseNoExt); len(matches) > 1 {
		return strings.TrimSpace(matches[1])
	}
	return ""
}

// ExtractCleanEditionStem extracts the normalized title stem (without parent directory),
// preserving volume/chapter numbers while stripping format/edition modifier tags.
func ExtractCleanEditionStem(relPath string) string {
	cleaned := normalizeSeriesLikePath(relPath)
	if cleaned == "" || strings.HasSuffix(cleaned, "/") {
		return ""
	}
	base := path.Base(cleaned)
	baseNoExt := strings.TrimSuffix(base, path.Ext(base))
	return cleanEditionStem(baseNoExt)
}

// BuildEditionStemKey returns a library-internal same-directory aggregation key
// ("<lower(parentDir)>\x00<cleanStem>") so same-directory format variants cluster via SQLite index.
func BuildEditionStemKey(relPath string) string {
	cleaned := normalizeSeriesLikePath(relPath)
	if cleaned == "" || strings.HasSuffix(cleaned, "/") {
		return ""
	}
	parentDir := path.Dir(cleaned)
	if parentDir == "" {
		parentDir = "."
	}
	stem := ExtractCleanEditionStem(cleaned)
	if stem == "" {
		return ""
	}
	return strings.ToLower(parentDir) + "\x00" + stem
}

// BuildEditionMatchKey builds a cross-directory / cross-library normalized book key.
// Volume/chapter identifiers (e.g. 三体1, 三体2, 上册, 下册) are strictly preserved.
// Generic/numeric-only names return "" to avoid false cross-directory merges.
func BuildEditionMatchKey(relPath, title string) string {
	cleaned := normalizeSeriesLikePath(relPath)
	if strings.HasSuffix(cleaned, "/") {
		return ""
	}

	var stem string
	if cleaned != "" {
		base := path.Base(cleaned)
		baseNoExt := strings.TrimSuffix(base, path.Ext(base))
		stem = cleanEditionStem(baseNoExt)
		if isGenericOrVolumeOnlyKey(stem) {
			// If filename alone is just "第01卷" or "01", enrich from smart title (parent directory).
			smart := FilenameToSmartTitle(cleaned)
			if smart != "" {
				stem = cleanEditionStem(smart)
			}
		}
	}
	if stem == "" && strings.TrimSpace(title) != "" {
		stem = cleanEditionStem(title)
	}
	if stem == "" || isGenericOrVolumeOnlyKey(stem) || utf8.RuneCountInString(stem) < 2 {
		return ""
	}
	return stem
}

func normalizeSeriesLikePath(raw string) string {
	trimmed := strings.TrimSpace(strings.ReplaceAll(raw, "\\", "/"))
	if trimmed == "" {
		return ""
	}
	isDir := strings.HasSuffix(trimmed, "/")
	trimmed = strings.Trim(trimmed, "/")
	if trimmed == "" {
		return ""
	}
	cleaned := path.Clean(trimmed)
	if cleaned == "." || cleaned == ".." || strings.HasPrefix(cleaned, "../") {
		return ""
	}
	if isDir {
		return cleaned + "/"
	}
	return cleaned
}

func cleanEditionStem(raw string) string {
	if strings.TrimSpace(raw) == "" {
		return ""
	}
	stripped, _ := stripEditionModifiersAndCollectLabels(raw)
	stripped = editionTailAuthorRe.ReplaceAllString(stripped, "")
	stripped = editionAuthorColonRe.ReplaceAllString(stripped, "")
	stripped = strings.NewReplacer("《", "", "》", "", "〈", "", "〉", "").Replace(stripped)

	normalized := normalizeEditionText(stripped)
	if normalized == "" {
		// Fallback to raw base string normalized without stripping brackets if everything was stripped
		fallback := strings.NewReplacer("《", "", "》", "", "〈", "", "〉", "").Replace(raw)
		normalized = normalizeEditionText(fallback)
	}
	return normalized
}

func stripEditionModifiersAndCollectLabels(input string) (string, []string) {
	var labels []string
	seenLabel := make(map[string]struct{})
	addLabel := func(lbl string) {
		lbl = strings.TrimSpace(lbl)
		if lbl == "" {
			return
		}
		key := strings.ToLower(lbl)
		if _, ok := seenLabel[key]; ok {
			return
		}
		seenLabel[key] = struct{}{}
		labels = append(labels, lbl)
	}

	type seg struct {
		text      string
		inBracket bool
		open      rune
		close     rune
	}
	var segs []seg
	var buf strings.Builder
	inBracket := false
	var openR, closeR rune

	flush := func() {
		if buf.Len() > 0 || inBracket {
			segs = append(segs, seg{text: buf.String(), inBracket: inBracket, open: openR, close: closeR})
			buf.Reset()
		}
	}

	matchingClose := func(r rune) (rune, bool) {
		switch r {
		case '(':
			return ')', true
		case '（':
			return '）', true
		case '[':
			return ']', true
		case '【':
			return '】', true
		case '〔':
			return '〕', true
		case '「':
			return '」', true
		case '『':
			return '』', true
		default:
			return 0, false
		}
	}

	for _, r := range input {
		if !inBracket {
			if cl, ok := matchingClose(r); ok {
				flush()
				inBracket = true
				openR = r
				closeR = cl
				continue
			}
			buf.WriteRune(r)
		} else {
			if r == closeR {
				flush()
				inBracket = false
				openR = 0
				closeR = 0
				continue
			}
			buf.WriteRune(r)
		}
	}
	flush()

	var out strings.Builder
	for _, s := range segs {
		if !s.inBracket {
			out.WriteString(s.text)
			continue
		}
		inside := strings.TrimSpace(s.text)
		if inside == "" {
			continue
		}
		if isEditionModifierTag(inside) {
			addLabel(inside)
			continue
		}
		if isFormatTag(inside) || isStatusTag(inside) || isScanGroupTag(inside) {
			continue
		}
		if editionAuthorColonRe.MatchString(inside) {
			continue
		}
		// Keep semantic brackets (like volume numbers `(01)` or `(上)` or `(第1卷)`)
		out.WriteRune(s.open)
		out.WriteString(s.text)
		out.WriteRune(s.close)
	}

	result := strings.TrimSpace(out.String())
	// Also peel trailing separator + standalone modifier/format tokens (e.g. "三体 精校版", "三体_EPUB")
	for {
		tokens := strings.Fields(strings.NewReplacer("_", " ").Replace(result))
		if len(tokens) <= 1 {
			break
		}
		last := tokens[len(tokens)-1]
		trimmedLast := strings.Trim(last, "-·.")
		if isEditionModifierTag(trimmedLast) {
			addLabel(trimmedLast)
			result = strings.TrimSpace(strings.Join(tokens[:len(tokens)-1], " "))
			result = strings.TrimRight(result, " -_·.")
			continue
		}
		if isFormatTag(trimmedLast) {
			result = strings.TrimSpace(strings.Join(tokens[:len(tokens)-1], " "))
			result = strings.TrimRight(result, " -_·.")
			continue
		}
		break
	}

	return strings.TrimSpace(result), labels
}

func normalizeEditionText(s string) string {
	s = width.Fold.String(s)
	s = norm.NFKC.String(s)
	s = toSimplified(s)
	s = strings.ToLower(s)

	var b strings.Builder
	b.Grow(len(s))
	for _, r := range s {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
		}
	}
	return b.String()
}

func isGenericOrVolumeOnlyKey(key string) bool {
	if key == "" {
		return true
	}
	if _, ok := editionGenericPlaceholders[key]; ok {
		return true
	}
	if isNumericTitle(key) || isVolumePartName(key) {
		return true
	}
	// Check simple normalized volume-only terms like "第1卷" / "vol01" / "上" / "下"
	switch key {
	case "上", "下", "中", "前", "后", "番外", "外传", "序章", "尾声", "目录", "简介":
		return true
	}
	return false
}
