package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"example.com/miaoda/server/internal/config"
)

func registerTrialAccount(t *testing.T, handler http.Handler, username, deviceID, ip string) map[string]any {
	t.Helper()
	body, err := json.Marshal(map[string]any{
		"username":   username,
		"password":   "password8",
		"deviceId":   deviceID,
		"deviceName": "test browser",
		"platform":   "web",
	})
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/api/auth/register", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.RemoteAddr = ip + ":43210"
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("register %s status=%d body=%s", username, recorder.Code, recorder.Body.String())
	}
	var payload map[string]any
	if err = json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	card, _ := payload["card"].(map[string]any)
	return card
}

func assertTrialQuota(t *testing.T, card map[string]any, seconds, written float64) {
	t.Helper()
	if card["remainingInterviewSeconds"] != seconds || card["remainingWrittenQuestions"] != written {
		t.Fatalf("quota=%#v, want interview=%v written=%v", card, seconds, written)
	}
}

func TestTrialOfferLimitsLifetimeDeviceAndRollingIPClaims(t *testing.T) {
	server, db := accountTestServer(t)
	router := server.Router()

	assertTrialQuota(t, registerTrialAccount(t, router, "TrialUserA", "shared-device", "203.0.113.10"), 300, 1)
	// Clearing/changing the network does not make the same device eligible again.
	assertTrialQuota(t, registerTrialAccount(t, router, "TrialUserB", "shared-device", "203.0.113.11"), 0, 0)
	// A shared household IP gets a second legitimate grant, then stops granting.
	assertTrialQuota(t, registerTrialAccount(t, router, "TrialUserC", "second-device", "203.0.113.10"), 300, 1)
	assertTrialQuota(t, registerTrialAccount(t, router, "TrialUserD", "third-device", "203.0.113.10"), 0, 0)

	settings, err := db.TrialOfferSettings(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	settings.Enabled = false
	if _, err = db.UpdateTrialOfferSettings(t.Context(), settings); err != nil {
		t.Fatal(err)
	}
	assertTrialQuota(t, registerTrialAccount(t, router, "TrialUserE", "fourth-device", "203.0.113.12"), 0, 0)

	settings.Enabled = true
	settings.InterviewSeconds = 600
	settings.WrittenQuestions = 2
	settings.MaxGrantsPerIP = 3
	settings.IPWindowHours = 48
	if _, err = db.UpdateTrialOfferSettings(t.Context(), settings); err != nil {
		t.Fatal(err)
	}
	assertTrialQuota(t, registerTrialAccount(t, router, "TrialUserF", "fifth-device", "203.0.113.13"), 600, 2)

	var grants int
	if err = db.DB.QueryRow("SELECT count(*) FROM trial_grants").Scan(&grants); err != nil || grants != 3 {
		t.Fatalf("trial grant count=%d err=%v, want 3", grants, err)
	}
}

func TestTrialOfferAdminConfigurationAndPublicAnnouncement(t *testing.T) {
	_, db := accountTestServer(t)
	adminPassword := "trial-admin-password-123456"
	server := New(config.Config{
		JWTSecret:  strings.Repeat("t", 40),
		TokenTTL:   time.Hour,
		AdminToken: adminPassword,
		SupportQQ:  "YOUR_SUPPORT_QQ",
	}, db)
	router := server.Router()

	public, payload := accountJSON(t, router, http.MethodGet, "/api/public/config", nil, "")
	trial, _ := payload["trialOffer"].(map[string]any)
	if public.Code != http.StatusOK || trial["enabled"] != true || trial["interviewSeconds"] != float64(300) || trial["writtenQuestions"] != float64(1) {
		t.Fatalf("default public trial config status=%d payload=%#v", public.Code, payload)
	}

	unauthorized := adminCookieJSON(t, router, http.MethodGet, "/api/admin/trial-offer", nil, nil, false)
	if unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("unauthorized settings status=%d", unauthorized.Code)
	}
	login := adminCookieJSON(t, router, http.MethodPost, "/api/admin/auth/login", map[string]string{
		"username": config.DefaultAdminUsername,
		"password": adminPassword,
	}, nil, false)
	if login.Code != http.StatusOK {
		t.Fatalf("admin login status=%d body=%s", login.Code, login.Body.String())
	}
	cookie := adminCookie(t, login)

	updated := adminCookieJSON(t, router, http.MethodPut, "/api/admin/trial-offer", map[string]any{
		"enabled": false, "interviewSeconds": 900, "writtenQuestions": 3, "maxGrantsPerIp": 4, "ipWindowHours": 168,
	}, cookie, true)
	if updated.Code != http.StatusOK || !strings.Contains(updated.Body.String(), `"interviewSeconds":900`) {
		t.Fatalf("update settings status=%d body=%s", updated.Code, updated.Body.String())
	}
	public, payload = accountJSON(t, router, http.MethodGet, "/api/public/config", nil, "")
	trial, _ = payload["trialOffer"].(map[string]any)
	if public.Code != http.StatusOK || trial["enabled"] != false || trial["interviewSeconds"] != float64(900) || trial["writtenQuestions"] != float64(3) {
		t.Fatalf("updated public trial config status=%d payload=%#v", public.Code, payload)
	}

	invalid := adminCookieJSON(t, router, http.MethodPut, "/api/admin/trial-offer", map[string]any{
		"enabled": true, "interviewSeconds": 0, "writtenQuestions": 0, "maxGrantsPerIp": 2, "ipWindowHours": 720,
	}, cookie, true)
	if invalid.Code != http.StatusBadRequest {
		t.Fatalf("zero enabled offer status=%d body=%s", invalid.Code, invalid.Body.String())
	}

	for _, marker := range []string{`data-view="trial"`, `id="trial-form"`, `新客体验赠送`, `同一设备终身只赠送一次`} {
		if !strings.Contains(adminHTML, marker) {
			t.Errorf("admin page missing trial marker %q", marker)
		}
	}
}

func TestWebsiteTrialAnnouncementAndPurchasePlacement(t *testing.T) {
	indexPath := filepath.Join("..", "..", "..", "miaoda-site", "index.html")
	indexBytes, err := os.ReadFile(indexPath)
	if err != nil {
		t.Fatal(err)
	}
	index := string(indexBytes)
	accountPosition := strings.Index(index, `class="nav-account"`)
	buyPosition := strings.Index(index, `href="/account.html">联系部署管理员</a>`)
	downloadPosition := strings.Index(index, `class="nav-download"`)
	if accountPosition < 0 || buyPosition <= accountPosition || downloadPosition <= buyPosition {
		t.Fatalf("top navigation order must be account, buy, download: account=%d buy=%d download=%d", accountPosition, buyPosition, downloadPosition)
	}
	if strings.Contains(index, `class="button buy"`) {
		t.Fatal("hero must not keep the purchase button")
	}
	for _, marker := range []string{
		`id="trial-announcement"`,
		`id="trial-announcement-dismiss"`,
		`id="trial-announcement-today"`,
		`miaoda_trial_announcement_hidden_date`,
		`/api/public/config`,
	} {
		if !strings.Contains(index, marker) {
			t.Errorf("website missing announcement marker %q", marker)
		}
	}

	accountBytes, err := os.ReadFile(filepath.Join("..", "..", "..", "miaoda-site", "account.html"))
	if err != nil {
		t.Fatal(err)
	}
	account := string(accountBytes)
	for _, marker := range []string{
		`id="register-trial-copy"`,
		`remainingInterviewSeconds:data.card.remainingInterviewSeconds`,
		`remainingWrittenQuestions:data.card.remainingWrittenQuestions`,
		`new URLSearchParams(location.search).get('tab')==='register'`,
		`忘记密码请<button type="button" data-contact>联系客服</button>重置：`,
		`supportEmail:''`,
		`supportWeChat:''`,
	} {
		if !strings.Contains(account, marker) {
			t.Errorf("account page missing trial marker %q", marker)
		}
	}
}
