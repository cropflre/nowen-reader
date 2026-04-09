package service

import (
	"encoding/json"
	"fmt"
	"log"
	"strings"
	"time"
)

// ============================================================
// AniList API (free, no key)
// ============================================================

const anilistAPI = "https://graphql.anilist.co"

func SearchAniList(query, lang string) []ComicMetadata {
	return searchAniListWithType(query, lang, "MANGA", "anilist")
}

// SearchAniListNovel searches AniList for light novels.
func SearchAniListNovel(query, lang string) []ComicMetadata {
	return searchAniListWithType(query, lang, "NOVEL", "anilist_novel")
}

func searchAniListWithType(query, lang, mediaType, sourceName string) []ComicMetadata {
	gql := fmt.Sprintf(`query ($search: String) {
		Page(page: 1, perPage: 10) {
			media(search: $search, type: %s, sort: SEARCH_MATCH) {`, mediaType) + `
				id
				title { romaji english native }
				description(asHtml: false)
				genres
				startDate { year }
				countryOfOrigin
				staff(sort: RELEVANCE, perPage: 5) {
					edges { role node { name { full } } }
				}
				coverImage { large }
				volumes
			}
		}
	}` + "}"

	body, _ := json.Marshal(map[string]interface{}{
		"query":     gql,
		"variables": map[string]string{"search": query},
	})

	resp, err := httpPostJSON(anilistAPI, body, nil, 15*time.Second)
	if err != nil {
		log.Printf("[metadata] AniList search failed: %v", err)
		return nil
	}
	defer resp.Body.Close()

	var data struct {
		Data struct {
			Page struct {
				Media []struct {
					Title struct {
						Romaji  string  `json:"romaji"`
						English *string `json:"english"`
						Native  *string `json:"native"`
					} `json:"title"`
					Description *string  `json:"description"`
					Genres      []string `json:"genres"`
					StartDate   struct {
						Year *int `json:"year"`
					} `json:"startDate"`
					CountryOfOrigin *string `json:"countryOfOrigin"`
					Staff           struct {
						Edges []struct {
							Role string `json:"role"`
							Node struct {
								Name struct {
									Full string `json:"full"`
								} `json:"name"`
							} `json:"node"`
						} `json:"edges"`
					} `json:"staff"`
					CoverImage struct {
						Large string `json:"large"`
					} `json:"coverImage"`
				} `json:"media"`
			} `json:"Page"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return nil
	}

	var results []ComicMetadata
	isZh := strings.HasPrefix(lang, "zh")

	for _, m := range data.Data.Page.Media {
		var authors []string
		for _, e := range m.Staff.Edges {
			role := strings.ToLower(e.Role)
			if strings.Contains(role, "story") || strings.Contains(role, "art") {
				authors = append(authors, e.Node.Name.Full)
			}
		}

		desc := ""
		if m.Description != nil {
			desc = stripHTML(*m.Description)
		}

		title := ""
		if isZh {
			if m.Title.Native != nil {
				title = *m.Title.Native
			}
			if title == "" {
				title = m.Title.Romaji
			}
		} else {
			if m.Title.English != nil {
				title = *m.Title.English
			}
			if title == "" {
				title = m.Title.Romaji
			}
		}

		genre := strings.Join(m.Genres, ", ")
		if genre != "" {
			genre = TranslateGenre(genre, lang)
		}

		// countryOfOrigin → language（AniList 返回的是国家代码如 "JP", "CN", "KR"）
		mediaLang := ""
		if m.CountryOfOrigin != nil {
			switch strings.ToUpper(*m.CountryOfOrigin) {
			case "JP":
				mediaLang = "ja"
			case "CN", "TW", "HK":
				mediaLang = "zh"
			case "KR":
				mediaLang = "ko"
			case "US", "GB", "AU", "CA":
				mediaLang = "en"
			case "FR":
				mediaLang = "fr"
			default:
				mediaLang = strings.ToLower(*m.CountryOfOrigin)
			}
		}

		results = append(results, ComicMetadata{
			Title:       title,
			Author:      strings.Join(authors, ", "),
			Year:        m.StartDate.Year,
			Description: desc,
			Genre:       genre,
			Language:    mediaLang,
			CoverURL:    m.CoverImage.Large,
			Source:      sourceName,
		})
	}
	return results
}
