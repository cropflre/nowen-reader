package service

import (
	"encoding/json"
	"fmt"
	"log"
	"net/url"
	"strings"
	"time"
)

// ============================================================
// MangaDex API (free, no key)
// ============================================================

const mangadexAPI = "https://api.mangadex.org"

func SearchMangaDex(query, lang string) []ComicMetadata {
	u := fmt.Sprintf("%s/manga?title=%s&limit=10&includes[]=author&includes[]=artist&includes[]=cover_art&order[relevance]=desc",
		mangadexAPI, url.QueryEscape(query))

	resp, err := httpGet(u, map[string]string{
		"User-Agent": "NowenReader/1.0",
	}, 15*time.Second)
	if err != nil {
		log.Printf("[metadata] MangaDex search failed: %v", err)
		return nil
	}
	defer resp.Body.Close()

	var data struct {
		Data []struct {
			ID         string `json:"id"`
			Attributes struct {
				Title       map[string]string   `json:"title"`
				AltTitles   []map[string]string `json:"altTitles"`
				Description map[string]string   `json:"description"`
				Year        *int                `json:"year"`
				Tags        []struct {
					Attributes struct {
						Name  map[string]string `json:"name"`
						Group string            `json:"group"`
					} `json:"attributes"`
				} `json:"tags"`
				OriginalLanguage string `json:"originalLanguage"`
			} `json:"attributes"`
			Relationships []struct {
				Type       string `json:"type"`
				Attributes *struct {
					Name     string `json:"name"`
					FileName string `json:"fileName"`
				} `json:"attributes"`
			} `json:"relationships"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return nil
	}

	isZh := strings.HasPrefix(lang, "zh")
	var results []ComicMetadata

	for _, manga := range data.Data {
		attrs := manga.Attributes

		// Title
		title := pickLangValue(attrs.Title, lang)

		// Description
		desc := pickLangValue(attrs.Description, lang)

		// Authors
		var authors []string
		seen := map[string]bool{}
		for _, r := range manga.Relationships {
			if (r.Type == "author" || r.Type == "artist") && r.Attributes != nil && r.Attributes.Name != "" {
				if !seen[r.Attributes.Name] {
					authors = append(authors, r.Attributes.Name)
					seen[r.Attributes.Name] = true
				}
			}
		}

		// Cover URL
		var coverURL string
		for _, r := range manga.Relationships {
			if r.Type == "cover_art" && r.Attributes != nil && r.Attributes.FileName != "" {
				coverURL = fmt.Sprintf("https://uploads.mangadex.org/covers/%s/%s.256.jpg",
					manga.ID, r.Attributes.FileName)
				break
			}
		}

		// Genre tags
		var genreTags []string
		for _, t := range attrs.Tags {
			if t.Attributes.Group == "genre" || t.Attributes.Group == "theme" {
				tagName := ""
				if isZh {
					tagName = t.Attributes.Name["zh"]
				}
				if tagName == "" {
					tagName = t.Attributes.Name["en"]
				}
				if tagName == "" {
					for _, v := range t.Attributes.Name {
						tagName = v
						break
					}
				}
				if tagName != "" {
					genreTags = append(genreTags, tagName)
				}
			}
		}

		genre := strings.Join(genreTags, ", ")
		if genre != "" {
			genre = TranslateGenre(genre, lang)
		}

		results = append(results, ComicMetadata{
			Title:       title,
			Author:      strings.Join(authors, ", "),
			Year:        attrs.Year,
			Description: desc,
			Genre:       genre,
			Language:    attrs.OriginalLanguage,
			CoverURL:    coverURL,
			Source:      "mangadex",
		})
	}
	return results
}
