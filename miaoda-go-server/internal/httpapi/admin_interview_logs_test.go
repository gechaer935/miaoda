package httpapi

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"example.com/miaoda/server/internal/config"
	store "example.com/miaoda/server/internal/store/sqlite"
)

func TestInterviewRequestsRecordFallbackAttemptsAndAdminSummary(t *testing.T) {
	const loggedQuestion = "请解释哈希表如何处理冲突"
	const clientVersion = "1.0.10"
	var upstreamModels []string
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload struct {
			Model string `json:"model"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Errorf("decode upstream request: %v", err)
			return
		}
		upstreamModels = append(upstreamModels, payload.Model)
		if strings.HasPrefix(payload.Model, "deepseek-") {
			http.Error(w, "temporary outage", http.StatusServiceUnavailable)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{
			"message": map[string]string{"content": "备用模型回答"}, "finish_reason": "stop",
		}}})
	}))
	defer upstream.Close()

	db, err := store.Open(filepath.Join(t.TempDir(), "interview-logs.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.DB.Close() })
	adminPassword := "interview-log-admin-password"
	server := New(config.Config{
		JWTSecret:    strings.Repeat("l", 40),
		TokenTTL:     time.Hour,
		AdminToken:   adminPassword,
		DeepSeekURL:  upstream.URL,
		DeepSeekKey:  "deepseek-key",
		DashscopeURL: upstream.URL,
		DashscopeKey: "dashscope-key",
		AnswerModels: "deepseek:deepseek-v4-flash,deepseek:deepseek-v4-pro,aliyun:qwen3.7-plus",
		SupportEmail: "support@example.com",
	}, db)
	router := server.Router()
	registered, payload := accountJSON(t, router, http.MethodPost, "/api/auth/register", map[string]any{
		"username": "LogUser", "password": "password8", "deviceId": "log-device", "platform": "win32",
	}, "")
	if registered.Code != http.StatusOK {
		t.Fatalf("register status=%d body=%s", registered.Code, registered.Body.String())
	}
	token, _ := payload["token"].(string)
	answerBody, err := json.Marshal(map[string]any{
		"question": loggedQuestion, "language": "Chinese",
	})
	if err != nil {
		t.Fatal(err)
	}
	answerRequest := httptest.NewRequest(http.MethodPost, "/api/interview/answer", bytes.NewReader(answerBody))
	answerRequest.Header.Set("Content-Type", "application/json")
	answerRequest.Header.Set("Authorization", "Bearer "+token)
	answerRequest.Header.Set("X-Miaoda-Client-Version", clientVersion)
	answered := httptest.NewRecorder()
	router.ServeHTTP(answered, answerRequest)
	var answerPayload map[string]any
	_ = json.Unmarshal(answered.Body.Bytes(), &answerPayload)
	if answered.Code != http.StatusOK || answerPayload["model"] != "qwen3.7-plus" {
		t.Fatalf("answer status=%d body=%s", answered.Code, answered.Body.String())
	}
	if strings.Join(upstreamModels, ",") != "deepseek-v4-flash,deepseek-v4-pro,qwen3.7-plus" {
		t.Fatalf("unexpected upstream model chain: %#v", upstreamModels)
	}

	unauthorized, _ := adminJSON(t, router, http.MethodGet, "/api/admin/interview-logs", nil, "", "")
	if unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("unauthorized status=%d body=%s", unauthorized.Code, unauthorized.Body.String())
	}
	logs, _ := adminJSON(t, router, http.MethodGet, "/api/admin/interview-logs?days=30", nil, adminPassword, "")
	if logs.Code != http.StatusOK {
		t.Fatalf("logs status=%d body=%s", logs.Code, logs.Body.String())
	}
	var response struct {
		Today            store.InterviewLogSummary   `json:"today"`
		Days             []store.InterviewLogDay     `json:"days"`
		SelectedDate     string                      `json:"selectedDate"`
		SelectedRequests []store.InterviewRequestLog `json:"selectedRequests"`
		SelectedPage     int                         `json:"selectedPage"`
		SelectedPageSize int                         `json:"selectedPageSize"`
		SelectedTotal    int                         `json:"selectedTotal"`
		SelectedPages    int                         `json:"selectedTotalPages"`
	}
	if err = json.Unmarshal(logs.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.Today.Requests != 1 || response.Today.Succeeded != 1 || response.Today.Failed != 0 || response.Today.Retried != 1 || response.Today.Attempts != 3 || response.Today.FailedAttempts != 2 {
		t.Fatalf("unexpected summary: %#v", response.Today)
	}
	if len(response.Days) != 30 || response.SelectedDate != "" || len(response.SelectedRequests) != 0 {
		t.Fatalf("unexpected initial log response: days=%d selectedDate=%q selected=%d", len(response.Days), response.SelectedDate, len(response.SelectedRequests))
	}
	today := time.Now().In(chinaTime).Format("2006-01-02")
	selected, _ := adminJSON(t, router, http.MethodGet, "/api/admin/interview-logs?days=30&date="+today, nil, adminPassword, "")
	if selected.Code != http.StatusOK {
		t.Fatalf("selected logs status=%d body=%s", selected.Code, selected.Body.String())
	}
	if err = json.Unmarshal(selected.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.SelectedDate != today || len(response.SelectedRequests) != 1 {
		t.Fatalf("unexpected selected response: date=%q count=%d", response.SelectedDate, len(response.SelectedRequests))
	}
	detail := response.SelectedRequests[0]
	if detail.Username != "LogUser" || detail.ClientVersion != clientVersion || detail.QuestionText != loggedQuestion || detail.FinalModel != "qwen3.7-plus" || detail.AttemptCount != 3 || detail.RetryCount != 2 || len(detail.Attempts) != 3 {
		t.Fatalf("unexpected selected log: %#v", detail)
	}
	if detail.Attempts[0].Status != "failed" || detail.Attempts[1].Status != "failed" || detail.Attempts[2].Status != "succeeded" {
		t.Fatalf("unexpected attempt chain: %#v", detail.Attempts)
	}

	tx, err := db.DB.Begin()
	if err != nil {
		t.Fatal(err)
	}
	for index := 0; index < 505; index++ {
		stamp := time.Now().UTC().Add(time.Duration(index+1) * time.Millisecond).Format(time.RFC3339Nano)
		if _, err = tx.Exec(`INSERT INTO interview_request_logs(
			request_id,username,device_id,requested_model,final_model,status,attempt_count,retry_count,error_message,started_at,completed_at
		) VALUES(?,?,?,?,?,'succeeded',1,0,'',?,?)`, fmt.Sprintf("legacy-usage-test-%03d", index), "LogUser", "log-device", "", "deepseek-v4-flash", stamp, stamp); err != nil {
			_ = tx.Rollback()
			t.Fatal(err)
		}
	}
	if err = tx.Commit(); err != nil {
		t.Fatal(err)
	}
	selected, _ = adminJSON(t, router, http.MethodGet, "/api/admin/interview-logs?days=30&date="+today, nil, adminPassword, "")
	if err = json.Unmarshal(selected.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if len(response.SelectedRequests) != 15 || response.SelectedPage != 1 || response.SelectedPageSize != 15 || response.SelectedTotal != 506 || response.SelectedPages != 34 {
		t.Fatalf("unexpected default request page: count=%d page=%d size=%d total=%d pages=%d", len(response.SelectedRequests), response.SelectedPage, response.SelectedPageSize, response.SelectedTotal, response.SelectedPages)
	}
	selected, _ = adminJSON(t, router, http.MethodGet, "/api/admin/interview-logs?days=30&date="+today+"&page=2&pageSize=30", nil, adminPassword, "")
	if err = json.Unmarshal(selected.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if len(response.SelectedRequests) != 30 || response.SelectedPage != 2 || response.SelectedPageSize != 30 || response.SelectedTotal != 506 || response.SelectedPages != 17 {
		t.Fatalf("unexpected second request page: count=%d page=%d size=%d total=%d pages=%d", len(response.SelectedRequests), response.SelectedPage, response.SelectedPageSize, response.SelectedTotal, response.SelectedPages)
	}
	selected, _ = adminJSON(t, router, http.MethodGet, "/api/admin/interview-logs?days=30&date="+today+"&page=99&pageSize=30", nil, adminPassword, "")
	if err = json.Unmarshal(selected.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if len(response.SelectedRequests) != 26 || response.SelectedPage != 17 {
		t.Fatalf("out-of-range page must clamp to the final page: count=%d page=%d", len(response.SelectedRequests), response.SelectedPage)
	}
	foundLegacyWithoutVersion := false
	for _, request := range response.SelectedRequests {
		if strings.HasPrefix(request.RequestID, "legacy-usage-test-") && request.ClientVersion == "" {
			foundLegacyWithoutVersion = true
			break
		}
	}
	if !foundLegacyWithoutVersion {
		t.Fatal("legacy requests without a version must remain readable")
	}
	invalidDate, _ := adminJSON(t, router, http.MethodGet, "/api/admin/interview-logs?days=30&date=2026-99-99", nil, adminPassword, "")
	if invalidDate.Code != http.StatusBadRequest {
		t.Fatalf("invalid date status=%d body=%s", invalidDate.Code, invalidDate.Body.String())
	}
	var storedQuestionCount int
	if err = db.DB.QueryRow(`SELECT count(*) FROM interview_request_logs WHERE question_text=?`, loggedQuestion).Scan(&storedQuestionCount); err != nil || storedQuestionCount != 1 {
		t.Fatalf("question text not stored exactly once: count=%d err=%v", storedQuestionCount, err)
	}
	var questionInErrorCount int
	if err = db.DB.QueryRow(`SELECT count(*) FROM interview_request_logs WHERE error_message LIKE '%哈希表%'`).Scan(&questionInErrorCount); err != nil || questionInErrorCount != 0 {
		t.Fatalf("question text leaked into error summary: count=%d err=%v", questionInErrorCount, err)
	}
}

func TestInterviewAnswerContinuesWhenRequestLoggingFails(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{
			"message": map[string]string{"content": "正常回答"}, "finish_reason": "stop",
		}}})
	}))
	defer upstream.Close()

	db, err := store.Open(filepath.Join(t.TempDir(), "interview-log-failure.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.DB.Close() })
	server := New(config.Config{
		JWTSecret:    strings.Repeat("f", 40),
		TokenTTL:     time.Hour,
		DeepSeekURL:  upstream.URL,
		DeepSeekKey:  "deepseek-key",
		AnswerModels: "deepseek:deepseek-v4-flash",
	}, db)
	router := server.Router()
	registered, payload := accountJSON(t, router, http.MethodPost, "/api/auth/register", map[string]any{
		"username": "LogFailureUser", "password": "password8", "deviceId": "log-failure-device", "platform": "win32",
	}, "")
	if registered.Code != http.StatusOK {
		t.Fatalf("register status=%d body=%s", registered.Code, registered.Body.String())
	}
	if _, err = db.DB.Exec(`CREATE TRIGGER reject_interview_log BEFORE INSERT ON interview_request_logs
		BEGIN SELECT RAISE(FAIL, 'simulated log failure'); END;`); err != nil {
		t.Fatal(err)
	}
	token, _ := payload["token"].(string)
	answered, answerPayload := accountJSON(t, router, http.MethodPost, "/api/interview/answer", map[string]any{
		"question": "日志失败时仍要回答", "language": "Chinese",
	}, token)
	if answered.Code != http.StatusOK || answerPayload["answer"] != "正常回答" {
		t.Fatalf("logging failure blocked answer: status=%d body=%s", answered.Code, answered.Body.String())
	}
}
