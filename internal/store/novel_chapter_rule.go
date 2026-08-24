package store

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"fmt"
	"regexp"
	"strings"
)

const ChapterRuleAutoID = "auto"

// NovelChapterRule describes one TXT chapter heading detection rule. System
// rules live in code; custom rules are persisted in NovelChapterRule.
type NovelChapterRule struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Pattern string `json:"pattern"`
	System  bool   `json:"system"`
}

type ComicChapterRuleSelection struct {
	ComicID string            `json:"comicId"`
	RuleID  string            `json:"ruleId"`
	Rule    *NovelChapterRule `json:"rule"`
}

var systemNovelChapterRules = []NovelChapterRule{
	{ID: ChapterRuleAutoID, Name: "自动识别（默认）", System: true},
	{
		ID:      "preset-cn",
		Name:    "中文章节（第X章/节/回/卷）",
		Pattern: `^(?:第[零一二三四五六七八九十百千万\d]+[章节回卷部篇集].*|[章节卷][ \t]*[零一二三四五六七八九十百千万\d]+.*)$`,
		System:  true,
	},
	{
		ID:      "preset-en",
		Name:    "英文 Chapter / Part",
		Pattern: `(?i)^(?:chapter|part)\s+[\divxlc]+(?:[\s.:：\-]+.*)?$`,
		System:  true,
	},
	{
		ID:      "preset-numbered",
		Name:    "数字编号（1. / 01、）",
		Pattern: `^\d{1,4}[.、][ \t]*\S.*$`,
		System:  true,
	},
	{
		ID:      "preset-bracketed",
		Name:    "方括号编号（【001】/ [001]）",
		Pattern: `^[【\[][ \t]*\d{1,6}[ \t]*[】\]].+$`,
		System:  true,
	},
}

func SystemNovelChapterRules() []NovelChapterRule {
	out := make([]NovelChapterRule, len(systemNovelChapterRules))
	copy(out, systemNovelChapterRules)
	return out
}

func ListNovelChapterRules() ([]NovelChapterRule, error) {
	rules := SystemNovelChapterRules()
	rows, err := DB().Query(`SELECT "id", "name", "pattern" FROM "NovelChapterRule" ORDER BY "name" COLLATE NOCASE, "id"`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var rule NovelChapterRule
		if err := rows.Scan(&rule.ID, &rule.Name, &rule.Pattern); err != nil {
			return nil, err
		}
		rules = append(rules, rule)
	}
	return rules, rows.Err()
}

func GetNovelChapterRuleByID(id string) (*NovelChapterRule, error) {
	id = strings.TrimSpace(id)
	if id == "" {
		id = ChapterRuleAutoID
	}
	for _, rule := range systemNovelChapterRules {
		if rule.ID == id {
			copyRule := rule
			return &copyRule, nil
		}
	}
	var rule NovelChapterRule
	err := DB().QueryRow(`SELECT "id", "name", "pattern" FROM "NovelChapterRule" WHERE "id" = ?`, id).
		Scan(&rule.ID, &rule.Name, &rule.Pattern)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &rule, nil
}

func ValidateNovelChapterRule(name, pattern string) error {
	if strings.TrimSpace(name) == "" {
		return fmt.Errorf("rule name cannot be empty")
	}
	if len([]rune(strings.TrimSpace(name))) > 64 {
		return fmt.Errorf("rule name is too long (max 64 characters)")
	}
	pattern = strings.TrimSpace(pattern)
	if pattern == "" {
		return fmt.Errorf("chapter pattern cannot be empty")
	}
	if len(pattern) > 1024 {
		return fmt.Errorf("chapter pattern is too long (max 1024 bytes)")
	}
	if _, err := regexp.Compile(pattern); err != nil {
		return fmt.Errorf("invalid chapter pattern: %w", err)
	}
	return nil
}

func CreateNovelChapterRule(name, pattern string) (*NovelChapterRule, error) {
	name = strings.TrimSpace(name)
	pattern = strings.TrimSpace(pattern)
	if err := ValidateNovelChapterRule(name, pattern); err != nil {
		return nil, err
	}
	id, err := newChapterRuleID()
	if err != nil {
		return nil, err
	}
	if _, err := DB().Exec(`INSERT INTO "NovelChapterRule" ("id", "name", "pattern") VALUES (?, ?, ?)`, id, name, pattern); err != nil {
		return nil, err
	}
	return &NovelChapterRule{ID: id, Name: name, Pattern: pattern}, nil
}

func UpdateNovelChapterRule(id, name, pattern string) error {
	if isSystemChapterRuleID(id) {
		return fmt.Errorf("system chapter rules cannot be edited")
	}
	name = strings.TrimSpace(name)
	pattern = strings.TrimSpace(pattern)
	if err := ValidateNovelChapterRule(name, pattern); err != nil {
		return err
	}
	res, err := DB().Exec(`UPDATE "NovelChapterRule" SET "name" = ?, "pattern" = ?, "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = ?`, name, pattern, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("chapter rule not found")
	}
	return nil
}

func DeleteNovelChapterRule(id string) error {
	if isSystemChapterRuleID(id) {
		return fmt.Errorf("system chapter rules cannot be deleted")
	}
	tx, err := DB().Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.Exec(`UPDATE "ComicChapterRule" SET "ruleId" = ?, "updatedAt" = CURRENT_TIMESTAMP WHERE "ruleId" = ?`, ChapterRuleAutoID, id); err != nil {
		return err
	}
	res, err := tx.Exec(`DELETE FROM "NovelChapterRule" WHERE "id" = ?`, id)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("chapter rule not found")
	}
	return tx.Commit()
}

func GetComicChapterRuleSelection(comicID string) (*ComicChapterRuleSelection, error) {
	ruleID := ChapterRuleAutoID
	err := DB().QueryRow(`SELECT "ruleId" FROM "ComicChapterRule" WHERE "comicId" = ?`, comicID).Scan(&ruleID)
	if err != nil && err != sql.ErrNoRows {
		return nil, err
	}
	rule, err := GetNovelChapterRuleByID(ruleID)
	if err != nil {
		return nil, err
	}
	if rule == nil {
		ruleID = ChapterRuleAutoID
		rule, _ = GetNovelChapterRuleByID(ruleID)
	}
	return &ComicChapterRuleSelection{ComicID: comicID, RuleID: ruleID, Rule: rule}, nil
}

func SetComicChapterRuleSelection(comicID, ruleID string) error {
	if strings.TrimSpace(ruleID) == "" {
		ruleID = ChapterRuleAutoID
	}
	rule, err := GetNovelChapterRuleByID(ruleID)
	if err != nil {
		return err
	}
	if rule == nil {
		return fmt.Errorf("chapter rule not found")
	}
	_, err = DB().Exec(`INSERT INTO "ComicChapterRule" ("comicId", "ruleId", "updatedAt") VALUES (?, ?, CURRENT_TIMESTAMP)
		ON CONFLICT("comicId") DO UPDATE SET "ruleId" = excluded."ruleId", "updatedAt" = CURRENT_TIMESTAMP`, comicID, ruleID)
	return err
}

func ListComicIDsByChapterRule(ruleID string) ([]string, error) {
	rows, err := DB().Query(`SELECT "comicId" FROM "ComicChapterRule" WHERE "ruleId" = ?`, ruleID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func isSystemChapterRuleID(id string) bool {
	for _, rule := range systemNovelChapterRules {
		if rule.ID == id {
			return true
		}
	}
	return false
}

func newChapterRuleID() (string, error) {
	buf := make([]byte, 8)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("generate chapter rule id: %w", err)
	}
	return "custom-" + hex.EncodeToString(buf), nil
}
