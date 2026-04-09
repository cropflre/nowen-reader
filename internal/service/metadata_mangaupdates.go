package service

import (
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"
)

// ============================================================
// MangaUpdates API (free)
// ============================================================

const mangaupdatesAPI = "https://api.mangaupdates.com/v1"

func SearchMangaUpdates(query, lang string) []ComicMetadata {
	body, _ := json.Marshal(map[string]interface{}{
		"search":   query,
		"per_page": 10,
	})

	resp, err := httpPostJSON(mangaupdatesAPI+"/series/search", body, nil, 15*time.Second)
	if err != nil {
		log.Printf("[metadata] MangaUpdates search failed: %v", err)
		return nil
	}
	defer resp.Body.Close()

	var data struct {
		Results []struct {
			Record struct {
				Title       string `json:"title"`
				Description string `json:"description"`
				Image       struct {
					URL struct {
						Original string `json:"original"`
					} `json:"url"`
				} `json:"image"`
				Year   string `json:"year"`
				Genres []struct {
					Genre string `json:"genre"`
				} `json:"genres"`
				Authors []struct {
					Name string `json:"name"`
					Type string `json:"type"`
				} `json:"authors"`
				Publishers []struct {
					PublisherName string `json:"publisher_name"`
					Type          string `json:"type"`
				} `json:"publishers"`
			} `json:"record"`
		} `json:"results"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return nil
	}

	var results []ComicMetadata
	for _, r := range data.Results {
		rec := r.Record

		var authors []string
		for _, a := range rec.Authors {
			if a.Name != "" {
				authors = append(authors, a.Name)
			}
		}

		publisher := ""
		for _, p := range rec.Publishers {
			if p.Type == "Original" {
				publisher = p.PublisherName
				break
			}
		}
		if publisher == "" && len(rec.Publishers) > 0 {
			publisher = rec.Publishers[0].PublisherName
		}

		var year *int
		if rec.Year != "" {
			var y int
			if _, err := fmt.Sscanf(rec.Year, "%d", &y); err == nil && y > 0 {
				year = &y
			}
		}

		var genreNames []string
		for _, g := range rec.Genres {
			genreNames = append(genreNames, g.Genre)
		}
		genre := strings.Join(genreNames, ", ")
		if genre != "" {
			genre = TranslateGenre(genre, lang)
		}

		results = append(results, ComicMetadata{
			Title:       rec.Title,
			Author:      strings.Join(authors, ", "),
			Publisher:   publisher,
			Year:        year,
			Description: stripHTML(rec.Description),
			Genre:       genre,
			CoverURL:    rec.Image.URL.Original,
			Source:      "mangaupdates",
		})
	}
	return results
}
