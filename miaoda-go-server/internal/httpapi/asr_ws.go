package httpapi

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
	store "example.com/miaoda/server/internal/store/sqlite"
)

var allowedASRModels = map[string]bool{"paraformer-realtime-v2": true, "fun-asr-realtime": true, "qwen3-asr-flash-realtime": true}

func (s *Server) asrWSAuth(w http.ResponseWriter, r *http.Request) {
	s.auth(http.HandlerFunc(s.asrWS)).ServeHTTP(w, r)
}

func (s *Server) asrWS(w http.ResponseWriter, r *http.Request) {
	a := authOf(r)
	if !s.allowPaidRequest(w, r, "interview-asr-ws", 12, time.Minute) {
		return
	}
	if _, err := s.store.RequireInterviewQuota(r.Context(), a); err != nil {
		if err.Error() == "interview_quota_exhausted" {
			fail(w, http.StatusPaymentRequired, "interview_quota_exhausted", "面试时间已用完，请先兑换卡密")
			return
		}
		fail(w, http.StatusForbidden, "account_unavailable", "当前账号暂时不可用")
		return
	}
	model := strings.TrimSpace(r.URL.Query().Get("model"))
	if model == "" {
		model = s.cfg.AliyunASRModel
	}
	if !allowedASRModels[model] {
		fail(w, 400, "invalid_asr_model", "Unsupported ASR model: "+model)
		return
	}
	language := normalizeASRLanguage(r.URL.Query().Get("language"))
	sampleRate, _ := strconv.Atoi(r.URL.Query().Get("sampleRate"))
	if sampleRate <= 0 {
		sampleRate = 16000
	}
	if o := r.Header.Get("Origin"); o != "" && !originOK(s.cfg.AllowOrigin, o) {
		fail(w, 403, "origin_forbidden", "Origin is not allowed")
		return
	}
	client, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
	if err != nil {
		return
	}
	defer client.Close(websocket.StatusNormalClosure, "closed")
	client.SetReadLimit(1 << 20)
	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	var clientMu sync.Mutex
	if _, card, err := s.store.Heartbeat(ctx, a, false); err != nil || card.RemainingInterviewSeconds <= 0 {
		_ = writeWSJSON(ctx, client, map[string]any{"type": "error", "code": "interview_quota_exhausted", "message": "面试时间已用完，请先兑换卡密", "model": model})
		return
	}
	if s.cfg.DashscopeKey == "" {
		if s.cfg.AllowMock {
			go s.meterInterviewWebSocket(ctx, cancel, client, &clientMu, a, model)
			s.mockASRWS(ctx, client, &clientMu, model)
			return
		}
		_ = writeWSJSON(ctx, client, map[string]any{"type": "error", "message": "Speech recognition is temporarily unavailable", "model": model})
		return
	}
	upstreamURL := s.cfg.AliyunASRURL
	qwen := model == "qwen3-asr-flash-realtime"
	if qwen {
		upstreamURL = strings.TrimSuffix(strings.TrimSuffix(upstreamURL, "/"), "/inference")
		if !strings.HasSuffix(upstreamURL, "/realtime") {
			upstreamURL += "/realtime"
		}
		u, e := url.Parse(upstreamURL)
		if e != nil {
			return
		}
		q := u.Query()
		q.Set("model", model)
		u.RawQuery = q.Encode()
		upstreamURL = u.String()
	}
	headers := http.Header{}
	if qwen {
		headers.Set("Authorization", "Bearer "+s.cfg.DashscopeKey)
		headers.Set("OpenAI-Beta", "realtime=v1")
	} else {
		headers.Set("Authorization", "bearer "+s.cfg.DashscopeKey)
	}
	upstream, resp, err := websocket.Dial(ctx, upstreamURL, &websocket.DialOptions{HTTPHeader: headers})
	if err != nil {
		message := "Speech recognition is temporarily unavailable"
		if resp != nil {
			slog.Warn("ASR upstream connection failed", "status", resp.StatusCode, "error", err)
		} else {
			slog.Warn("ASR upstream connection failed", "error", err)
		}
		_ = writeWSJSON(ctx, client, map[string]any{"type": "error", "message": message, "model": model})
		return
	}
	defer upstream.Close(websocket.StatusNormalClosure, "client closed")
	upstream.SetReadLimit(1 << 20)
	taskID := ""
	if qwen {
		err = writeWSJSON(ctx, upstream, qwenSessionUpdate(language, sampleRate, s.cfg.AliyunASRMaxSilenceMS))
	} else {
		taskID = randomHex(16)
		err = writeWSJSON(ctx, upstream, paraformerStart(taskID, model, language, sampleRate, s.cfg.AliyunASRMaxSilenceMS))
	}
	if err != nil {
		return
	}
	go s.meterInterviewWebSocket(ctx, cancel, client, &clientMu, a, model)
	seenFinalSegments := make(map[string]struct{})
	done := make(chan error, 1)
	go func() {
		for {
			typ, raw, e := upstream.Read(ctx)
			if e != nil {
				done <- e
				return
			}
			if typ != websocket.MessageText {
				continue
			}
			events := translateASREvent(raw, model, language)
			for _, ev := range events {
				if ev["type"] == "final" {
					segmentID := strings.TrimSpace(fmt.Sprint(ev["segmentId"]))
					if segmentID != "" && segmentID != "<nil>" {
						if _, duplicate := seenFinalSegments[segmentID]; duplicate {
							continue
						}
						seenFinalSegments[segmentID] = struct{}{}
					}
				}
				clientMu.Lock()
				e = writeWSJSON(ctx, client, ev)
				clientMu.Unlock()
				if e != nil {
					done <- e
					return
				}
			}
		}
	}()
	for {
		select {
		case <-done:
			return
		default:
		}
		typ, raw, e := client.Read(ctx)
		if e != nil {
			return
		}
		if typ == websocket.MessageBinary {
			if qwen {
				e = writeWSJSON(ctx, upstream, map[string]any{"event_id": "event_" + randomHex(16), "type": "input_audio_buffer.append", "audio": base64.StdEncoding.EncodeToString(raw)})
			} else {
				e = upstream.Write(ctx, websocket.MessageBinary, raw)
			}
			if e != nil {
				return
			}
			continue
		}
		var msg struct {
			Type string `json:"type"`
		}
		if json.Unmarshal(raw, &msg) != nil || msg.Type != "finish" {
			continue
		}
		if qwen {
			_ = writeWSJSON(ctx, upstream, map[string]any{"event_id": "event_" + randomHex(16), "type": "input_audio_buffer.commit"})
			_ = writeWSJSON(ctx, upstream, map[string]any{"event_id": "event_" + randomHex(16), "type": "session.finish"})
		} else {
			_ = writeWSJSON(ctx, upstream, paraformerFinish(taskID))
		}
	}
}

func (s *Server) meterInterviewWebSocket(ctx context.Context, cancel context.CancelFunc, client *websocket.Conn, clientMu *sync.Mutex, a store.Auth, model string) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			_, card, err := s.store.Heartbeat(ctx, a, true)
			if err == nil && card.RemainingInterviewSeconds > 0 {
				continue
			}
			writeCtx, stopWrite := context.WithTimeout(context.Background(), 2*time.Second)
			clientMu.Lock()
			_ = writeWSJSON(writeCtx, client, map[string]any{
				"type":    "error",
				"code":    "interview_quota_exhausted",
				"message": "面试时间已用完，请先兑换卡密",
				"model":   model,
			})
			clientMu.Unlock()
			stopWrite()
			cancel()
			return
		}
	}
}

func writeWSJSON(ctx context.Context, conn *websocket.Conn, value any) error {
	raw, e := json.Marshal(value)
	if e != nil {
		return e
	}
	return conn.Write(ctx, websocket.MessageText, raw)
}
func normalizeASRLanguage(v string) string {
	v = strings.ToLower(strings.TrimSpace(v))
	if v == "" || v == "auto" || strings.HasPrefix(v, "zh") {
		return "zh"
	}
	if strings.HasPrefix(v, "en") {
		return "en"
	}
	return v
}
func paraformerStart(id, model, language string, rate, silence int) map[string]any {
	p := map[string]any{"sample_rate": rate, "format": "pcm", "max_sentence_silence": silence}
	if model == "paraformer-realtime-v2" {
		if language == "zh" {
			p["language_hints"] = []string{"zh", "en"}
		} else {
			p["language_hints"] = []string{language}
		}
	}
	return map[string]any{"header": map[string]any{"action": "run-task", "task_id": id, "streaming": "duplex"}, "payload": map[string]any{"task_group": "audio", "task": "asr", "function": "recognition", "model": model, "parameters": p, "input": map[string]any{}}}
}
func paraformerFinish(id string) map[string]any {
	return map[string]any{"header": map[string]any{"action": "finish-task", "task_id": id, "streaming": "duplex"}, "payload": map[string]any{"input": map[string]any{}}}
}
func qwenSessionUpdate(language string, rate, silence int) map[string]any {
	return map[string]any{"event_id": "event_" + randomHex(16), "type": "session.update", "session": map[string]any{"input_audio_format": "pcm", "sample_rate": rate, "input_audio_transcription": map[string]any{"language": language}, "turn_detection": map[string]any{"type": "server_vad", "silence_duration_ms": silence}}}
}
func translateASREvent(raw []byte, model, language string) []map[string]any {
	var m map[string]any
	if json.Unmarshal(raw, &m) != nil {
		return []map[string]any{{"type": "error", "message": "Bad ASR upstream response", "model": model}}
	}
	if header, ok := m["header"].(map[string]any); ok {
		event := fmt.Sprint(header["event"])
		switch event {
		case "task-started":
			return []map[string]any{{"type": "ready", "model": model}}
		case "task-finished":
			return []map[string]any{{"type": "finished", "model": model}}
		case "task-failed":
			return []map[string]any{{"type": "error", "message": "Speech recognition is temporarily unavailable", "model": model}}
		case "result-generated":
			payload, _ := m["payload"].(map[string]any)
			output, _ := payload["output"].(map[string]any)
			sentence, _ := output["sentence"].(map[string]any)
			text := strings.TrimSpace(fmt.Sprint(sentence["text"]))
			if text != "" {
				end, _ := sentence["sentence_end"].(bool)
				typ := "partial"
				if end {
					typ = "final"
				}
				event := map[string]any{"type": typ, "text": text, "model": model, "speechEnded": end}
				if sentence["sentence_id"] != nil {
					event["segmentId"] = fmt.Sprint(sentence["sentence_id"])
				}
				return []map[string]any{event}
			}
		}
		return nil
	}
	typ := fmt.Sprint(m["type"])
	switch typ {
	case "session.created", "session.updated":
		return []map[string]any{{"type": "ready", "model": model}}
	case "session.finished":
		return []map[string]any{{"type": "finished", "model": model}}
	case "error", "conversation.item.input_audio_transcription.failed":
		return []map[string]any{{"type": "error", "message": "Speech recognition is temporarily unavailable", "model": model}}
	case "conversation.item.input_audio_transcription.completed":
		text := strings.TrimSpace(fmt.Sprint(m["transcript"]))
		if text != "" {
			return []map[string]any{{"type": "final", "text": text, "model": model, "speechEnded": true}}
		}
	case "conversation.item.input_audio_transcription.text":
		text := strings.TrimSpace(fmt.Sprint(m["text"]) + fmt.Sprint(m["stash"]))
		if text != "" {
			return []map[string]any{{"type": "partial", "text": text, "model": model, "speechEnded": false}}
		}
	}
	_ = language
	return nil
}
func (s *Server) mockASRWS(ctx context.Context, client *websocket.Conn, clientMu *sync.Mutex, model string) {
	clientMu.Lock()
	_ = writeWSJSON(ctx, client, map[string]any{"type": "ready", "model": "mock-" + model})
	clientMu.Unlock()
	for {
		typ, raw, e := client.Read(ctx)
		if e != nil {
			return
		}
		if typ != websocket.MessageText {
			continue
		}
		var m struct {
			Type string `json:"type"`
		}
		if json.Unmarshal(raw, &m) == nil && m.Type == "finish" {
			clientMu.Lock()
			_ = writeWSJSON(ctx, client, map[string]any{"type": "final", "text": "mock ASR transcript", "model": "mock-" + model, "speechEnded": true})
			_ = writeWSJSON(ctx, client, map[string]any{"type": "finished", "model": "mock-" + model})
			clientMu.Unlock()
			return
		}
	}
}
