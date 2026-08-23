package service

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
)

func TestResolveOpenAICompatibleEndpoint(t *testing.T) {
	tests := []struct {
		name     string
		rawURL   string
		endpoint string
		want     string
	}{
		{name: "base url", rawURL: "https://api.siliconflow.cn/v1", endpoint: "chat/completions", want: "https://api.siliconflow.cn/v1/chat/completions"},
		{name: "full chat endpoint is not duplicated", rawURL: "https://api.siliconflow.cn/v1/chat/completions", endpoint: "chat/completions", want: "https://api.siliconflow.cn/v1/chat/completions"},
		{name: "models derived from full chat endpoint", rawURL: "https://api.siliconflow.cn/v1/chat/completions", endpoint: "models", want: "https://api.siliconflow.cn/v1/models"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := resolveOpenAICompatibleEndpoint(tt.rawURL, tt.endpoint)
			if err != nil {
				t.Fatal(err)
			}
			if got != tt.want {
				t.Fatalf("endpoint = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestFetchOpenAICompatibleModelsFromFullChatEndpoint(t *testing.T) {
	var badPath atomic.Bool
	var badAuth atomic.Bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/models" {
			badPath.Store(true)
		}
		if r.Header.Get("Authorization") != "Bearer test-key" {
			badAuth.Store(true)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"object":"list","data":[{"id":"Qwen/Qwen3-32B"},{"id":"deepseek-ai/DeepSeek-V3.2"}]}`))
	}))
	defer server.Close()

	models, err := FetchOpenAICompatibleModels(server.URL+"/v1/chat/completions", "test-key")
	if err != nil {
		t.Fatal(err)
	}
	if badPath.Load() || badAuth.Load() {
		t.Fatalf("unexpected upstream request: badPath=%v badAuth=%v", badPath.Load(), badAuth.Load())
	}
	if len(models) != 2 {
		t.Fatalf("models len = %d, want 2", len(models))
	}
	if models[0].ID == "" || models[1].ID == "" {
		t.Fatalf("unexpected empty model id: %#v", models)
	}
}

func TestCallOpenAICompatibleAcceptsFullEndpoint(t *testing.T) {
	var badPath atomic.Bool
	var badModel atomic.Bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			badPath.Store(true)
		}
		var body map[string]interface{}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		if body["model"] != "deepseek-ai/DeepSeek-V3.2" {
			badModel.Store(true)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"OK"}}],"usage":{"prompt_tokens":2,"completion_tokens":1,"total_tokens":3}}`))
	}))
	defer server.Close()

	cfg := AIConfig{CloudAPIKey: "test-key", CloudModel: "deepseek-ai/DeepSeek-V3.2"}
	got, usage, err := callOpenAICompatible(cfg, server.URL+"/v1/chat/completions", "system", "hello", 32, 0.3, nil)
	if err != nil {
		t.Fatal(err)
	}
	if badPath.Load() || badModel.Load() {
		t.Fatalf("unexpected request: badPath=%v badModel=%v", badPath.Load(), badModel.Load())
	}
	if got != "OK" || usage.TotalTokens != 3 {
		t.Fatalf("got=%q usage=%+v", got, usage)
	}
}

func TestStreamOpenAICompatibleAcceptsFullEndpoint(t *testing.T) {
	var badPath atomic.Bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			badPath.Store(true)
		}
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"O\"}}]}\n\n"))
		_, _ = w.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"K\"}}]}\n\n"))
		_, _ = w.Write([]byte("data: [DONE]\n\n"))
	}))
	defer server.Close()

	cfg := AIConfig{CloudAPIKey: "test-key", CloudModel: "test-model"}
	var content strings.Builder
	done := false
	err := streamOpenAICompatible(cfg, server.URL+"/v1/chat/completions", "system", "hello", 32, 0.3, func(chunk StreamChunk) bool {
		content.WriteString(chunk.Content)
		if chunk.Done {
			done = true
		}
		return true
	})
	if err != nil {
		t.Fatal(err)
	}
	if badPath.Load() {
		t.Fatal("stream request duplicated /chat/completions")
	}
	if content.String() != "OK" || !done {
		t.Fatalf("stream content=%q done=%v", content.String(), done)
	}
}

func TestBadRequestIsNotRetryable(t *testing.T) {
	if isRetryableLLMError(newLLMHTTPError("OpenAI", http.StatusBadRequest, `{"code":20015}`)) {
		t.Fatal("HTTP 400 must not be retried")
	}
	if !isRetryableLLMError(newLLMHTTPError("OpenAI", http.StatusTooManyRequests, "rate limited")) {
		t.Fatal("HTTP 429 should remain retryable")
	}
	if !isRetryableLLMError(newLLMHTTPError("OpenAI", http.StatusInternalServerError, "temporary")) {
		t.Fatal("HTTP 500 should remain retryable")
	}
}

func TestCallCloudLLMDoesNotRepeatHTTP400(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"code":20015,"message":"The parameter is invalid. Please check again.","data":null}`))
	}))
	defer server.Close()

	cfg := AIConfig{
		EnableCloudAI: true,
		CloudProvider: "compatible",
		CloudAPIKey:   "test-key",
		CloudAPIURL:   server.URL + "/v1",
		CloudModel:    "test-model",
		MaxTokens:     16,
		MaxRetries:    2,
	}
	_, err := CallCloudLLM(cfg, "system", "hello", &LLMCallOptions{Scenario: "test"})
	if err == nil {
		t.Fatal("expected HTTP 400 error")
	}
	if calls.Load() != 1 {
		t.Fatalf("calls = %d, want 1", calls.Load())
	}
	if strings.Contains(err.Error(), "after 2 retries") {
		t.Fatalf("400 error should be returned directly, got %v", err)
	}
}
