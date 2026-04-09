package service

import (
	"strings"
)

func sortByRelevance(results []ComicMetadata, query string) {
	if len(results) <= 1 {
		return
	}
	queryLower := strings.ToLower(strings.TrimSpace(query))
	queryClean := strings.ToLower(strings.TrimSpace(CleanTitle(query)))

	// 多级匹配评分算法
	score := func(m ComicMetadata) int {
		titleLower := strings.ToLower(strings.TrimSpace(m.Title))
		titleClean := strings.ToLower(strings.TrimSpace(CleanTitle(m.Title)))

		bestScore := 0

		// 对原始查询和清洗后查询都进行评分，取最高分
		for _, q := range []string{queryLower, queryClean} {
			if q == "" {
				continue
			}
			for _, t := range []string{titleLower, titleClean} {
				if t == "" {
					continue
				}
				s := 0

				// 第1级: 完全匹配 (最高分)
				if t == q {
					s = 100
				} else if strings.Contains(t, q) {
					// 第2级: 结果标题包含整个查询
					s = 85
				} else if strings.Contains(q, t) {
					// 第3级: 查询包含整个结果标题（查询更长）
					s = 75
				} else {
					// 第4级: 关键词匹配 — 计算查询词在标题中的覆盖度
					words := strings.Fields(q)
					if len(words) > 0 {
						matched := 0
						for _, w := range words {
							if len(w) < 2 {
								continue // 跳过单字符词
							}
							if strings.Contains(t, w) {
								matched++
							}
						}
						// 覆盖率加权
						coverage := float64(matched) / float64(len(words))
						s = int(coverage * 60)
					}

					// 第5级: 反向检查 — 标题词在查询中的覆盖
					tWords := strings.Fields(t)
					if len(tWords) > 0 {
						rmatched := 0
						for _, w := range tWords {
							if len(w) < 2 {
								continue
							}
							if strings.Contains(q, w) {
								rmatched++
							}
						}
						rCoverage := float64(rmatched) / float64(len(tWords))
						rScore := int(rCoverage * 55)
						if rScore > s {
							s = rScore
						}
					}
				}

				if s > bestScore {
					bestScore = s
				}
			}
		}

		// 额外加分：标题长度与查询长度相近（避免标题过长或过短的不相关结果）
		if bestScore > 0 && bestScore < 100 {
			lenRatio := float64(len(queryLower)) / float64(len(strings.ToLower(m.Title))+1)
			if lenRatio > 1 {
				lenRatio = 1.0 / lenRatio
			}
			if lenRatio > 0.5 {
				bestScore += 5 // 长度相近加分
			}
		}

		return bestScore
	}

	// 简单冒泡排序（结果集通常很小）
	for i := 0; i < len(results); i++ {
		for j := i + 1; j < len(results); j++ {
			if score(results[j]) > score(results[i]) {
				results[i], results[j] = results[j], results[i]
			}
		}
	}
}

// ============================================================
// ComicInfo.xml parsing
// ============================================================

// ParseComicInfoXML parses ComicInfo.xml content into metadata.
