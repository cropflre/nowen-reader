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
// Google Books API (free, no key required for basic usage)
// ============================================================

const googleBooksAPI = "https://www.googleapis.com/books/v1/volumes"

func SearchGoogleBooks(query, lang string) []ComicMetadata {
	params := url.Values{}
	params.Set("q", query)
	params.Set("maxResults", "10")
	params.Set("printType", "books")
	if strings.HasPrefix(lang, "zh") {
		params.Set("langRestrict", "zh")
	}

	u := fmt.Sprintf("%s?%s", googleBooksAPI, params.Encode())
	resp, err := httpGet(u, map[string]string{
		"User-Agent": "NowenReader/1.0",
	}, 15*time.Second)
	if err != nil {
		log.Printf("[metadata] Google Books search failed: %v", err)
		return nil
	}
	defer resp.Body.Close()

	var data struct {
		Items []struct {
			VolumeInfo struct {
				Title         string   `json:"title"`
				Authors       []string `json:"authors"`
				Publisher     string   `json:"publisher"`
				PublishedDate string   `json:"publishedDate"`
				Description   string   `json:"description"`
				Categories    []string `json:"categories"`
				Language      string   `json:"language"`
				ImageLinks    *struct {
					Thumbnail      string `json:"thumbnail"`
					SmallThumbnail string `json:"smallThumbnail"`
				} `json:"imageLinks"`
				IndustryIdentifiers []struct {
					Type       string `json:"type"`
					Identifier string `json:"identifier"`
				} `json:"industryIdentifiers"`
			} `json:"volumeInfo"`
		} `json:"items"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return nil
	}

	var results []ComicMetadata
	for _, item := range data.Items {
		vi := item.VolumeInfo

		var year *int
		if vi.PublishedDate != "" {
			var y int
			if _, err := fmt.Sscanf(vi.PublishedDate, "%d", &y); err == nil && y > 0 {
				year = &y
			}
		}

		genre := strings.Join(vi.Categories, ", ")
		if genre != "" {
			genre = TranslateGenre(genre, lang)
		}

		var coverURL string
		if vi.ImageLinks != nil {
			coverURL = vi.ImageLinks.Thumbnail
			if coverURL == "" {
				coverURL = vi.ImageLinks.SmallThumbnail
			}
			// Google Books 返回的是 http URL，转换为 https
			if strings.HasPrefix(coverURL, "http://") {
				coverURL = "https://" + coverURL[7:]
			}
		}

		results = append(results, ComicMetadata{
			Title:       vi.Title,
			Author:      strings.Join(vi.Authors, ", "),
			Publisher:   vi.Publisher,
			Year:        year,
			Description: vi.Description,
			Genre:       genre,
			Language:    vi.Language,
			CoverURL:    coverURL,
			Source:      "googlebooks",
		})
	}
	return results
}
