package httpapi

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func registerZeroQuotaAccount(t *testing.T, server *Server) string {
	t.Helper()
	settings, err := server.store.TrialOfferSettings(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	settings.Enabled = false
	if _, err = server.store.UpdateTrialOfferSettings(t.Context(), settings); err != nil {
		t.Fatal(err)
	}
	rec, payload := accountJSON(t, server.Router(), http.MethodPost, "/api/auth/register", map[string]any{
		"username": "ZeroQuotaUser", "password": "password8", "deviceId": "desktop-zero", "platform": "win32",
	}, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("register status=%d body=%s", rec.Code, rec.Body.String())
	}
	token, _ := payload["token"].(string)
	if token == "" {
		t.Fatal("registration did not return a token")
	}
	return token
}

func TestZeroInterviewQuotaIsRejectedBeforePaidProviders(t *testing.T) {
	server, _ := accountTestServer(t)
	token := registerZeroQuotaAccount(t, server)
	router := server.Router()

	for _, item := range []struct {
		path string
		body map[string]any
	}{
		{path: "/api/interview/answer", body: map[string]any{"question": "Explain a B+ tree"}},
		{path: "/api/interview/answer-stream", body: map[string]any{"question": "Explain a B+ tree"}},
		{path: "/api/interview/translate-stream", body: map[string]any{"text": "Explain a B+ tree", "sourceLanguage": "English"}},
	} {
		rec, _ := accountJSON(t, router, http.MethodPost, item.path, item.body, token)
		if rec.Code != http.StatusPaymentRequired || !strings.Contains(rec.Body.String(), "interview_quota_exhausted") {
			t.Fatalf("%s status=%d body=%s", item.path, rec.Code, rec.Body.String())
		}
	}

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("audio", "sample.pcm")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = part.Write([]byte{0, 1, 2, 3})
	_ = writer.Close()
	req := httptest.NewRequest(http.MethodPost, "/api/interview/asr", &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusPaymentRequired || !strings.Contains(rec.Body.String(), "interview_quota_exhausted") {
		t.Fatalf("REST ASR status=%d body=%s", rec.Code, rec.Body.String())
	}

	wsReq := httptest.NewRequest(http.MethodGet, "/ws/asr", nil)
	wsReq.Header.Set("Authorization", "Bearer "+token)
	wsRec := httptest.NewRecorder()
	router.ServeHTTP(wsRec, wsReq)
	if wsRec.Code != http.StatusPaymentRequired || !strings.Contains(wsRec.Body.String(), "interview_quota_exhausted") {
		t.Fatalf("WebSocket ASR status=%d body=%s", wsRec.Code, wsRec.Body.String())
	}
}

func TestASRRejectsTokensInURLsAndOversizedInterviewPrompts(t *testing.T) {
	server, _ := accountTestServer(t)
	token := registerZeroQuotaAccount(t, server)
	router := server.Router()

	queryToken := httptest.NewRequest(http.MethodGet, "/ws/asr?token="+token, nil)
	queryTokenRec := httptest.NewRecorder()
	router.ServeHTTP(queryTokenRec, queryToken)
	if queryTokenRec.Code != http.StatusUnauthorized || !strings.Contains(queryTokenRec.Body.String(), "missing_token") {
		t.Fatalf("query token status=%d body=%s", queryTokenRec.Code, queryTokenRec.Body.String())
	}

	rec, _ := accountJSON(t, router, http.MethodPost, "/api/interview/answer-stream", map[string]any{
		"question": strings.Repeat("q", 4001),
	}, token)
	if rec.Code != http.StatusBadRequest || !strings.Contains(rec.Body.String(), "validation_failed") {
		t.Fatalf("oversized interview request status=%d body=%s", rec.Code, rec.Body.String())
	}

	translateRec, _ := accountJSON(t, router, http.MethodPost, "/api/interview/translate-stream", map[string]any{
		"text": strings.Repeat("q", translationTextMaxRunes+1), "sourceLanguage": "English",
	}, token)
	if translateRec.Code != http.StatusBadRequest || !strings.Contains(translateRec.Body.String(), "validation_failed") {
		t.Fatalf("oversized translation request status=%d body=%s", translateRec.Code, translateRec.Body.String())
	}
}

func TestZeroWrittenQuotaIsRejectedBeforeImageProcessing(t *testing.T) {
	server, _ := accountTestServer(t)
	token := registerZeroQuotaAccount(t, server)
	req := httptest.NewRequest(http.MethodPost, "/api/written/solve-screen", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	server.Router().ServeHTTP(rec, req)
	if rec.Code != http.StatusPaymentRequired || !strings.Contains(rec.Body.String(), "written_quota_exhausted") {
		t.Fatalf("written solve status=%d body=%s", rec.Code, rec.Body.String())
	}
}

func TestWebAccountUsesHttpOnlyCookieAndRejectsCrossSiteMutation(t *testing.T) {
	server, _ := accountTestServer(t)
	server.cfg.AllowOrigin = "https://example.invalid"
	router := server.Router()
	rec, _ := accountJSON(t, router, http.MethodPost, "/api/auth/register", map[string]any{
		"username": "CookieUser", "password": "password8", "deviceId": "web-cookie", "platform": "web",
	}, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("register status=%d body=%s", rec.Code, rec.Body.String())
	}
	cookies := rec.Result().Cookies()
	if len(cookies) == 0 || cookies[0].Name != webSessionCookie || !cookies[0].HttpOnly || cookies[0].SameSite != http.SameSiteStrictMode {
		t.Fatalf("missing hardened web session cookie: %#v", cookies)
	}

	meReq := httptest.NewRequest(http.MethodGet, "/api/account/me", nil)
	meReq.AddCookie(cookies[0])
	meRec := httptest.NewRecorder()
	router.ServeHTTP(meRec, meReq)
	if meRec.Code != http.StatusOK {
		t.Fatalf("cookie-authenticated account request status=%d body=%s", meRec.Code, meRec.Body.String())
	}

	mutation := httptest.NewRequest(http.MethodPost, "/api/account/redeem", strings.NewReader(`{"cardKey":"MD-NOT-REAL"}`))
	mutation.Header.Set("Content-Type", "application/json")
	mutation.AddCookie(cookies[0])
	mutationRec := httptest.NewRecorder()
	router.ServeHTTP(mutationRec, mutation)
	if mutationRec.Code != http.StatusForbidden || !strings.Contains(mutationRec.Body.String(), "origin_forbidden") {
		t.Fatalf("cross-site cookie mutation status=%d body=%s", mutationRec.Code, mutationRec.Body.String())
	}
}
