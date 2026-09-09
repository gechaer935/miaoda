package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"example.com/miaoda/server/internal/config"
)

func adminJSON(t *testing.T, handler http.Handler, method, path string, body any, adminToken, forwardedFor string) (*httptest.ResponseRecorder, map[string]any) {
	t.Helper()
	encoded, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(method, path, bytes.NewReader(encoded))
	req.Header.Set("Content-Type", "application/json")
	if adminToken != "" {
		req.Header.Set("X-Admin-Username", config.DefaultAdminUsername)
		req.Header.Set("X-Admin-Token", adminToken)
	}
	if forwardedFor != "" {
		req.RemoteAddr = "127.0.0.1:43120"
		req.Header.Set("X-Forwarded-For", forwardedFor)
	}
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	var response map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &response)
	return rec, response
}

func TestAdminIPAllowlistProtectsPagesAndAPI(t *testing.T) {
	_, db := accountTestServer(t)
	server := New(config.Config{
		JWTSecret:     strings.Repeat("s", 40),
		TokenTTL:      time.Hour,
		AdminToken:    "top-secret-admin",
		AdminAllowIPs: "203.0.113.8,2001:db8:1::/64",
	}, db)
	router := server.Router()

	blockedPage := httptest.NewRecorder()
	router.ServeHTTP(blockedPage, httptest.NewRequest(http.MethodGet, "/manage", nil))
	if blockedPage.Code != http.StatusNotFound {
		t.Fatalf("blocked admin page status=%d, want 404", blockedPage.Code)
	}
	blockedAPI, _ := adminJSON(t, router, http.MethodGet, "/api/admin/users", nil, "top-secret-admin", "198.51.100.20")
	if blockedAPI.Code != http.StatusNotFound {
		t.Fatalf("blocked admin API status=%d, want 404", blockedAPI.Code)
	}
	directSpoof := httptest.NewRequest(http.MethodGet, "/manage", nil)
	directSpoof.RemoteAddr = "198.51.100.20:43120"
	directSpoof.Header.Set("X-Forwarded-For", "203.0.113.8")
	directSpoofPage := httptest.NewRecorder()
	router.ServeHTTP(directSpoofPage, directSpoof)
	if directSpoofPage.Code != http.StatusNotFound {
		t.Fatalf("direct spoofed forwarding header status=%d, want 404", directSpoofPage.Code)
	}

	allowedPage := httptest.NewRecorder()
	allowedRequest := httptest.NewRequest(http.MethodGet, "/manage", nil)
	allowedRequest.RemoteAddr = "127.0.0.1:43120"
	allowedRequest.Header.Set("X-Forwarded-For", "203.0.113.8")
	router.ServeHTTP(allowedPage, allowedRequest)
	if allowedPage.Code != http.StatusOK || !strings.Contains(allowedPage.Body.String(), "用户管理") {
		t.Fatalf("allowed admin page status=%d", allowedPage.Code)
	}
	missingToken, _ := adminJSON(t, router, http.MethodGet, "/api/admin/users", nil, "", "203.0.113.8")
	if missingToken.Code != http.StatusUnauthorized {
		t.Fatalf("allowed IP without token status=%d, want 401", missingToken.Code)
	}
}

func TestAdminPageAllowsPublicNetworksWhenAllowlistBlank(t *testing.T) {
	_, db := accountTestServer(t)
	server := New(config.Config{
		JWTSecret:  strings.Repeat("s", 40),
		TokenTTL:   time.Hour,
		AdminToken: "top-secret-admin",
	}, db)
	request := httptest.NewRequest(http.MethodGet, "/admin", nil)
	request.RemoteAddr = "198.51.100.20:43120"
	recorder := httptest.NewRecorder()
	server.Router().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK || !strings.Contains(recorder.Body.String(), "管理员用户名") {
		t.Fatalf("public admin page status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}

func TestAdminCanManageUsersWithoutExposingPasswords(t *testing.T) {
	_, db := accountTestServer(t)
	server := New(config.Config{
		JWTSecret:     strings.Repeat("s", 40),
		TokenTTL:      time.Hour,
		AdminToken:    "top-secret-admin",
		AdminAllowIPs: "192.0.2.1",
	}, db)
	router := server.Router()

	register, registered := accountJSON(t, router, http.MethodPost, "/api/auth/register", map[string]any{
		"username": "ManagedUser", "password": "password8", "deviceId": "web-admin-test", "platform": "web",
	}, "")
	if register.Code != http.StatusOK {
		t.Fatalf("register status=%d body=%s", register.Code, register.Body.String())
	}
	userToken, _ := registered["token"].(string)

	list, _ := adminJSON(t, router, http.MethodGet, "/api/admin/users?limit=10", nil, "top-secret-admin", "")
	if list.Code != http.StatusOK || !strings.Contains(list.Body.String(), "ManagedUser") {
		t.Fatalf("list users status=%d body=%s", list.Code, list.Body.String())
	}
	if strings.Contains(strings.ToLower(list.Body.String()), "password") || strings.Contains(list.Body.String(), "ACCOUNT-") {
		t.Fatalf("user list leaked password or internal account key: %s", list.Body.String())
	}

	quota, _ := adminJSON(t, router, http.MethodPost, "/api/admin/users/ManagedUser/quota", map[string]any{
		"interviewSeconds": 900, "writtenQuestions": 4,
	}, "top-secret-admin", "")
	if quota.Code != http.StatusOK {
		t.Fatalf("set quota status=%d body=%s", quota.Code, quota.Body.String())
	}
	me, account := accountJSON(t, router, http.MethodGet, "/api/account/me", map[string]any{}, userToken)
	if me.Code != http.StatusOK || account["remainingInterviewSeconds"] != float64(900) || account["remainingWrittenQuestions"] != float64(4) {
		t.Fatalf("managed quota not visible to account: status=%d body=%s", me.Code, me.Body.String())
	}

	disable, _ := adminJSON(t, router, http.MethodPost, "/api/admin/users/ManagedUser/status", map[string]string{"status": "disabled"}, "top-secret-admin", "")
	if disable.Code != http.StatusOK {
		t.Fatalf("disable status=%d body=%s", disable.Code, disable.Body.String())
	}
	revoked, _ := accountJSON(t, router, http.MethodGet, "/api/account/me", map[string]any{}, userToken)
	if revoked.Code != http.StatusUnauthorized {
		t.Fatalf("disabled user session remained active: status=%d", revoked.Code)
	}
	enable, _ := adminJSON(t, router, http.MethodPost, "/api/admin/users/ManagedUser/status", map[string]string{"status": "active"}, "top-secret-admin", "")
	if enable.Code != http.StatusOK {
		t.Fatalf("enable status=%d body=%s", enable.Code, enable.Body.String())
	}

	password, _ := adminJSON(t, router, http.MethodPost, "/api/admin/users/ManagedUser/password", map[string]string{"password": "new-password9"}, "top-secret-admin", "")
	if password.Code != http.StatusOK {
		t.Fatalf("reset password status=%d body=%s", password.Code, password.Body.String())
	}
	oldLogin, _ := accountJSON(t, router, http.MethodPost, "/api/auth/account-login", map[string]any{
		"username": "ManagedUser", "password": "password8", "deviceId": "desktop-old", "platform": "win32",
	}, "")
	if oldLogin.Code != http.StatusUnauthorized {
		t.Fatalf("old password still works: status=%d", oldLogin.Code)
	}
	newLogin, _ := accountJSON(t, router, http.MethodPost, "/api/auth/account-login", map[string]any{
		"username": "ManagedUser", "password": "new-password9", "deviceId": "desktop-new", "platform": "win32",
	}, "")
	if newLogin.Code != http.StatusOK {
		t.Fatalf("new password login status=%d body=%s", newLogin.Code, newLogin.Body.String())
	}
	reset, result := adminJSON(t, router, http.MethodPost, "/api/admin/users/ManagedUser/reset-devices", map[string]any{}, "top-secret-admin", "")
	if reset.Code != http.StatusOK || result["ok"] != true {
		t.Fatalf("reset devices status=%d body=%s", reset.Code, reset.Body.String())
	}
}

func TestAdminDeletesUserOnlyAfterExactConfirmationAndPreservesAuditHistory(t *testing.T) {
	_, db := accountTestServer(t)
	server := New(config.Config{
		JWTSecret:  strings.Repeat("d", 40),
		TokenTTL:   time.Hour,
		AdminToken: "top-secret-admin",
	}, db)
	router := server.Router()

	register, registered := accountJSON(t, router, http.MethodPost, "/api/auth/register", map[string]any{
		"username": "DeleteMe", "password": "password8", "deviceId": "delete-test-device", "platform": "web",
	}, "")
	if register.Code != http.StatusOK {
		t.Fatalf("register status=%d body=%s", register.Code, register.Body.String())
	}
	token, _ := registered["token"].(string)
	var userID, accountCardID int64
	if err := db.DB.QueryRow("SELECT id,account_card_id FROM users WHERE username='DeleteMe'").Scan(&userID, &accountCardID); err != nil {
		t.Fatal(err)
	}
	if err := db.CreateCard(t.Context(), "MD-DELETE-AUDIT", 600, 2, 1, "delete audit source"); err != nil {
		t.Fatal(err)
	}
	redeem, _ := accountJSON(t, router, http.MethodPost, "/api/account/redeem", map[string]string{"cardKey": "MD-DELETE-AUDIT"}, token)
	if redeem.Code != http.StatusOK {
		t.Fatalf("redeem status=%d body=%s", redeem.Code, redeem.Body.String())
	}
	if _, err := db.DB.Exec(`INSERT INTO feedback_threads(id,user_id,status,created_at,updated_at) VALUES('delete-thread',?,'open','2026-08-04T00:00:00Z','2026-08-04T00:00:00Z');
		INSERT INTO feedback_messages(thread_id,sender,body,created_at) VALUES('delete-thread','user','delete me','2026-08-04T00:00:00Z');
		INSERT INTO feedback_attachments(id,message_id,filename,mime_type,size_bytes,data,created_at)
		VALUES('delete-attachment',(SELECT id FROM feedback_messages WHERE thread_id='delete-thread'),'test.png','image/png',3,X'010203','2026-08-04T00:00:00Z')`, userID); err != nil {
		t.Fatal(err)
	}

	unauthorized, _ := adminJSON(t, router, http.MethodDelete, "/api/admin/users/DeleteMe", map[string]string{"confirmUsername": "DeleteMe"}, "", "")
	if unauthorized.Code != http.StatusUnauthorized {
		t.Fatalf("unauthorized delete status=%d, want 401", unauthorized.Code)
	}
	mismatch, payload := adminJSON(t, router, http.MethodDelete, "/api/admin/users/deleteme", map[string]string{"confirmUsername": "deleteme"}, "top-secret-admin", "")
	if mismatch.Code != http.StatusBadRequest || payload["error"].(map[string]any)["code"] != "confirmation_mismatch" {
		t.Fatalf("mismatched confirmation status=%d body=%s", mismatch.Code, mismatch.Body.String())
	}
	var stillPresent int
	if err := db.DB.QueryRow("SELECT count(*) FROM users WHERE id=?", userID).Scan(&stillPresent); err != nil || stillPresent != 1 {
		t.Fatalf("mismatch deleted user: count=%d err=%v", stillPresent, err)
	}

	deleted, payload := adminJSON(t, router, http.MethodDelete, "/api/admin/users/deleteme", map[string]string{"confirmUsername": "DeleteMe"}, "top-secret-admin", "")
	if deleted.Code != http.StatusOK || payload["ok"] != true || payload["username"] != "DeleteMe" {
		t.Fatalf("delete status=%d body=%s", deleted.Code, deleted.Body.String())
	}

	checks := []struct {
		name  string
		query string
		args  []any
		want  int
	}{
		{"user", "SELECT count(*) FROM users WHERE id=?", []any{userID}, 0},
		{"account card", "SELECT count(*) FROM cards WHERE id=?", []any{accountCardID}, 0},
		{"metadata", "SELECT count(*) FROM user_metadata WHERE user_id=?", []any{userID}, 0},
		{"trial grant", "SELECT count(*) FROM trial_grants WHERE user_id=?", []any{userID}, 0},
		{"redemption relation", "SELECT count(*) FROM card_redemptions WHERE user_id=?", []any{userID}, 0},
		{"feedback thread", "SELECT count(*) FROM feedback_threads WHERE user_id=?", []any{userID}, 0},
		{"feedback message", "SELECT count(*) FROM feedback_messages WHERE thread_id='delete-thread'", nil, 0},
		{"feedback attachment", "SELECT count(*) FROM feedback_attachments WHERE id='delete-attachment'", nil, 0},
		{"source card", "SELECT count(*) FROM cards WHERE card_key='MD-DELETE-AUDIT' AND status='redeemed'", nil, 1},
		{"sales ledger", "SELECT count(*) FROM sales_ledger WHERE card_id=(SELECT id FROM cards WHERE card_key='MD-DELETE-AUDIT')", nil, 1},
		{"trial claim history", "SELECT count(*) FROM trial_claim_history", nil, 1},
	}
	for _, check := range checks {
		var got int
		if err := db.DB.QueryRow(check.query, check.args...).Scan(&got); err != nil || got != check.want {
			t.Errorf("%s count=%d err=%v, want %d", check.name, got, err, check.want)
		}
	}
	oldSession, _ := accountJSON(t, router, http.MethodGet, "/api/account/me", nil, token)
	if oldSession.Code != http.StatusUnauthorized {
		t.Fatalf("deleted account session status=%d, want 401", oldSession.Code)
	}
	second := registerTrialAccount(t, router, "DeleteMeAgain", "delete-test-device", "192.0.2.1")
	assertTrialQuota(t, second, 0, 0)

	for _, marker := range []string{"删除账号", "删除账号：第一次确认", "永久删除账号：第二次确认", "confirmUsername", "input.value!==username", `class="table-wrap user-table-wrap"`, `class="data-table user-table"`, `.user-table th:last-child`, `grid-template-columns:repeat(3,max-content)`, `class="actions user-actions"`} {
		if !strings.Contains(adminHTML, marker) {
			t.Errorf("admin page missing delete confirmation marker %q", marker)
		}
	}
}
