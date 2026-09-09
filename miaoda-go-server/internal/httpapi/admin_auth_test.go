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

func adminCookie(t *testing.T, recorder *httptest.ResponseRecorder) *http.Cookie {
	t.Helper()
	for _, cookie := range recorder.Result().Cookies() {
		if cookie.Name == adminSessionCookie {
			return cookie
		}
	}
	t.Fatalf("response did not set %s: %s", adminSessionCookie, recorder.Body.String())
	return nil
}

func adminCookieJSON(t *testing.T, handler http.Handler, method, path string, body any, cookie *http.Cookie, csrf bool) *httptest.ResponseRecorder {
	t.Helper()
	encoded, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(method, path, bytes.NewReader(encoded))
	request.Header.Set("Content-Type", "application/json")
	if cookie != nil {
		request.AddCookie(cookie)
	}
	if csrf {
		request.Header.Set("X-Admin-CSRF", adminCSRFFlag)
	}
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	return recorder
}

func TestAdminPasswordLoginSessionAndChange(t *testing.T) {
	_, db := accountTestServer(t)
	initialPassword := "bootstrap-admin-password-123456"
	server := New(config.Config{
		JWTSecret:  strings.Repeat("j", 40),
		TokenTTL:   time.Hour,
		AdminToken: initialPassword,
	}, db)
	router := server.Router()

	missing := adminCookieJSON(t, router, http.MethodGet, "/api/admin/auth/session", nil, nil, false)
	if missing.Code != http.StatusUnauthorized {
		t.Fatalf("session without login status=%d body=%s", missing.Code, missing.Body.String())
	}
	missingUsername := adminCookieJSON(t, router, http.MethodPost, "/api/admin/auth/login", map[string]string{"password": initialPassword}, nil, false)
	if missingUsername.Code != http.StatusUnauthorized {
		t.Fatalf("missing username status=%d body=%s", missingUsername.Code, missingUsername.Body.String())
	}
	wrongUsername := adminCookieJSON(t, router, http.MethodPost, "/api/admin/auth/login", map[string]string{"username": "another-admin", "password": initialPassword}, nil, false)
	if wrongUsername.Code != http.StatusUnauthorized {
		t.Fatalf("wrong username status=%d body=%s", wrongUsername.Code, wrongUsername.Body.String())
	}
	wrong := adminCookieJSON(t, router, http.MethodPost, "/api/admin/auth/login", map[string]string{"username": config.DefaultAdminUsername, "password": "wrong-password-value"}, nil, false)
	if wrong.Code != http.StatusUnauthorized {
		t.Fatalf("wrong password status=%d body=%s", wrong.Code, wrong.Body.String())
	}
	loginRequest := httptest.NewRequest(http.MethodPost, "/api/admin/auth/login", bytes.NewBufferString(`{"username":"`+config.DefaultAdminUsername+`","password":"`+initialPassword+`"}`))
	loginRequest.Header.Set("Content-Type", "application/json")
	loginRequest.Header.Set("X-Forwarded-Proto", "https")
	login := httptest.NewRecorder()
	router.ServeHTTP(login, loginRequest)
	if login.Code != http.StatusOK {
		t.Fatalf("login status=%d body=%s", login.Code, login.Body.String())
	}
	sessionCookie := adminCookie(t, login)
	if !sessionCookie.HttpOnly || !sessionCookie.Secure || sessionCookie.SameSite != http.SameSiteStrictMode {
		t.Fatalf("admin cookie security attributes: %#v", sessionCookie)
	}
	credential, err := db.AdminCredential(t.Context())
	if err != nil || credential.Username != config.DefaultAdminUsername || credential.SessionVersion != 1 || credential.PasswordHash == initialPassword {
		t.Fatalf("credential was not initialized safely: version=%d err=%v", credential.SessionVersion, err)
	}
	session := adminCookieJSON(t, router, http.MethodGet, "/api/admin/auth/session", nil, sessionCookie, false)
	if session.Code != http.StatusOK || !strings.Contains(session.Body.String(), `"authenticated":true`) {
		t.Fatalf("session status=%d body=%s", session.Code, session.Body.String())
	}
	dashboard := adminCookieJSON(t, router, http.MethodGet, "/api/admin/dashboard?days=7", nil, sessionCookie, false)
	if dashboard.Code != http.StatusOK {
		t.Fatalf("cookie-authenticated dashboard status=%d body=%s", dashboard.Code, dashboard.Body.String())
	}
	noCSRF := adminCookieJSON(t, router, http.MethodPost, "/api/admin/cards/create", map[string]any{
		"count": 1, "interviewSeconds": 600, "writtenQuestions": 0, "salesPlatform": "taobao",
	}, sessionCookie, false)
	if noCSRF.Code != http.StatusForbidden {
		t.Fatalf("cookie mutation without CSRF status=%d body=%s", noCSRF.Code, noCSRF.Body.String())
	}

	newPassword := "replacement-admin-password-654321"
	change := adminCookieJSON(t, router, http.MethodPost, "/api/admin/auth/password", map[string]string{
		"currentPassword": initialPassword,
		"newPassword":     newPassword,
	}, sessionCookie, true)
	if change.Code != http.StatusOK {
		t.Fatalf("change password status=%d body=%s", change.Code, change.Body.String())
	}
	newCookie := adminCookie(t, change)
	credential, err = db.AdminCredential(t.Context())
	if err != nil || credential.SessionVersion != 2 || credential.PasswordHash == newPassword {
		t.Fatalf("changed credential was not stored safely: version=%d err=%v", credential.SessionVersion, err)
	}
	oldSession := adminCookieJSON(t, router, http.MethodGet, "/api/admin/auth/session", nil, sessionCookie, false)
	if oldSession.Code != http.StatusUnauthorized {
		t.Fatalf("old session survived password change: status=%d", oldSession.Code)
	}
	oldLogin := adminCookieJSON(t, router, http.MethodPost, "/api/admin/auth/login", map[string]string{"username": config.DefaultAdminUsername, "password": initialPassword}, nil, false)
	if oldLogin.Code != http.StatusUnauthorized {
		t.Fatalf("old password still logs in: status=%d", oldLogin.Code)
	}
	oldHeader, _ := adminJSON(t, router, http.MethodGet, "/api/admin/users", nil, initialPassword, "")
	if oldHeader.Code != http.StatusUnauthorized {
		t.Fatalf("old legacy header still authenticates: status=%d", oldHeader.Code)
	}
	newHeader, _ := adminJSON(t, router, http.MethodGet, "/api/admin/users", nil, newPassword, "")
	if newHeader.Code != http.StatusOK {
		t.Fatalf("new password header status=%d body=%s", newHeader.Code, newHeader.Body.String())
	}
	passwordOnlyRequest := httptest.NewRequest(http.MethodGet, "/api/admin/users", nil)
	passwordOnlyRequest.Header.Set("X-Admin-Token", newPassword)
	passwordOnly := httptest.NewRecorder()
	router.ServeHTTP(passwordOnly, passwordOnlyRequest)
	if passwordOnly.Code != http.StatusUnauthorized {
		t.Fatalf("password-only admin header bypassed username: status=%d body=%s", passwordOnly.Code, passwordOnly.Body.String())
	}
	newSession := adminCookieJSON(t, router, http.MethodGet, "/api/admin/auth/session", nil, newCookie, false)
	if newSession.Code != http.StatusOK {
		t.Fatalf("new session status=%d body=%s", newSession.Code, newSession.Body.String())
	}
}

func TestAdminConsoleUsesUsernameAndPasswordWithoutBrowserTokenStorage(t *testing.T) {
	for _, forbidden := range []string{"保存并验证", "管理员 Token", "sessionStorage", "miaoda_admin_token", `value="admin"`, "data-1p-ignore", "data-lpignore", "resetLoginFields", "unlockLoginField"} {
		if strings.Contains(adminHTML, forbidden) {
			t.Fatalf("admin console still contains legacy token UI/storage: %q", forbidden)
		}
	}
	for _, required := range []string{"管理员登录", "管理员用户名", `id="login-username" name="username" type="text" autocomplete="username"`, `id="login-password" name="password" type="password" autocomplete="current-password"`, "支持公网安全访问", "请求日志", "今日面试请求", "点击日期查看当天全部请求", "请求明细", "客户端版本", "logClientVersion", "未记录", "问题内容", "历史未记录", "不保存回答、简历和上下文", "历史未采集", "每 5 秒自动更新", "/interview-logs?days=30", "selectedRequests", "卡密管理", "用户管理", `data-user-sort="interview"`, `data-user-sort="activity"`, `aria-sort="none"`, "function sortedUsers()", "网站访问统计", "累计收益估算", "每日新增用户", "展开访问明细", "展开新增用户明细", "修改管理密码"} {
		if !strings.Contains(adminHTML, required) {
			t.Fatalf("admin console missing %q", required)
		}
	}
	previousNavIndex := -1
	for _, view := range []string{"cards", "users", "analytics", "logs", "trial", "feedback"} {
		marker := `data-view="` + view + `"`
		index := strings.Index(adminHTML, marker)
		if index < 0 || index <= previousNavIndex {
			t.Fatalf("admin navigation order is incorrect at %q", marker)
		}
		previousNavIndex = index
	}
	for _, collapsed := range []string{`id="visitor-detail" hidden`, `id="user-growth-detail" hidden`} {
		if !strings.Contains(adminHTML, collapsed) {
			t.Fatalf("admin detail must be collapsed by default: %q", collapsed)
		}
	}
	for _, marker := range []string{`id="log-mask"`, `id="log-day-page-size"`, `id="log-request-page-size"`, `selectedPageSize`} {
		if !strings.Contains(adminHTML, marker) {
			t.Fatalf("admin page missing request log pagination marker %q", marker)
		}
	}
	if manageHTML != adminHTML {
		t.Fatal("/manage must serve the unified enterprise console")
	}
}
