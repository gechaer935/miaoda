package provider

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"example.com/miaoda/server/internal/config"
)

func structuredAnswer(text string) bool {
	return strings.Contains(text, "<<<QUESTION>>>") && strings.Contains(text, "<<<ANSWER>>>")
}

func TestChatOptionsSendsMaxTokensAndDisablesThinking(t *testing.T) {
	var gotMaxTokens int
	var gotThinking map[string]string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload struct {
			MaxTokens int               `json:"max_tokens"`
			Thinking  map[string]string `json:"thinking"`
		}
		_ = json.NewDecoder(r.Body).Decode(&payload)
		gotMaxTokens = payload.MaxTokens
		gotThinking = payload.Thinking
		_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]string{"content": "简短回答"}}}})
	}))
	defer server.Close()

	client := New(config.Config{DeepSeekURL: server.URL, DeepSeekKey: "key", DeepSeekModel: "model"})
	if _, _, err := client.ChatWithOptions(context.Background(), []Message{{Role: "user", Content: "问题"}}, "model", ChatOptions{DisableThinking: true, MaxTokens: 1000}); err != nil {
		t.Fatal(err)
	}
	if gotMaxTokens != 1000 {
		t.Fatalf("expected max_tokens 1000, got %d", gotMaxTokens)
	}
	if gotThinking["type"] != "disabled" {
		t.Fatalf("expected thinking to be disabled, got %#v", gotThinking)
	}
}

func TestChatFallsBackToQwenAndDisablesDashscopeThinking(t *testing.T) {
	var deepseekCalls int
	deepseek := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		deepseekCalls++
		http.Error(w, "temporarily unavailable", http.StatusServiceUnavailable)
	}))
	defer deepseek.Close()

	var gotModel string
	var gotEnableThinking *bool
	var gotDeepseekThinking map[string]string
	qwen := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload struct {
			Model          string            `json:"model"`
			EnableThinking *bool             `json:"enable_thinking"`
			Thinking       map[string]string `json:"thinking"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("decode Qwen payload: %v", err)
		}
		gotModel = payload.Model
		gotEnableThinking = payload.EnableThinking
		gotDeepseekThinking = payload.Thinking
		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []any{map[string]any{
				"message":       map[string]string{"content": "Qwen backup answer"},
				"finish_reason": "stop",
			}},
		})
	}))
	defer qwen.Close()

	client := New(config.Config{
		DeepSeekURL:  deepseek.URL,
		DeepSeekKey:  "deepseek-key",
		DashscopeURL: qwen.URL,
		DashscopeKey: "qwen-key",
		AnswerModels: "deepseek:deepseek-v4-flash,deepseek:deepseek-v4-pro,aliyun:qwen3.7-plus",
	})
	var events []AttemptEvent
	answer, model, err := client.ChatWithOptions(
		context.Background(),
		[]Message{{Role: "user", Content: "question"}},
		"",
		ChatOptions{DisableThinking: true, MaxTokens: 1000, AttemptObserver: func(event AttemptEvent) {
			events = append(events, event)
		}},
	)
	if err != nil {
		t.Fatal(err)
	}
	if deepseekCalls != 2 {
		t.Fatalf("expected Flash and Pro attempts before Qwen, got %d DeepSeek calls", deepseekCalls)
	}
	if answer != "Qwen backup answer" || model != "qwen3.7-plus" || gotModel != "qwen3.7-plus" {
		t.Fatalf("unexpected fallback result answer=%q model=%q payloadModel=%q", answer, model, gotModel)
	}
	if gotEnableThinking == nil || *gotEnableThinking {
		t.Fatalf("expected enable_thinking=false for Qwen interview answers, got %#v", gotEnableThinking)
	}
	if gotDeepseekThinking != nil {
		t.Fatalf("Qwen request must not receive DeepSeek thinking payload: %#v", gotDeepseekThinking)
	}
	wantEvents := []struct{ model, phase string }{
		{"deepseek-v4-flash", "started"}, {"deepseek-v4-flash", "failed"},
		{"deepseek-v4-pro", "started"}, {"deepseek-v4-pro", "failed"},
		{"qwen3.7-plus", "started"}, {"qwen3.7-plus", "succeeded"},
	}
	if len(events) != len(wantEvents) {
		t.Fatalf("attempt observer events=%#v", events)
	}
	for index, want := range wantEvents {
		if events[index].Model != want.model || events[index].Phase != want.phase || events[index].Attempt != index/2+1 {
			t.Fatalf("event %d=%#v want model=%s phase=%s", index, events[index], want.model, want.phase)
		}
	}
}

func TestStreamWithOptionsRejectsLengthFinishReason(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"半段回答\"},\"finish_reason\":null}]}\n\n"))
		_, _ = w.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"\"},\"finish_reason\":\"length\"}]}\n\n"))
		_, _ = w.Write([]byte("data: [DONE]\n\n"))
	}))
	defer server.Close()

	client := New(config.Config{DeepSeekURL: server.URL, DeepSeekKey: "key", DeepSeekModel: "model"})
	var streamed strings.Builder
	_, _, err := client.StreamWithOptions(
		context.Background(),
		[]Message{{Role: "user", Content: "问题"}},
		"model",
		func(token string) error {
			streamed.WriteString(token)
			return nil
		},
		ChatOptions{DisableThinking: true, MaxTokens: 1000},
	)
	if !errors.Is(err, ErrModelOutputTruncated) {
		t.Fatalf("expected ErrModelOutputTruncated, got %v", err)
	}
	if streamed.String() != "半段回答" {
		t.Fatalf("expected partial tokens to stream before retry, got %q", streamed.String())
	}
}

func TestStreamWithOptionsRejectsEmptyResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"\"},\"finish_reason\":\"stop\"}]}\n\n"))
		_, _ = w.Write([]byte("data: [DONE]\n\n"))
	}))
	defer server.Close()

	client := New(config.Config{DeepSeekURL: server.URL, DeepSeekKey: "key", DeepSeekModel: "model"})
	_, _, err := client.StreamWithOptions(
		context.Background(),
		[]Message{{Role: "user", Content: "问题"}},
		"model",
		func(string) error { return nil },
		ChatOptions{DisableThinking: true, MaxTokens: 1000},
	)
	if !errors.Is(err, ErrModelEmptyResponse) {
		t.Fatalf("expected ErrModelEmptyResponse, got %v", err)
	}
}

func TestStreamTranslationUsesDedicatedQwenMTRequest(t *testing.T) {
	var payload struct {
		Model              string    `json:"model"`
		Messages           []Message `json:"messages"`
		Stream             bool      `json:"stream"`
		TranslationOptions struct {
			SourceLanguage string `json:"source_lang"`
			TargetLanguage string `json:"target_lang"`
		} `json:"translation_options"`
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer translation-key" {
			t.Errorf("unexpected authorization header %q", got)
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Errorf("decode payload: %v", err)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		_, _ = w.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"中文\"}}]}\n\n"))
		_, _ = w.Write([]byte("data: {\"choices\":[{\"delta\":{\"content\":\"译文\"}}]}\n\n"))
		_, _ = w.Write([]byte("data: [DONE]\n\n"))
	}))
	defer server.Close()

	client := New(config.Config{
		DashscopeURL:      server.URL,
		DashscopeKey:      "translation-key",
		DashscopeKeys:     []string{"translation-key"},
		TranslationModels: "aliyun:qwen-mt-lite",
	})
	var streamed strings.Builder
	text, model, err := client.StreamTranslation(
		context.Background(),
		"Explain a B+ tree.",
		"English",
		"Chinese",
		func(token string) error {
			streamed.WriteString(token)
			return nil
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if model != "qwen-mt-lite" || text != "中文译文" || streamed.String() != text {
		t.Fatalf("unexpected translation model=%q text=%q streamed=%q", model, text, streamed.String())
	}
	if payload.Model != "qwen-mt-lite" || !payload.Stream {
		t.Fatalf("unexpected model or stream flag: %#v", payload)
	}
	if len(payload.Messages) != 1 || payload.Messages[0].Role != "user" || payload.Messages[0].Content != "Explain a B+ tree." {
		t.Fatalf("Qwen-MT must receive exactly one user message: %#v", payload.Messages)
	}
	if payload.TranslationOptions.SourceLanguage != "English" || payload.TranslationOptions.TargetLanguage != "Chinese" {
		t.Fatalf("unexpected translation options: %#v", payload.TranslationOptions)
	}
}

func TestSolveImageRetriesWithSecondDashscopeKey(t *testing.T) {
	var mu sync.Mutex
	var authorizations []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		authorizations = append(authorizations, r.Header.Get("Authorization"))
		attempt := len(authorizations)
		mu.Unlock()
		if attempt == 1 {
			http.Error(w, "rate limited", http.StatusTooManyRequests)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]string{"content": "<<<QUESTION>>>\n题目\n<<<ANSWER>>>\n答案"}}}})
	}))
	defer server.Close()

	client := New(config.Config{
		DashscopeURL:  server.URL,
		DashscopeKey:  "key-a",
		DashscopeKeys: []string{"key-a", "key-b"},
	})
	text, model, err := client.SolveImage(context.Background(), []byte("png"), "image/png", []string{"aliyun:qwen3.7-plus"}, "solve", SolveImageOptions{Retries: 1, Validate: structuredAnswer})
	if err != nil {
		t.Fatal(err)
	}
	if model != "qwen3.7-plus" || !structuredAnswer(text) {
		t.Fatalf("unexpected result model=%q text=%q", model, text)
	}
	if len(authorizations) != 2 || authorizations[0] != "Bearer key-a" || authorizations[1] != "Bearer key-b" {
		t.Fatalf("expected key failover, got %#v", authorizations)
	}
}

func TestSolveImageKeepsThinkingEnabledForWrittenAnswers(t *testing.T) {
	var gotThinking bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload struct {
			EnableThinking bool `json:"enable_thinking"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Errorf("decode payload: %v", err)
			return
		}
		gotThinking = payload.EnableThinking
		_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]string{
			"content": "<<<QUESTION>>>\n题目\n<<<ANSWER>>>\n答案",
		}}}})
	}))
	defer server.Close()

	client := New(config.Config{
		DashscopeURL:  server.URL,
		DashscopeKey:  "key",
		DashscopeKeys: []string{"key"},
	})
	_, _, err := client.SolveImage(
		context.Background(),
		[]byte("png"),
		"image/png",
		[]string{"aliyun:qwen3.7-plus"},
		"solve",
		SolveImageOptions{Thinking: true, Validate: structuredAnswer},
	)
	if err != nil {
		t.Fatal(err)
	}
	if !gotThinking {
		t.Fatal("expected written-answer thinking to remain enabled")
	}
}

func TestSolveImageFallsBackAfterInvalidPrimaryResponses(t *testing.T) {
	var mu sync.Mutex
	var models []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload struct {
			Model string `json:"model"`
		}
		_ = json.NewDecoder(r.Body).Decode(&payload)
		mu.Lock()
		models = append(models, payload.Model)
		mu.Unlock()
		content := "invalid"
		if payload.Model == "qwen3.6-plus" {
			content = "<<<QUESTION>>>\n题目\n<<<ANSWER>>>\n答案"
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]string{"content": content}}}})
	}))
	defer server.Close()

	client := New(config.Config{
		DashscopeURL:  server.URL,
		DashscopeKey:  "key-a",
		DashscopeKeys: []string{"key-a", "key-b"},
	})
	_, model, err := client.SolveImage(context.Background(), []byte("png"), "image/png", []string{"aliyun:qwen3.7-plus", "aliyun:qwen3.6-plus"}, "solve", SolveImageOptions{Retries: 1, Validate: structuredAnswer})
	if err != nil {
		t.Fatal(err)
	}
	if model != "qwen3.6-plus" {
		t.Fatalf("expected fallback model, got %q", model)
	}
	if len(models) != 3 || models[0] != "qwen3.7-plus" || models[1] != "qwen3.7-plus" || models[2] != "qwen3.6-plus" {
		t.Fatalf("unexpected model attempts: %#v", models)
	}
}

func TestSolveImageRetriesAfterAttemptTimeout(t *testing.T) {
	var mu sync.Mutex
	var authorizations []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		authorizations = append(authorizations, r.Header.Get("Authorization"))
		attempt := len(authorizations)
		mu.Unlock()
		if attempt == 1 {
			time.Sleep(100 * time.Millisecond)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]string{"content": "<<<QUESTION>>>\nquestion\n<<<ANSWER>>>\nanswer"}}}})
	}))
	defer server.Close()

	client := New(config.Config{
		DashscopeURL:  server.URL,
		DashscopeKey:  "key-a",
		DashscopeKeys: []string{"key-a", "key-b"},
	})
	_, _, err := client.SolveImage(context.Background(), []byte("png"), "image/png", []string{"aliyun:qwen3.7-plus"}, "solve", SolveImageOptions{
		Retries:        1,
		AttemptTimeout: 20 * time.Millisecond,
		Validate:       structuredAnswer,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(authorizations) != 2 || authorizations[0] != "Bearer key-a" || authorizations[1] != "Bearer key-b" {
		t.Fatalf("expected timeout failover, got %#v", authorizations)
	}
}
