package service

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/nowen-reader/nowen-reader/internal/config"
)

// ============================================================
// Types
// ============================================================

type EHGallery struct {
	GID       string   `json:"gid"`
	Token     string   `json:"token"`
	Title     string   `json:"title"`
	TitleJPN  string   `json:"titleJpn"`
	Category  string   `json:"category"`
	Cover     string   `json:"cover"`
	Uploader  string   `json:"uploader"`
	Tags      []string `json:"tags"`
	FileCount int      `json:"fileCount"`
	Rating    float64  `json:"rating"`
	URL       string   `json:"url"`
}

type EHGalleryDetail struct {
	EHGallery
	PageLinks     []string `json:"pageLinks"`
	TotalPageSets int      `json:"totalPageSets"`
}

type EHSearchResult struct {
	Galleries []EHGallery `json:"galleries"`
	HasNext   bool        `json:"hasNext"`
	Total     int         `json:"total"`
}

type EHApiMetadata struct {
	GID       int    `json:"gid"`
	Token     string `json:"token"`
	Title     string `json:"title"`
	TitleJPN  string `json:"title_jpn"`
	Category  string `json:"category"`
	Uploader  string `json:"uploader"`
	Tags      []string `json:"tags"`
	FileCount string `json:"filecount"`
	Rating    string `json:"rating"`
	Thumb     string `json:"thumb"`
	Posted    string `json:"posted"`
	FileSize  int64  `json:"filesize"`
}

// ============================================================
// Config
// ============================================================

type EHentaiConfig struct {
	MemberID string `json:"memberId"`
	PassHash string `json:"passHash"`
	Igneous  string `json:"igneous"`
}

func ehentaiConfigPath() string {
	return filepath.Join(config.DataDir(), "ehentai-config.json")
}

func LoadEHentaiConfig() EHentaiConfig {
	cfg := EHentaiConfig{}
	data, err := os.ReadFile(ehentaiConfigPath())
	if err != nil {
		return cfg
	}
	_ = json.Unmarshal(data, &cfg)
	return cfg
}

func SaveEHentaiConfig(cfg EHentaiConfig) error {
	dir := filepath.Dir(ehentaiConfigPath())
	os.MkdirAll(dir, 0755)
	data, _ := json.MarshalIndent(cfg, "", "  ")
	return os.WriteFile(ehentaiConfigPath(), data, 0644)
}

func EHentaiIsConfigured() bool {
	cfg := LoadEHentaiConfig()
	return cfg.MemberID != "" && cfg.PassHash != ""
}

func ehBaseURL() string {
	cfg := LoadEHentaiConfig()
	if cfg.Igneous != "" {
		return "https://exhentai.org"
	}
	return "https://e-hentai.org"
}

const ehAPIURL = "https://api.e-hentai.org/api.php"

func ehCookieString() string {
	cfg := LoadEHentaiConfig()
	var cookies []string
	if cfg.MemberID != "" {
		cookies = append(cookies, "ipb_member_id="+cfg.MemberID)
	}
	if cfg.PassHash != "" {
		cookies = append(cookies, "ipb_pass_hash="+cfg.PassHash)
	}
	if cfg.Igneous != "" {
		cookies = append(cookies, "igneous="+cfg.Igneous)
	}
	return strings.Join(cookies, "; ")
}

func ehHeaders() map[string]string {
	cookie := ehCookieString()
	headers := map[string]string{
		"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
		"Referer":    ehBaseURL() + "/",
	}
	if cookie != "" {
		headers["Cookie"] = cookie
	}
	return headers
}

// ============================================================
// Search (HTML scraping with regex since no goquery)
// ============================================================

var (
	// Match gallery links like /g/12345/abcdef12/
	ehGalleryLinkRe = regexp.MustCompile(`/g/(\d+)/([a-z0-9]+)/`)
	// Match title in glink class
	ehGlinkRe = regexp.MustCompile(`class="glink">([^<]+)<`)
	// Match image src
	ehImgSrcRe = regexp.MustCompile(`(?:src|data-src)="(https?://[^"]+\.(jpg|jpeg|png|gif|webp))"`)
	// Match total count
	ehTotalRe = regexp.MustCompile(`of\s+([\d,]+)`)
	// Simple tag extraction from HTML
	ehNextPageRe = regexp.MustCompile(`class="ptt".*?<td[^>]*><a`)
)

func EHentaiSearch(query string, page, category int) (*EHSearchResult, error) {
	base := ehBaseURL()
	params := url.Values{}
	params.Set("f_search", query)
	if page > 0 {
		params.Set("page", strconv.Itoa(page))
	}
	if category > 0 {
		params.Set("f_cats", strconv.Itoa(category))
	}

	reqURL := fmt.Sprintf("%s/?%s", base, params.Encode())

	client := &http.Client{Timeout: 15 * time.Second}
	req, err := http.NewRequest("GET", reqURL, nil)
	if err != nil {
		return nil, err
	}
	for k, v := range ehHeaders() {
		req.Header.Set(k, v)
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("E-Hentai network error: %v — URL: %s", err, base)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return nil, fmt.Errorf("E-Hentai returned HTTP %d — URL: %s", resp.StatusCode, base)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	html := string(body)

	if len(html) < 100 && !strings.Contains(html, "<html") {
		return nil, fmt.Errorf("E-Hentai returned empty/invalid response. If using ExHentai, check your cookies")
	}

	// Parse galleries using regex (simplified approach without goquery)
	galleries := parseGalleriesFromHTML(html)

	hasNext := ehNextPageRe.MatchString(html)

	totalMatch := ehTotalRe.FindStringSubmatch(html)
	total := len(galleries)
	if len(totalMatch) > 1 {
		s := strings.ReplaceAll(totalMatch[1], ",", "")
		if n, err := strconv.Atoi(s); err == nil {
			total = n
		}
	}

	return &EHSearchResult{
		Galleries: galleries,
		HasNext:   hasNext,
		Total:     total,
	}, nil
}

func parseGalleriesFromHTML(html string) []EHGallery {
	// Find all gallery links
	linkMatches := ehGalleryLinkRe.FindAllStringSubmatch(html, -1)

	// Deduplicate by gid
	seen := map[string]bool{}
	var galleries []EHGallery

	for _, m := range linkMatches {
		gid := m[1]
		token := m[2]
		if seen[gid] {
			continue
		}
		seen[gid] = true

		galleries = append(galleries, EHGallery{
			GID:   gid,
			Token: token,
			Title: fmt.Sprintf("Gallery %s", gid), // Will be enriched by API if needed
			URL:   fmt.Sprintf("%s/g/%s/%s/", ehBaseURL(), gid, token),
		})
	}

	// Try to enrich with titles from glink spans
	titleMatches := ehGlinkRe.FindAllStringSubmatch(html, -1)
	for i, m := range titleMatches {
		if i < len(galleries) && len(m) > 1 {
			galleries[i].Title = strings.TrimSpace(m[1])
		}
	}

	return galleries
}

// ============================================================
// Gallery Detail (simplified)
// ============================================================

var (
	ehPageLinkRe = regexp.MustCompile(`href="(https?://[^"]+/s/[^"]+)"`)
	ehImgIDRe    = regexp.MustCompile(`id="img"\s+src="([^"]+)"`)
)

func EHentaiGetGalleryDetail(gid, token string) (*EHGalleryDetail, error) {
	base := ehBaseURL()
	galleryURL := fmt.Sprintf("%s/g/%s/%s/", base, gid, token)

	client := &http.Client{Timeout: 15 * time.Second}
	req, err := http.NewRequest("GET", galleryURL, nil)
	if err != nil {
		return nil, err
	}
	for k, v := range ehHeaders() {
		req.Header.Set(k, v)
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	html := string(body)

	// Extract page links
	pageLinkMatches := ehPageLinkRe.FindAllStringSubmatch(html, -1)
	var pageLinks []string
	seen := map[string]bool{}
	for _, m := range pageLinkMatches {
		if !seen[m[1]] {
			pageLinks = append(pageLinks, m[1])
			seen[m[1]] = true
		}
	}

	// Extract file count
	fileCountRe := regexp.MustCompile(`of\s+(\d+)\s+images`)
	fcMatch := fileCountRe.FindStringSubmatch(html)
	fileCount := 0
	if len(fcMatch) > 1 {
		fileCount, _ = strconv.Atoi(fcMatch[1])
	}

	// Extract title
	titleRe := regexp.MustCompile(`id="gn">([^<]+)<`)
	titleMatch := titleRe.FindStringSubmatch(html)
	title := fmt.Sprintf("Gallery %s", gid)
	if len(titleMatch) > 1 {
		title = strings.TrimSpace(titleMatch[1])
	}

	titleJpnRe := regexp.MustCompile(`id="gj">([^<]+)<`)
	titleJpnMatch := titleJpnRe.FindStringSubmatch(html)
	titleJpn := ""
	if len(titleJpnMatch) > 1 {
		titleJpn = strings.TrimSpace(titleJpnMatch[1])
	}

	// Extract tags
	tagRe := regexp.MustCompile(`class="gt[lm]?"[^>]*title="([^"]+)"`)
	tagMatches := tagRe.FindAllStringSubmatch(html, -1)
	var tags []string
	for _, m := range tagMatches {
		tags = append(tags, m[1])
	}

	// Pagination detection
	paginationRe := regexp.MustCompile(`class="ptt".*?</table>`)
	paginationBlock := paginationRe.FindString(html)
	pageLinkCountRe := regexp.MustCompile(`<td[^>]*><a[^>]+>`)
	paginationLinks := pageLinkCountRe.FindAllString(paginationBlock, -1)
	totalPageSets := 1
	if len(paginationLinks) > 1 {
		totalPageSets = len(paginationLinks)
	}

	// Fetch remaining pages if >1
	if totalPageSets > 1 {
		for p := 1; p < totalPageSets; p++ {
			time.Sleep(1500 * time.Millisecond)
			pageURL := fmt.Sprintf("%s?p=%d", galleryURL, p)
			req2, err := http.NewRequest("GET", pageURL, nil)
			if err != nil {
				continue
			}
			for k, v := range ehHeaders() {
				req2.Header.Set(k, v)
			}
			resp2, err := client.Do(req2)
			if err != nil {
				continue
			}
			body2, err := io.ReadAll(resp2.Body)
			resp2.Body.Close()
			if err != nil {
				continue
			}
			pageMatches := ehPageLinkRe.FindAllStringSubmatch(string(body2), -1)
			for _, m := range pageMatches {
				if !seen[m[1]] {
					pageLinks = append(pageLinks, m[1])
					seen[m[1]] = true
				}
			}
		}
	}

	return &EHGalleryDetail{
		EHGallery: EHGallery{
			GID:       gid,
			Token:     token,
			Title:     title,
			TitleJPN:  titleJpn,
			Tags:      tags,
			FileCount: fileCount,
			URL:       galleryURL,
		},
		PageLinks:     pageLinks,
		TotalPageSets: totalPageSets,
	}, nil
}

// ============================================================
// Get Real Image URL from Page Viewer
// ============================================================

func EHentaiGetRealImageURL(pageURL string) (imageURL, filename string, err error) {
	client := &http.Client{Timeout: 15 * time.Second}
	req, err := http.NewRequest("GET", pageURL, nil)
	if err != nil {
		return "", "", err
	}
	for k, v := range ehHeaders() {
		req.Header.Set(k, v)
	}

	resp, err := client.Do(req)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", "", err
	}
	html := string(body)

	imgMatch := ehImgIDRe.FindStringSubmatch(html)
	if len(imgMatch) > 1 {
		imageURL = imgMatch[1]
	}

	filenameRe := regexp.MustCompile(`/([^/?]+)$`)
	fnMatch := filenameRe.FindStringSubmatch(imageURL)
	if len(fnMatch) > 1 {
		filename = fnMatch[1]
	} else {
		filename = fmt.Sprintf("page_%d.jpg", time.Now().UnixMilli())
	}

	return imageURL, filename, nil
}

// ============================================================
// E-Hentai JSON API for Metadata
// ============================================================

func EHentaiGetGalleryMetadata(gidTokenPairs [][2]interface{}) ([]EHApiMetadata, error) {
	reqBody, _ := json.Marshal(map[string]interface{}{
		"method":    "gdata",
		"gidlist":   gidTokenPairs,
		"namespace": 1,
	})

	client := &http.Client{Timeout: 15 * time.Second}
	req, err := http.NewRequest("POST", ehAPIURL, strings.NewReader(string(reqBody)))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	for k, v := range ehHeaders() {
		req.Header.Set(k, v)
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var data struct {
		GMetadata []EHApiMetadata `json:"gmetadata"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return nil, err
	}
	return data.GMetadata, nil
}

// ============================================================
// Proxy fetch (stream image through backend)
// ============================================================

func EHentaiFetchImage(imageURL string) (*http.Response, error) {
	client := &http.Client{Timeout: 30 * time.Second}
	req, err := http.NewRequest("GET", imageURL, nil)
	if err != nil {
		return nil, err
	}
	for k, v := range ehHeaders() {
		req.Header.Set(k, v)
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != 200 {
		resp.Body.Close()
		return nil, fmt.Errorf("failed to fetch image: %d", resp.StatusCode)
	}
	return resp, nil
}

// AllowedImageDomains is the whitelist for E-Hentai image proxy.
var AllowedImageDomains = []string{
	"ehgt.org", "exhentai.org", "e-hentai.org", "hath.network",
}

func IsAllowedImageDomain(rawURL string) bool {
	u, err := url.Parse(rawURL)
	if err != nil {
		return false
	}
	host := u.Hostname()
	for _, d := range AllowedImageDomains {
		if host == d || strings.HasSuffix(host, "."+d) {
			return true
		}
	}
	return false
}
