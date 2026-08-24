package store

import "testing"

func TestNovelChapterRuleCRUDAndSystemPresets(t *testing.T) {
	setupTestDB(t)

	rules, err := ListNovelChapterRules()
	if err != nil {
		t.Fatalf("ListNovelChapterRules failed: %v", err)
	}
	if len(rules) < 5 {
		t.Fatalf("expected auto + built-in presets, got %d rules", len(rules))
	}
	if rules[0].ID != ChapterRuleAutoID || !rules[0].System {
		t.Fatalf("expected first rule to be system auto, got %#v", rules[0])
	}

	created, err := CreateNovelChapterRule("方括号章节", `^【\d+】.+$`)
	if err != nil {
		t.Fatalf("CreateNovelChapterRule failed: %v", err)
	}
	if created.ID == "" || created.System {
		t.Fatalf("unexpected created rule: %#v", created)
	}

	got, err := GetNovelChapterRuleByID(created.ID)
	if err != nil || got == nil {
		t.Fatalf("GetNovelChapterRuleByID failed: rule=%#v err=%v", got, err)
	}
	if got.Name != "方括号章节" || got.Pattern != `^【\d+】.+$` {
		t.Fatalf("unexpected stored rule: %#v", got)
	}

	if err := UpdateNovelChapterRule(created.ID, "星号章节", `^☆.+☆$`); err != nil {
		t.Fatalf("UpdateNovelChapterRule failed: %v", err)
	}
	got, _ = GetNovelChapterRuleByID(created.ID)
	if got == nil || got.Name != "星号章节" || got.Pattern != `^☆.+☆$` {
		t.Fatalf("rule was not updated: %#v", got)
	}

	if err := UpdateNovelChapterRule(created.ID, "bad", `([`); err == nil {
		t.Fatal("expected invalid regex to be rejected")
	}
	if err := UpdateNovelChapterRule("preset-cn", "changed", `.*`); err == nil {
		t.Fatal("expected system preset update to be rejected")
	}
	if err := DeleteNovelChapterRule("preset-cn"); err == nil {
		t.Fatal("expected system preset deletion to be rejected")
	}

	if err := DeleteNovelChapterRule(created.ID); err != nil {
		t.Fatalf("DeleteNovelChapterRule failed: %v", err)
	}
	got, err = GetNovelChapterRuleByID(created.ID)
	if err != nil {
		t.Fatalf("GetNovelChapterRuleByID after delete failed: %v", err)
	}
	if got != nil {
		t.Fatalf("expected deleted rule to be absent, got %#v", got)
	}
}

func TestValidateNovelChapterRule(t *testing.T) {
	if err := ValidateNovelChapterRule("", `^第\d+章`); err == nil {
		t.Fatal("expected empty name error")
	}
	if err := ValidateNovelChapterRule("ok", ""); err == nil {
		t.Fatal("expected empty pattern error")
	}
	if err := ValidateNovelChapterRule("ok", `^第\d+章`); err != nil {
		t.Fatalf("valid regex rejected: %v", err)
	}
}
