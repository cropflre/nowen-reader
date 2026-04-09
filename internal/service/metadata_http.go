package service

import (
	"fmt"
	"log"
	"math"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
)

func retryAfterFromHeader(resp *http.Response, fallback time.Duration) time.Duration {
	if ra := resp.Header.Get("Retry-After"); ra != "" {
		if secs, err := strconv.Atoi(ra); err == nil && secs > 0 {
			d := time.Duration(secs) * time.Second
			if d > 60*time.Second {
				d = 60 * time.Second // 最多等 60s
			}
			return d
		}
	}
	return fallback
}

func httpGet(rawURL string, headers map[string]string, timeout time.Duration) (*http.Response, error) {
	client := &http.Client{Timeout: timeout}

	for attempt := 0; attempt <= maxRetries429; attempt++ {
		req, err := http.NewRequest("GET", rawURL, nil)
		if err != nil {
			return nil, err
		}
		for k, v := range headers {
			req.Header.Set(k, v)
		}

		resp, err := client.Do(req)
		if err != nil {
			return nil, err
		}

		// 429 限流：指数退避重试
		if resp.StatusCode == http.StatusTooManyRequests && attempt < maxRetries429 {
			resp.Body.Close()
			backoff := retryAfterFromHeader(resp, time.Duration(math.Pow(2, float64(attempt+1)))*time.Second)
			log.Printf("[metadata] HTTP 429 on GET %s, retry %d/%d after %v", rawURL, attempt+1, maxRetries429, backoff)
			time.Sleep(backoff)
			continue
		}

		if resp.StatusCode >= 400 {
			resp.Body.Close()
			return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
		}
		return resp, nil
	}
	return nil, fmt.Errorf("HTTP 429: rate limited after %d retries", maxRetries429)
}

func httpPostJSON(rawURL string, body []byte, headers map[string]string, timeout time.Duration) (*http.Response, error) {
	client := &http.Client{Timeout: timeout}

	for attempt := 0; attempt <= maxRetries429; attempt++ {
		req, err := http.NewRequest("POST", rawURL, strings.NewReader(string(body)))
		if err != nil {
			return nil, err
		}
		req.Header.Set("Content-Type", "application/json")
		for k, v := range headers {
			req.Header.Set(k, v)
		}

		resp, err := client.Do(req)
		if err != nil {
			return nil, err
		}

		// 429 限流：指数退避重试
		if resp.StatusCode == http.StatusTooManyRequests && attempt < maxRetries429 {
			resp.Body.Close()
			backoff := retryAfterFromHeader(resp, time.Duration(math.Pow(2, float64(attempt+1)))*time.Second)
			log.Printf("[metadata] HTTP 429 on POST %s, retry %d/%d after %v", rawURL, attempt+1, maxRetries429, backoff)
			time.Sleep(backoff)
			continue
		}

		if resp.StatusCode >= 400 {
			resp.Body.Close()
			return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
		}
		return resp, nil
	}
	return nil, fmt.Errorf("HTTP 429: rate limited after %d retries", maxRetries429)
}

// ============================================================
// Utility
// ============================================================

var htmlTagRe = regexp.MustCompile(`<[^>]+>`)

func stripHTML(s string) string {
	s = htmlTagRe.ReplaceAllString(s, "")
	s = strings.ReplaceAll(s, "\n\n\n", "\n")
	return strings.TrimSpace(s)
}

func pickLangValue(m map[string]string, lang string) string {
	isZh := strings.HasPrefix(lang, "zh")
	if isZh {
		if v := m["zh"]; v != "" {
			return v
		}
		if v := m["zh-hk"]; v != "" {
			return v
		}
	}
	if v := m["en"]; v != "" {
		return v
	}
	if v := m["ja"]; v != "" {
		return v
	}
	for _, v := range m {
		return v
	}
	return ""
}
