package store

import "testing"

// TestFilenameToSmartTitle 覆盖方案 1 的核心场景：
//
//	无父目录 → 仅用文件名；
//	有父目录 → 文件夹名做主体，文件名做卷次后缀；
//	文件名已包含父目录名时不重复拼接；
//	父目录是分卷词 / 格式标签时继续向上查找真正的作品名。
func TestFilenameToSmartTitle(t *testing.T) {
	cases := []struct {
		relPath string
		want    string
	}{
		// === 1. 根目录下的文件：直接用文件名 ===
		{"test-comic.cbz", "test-comic"},
		{"NARUTO vol.23.zip", "NARUTO vol.23"},
		{"1.cbz", "1"},

		// === 2. 单级文件夹：文件夹名 + 文件名 ===
		{"海贼王/01.pdf", "海贼王 01"},
		{"海贼王/1.cbz", "海贼王 1"},
		{"海贼王/单行本.cbz", "海贼王 单行本"},
		{"封神纪/第三部.zip", "封神纪 第三部"},

		// === 3. 文件名已包含文件夹名：去重，避免 "海贼王 海贼王 第1卷" ===
		{"海贼王/海贼王 第100卷.cbz", "海贼王 第100卷"},
		{"NARUTO/NARUTO vol.23.zip", "NARUTO vol.23"},

		// === 4. 多级目录：父级是分卷词 → 继续向上找作品名，分卷词作为中间层 ===
		{"封神纪/第三部/01.PDF", "封神纪 第三部 01"},
		{"封神纪/第一部/FengShen 001.PDF", "封神纪 第一部 FengShen 001"},

		// === 5. 父目录含 [汉化组] / 格式标签 等噪声：通过 cleanDirName 清洗 ===
		{"【郑健和 - 封神纪（武庚纪）】 PDF/第三部/01.PDF", "郑健和 - 封神纪（武庚纪） 第三部 01"},
		{"[汉化组]海贼王/01.cbz", "海贼王 01"},

		// === 6. 扫图组/状态标签场景：作品名位于括号外，应该被提取 ===
		// "【已完结】佣兵天下(潮華版)[黃玉郎][誰在乎版]/誰在乎版 YongBing-000.cbz"
		// 期望：作品名取 "佣兵天下(潮華版)"，文件名前缀的"誰在乎版"被剥除
		{"【已完结】佣兵天下(潮華版)[黃玉郎][誰在乎版]/誰在乎版 YongBing-000.cbz", "佣兵天下(潮華版) YongBing-000"},
		{"[漢化組]火影忍者/[漢化組] NARUTO 01.zip", "火影忍者 NARUTO 01"},
	}
	for _, tc := range cases {
		got := FilenameToSmartTitle(tc.relPath)
		if got != tc.want {
			t.Errorf("FilenameToSmartTitle(%q) = %q, want %q", tc.relPath, got, tc.want)
		}
	}
}

// TestIsVolumePartName 覆盖分卷词识别。
func TestIsVolumePartName(t *testing.T) {
	trueCases := []string{
		"第一部", "第二卷", "第3集", "第十二话", "第二十回",
		"上篇", "中篇", "下篇",
		"上", "中", "下",
		"上卷", "下卷",
		"外传", "番外", "特别篇",
		"Vol.1", "vol 2", "Volume 3", "Part 4", "Book 5", "Chapter 6", "Season 7", "Episode 8",
		"01", "123",
	}
	for _, s := range trueCases {
		if !isVolumePartName(s) {
			t.Errorf("isVolumePartName(%q) = false, want true", s)
		}
	}
	falseCases := []string{
		"海贼王", "封神纪（武庚纪）", "NARUTO", "港漫.大圣王.KC.010",
		"FengShen 001", "第一部作品", "Vol.1 特别篇",
		"",
	}
	for _, s := range falseCases {
		if isVolumePartName(s) {
			t.Errorf("isVolumePartName(%q) = true, want false", s)
		}
	}
}

// TestBuildGroupNameFromPath 验证分卷词父级拼接 + 格式标签降级。
func TestBuildGroupNameFromPath(t *testing.T) {
	cases := []struct {
		path string
		want string
	}{
		{"海贼王", "海贼王"},
		{"乌龙院/乌龙院前篇", "乌龙院前篇"}, // 最后一级不是分卷词，保持原行为
		// 【...】 PDF 形式：方括号外只剩"PDF"格式标签，会降级使用方括号内的内容
		{"【郑健和 - 封神纪（武庚纪）】 PDF/第三部", "郑健和 - 封神纪（武庚纪） / 第三部"},
		{"封神纪/第一部", "封神纪 / 第一部"},
		{"作品/Vol.1", "作品 / Vol.1"},
	}
	for _, tc := range cases {
		got := buildGroupNameFromPath(tc.path)
		if got != tc.want {
			t.Errorf("buildGroupNameFromPath(%q) = %q, want %q", tc.path, got, tc.want)
		}
	}
}
