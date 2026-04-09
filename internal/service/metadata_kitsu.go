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
// Kitsu API (free, no key)
// ============================================================

const kitsuAPI = "https://kitsu.io/api/edge"

func SearchKitsu(query, lang string) []ComicMetadata {
	u := fmt.Sprintf("%s/manga?filter[text]=%s&page[limit]=10", kitsuAPI, url.QueryEscape(query))

	resp, err := httpGet(u, map[string]string{
		"Accept": "application/vnd.api+json",
	}, 15*time.Second)
	if err != nil {
		log.Printf("[metadata] Kitsu search failed: %v", err)
		return nil
	}
	defer resp.Body.Close()

	var data struct {
		Data []struct {
			Attributes struct {
				CanonicalTitle string            `json:"canonicalTitle"`
				Titles         map[string]string `json:"titles"`
				Synopsis       string            `json:"synopsis"`
				StartDate      string            `json:"startDate"`
				PosterImage    *struct {
					Original string `json:"original"`
					Large    string `json:"large"`
					Medium   string `json:"medium"`
				} `json:"posterImage"`
				Serialization string `json:"serialization"`
			} `json:"attributes"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return nil
	}

	isZh := strings.HasPrefix(lang, "zh")
	var results []ComicMetadata

	for _, manga := range data.Data {
		attrs := manga.Attributes
		var year *int
		if attrs.StartDate != "" {
			parts := strings.Split(attrs.StartDate, "-")
			if len(parts) > 0 {
				var y int
				if _, err := fmt.Sscanf(parts[0], "%d", &y); err == nil && y > 0 {
					year = &y
				}
			}
		}

		title := attrs.CanonicalTitle
		if isZh {
			if t := attrs.Titles["ja_jp"]; t != "" {
				title = t
			}
		} else {
			if t := attrs.Titles["en"]; t != "" {
				title = t
			} else if t := attrs.Titles["en_jp"]; t != "" {
				title = t
			}
		}

		var coverURL string
		if attrs.PosterImage != nil {
			coverURL = attrs.PosterImage.Large
			if coverURL == "" {
				coverURL = attrs.PosterImage.Original
			}
			if coverURL == "" {
				coverURL = attrs.PosterImage.Medium
			}
		}

		results = append(results, ComicMetadata{
			Title:       title,
			Year:        year,
			Description: attrs.Synopsis,
			Publisher:   attrs.Serialization,
			CoverURL:    coverURL,
			Source:      "kitsu",
		})
	}
	return results
}
