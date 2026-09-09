package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"example.com/miaoda/server/internal/config"
	store "example.com/miaoda/server/internal/store/sqlite"
)

func accountTestServer(t *testing.T) (*Server, *store.Store) {
	t.Helper()
	db, err := store.Open(filepath.Join(t.TempDir(), "account.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.DB.Close() })
	cfg := config.Config{JWTSecret: strings.Repeat("s", 40), TokenTTL: time.Hour, SupportEmail: "support@example.invalid"}
	return New(cfg, db), db
}

func accountJSON(t *testing.T, handler http.Handler, method, path string, body any, token string) (*httptest.ResponseRecorder, map[string]any) {
	t.Helper()
	encoded, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(method, path, bytes.NewReader(encoded))
	req.Header.Set("Content-Type", "application/json")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	var response map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &response)
	return rec, response
}

func TestAccountRegistrationLoginAndRedemption(t *testing.T) {
	server, db := accountTestServer(t)
	router := server.Router()

	register, payload := accountJSON(t, router, http.MethodPost, "/api/auth/register", map[string]any{
		"username": "CaseUser", "password": "password8", "deviceId": "web-1", "deviceName": "browser", "platform": "web",
	}, "")
	if register.Code != http.StatusOK {
		t.Fatalf("register status=%d body=%s", register.Code, register.Body.String())
	}
	token, _ := payload["token"].(string)
	if token == "" {
		t.Fatal("registration did not return token")
	}
	cardPayload, _ := payload["card"].(map[string]any)
	if cardPayload["remainingInterviewSeconds"] != float64(store.DefaultTrialInterviewSeconds) || cardPayload["remainingWrittenQuestions"] != store.DefaultTrialWrittenQuestions {
		t.Fatalf("new account trial quota: %#v", cardPayload)
	}
	if cardPayload["maxDevices"] != float64(store.DefaultDeviceLimit) {
		t.Fatalf("new account device limit=%v, want %d", cardPayload["maxDevices"], store.DefaultDeviceLimit)
	}

	differentCase, _ := accountJSON(t, router, http.MethodPost, "/api/auth/account-login", map[string]any{
		"username": "caseuser", "password": "password8", "deviceId": "web-2", "deviceName": "browser", "platform": "web",
	}, "")
	if differentCase.Code != http.StatusOK {
		t.Fatalf("case-insensitive login status=%d body=%s", differentCase.Code, differentCase.Body.String())
	}

	caseCollision, _ := accountJSON(t, router, http.MethodPost, "/api/auth/register", map[string]any{
		"username": "CASEUSER", "password": "password8", "deviceId": "web-3", "deviceName": "browser", "platform": "web",
	}, "")
	if caseCollision.Code != http.StatusConflict {
		t.Fatalf("case-insensitive duplicate registration status=%d body=%s", caseCollision.Code, caseCollision.Body.String())
	}

	correct, _ := accountJSON(t, router, http.MethodPost, "/api/auth/account-login", map[string]any{
		"username": "CaseUser", "password": "password8", "deviceId": "web-1", "deviceName": "browser", "platform": "web",
	}, "")
	if correct.Code != http.StatusOK {
		t.Fatalf("account login status=%d body=%s", correct.Code, correct.Body.String())
	}
	for i := 1; i <= store.DefaultDeviceLimit; i++ {
		desktop, _ := accountJSON(t, router, http.MethodPost, "/api/auth/account-login", map[string]any{
			"username": "CaseUser", "password": "password8", "deviceId": "desktop-" + strconv.Itoa(i), "deviceName": "Windows " + strconv.Itoa(i), "platform": "win32",
		}, "")
		if desktop.Code != http.StatusOK {
			t.Fatalf("desktop %d of %d should log in: status=%d body=%s", i, store.DefaultDeviceLimit, desktop.Code, desktop.Body.String())
		}
	}
	sixthDesktop, _ := accountJSON(t, router, http.MethodPost, "/api/auth/account-login", map[string]any{
		"username": "CaseUser", "password": "password8", "deviceId": "desktop-6", "deviceName": "Windows 6", "platform": "win32",
	}, "")
	if sixthDesktop.Code != http.StatusForbidden || !strings.Contains(sixthDesktop.Body.String(), "device_limit_exceeded") {
		t.Fatalf("sixth desktop should hit device limit: status=%d body=%s", sixthDesktop.Code, sixthDesktop.Body.String())
	}

	if err := db.CreateCard(t.Context(), "MD-LOW-QUOTA-01", 600, 0, 1, "low quota"); err != nil {
		t.Fatal(err)
	}
	redeem, result := accountJSON(t, router, http.MethodPost, "/api/account/redeem", map[string]string{"cardKey": "MD-LOW-QUOTA-01"}, token)
	if redeem.Code != http.StatusOK || result["remainingInterviewSeconds"] != float64(900) || result["remainingWrittenQuestions"] != store.DefaultTrialWrittenQuestions {
		t.Fatalf("redeem status=%d body=%s", redeem.Code, redeem.Body.String())
	}

	if err := db.CreateCard(t.Context(), "MD-LOW-QUOTA-02", 600, 0, 1, "second low quota"); err != nil {
		t.Fatal(err)
	}
	secondLowQuota, result := accountJSON(t, router, http.MethodPost, "/api/account/redeem", map[string]string{"cardKey": "MD-LOW-QUOTA-02"}, token)
	if secondLowQuota.Code != http.StatusOK || result["remainingInterviewSeconds"] != float64(1500) {
		t.Fatalf("second low-quota redemption status=%d body=%s", secondLowQuota.Code, secondLowQuota.Body.String())
	}

	if err := db.CreateCard(t.Context(), "MD-STANDARD-0001", 1200, 3, 1, "standard"); err != nil {
		t.Fatal(err)
	}
	standard, result := accountJSON(t, router, http.MethodPost, "/api/account/redeem", map[string]string{"cardKey": "MD-STANDARD-0001"}, token)
	if standard.Code != http.StatusOK || result["remainingInterviewSeconds"] != float64(2700) || result["remainingWrittenQuestions"] != float64(4) {
		t.Fatalf("standard redemption status=%d body=%s", standard.Code, standard.Body.String())
	}

	if err := db.CreateCard(t.Context(), "MD-CONCURRENT-01", 300, 0, 1, "concurrent"); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	statuses := make(chan int, 8)
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			body := bytes.NewBufferString(`{"cardKey":"MD-CONCURRENT-01"}`)
			req := httptest.NewRequest(http.MethodPost, "/api/account/redeem", body)
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Authorization", "Bearer "+token)
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, req)
			statuses <- rec.Code
		}()
	}
	wg.Wait()
	close(statuses)
	successes := 0
	for status := range statuses {
		if status == http.StatusOK {
			successes++
		}
	}
	if successes != 1 {
		t.Fatalf("concurrent single-use redemption succeeded %d times, want 1", successes)
	}
	_, final := accountJSON(t, router, http.MethodGet, "/api/account/me", map[string]string{}, token)
	if final["remainingInterviewSeconds"] != float64(3000) || final["remainingWrittenQuestions"] != float64(4) {
		t.Fatalf("concurrent redemption credited more than once: %#v", final)
	}
}

func TestRegistrationLimitIsFivePerHour(t *testing.T) {
	server, _ := accountTestServer(t)
	for i := 0; i < 6; i++ {
		rec, _ := accountJSON(t, server.Router(), http.MethodPost, "/api/auth/register", map[string]any{
			"username": "LimitUser" + strconv.Itoa(i), "password": "password8", "deviceId": "device-" + strconv.Itoa(i), "platform": "web",
		}, "")
		if i < 5 && rec.Code != http.StatusOK {
			t.Fatalf("registration %d status=%d body=%s", i+1, rec.Code, rec.Body.String())
		}
		if i == 5 && (rec.Code != http.StatusTooManyRequests || !strings.Contains(rec.Body.String(), "每小时最多注册 5 个账户")) {
			t.Fatalf("sixth registration status=%d body=%s", rec.Code, rec.Body.String())
		}
	}
}

func TestLoginFailuresLockUsernameAndIPWithBackoff(t *testing.T) {
	limiter := &authLimiter{windows: map[string]*limitWindow{}, failures: map[string]*loginFailure{}}
	for i := 0; i < 5; i++ {
		limiter.failed("user:CaseUser", "ip:203.0.113.8")
	}
	if !limiter.locked("user:CaseUser") || !limiter.locked("ip:203.0.113.8") {
		t.Fatal("five failures should independently lock username and IP")
	}
	firstDelay := time.Until(limiter.failures["user:CaseUser"].LockedUntil)
	limiter.failures["user:CaseUser"].LockedUntil = time.Now().Add(-time.Second)
	limiter.failed("user:CaseUser")
	secondDelay := time.Until(limiter.failures["user:CaseUser"].LockedUntil)
	if firstDelay < 29*time.Second || secondDelay < 59*time.Second || secondDelay <= firstDelay {
		t.Fatalf("expected progressive backoff, first=%s second=%s", firstDelay, secondDelay)
	}
	limiter.succeeded("user:CaseUser", "ip:203.0.113.8")
	if limiter.locked("user:CaseUser", "ip:203.0.113.8") {
		t.Fatal("successful login should clear both username and IP failure state")
	}
}
