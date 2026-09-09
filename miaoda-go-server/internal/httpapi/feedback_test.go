package httpapi

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"example.com/miaoda/server/internal/config"
)

func feedbackMultipart(t *testing.T, handler http.Handler, path, message, token string, withImage bool) (*httptest.ResponseRecorder, map[string]any) {
	t.Helper()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	if err := writer.WriteField("message", message); err != nil {
		t.Fatal(err)
	}
	if withImage {
		part, err := writer.CreateFormFile("images", "problem.png")
		if err != nil {
			t.Fatal(err)
		}
		// DetectContentType identifies this signature as PNG; the service does
		// not decode images, so malformed payloads cannot reach an image parser.
		_, _ = part.Write([]byte("\x89PNG\r\n\x1a\nfeedback-test"))
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, path, &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	var response map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &response)
	return rec, response
}

func registerFeedbackUser(t *testing.T, handler http.Handler, username string) string {
	t.Helper()
	rec, response := accountJSON(t, handler, http.MethodPost, "/api/auth/register", map[string]any{
		"username": username, "password": "password8", "deviceId": "web-" + username, "deviceName": "browser", "platform": "web",
	}, "")
	if rec.Code != http.StatusOK {
		t.Fatalf("register %s status=%d body=%s", username, rec.Code, rec.Body.String())
	}
	token, _ := response["token"].(string)
	return token
}

func TestFeedbackConversationAuthorizationAndUnread(t *testing.T) {
	_, db := accountTestServer(t)
	server := New(config.Config{JWTSecret: strings.Repeat("s", 40), TokenTTL: time.Hour, AdminToken: "top-secret-admin", MaxUpload: 1 << 20}, db)
	router := server.Router()
	userToken := registerFeedbackUser(t, router, "feedback-user")
	otherToken := registerFeedbackUser(t, router, "feedback-other")

	created, payload := feedbackMultipart(t, router, "/api/feedback", "启动后按钮没有响应", userToken, true)
	if created.Code != http.StatusCreated {
		t.Fatalf("create feedback status=%d body=%s", created.Code, created.Body.String())
	}
	feedbackID, _ := payload["id"].(string)
	if feedbackID == "" {
		t.Fatal("feedback id is empty")
	}

	adminUnread, data := adminJSON(t, router, http.MethodGet, "/api/admin/feedback/unread", nil, "top-secret-admin", "")
	if adminUnread.Code != http.StatusOK || data["count"] != float64(1) {
		t.Fatalf("admin unread status=%d payload=%#v", adminUnread.Code, data)
	}

	adminDetailReq := httptest.NewRequest(http.MethodGet, "/api/admin/feedback/"+feedbackID, nil)
	adminDetailReq.Header.Set("X-Admin-Token", "top-secret-admin")
	adminDetailReq.Header.Set("X-Admin-Username", config.DefaultAdminUsername)
	adminDetail := httptest.NewRecorder()
	router.ServeHTTP(adminDetail, adminDetailReq)
	if adminDetail.Code != http.StatusOK {
		t.Fatalf("admin detail status=%d body=%s", adminDetail.Code, adminDetail.Body.String())
	}
	var detail map[string]any
	if err := json.Unmarshal(adminDetail.Body.Bytes(), &detail); err != nil {
		t.Fatal(err)
	}
	messages, _ := detail["messages"].([]any)
	first, _ := messages[0].(map[string]any)
	attachments, _ := first["attachments"].([]any)
	attachment, _ := attachments[0].(map[string]any)
	attachmentID, _ := attachment["id"].(string)
	if attachmentID == "" {
		t.Fatalf("attachment missing in %#v", detail)
	}

	adminUnread, data = adminJSON(t, router, http.MethodGet, "/api/admin/feedback/unread", nil, "top-secret-admin", "")
	if data["count"] != float64(0) {
		t.Fatalf("admin unread after read=%#v", data)
	}
	reply, _ := adminJSON(t, router, http.MethodPost, "/api/admin/feedback/"+feedbackID+"/reply", map[string]string{"message": "已收到，请升级后重试。"}, "top-secret-admin", "")
	if reply.Code != http.StatusCreated {
		t.Fatalf("admin reply status=%d body=%s", reply.Code, reply.Body.String())
	}

	userUnread, data := accountJSON(t, router, http.MethodGet, "/api/feedback/unread", nil, userToken)
	if userUnread.Code != http.StatusOK || data["count"] != float64(1) {
		t.Fatalf("user unread status=%d payload=%#v", userUnread.Code, data)
	}
	otherDetail, _ := accountJSON(t, router, http.MethodGet, "/api/feedback/"+feedbackID, nil, otherToken)
	if otherDetail.Code != http.StatusNotFound {
		t.Fatalf("other account detail status=%d", otherDetail.Code)
	}

	ownerDetail, _ := accountJSON(t, router, http.MethodGet, "/api/feedback/"+feedbackID, nil, userToken)
	if ownerDetail.Code != http.StatusOK {
		t.Fatalf("owner detail status=%d body=%s", ownerDetail.Code, ownerDetail.Body.String())
	}
	userUnread, data = accountJSON(t, router, http.MethodGet, "/api/feedback/unread", nil, userToken)
	if data["count"] != float64(0) {
		t.Fatalf("user unread after read=%#v", data)
	}

	attachmentPath := "/api/feedback/" + feedbackID + "/attachments/" + attachmentID
	ownerImageReq := httptest.NewRequest(http.MethodGet, attachmentPath, nil)
	ownerImageReq.Header.Set("Authorization", "Bearer "+userToken)
	ownerImage := httptest.NewRecorder()
	router.ServeHTTP(ownerImage, ownerImageReq)
	if ownerImage.Code != http.StatusOK || ownerImage.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("owner image status=%d type=%s", ownerImage.Code, ownerImage.Header().Get("Content-Type"))
	}
	otherImageReq := httptest.NewRequest(http.MethodGet, attachmentPath, nil)
	otherImageReq.Header.Set("Authorization", "Bearer "+otherToken)
	otherImage := httptest.NewRecorder()
	router.ServeHTTP(otherImage, otherImageReq)
	if otherImage.Code != http.StatusNotFound {
		t.Fatalf("other account image status=%d", otherImage.Code)
	}
}

func TestAccountPasswordChangeRevokesSessions(t *testing.T) {
	server, _ := accountTestServer(t)
	router := server.Router()
	token := registerFeedbackUser(t, router, "password-user")

	wrong, _ := accountJSON(t, router, http.MethodPost, "/api/account/password", map[string]string{"currentPassword": "wrong-password", "newPassword": "new-password8"}, token)
	if wrong.Code != http.StatusUnauthorized {
		t.Fatalf("wrong current password status=%d body=%s", wrong.Code, wrong.Body.String())
	}
	changed, _ := accountJSON(t, router, http.MethodPost, "/api/account/password", map[string]string{"currentPassword": "password8", "newPassword": "new-password8"}, token)
	if changed.Code != http.StatusOK {
		t.Fatalf("password change status=%d body=%s", changed.Code, changed.Body.String())
	}
	if cookies := changed.Result().Cookies(); len(cookies) == 0 || cookies[0].Name != webSessionCookie || cookies[0].MaxAge >= 0 {
		t.Fatalf("password change did not clear session cookie: %#v", cookies)
	}

	me, _ := accountJSON(t, router, http.MethodGet, "/api/account/me", nil, token)
	if me.Code != http.StatusUnauthorized {
		t.Fatalf("old session status=%d", me.Code)
	}
	oldLogin, _ := accountJSON(t, router, http.MethodPost, "/api/auth/account-login", map[string]any{"username": "password-user", "password": "password8", "deviceId": "web-old", "platform": "web"}, "")
	if oldLogin.Code != http.StatusUnauthorized {
		t.Fatalf("old password login status=%d", oldLogin.Code)
	}
	newLogin, payload := accountJSON(t, router, http.MethodPost, "/api/auth/account-login", map[string]any{"username": "password-user", "password": "new-password8", "deviceId": "web-new", "platform": "web"}, "")
	if newLogin.Code != http.StatusOK || payload["token"] == nil {
		t.Fatalf("new password login status=%d body=%s", newLogin.Code, newLogin.Body.String())
	}
}

func TestFeedbackRejectsExcessImages(t *testing.T) {
	server, _ := accountTestServer(t)
	router := server.Router()
	token := registerFeedbackUser(t, router, "image-limit-user")
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	_ = writer.WriteField("message", "图片数量测试")
	for index := 0; index < maxFeedbackImages+1; index++ {
		part, err := writer.CreateFormFile("images", "image-"+strconv.Itoa(index)+".png")
		if err != nil {
			t.Fatal(err)
		}
		_, _ = part.Write([]byte("\x89PNG\r\n\x1a\n"))
	}
	_ = writer.Close()
	req := httptest.NewRequest(http.MethodPost, "/api/feedback", &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("excess images status=%d body=%s", rec.Code, rec.Body.String())
	}
}
