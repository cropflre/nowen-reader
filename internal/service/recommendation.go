package service

import (
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/nowen-reader/nowen-reader/internal/store"
)

// ScoredComic represents a recommended comic with scoring details.
type ScoredComic struct {
	ID       string              `json:"id"`
	Title    string              `json:"title"`
	Score    float64             `json:"score"`
	Reasons  []string            `json:"reasons"`
	CoverURL string              `json:"coverUrl"`
	Author   string              `json:"author"`
	Genre    string              `json:"genre"`
	Tags     []store.ComicTagInfo `json:"tags"`
}

// GetRecommendations returns personalized comic recommendations.
func GetRecommendations(limit int, excludeRead bool) ([]ScoredComic, error) {
	allComics, err := store.GetAllComicsForRecommendation()
	if err != nil || len(allComics) == 0 {
		return []ScoredComic{}, nil
	}

	profile := buildUserProfile(allComics)

	var scored []ScoredComic
	for _, comic := range allComics {
		if excludeRead && comic.LastReadPage > 0 && comic.PageCount > 0 {
			progress := float64(comic.LastReadPage) / float64(comic.PageCount)
			if progress >= 0.9 {
				continue
			}
		}

		score, reasons := calculateRecommendationScore(comic, profile)

		scored = append(scored, ScoredComic{
			ID:       comic.ID,
			Title:    comic.Title,
			Score:    score,
			Reasons:  reasons,
			CoverURL: fmt.Sprintf("/api/comics/%s/thumbnail", comic.ID),
			Author:   comic.Author,
			Genre:    comic.Genre,
			Tags:     comic.Tags,
		})
	}

	// Sort by score desc
	for i := 0; i < len(scored); i++ {
		for j := i + 1; j < len(scored); j++ {
			if scored[j].Score > scored[i].Score {
				scored[i], scored[j] = scored[j], scored[i]
			}
		}
	}

	if limit > 0 && len(scored) > limit {
		scored = scored[:limit]
	}
	return scored, nil
}

// GetSimilarComics returns comics similar to a given comic.
func GetSimilarComics(comicID string, limit int) ([]ScoredComic, error) {
	target, err := store.GetComicByID(comicID)
	if err != nil || target == nil {
		return []ScoredComic{}, nil
	}

	allComics, err := store.GetAllComicsForRecommendation()
	if err != nil {
		return nil, err
	}

	targetTags := map[string]bool{}
	for _, t := range target.Tags {
		targetTags[t.Name] = true
	}
	targetGenres := map[string]bool{}
	for _, g := range strings.Split(target.Genre, ",") {
		g = strings.TrimSpace(g)
		if g != "" {
			targetGenres[g] = true
		}
	}
	targetCats := map[string]bool{}
	for _, c := range target.Categories {
		targetCats[c.Slug] = true
	}

	var scored []ScoredComic
	for _, comic := range allComics {
		if comic.ID == comicID {
			continue
		}

		var score float64
		var reasons []string

		// Tag overlap (Jaccard)
		comicTags := map[string]bool{}
		for _, t := range comic.Tags {
			comicTags[t.Name] = true
		}
		intersection := 0
		for t := range targetTags {
			if comicTags[t] {
				intersection++
			}
		}
		unionSize := len(targetTags)
		for t := range comicTags {
			if !targetTags[t] {
				unionSize++
			}
		}
		if unionSize > 0 {
			tagSim := float64(intersection) / float64(unionSize)
			score += tagSim * 40
			if tagSim > 0.3 {
				reasons = append(reasons, "similar_tags")
			}
		}

		// Genre overlap
		comicGenres := map[string]bool{}
		for _, g := range strings.Split(comic.Genre, ",") {
			g = strings.TrimSpace(g)
			if g != "" {
				comicGenres[g] = true
			}
		}
		genreIntersection := 0
		for g := range targetGenres {
			if comicGenres[g] {
				genreIntersection++
			}
		}
		genreUnion := len(targetGenres)
		for g := range comicGenres {
			if !targetGenres[g] {
				genreUnion++
			}
		}
		if genreUnion > 0 {
			genreSim := float64(genreIntersection) / float64(genreUnion)
			score += genreSim * 30
			if genreSim > 0.3 {
				reasons = append(reasons, "similar_genre")
			}
		}

		// Same author
		if comic.Author != "" && comic.Author == target.Author {
			score += 20
			reasons = append(reasons, "same_author")
		}

		// Same series
		if comic.SeriesName != "" && comic.SeriesName == target.SeriesName {
			score += 25
			reasons = append(reasons, "same_series")
		}

		// Same category
		for _, c := range comic.Categories {
			if targetCats[c.Slug] {
				score += 8
				reasons = append(reasons, "same_category")
				break
			}
		}

		if score > 0 {
			scored = append(scored, ScoredComic{
				ID:       comic.ID,
				Title:    comic.Title,
				Score:    score,
				Reasons:  reasons,
				CoverURL: fmt.Sprintf("/api/comics/%s/thumbnail", comic.ID),
				Author:   comic.Author,
				Genre:    comic.Genre,
				Tags:     comic.Tags,
			})
		}
	}

	// Sort
	for i := 0; i < len(scored); i++ {
		for j := i + 1; j < len(scored); j++ {
			if scored[j].Score > scored[i].Score {
				scored[i], scored[j] = scored[j], scored[i]
			}
		}
	}

	if limit > 0 && len(scored) > limit {
		scored = scored[:limit]
	}
	return scored, nil
}

// ============================================================
// Internal
// ============================================================

type userProfile struct {
	tagWeights    map[string]float64
	genreWeights  map[string]float64
	authorWeights map[string]float64
	avgRating     float64
	activeSeries  map[string]bool
}

func buildUserProfile(comics []store.RecommendationComic) userProfile {
	p := userProfile{
		tagWeights:    map[string]float64{},
		genreWeights:  map[string]float64{},
		authorWeights: map[string]float64{},
		activeSeries:  map[string]bool{},
	}

	var totalRating float64
	var ratedCount int

	for _, c := range comics {
		engagement := calculateEngagement(c)
		if engagement <= 0 {
			continue
		}

		for _, t := range c.Tags {
			p.tagWeights[t.Name] += engagement
		}

		if c.Genre != "" {
			for _, g := range strings.Split(c.Genre, ",") {
				g = strings.TrimSpace(g)
				if g != "" {
					p.genreWeights[g] += engagement
				}
			}
		}

		if c.Author != "" {
			p.authorWeights[c.Author] += engagement
		}

		if c.Rating != nil {
			totalRating += float64(*c.Rating)
			ratedCount++
		}

		if c.SeriesName != "" && c.LastReadPage > 0 {
			p.activeSeries[c.SeriesName] = true
		}
	}

	if ratedCount > 0 {
		p.avgRating = totalRating / float64(ratedCount)
	} else {
		p.avgRating = 3
	}
	return p
}

func calculateEngagement(c store.RecommendationComic) float64 {
	var score float64

	readTime := c.TotalReadTime
	if readTime > 0 {
		score += math.Min(float64(readTime)/600, 5)
	}

	if c.PageCount > 0 && c.LastReadPage > 0 {
		progress := float64(c.LastReadPage) / float64(c.PageCount)
		score += progress * 3
	}

	if c.Rating != nil {
		score += (float64(*c.Rating) - 2.5) * 2
	}

	if c.IsFavorite {
		score += 3
	}

	if c.LastReadAt != nil {
		daysSince := time.Since(*c.LastReadAt).Hours() / 24
		if daysSince < 7 {
			score += 2
		} else if daysSince < 30 {
			score += 1
		}
	}

	return score
}

func calculateRecommendationScore(c store.RecommendationComic, profile userProfile) (float64, []string) {
	var score float64
	var reasons []string

	// Tag match
	var tagScore float64
	for _, t := range c.Tags {
		tagScore += profile.tagWeights[t.Name]
	}
	if tagScore > 0 {
		normalized := math.Min(tagScore/10, 30)
		score += normalized
		if normalized > 5 {
			reasons = append(reasons, "tag_match")
		}
	}

	// Genre match
	if c.Genre != "" {
		var genreScore float64
		for _, g := range strings.Split(c.Genre, ",") {
			g = strings.TrimSpace(g)
			genreScore += profile.genreWeights[g]
		}
		if genreScore > 0 {
			normalized := math.Min(genreScore/10, 25)
			score += normalized
			if normalized > 5 {
				reasons = append(reasons, "genre_match")
			}
		}
	}

	// Author match
	if c.Author != "" {
		if w := profile.authorWeights[c.Author]; w > 0 {
			normalized := math.Min(w/5, 20)
			score += normalized
			reasons = append(reasons, "same_author")
		}
	}

	// Series continuation
	if c.SeriesName != "" && profile.activeSeries[c.SeriesName] {
		if c.PageCount > 0 && c.LastReadPage == 0 {
			score += 15
			reasons = append(reasons, "series_continuation")
		} else if c.LastReadPage > 0 && float64(c.LastReadPage) < float64(c.PageCount)*0.9 {
			score += 10
			reasons = append(reasons, "series_in_progress")
		}
	}

	// Rating prediction
	if c.Rating != nil && float64(*c.Rating) >= profile.avgRating {
		score += (float64(*c.Rating) - profile.avgRating) * 3
		reasons = append(reasons, "highly_rated")
	}

	// Unread bonus
	if c.LastReadPage == 0 && c.PageCount > 0 {
		score += 5
		reasons = append(reasons, "unread")
	}

	// Recency penalty
	if c.LastReadAt != nil {
		daysSince := time.Since(*c.LastReadAt).Hours() / 24
		if daysSince < 1 {
			score -= 10
		} else if daysSince < 3 {
			score -= 5
		}
	}

	if score < 0 {
		score = 0
	}
	if reasons == nil {
		reasons = []string{}
	}
	return score, reasons
}
