package store

import (
	"database/sql/driver"
	"encoding/hex"
	"fmt"
	"strings"
	"sync"
	"time"
	"unicode"

	"golang.org/x/text/collate"
	"golang.org/x/text/language"
	"golang.org/x/text/unicode/norm"
	"golang.org/x/text/width"
	sqlite "modernc.org/sqlite"
)

var (
	titleSortCollator = collate.New(language.Chinese, collate.IgnoreCase)
	titleSortFuncOnce sync.Once
	titleSortFuncErr  error
)

// BuildTitleSortKey returns a stable title key for natural + Chinese collation.
// Numeric runs are compared by numeric value, while text runs use CLDR Chinese
// collation (pinyin-oriented for common Han characters).
func BuildTitleSortKey(title string) string {
	normalized := normalizeTitleForSort(title)
	if normalized == "" {
		return ""
	}

	var parts []string
	runes := []rune(normalized)
	for i := 0; i < len(runes); {
		r := runes[i]
		if unicode.IsDigit(r) {
			j := i + 1
			for j < len(runes) && unicode.IsDigit(runes[j]) {
				j++
			}
			digits := string(runes[i:j])
			trimmed := strings.TrimLeft(digits, "0")
			if trimmed == "" {
				trimmed = "0"
			}
			parts = append(parts, fmt.Sprintf("n%010d:%s:%010d", len(trimmed), trimmed, len(digits)))
			i = j
			continue
		}

		j := i + 1
		for j < len(runes) && !unicode.IsDigit(runes[j]) {
			j++
		}
		chunk := strings.TrimSpace(string(runes[i:j]))
		if chunk != "" {
			var buf collate.Buffer
			key := titleSortCollator.KeyFromString(&buf, chunk)
			parts = append(parts, "t"+hex.EncodeToString(key))
		}
		i = j
	}

	return strings.Join(parts, "|")
}

func TitleSortOrderSQL(alias string, direction string) string {
	direction = strings.ToUpper(strings.TrimSpace(direction))
	if direction != "DESC" {
		direction = "ASC"
	}
	prefix := ""
	if strings.TrimSpace(alias) != "" {
		prefix = strings.TrimSpace(alias) + "."
	}
	return fmt.Sprintf(`ORDER BY %s"titleSortKey" %s, %s"title" %s, %s"id" ASC`,
		prefix, direction, prefix, direction, prefix)
}

func normalizeTitleForSort(title string) string {
	title = width.Fold.String(title)
	title = norm.NFKC.String(title)
	title = strings.ToLower(title)

	var b strings.Builder
	lastSpace := false
	for _, r := range title {
		switch {
		case unicode.IsLetter(r) || unicode.IsDigit(r):
			b.WriteRune(r)
			lastSpace = false
		case unicode.IsSpace(r) || unicode.IsPunct(r) || unicode.IsSymbol(r):
			if !lastSpace {
				b.WriteByte(' ')
				lastSpace = true
			}
		default:
			b.WriteRune(r)
			lastSpace = false
		}
	}
	return strings.TrimSpace(b.String())
}

func registerTitleSortKeySQLFunction() error {
	titleSortFuncOnce.Do(func() {
		titleSortFuncErr = sqlite.RegisterDeterministicScalarFunction("title_sort_key", 1, func(ctx *sqlite.FunctionContext, args []driver.Value) (driver.Value, error) {
			if len(args) == 0 || args[0] == nil {
				return "", nil
			}
			switch v := args[0].(type) {
			case string:
				return BuildTitleSortKey(v), nil
			case []byte:
				return BuildTitleSortKey(string(v)), nil
			default:
				return BuildTitleSortKey(fmt.Sprint(v)), nil
			}
		})
		if titleSortFuncErr != nil {
			return
		}
		titleSortFuncErr = sqlite.RegisterDeterministicScalarFunction("shelf_time_key", 1, func(ctx *sqlite.FunctionContext, args []driver.Value) (driver.Value, error) {
			if len(args) == 0 || args[0] == nil {
				return "", nil
			}
			value := fmt.Sprint(args[0])
			parsed := parseSQLiteTime(value)
			if parsed.IsZero() {
				return value, nil
			}
			return parsed.UTC().Format(time.RFC3339Nano), nil
		})
	})
	return titleSortFuncErr
}
