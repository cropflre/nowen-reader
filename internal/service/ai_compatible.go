package service

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"
)

// OpenAICompatibleModel is the normalized model option returned by an
// OpenAI-compatible /models endpoint.
type OpenAICompatibleModel struct {
	ID   string `json:"id"`
	Name string `json:"name,omitempty"`
}

type llmHTTPError struct {
	Provider   string
	StatusCode int
	Body       string
}

func (e *llmHTTPError) Error() string {
	provider := strings.TrimSpace(e.Provider)
	if provider == "" {
		provider = "LLM"
	}
	return fmt.Sprintf("%s API error %d: %s", provider, e.StatusCode, e.Body)
}

func newLLMHTTPError(provider string, statusCode int, body string) error {
	body = strings.TrimSpace(body)
	if len(body) > 500 {
		body = body[:500]
	}
	return &llmHTTPError{Provider: provider, StatusCode: statusCode, Body: body}
}

// isRetryableLLMError prevents deterministic 4xx configuration/request errors
// from being retried unchanged. Transient statuses such as 408/425/429 and 5xx
// still use the caller's exponential-backoff retry policy.
func isRetryableLLMError(err error) bool {
	if err == nil {
		return false
	}

	var httpErr *llmHTTPError
	if errors.As(err, &httpErr) {
		if httpErr.StatusCode >= 500 {
			return true
		}
		switch httpErr.StatusCode {
		case http.StatusRequestTimeout, http.StatusTooEarly, http.StatusTooManyRequests:
			return true
		default:
			return false
		}
	}

	errStr := strings.ToLower(err.Error())
	if strings.Contains(errStr, "invalid_api_key") ||
		strings.Contains(errStr, "not configured") ||
		strings.Contains(errStr, "does not support vision") {
		return false
	}
	return true
}

// resolveOpenAICompatibleEndpoint accepts either a base URL such as
// https://api.example.com/v1 or a full endpoint such as
// https://api.example.com/v1/chat/completions. This is important for custom
// providers whose documentation often shows the full endpoint for copy/paste.
func resolveOpenAICompatibleEndpoint(rawURL, endpoint string) (string, error) {
	rawURL = strings.TrimSpace(rawURL)
	if rawURL == "" {
		return "", fmt.Errorf("OpenAI-compatible API URL is empty")
	}

	u, err := url.Parse(rawURL)
	if err != nil {
		return "", fmt.Errorf("invalid OpenAI-compatible API URL: %w", err)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return "", fmt.Errorf("invalid OpenAI-compatible API URL scheme: %q", u.Scheme)
	}
	if u.Host == "" {
		return "", fmt.Errorf("invalid OpenAI-compatible API URL: missing host")
	}

	cleanPath := strings.TrimRight(u.Path, "/")
	for _, suffix := range []string{"/chat/completions", "/models"} {
		if strings.HasSuffix(cleanPath, suffix) {
			cleanPath = strings.TrimSuffix(cleanPath, suffix)
			break
		}
	}

	endpoint = strings.Trim(endpoint, "/")
	if endpoint == "" {
		return "", fmt.Errorf("OpenAI-compatible endpoint is empty")
	}
	u.Path = cleanPath + "/" + endpoint
	u.RawPath = ""
	u.Fragment = ""
	return u.String(), nil
}

// FetchOpenAICompatibleModels queries the provider's OpenAI-compatible /models
// endpoint. Custom-provider users can therefore select an exact upstream model
// ID instead of guessing it manually.
func FetchOpenAICompatibleModels(apiURL, apiKey string) ([]OpenAICompatibleModel, error) {
	reqURL, err := resolveOpenAICompatibleEndpoint(apiURL, "models")
	if err != nil {
		return nil, err
	}

	req, err := http.NewRequest(http.MethodGet, reqURL, nil)
	if err != nil {
		return nil, fmt.Errorf("build OpenAI-compatible models request: %w", err)
	}
	if strings.TrimSpace(apiKey) != "" {
		req.Header.Set("Authorization", "Bearer "+apiKey)
	}
	req.Header.Set("Accept", "application/json")

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("read OpenAI-compatible models response: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, newLLMHTTPError("OpenAI-compatible models", resp.StatusCode, string(respBody))
	}

	var payload struct {
		Data []struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"data"`
		Models []json.RawMessage `json:"models"`
	}
	if err := json.Unmarshal(respBody, &payload); err != nil {
		return nil, fmt.Errorf("parse OpenAI-compatible models response: %w", err)
	}

	models := make([]OpenAICompatibleModel, 0, len(payload.Data)+len(payload.Models))
	seen := make(map[string]struct{})
	appendModel := func(id, name string) {
		id = strings.TrimSpace(id)
		if id == "" {
			return
		}
		if _, ok := seen[id]; ok {
			return
		}
		seen[id] = struct{}{}
		models = append(models, OpenAICompatibleModel{ID: id, Name: strings.TrimSpace(name)})
	}

	for _, item := range payload.Data {
		appendModel(item.ID, item.Name)
	}
	for _, raw := range payload.Models {
		var id string
		if err := json.Unmarshal(raw, &id); err == nil {
			appendModel(id, "")
			continue
		}
		var item struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		}
		if err := json.Unmarshal(raw, &item); err == nil {
			appendModel(item.ID, item.Name)
		}
	}

	sort.Slice(models, func(i, j int) bool {
		return strings.ToLower(models[i].ID) < strings.ToLower(models[j].ID)
	})
	return models, nil
}
