package provider

import (
	"bufio"
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"mime/multipart"
	"net/http"
	"strings"
	"sync/atomic"
	"time"

	"example.com/miaoda/server/internal/config"
)

type Message struct {
	Role    string `json:"role"`
	Content any    `json:"content"`
}
type Client struct {
	cfg             config.Config
	http            *http.Client
	dashscopeCursor uint64
}

type ChatOptions struct {
	DisableThinking bool
	MaxTokens       int
	AttemptObserver func(AttemptEvent)
}

type AttemptEvent struct {
	Attempt  int
	Provider string
	Model    string
	Phase    string
	Err      error
}

func observeAttempt(options ChatOptions, event AttemptEvent) {
	if options.AttemptObserver != nil {
		options.AttemptObserver(event)
	}
}

var (
	ErrModelEmptyResponse   = errors.New("model returned an empty response")
	ErrModelOutputTruncated = errors.New("model output reached max_tokens")
)

type SolveImageOptions struct {
	Thinking       bool
	Retries        int
	AttemptTimeout time.Duration
	Validate       func(string) bool
}

func New(c config.Config) *Client {
	return &Client{cfg: c, http: &http.Client{Timeout: 90 * time.Second}}
}

func (c *Client) route(route string) (providerName, key, url, model string) {
	providerName, url, model, keys := c.routeCandidates(route)
	if len(keys) > 0 {
		key = keys[0]
	}
	return providerName, key, url, model
}

func (c *Client) routeCandidates(route string) (providerName, url, model string, keys []string) {
	p := strings.SplitN(route, ":", 2)
	providerName = "deepseek"
	model = c.cfg.DeepSeekModel
	if len(p) > 1 {
		providerName = p[0]
		model = p[1]
	} else if strings.TrimSpace(p[0]) != "" {
		// A bare route is a DeepSeek model id (for example
		// "deepseek-v4-flash"), not a provider name.
		model = p[0]
	}
	switch providerName {
	case "zhipu", "glm":
		return providerName, c.cfg.ZhipuURL, model, nonEmptyKeys(c.cfg.ZhipuKey)
	case "aliyun", "dashscope":
		keys = append([]string(nil), c.cfg.DashscopeKeys...)
		if len(keys) == 0 {
			keys = nonEmptyKeys(c.cfg.DashscopeKey)
		}
		return providerName, c.cfg.DashscopeURL, model, keys
	default:
		return providerName, c.cfg.DeepSeekURL, model, nonEmptyKeys(c.cfg.DeepSeekKey)
	}
}

func nonEmptyKeys(values ...string) []string {
	var result []string
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			result = append(result, value)
		}
	}
	return result
}
func (c *Client) Chat(ctx context.Context, messages []Message, requested string) (string, string, error) {
	return c.ChatWithOptions(ctx, messages, requested, ChatOptions{})
}
func (c *Client) ChatWithOptions(ctx context.Context, messages []Message, requested string, options ChatOptions) (string, string, error) {
	routes := strings.Split(c.cfg.AnswerModels, ",")
	if requested != "" {
		routes = []string{requested}
	}
	var last error
	attempt := 0
	for _, route := range routes {
		providerName, key, url, model := c.route(strings.TrimSpace(route))
		attempt++
		observeAttempt(options, AttemptEvent{Attempt: attempt, Provider: providerName, Model: model, Phase: "started"})
		if key == "" {
			last = errors.New("model API key is not configured")
			observeAttempt(options, AttemptEvent{Attempt: attempt, Provider: providerName, Model: model, Phase: "failed", Err: last})
			continue
		}
		text, e := c.complete(ctx, providerName, key, url, model, messages, false, nil, options)
		if e == nil {
			observeAttempt(options, AttemptEvent{Attempt: attempt, Provider: providerName, Model: model, Phase: "succeeded"})
			return text, model, nil
		}
		last = e
		observeAttempt(options, AttemptEvent{Attempt: attempt, Provider: providerName, Model: model, Phase: "failed", Err: e})
	}
	if c.cfg.AllowMock {
		attempt++
		observeAttempt(options, AttemptEvent{Attempt: attempt, Provider: "mock", Model: "mock", Phase: "started"})
		observeAttempt(options, AttemptEvent{Attempt: attempt, Provider: "mock", Model: "mock", Phase: "succeeded"})
		return "这是本地模型模拟回答，用于接口联调。", "mock", nil
	}
	return "", "", last
}
func (c *Client) Stream(ctx context.Context, messages []Message, requested string, onToken func(string) error) (string, string, error) {
	return c.StreamWithOptions(ctx, messages, requested, onToken, ChatOptions{})
}
func (c *Client) StreamWithOptions(ctx context.Context, messages []Message, requested string, onToken func(string) error, options ChatOptions) (string, string, error) {
	routes := strings.Split(c.cfg.AnswerModels, ",")
	if requested != "" {
		routes = []string{requested}
	}
	var last error
	attempt := 0
	for _, route := range routes {
		providerName, key, url, model := c.route(strings.TrimSpace(route))
		attempt++
		observeAttempt(options, AttemptEvent{Attempt: attempt, Provider: providerName, Model: model, Phase: "started"})
		if key == "" {
			last = errors.New("model API key is not configured")
			observeAttempt(options, AttemptEvent{Attempt: attempt, Provider: providerName, Model: model, Phase: "failed", Err: last})
			continue
		}
		text, e := c.complete(ctx, providerName, key, url, model, messages, true, onToken, options)
		if e == nil {
			observeAttempt(options, AttemptEvent{Attempt: attempt, Provider: providerName, Model: model, Phase: "succeeded"})
			return text, model, nil
		}
		last = e
		observeAttempt(options, AttemptEvent{Attempt: attempt, Provider: providerName, Model: model, Phase: "failed", Err: e})
	}
	if c.cfg.AllowMock {
		attempt++
		observeAttempt(options, AttemptEvent{Attempt: attempt, Provider: "mock", Model: "mock", Phase: "started"})
		v := "这是本地模型模拟回答，用于流式接口联调。"
		for _, r := range []rune(v) {
			if e := onToken(string(r)); e != nil {
				observeAttempt(options, AttemptEvent{Attempt: attempt, Provider: "mock", Model: "mock", Phase: "failed", Err: e})
				return "", "mock", e
			}
		}
		observeAttempt(options, AttemptEvent{Attempt: attempt, Provider: "mock", Model: "mock", Phase: "succeeded"})
		return v, "mock", nil
	}
	return "", "", last
}

// StreamTranslation sends a single-turn translation request to a dedicated
// DashScope translation model. Qwen-MT requires exactly one user message plus
// structured translation_options; it does not accept a system message.
func (c *Client) StreamTranslation(ctx context.Context, text, sourceLanguage, targetLanguage string, onToken func(string) error) (string, string, error) {
	routes := strings.Split(c.cfg.TranslationModels, ",")
	if strings.TrimSpace(c.cfg.TranslationModels) == "" {
		routes = []string{"aliyun:qwen-mt-lite"}
	}
	var last error
	for _, route := range routes {
		route = strings.TrimSpace(route)
		if route == "" {
			continue
		}
		providerName, url, model, keys := c.routeCandidates(route)
		if providerName != "aliyun" && providerName != "dashscope" {
			last = fmt.Errorf("translation route %q must use DashScope", route)
			continue
		}
		if len(keys) == 0 {
			last = errors.New("translation API key is not configured")
			continue
		}
		start := int(atomic.AddUint64(&c.dashscopeCursor, 1)-1) % len(keys)
		for attempt := 0; attempt < len(keys); attempt++ {
			translated, err := c.completeTranslation(
				ctx,
				keys[(start+attempt)%len(keys)],
				url,
				model,
				text,
				sourceLanguage,
				targetLanguage,
				onToken,
			)
			if err == nil {
				return translated, model, nil
			}
			last = err
		}
	}
	if c.cfg.AllowMock {
		value := "模拟中文翻译"
		for _, r := range []rune(value) {
			if err := onToken(string(r)); err != nil {
				return "", "mock-translation", err
			}
		}
		return value, "mock-translation", nil
	}
	if last == nil {
		last = errors.New("no translation model is configured")
	}
	return "", "", last
}

func (c *Client) completeTranslation(
	ctx context.Context,
	key, url, model, text, sourceLanguage, targetLanguage string,
	onToken func(string) error,
) (string, error) {
	payload := map[string]any{
		"model":    model,
		"messages": []Message{{Role: "user", Content: text}},
		"stream":   true,
		"translation_options": map[string]string{
			"source_lang": sourceLanguage,
			"target_lang": targetLanguage,
		},
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(url, "/")+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "text/event-stream")
	resp, err := c.http.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		return "", fmt.Errorf("translation upstream returned %d", resp.StatusCode)
	}

	var answer strings.Builder
	sc := bufio.NewScanner(resp.Body)
	sc.Buffer(make([]byte, 4096), 1<<20)
	for sc.Scan() {
		line := sc.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		raw := strings.TrimPrefix(line, "data: ")
		if raw == "[DONE]" {
			break
		}
		var ev struct {
			Choices []struct {
				Delta struct {
					Content string `json:"content"`
				} `json:"delta"`
			} `json:"choices"`
		}
		if json.Unmarshal([]byte(raw), &ev) != nil || len(ev.Choices) == 0 {
			continue
		}
		token := ev.Choices[0].Delta.Content
		if token == "" {
			continue
		}
		answer.WriteString(token)
		if err := onToken(token); err != nil {
			return answer.String(), err
		}
	}
	if err := sc.Err(); err != nil {
		return answer.String(), err
	}
	if strings.TrimSpace(answer.String()) == "" {
		return "", errors.New("translation model returned an empty response")
	}
	return answer.String(), nil
}

func (c *Client) complete(ctx context.Context, providerName, key, url, model string, messages []Message, stream bool, onToken func(string) error, options ChatOptions) (string, error) {
	payload := map[string]any{"model": model, "messages": messages, "stream": stream, "temperature": 0.3}
	if options.DisableThinking {
		if providerName == "aliyun" || providerName == "dashscope" {
			payload["enable_thinking"] = false
		} else {
			payload["thinking"] = map[string]string{"type": "disabled"}
		}
	}
	if options.MaxTokens > 0 {
		payload["max_tokens"] = options.MaxTokens
	}
	body, _ := json.Marshal(payload)
	req, _ := http.NewRequestWithContext(ctx, "POST", strings.TrimRight(url, "/")+"/chat/completions", bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Content-Type", "application/json")
	resp, e := c.http.Do(req)
	if e != nil {
		return "", e
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		return "", fmt.Errorf("model upstream returned %d", resp.StatusCode)
	}
	if !stream {
		var out struct {
			Choices []struct {
				Message struct {
					Content string `json:"content"`
				} `json:"message"`
				FinishReason string `json:"finish_reason"`
			} `json:"choices"`
		}
		if e = json.NewDecoder(resp.Body).Decode(&out); e != nil || len(out.Choices) == 0 {
			return "", errors.New("invalid model response")
		}
		text := out.Choices[0].Message.Content
		if e = validateModelCompletion(text, out.Choices[0].FinishReason); e != nil {
			return text, e
		}
		return text, nil
	}
	var answer strings.Builder
	finishReason := ""
	sc := bufio.NewScanner(resp.Body)
	sc.Buffer(make([]byte, 4096), 1<<20)
	for sc.Scan() {
		line := sc.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		raw := strings.TrimPrefix(line, "data: ")
		if raw == "[DONE]" {
			break
		}
		var ev struct {
			Choices []struct {
				Delta struct {
					Content string `json:"content"`
				} `json:"delta"`
				FinishReason *string `json:"finish_reason"`
			} `json:"choices"`
		}
		if json.Unmarshal([]byte(raw), &ev) == nil && len(ev.Choices) > 0 {
			if ev.Choices[0].FinishReason != nil {
				finishReason = *ev.Choices[0].FinishReason
			}
			t := ev.Choices[0].Delta.Content
			if t != "" {
				answer.WriteString(t)
				if e = onToken(t); e != nil {
					return answer.String(), e
				}
			}
		}
	}
	if e = sc.Err(); e != nil {
		return answer.String(), e
	}
	text := answer.String()
	if e = validateModelCompletion(text, finishReason); e != nil {
		return text, e
	}
	return text, nil
}

func validateModelCompletion(text, finishReason string) error {
	switch strings.TrimSpace(finishReason) {
	case "length":
		return ErrModelOutputTruncated
	case "", "stop":
		// Some OpenAI-compatible test and fallback providers omit
		// finish_reason. A non-empty response is still usable.
	default:
		return fmt.Errorf("model stopped with finish_reason=%s", finishReason)
	}
	if strings.TrimSpace(text) == "" {
		return ErrModelEmptyResponse
	}
	return nil
}
func (c *Client) Vision(ctx context.Context, image []byte, mime, route string) (string, string, error) {
	providerName, key, url, model := c.route(route)
	if key == "" {
		if c.cfg.AllowMock {
			return "模拟图片题目", "mock-vision", nil
		}
		return "", "", errors.New("vision API key is not configured")
	}
	data := "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(image)
	messages := []Message{{"user", []map[string]any{{"type": "text", "text": "完整识别图片中的题目正文，只输出题目内容。"}, {"type": "image_url", "image_url": map[string]string{"url": data}}}}}
	text, e := c.complete(ctx, providerName, key, url, model, messages, false, nil, ChatOptions{})
	return text, model, e
}

// SolveImage sends a screenshot and the complete solving prompt to one
// multimodal model. Each route gets the configured initial attempt plus the
// requested retries. Multiple DashScope keys are rotated between attempts;
// only after those attempts fail does the next model route run.
func (c *Client) SolveImage(ctx context.Context, image []byte, mime string, routes []string, prompt string, options SolveImageOptions) (string, string, error) {
	attempts := options.Retries + 1
	if attempts < 1 {
		attempts = 1
	}
	var last error
	for _, route := range routes {
		route = strings.TrimSpace(route)
		if route == "" {
			continue
		}
		providerName, url, model, keys := c.routeCandidates(route)
		if len(keys) == 0 {
			last = fmt.Errorf("%s API key is not configured", providerName)
			continue
		}
		start := 0
		if len(keys) > 1 && (providerName == "aliyun" || providerName == "dashscope") {
			start = int(atomic.AddUint64(&c.dashscopeCursor, 1)-1) % len(keys)
		}
		for attempt := 0; attempt < attempts; attempt++ {
			if err := ctx.Err(); err != nil {
				return "", "", err
			}
			key := keys[(start+attempt)%len(keys)]
			attemptCtx := ctx
			cancel := func() {}
			if options.AttemptTimeout > 0 {
				attemptCtx, cancel = context.WithTimeout(ctx, options.AttemptTimeout)
			}
			text, err := c.completeImage(attemptCtx, providerName, key, url, model, image, mime, prompt, options.Thinking)
			cancel()
			if err == nil && options.Validate != nil && !options.Validate(text) {
				err = errors.New("model returned an invalid structured answer")
			}
			if err == nil {
				return text, model, nil
			}
			last = fmt.Errorf("%s attempt %d failed: %w", model, attempt+1, err)
		}
	}
	if c.cfg.AllowMock {
		return "<<<QUESTION>>>\n模拟图片题目\n<<<ANSWER>>>\n模拟图片答案", "mock-written-solver", nil
	}
	if last == nil {
		last = errors.New("no written solver model is configured")
	}
	return "", "", last
}

func (c *Client) completeImage(ctx context.Context, providerName, key, url, model string, image []byte, mime, prompt string, thinking bool) (string, error) {
	data := "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(image)
	messages := []Message{{Role: "user", Content: []map[string]any{
		{"type": "text", "text": prompt},
		{"type": "image_url", "image_url": map[string]string{"url": data}},
	}}}
	payload := map[string]any{"model": model, "messages": messages, "stream": false, "temperature": 0}
	if providerName == "aliyun" || providerName == "dashscope" {
		payload["enable_thinking"] = thinking
	}
	body, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(url, "/")+"/chat/completions", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Authorization", "Bearer "+key)
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.http.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		return "", fmt.Errorf("model upstream returned %d", resp.StatusCode)
	}
	var out struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err = json.NewDecoder(resp.Body).Decode(&out); err != nil || len(out.Choices) == 0 {
		return "", errors.New("invalid model response")
	}
	text := strings.TrimSpace(out.Choices[0].Message.Content)
	if text == "" {
		return "", errors.New("model returned an empty answer")
	}
	return text, nil
}

func (c *Client) Transcribe(ctx context.Context, audio []byte, filename, mime, language string) (string, string, error) {
	if len(audio) == 0 {
		return "", "", errors.New("audio is empty")
	}
	if c.cfg.ZhipuKey == "" {
		if c.cfg.AllowMock {
			return "mock ASR transcript", "mock-glm-asr", nil
		}
		return "", "", errors.New("ZHIPU_API_KEY is not configured")
	}
	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	if filename == "" {
		filename = "audio.wav"
	}
	f, err := w.CreateFormFile("file", filename)
	if err != nil {
		return "", "", err
	}
	if _, err = f.Write(audio); err != nil {
		return "", "", err
	}
	_ = w.WriteField("model", c.cfg.ZhipuASRModel)
	if language != "" {
		_ = w.WriteField("language", language)
	}
	_ = w.WriteField("prompt", "Transcribe in Chinese context and keep common technical terms such as CPU, API, HTTP, JVM, Redis and MySQL.")
	if err = w.Close(); err != nil {
		return "", "", err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(c.cfg.ZhipuAudioURL, "/")+"/audio/transcriptions", &body)
	if err != nil {
		return "", "", err
	}
	req.Header.Set("Authorization", "Bearer "+c.cfg.ZhipuKey)
	req.Header.Set("Content-Type", w.FormDataContentType())
	if mime != "" {
		req.Header.Set("X-Upload-Content-Type", mime)
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		return "", "", fmt.Errorf("ASR upstream returned %d", resp.StatusCode)
	}
	var out struct {
		Text string `json:"text"`
	}
	if err = json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return "", "", err
	}
	if strings.TrimSpace(out.Text) == "" {
		return "", "", errors.New("empty transcript")
	}
	return out.Text, c.cfg.ZhipuASRModel, nil
}
