package httpapi

import (
	"encoding/json"
	"mime"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"example.com/miaoda/server/internal/config"
	store "example.com/miaoda/server/internal/store/sqlite"
)

func TestAdminCreatesAndDownloadsCardBatch(t *testing.T) {
	_, db := accountTestServer(t)
	server := New(config.Config{
		JWTSecret:  strings.Repeat("s", 40),
		TokenTTL:   time.Hour,
		AdminToken: "top-secret-admin",
	}, db)
	router := server.Router()

	created, payload := adminJSON(t, router, http.MethodPost, "/api/admin/cards/create", map[string]any{
		"count": 3, "interviewSeconds": 3600, "writtenQuestions": 5, "maxDevices": 1, "salesPlatform": "taobao",
	}, "top-secret-admin", "")
	if created.Code != http.StatusOK {
		t.Fatalf("create batch status=%d body=%s", created.Code, created.Body.String())
	}
	batch, ok := payload["batch"].(map[string]any)
	if !ok || batch["salesPlatform"] != "taobao" || batch["maxDevices"] != float64(5) || batch["cardCount"] != float64(3) {
		t.Fatalf("unexpected batch payload: %#v", payload)
	}
	batchCode, _ := batch["batchCode"].(string)
	if batchCode == "" {
		t.Fatalf("missing batch code: %#v", batch)
	}
	if batch["displayName"] != "淘宝面试1小时+笔试5次-3张-0001" {
		t.Fatalf("unexpected batch display name: %#v", batch)
	}

	listRequest := httptest.NewRequest(http.MethodGet, "/api/admin/card-batches?limit=10", nil)
	listRequest.Header.Set("X-Admin-Token", "top-secret-admin")
	listRequest.Header.Set("X-Admin-Username", config.DefaultAdminUsername)
	listResponse := httptest.NewRecorder()
	router.ServeHTTP(listResponse, listRequest)
	var batches []map[string]any
	if err := json.Unmarshal(listResponse.Body.Bytes(), &batches); err != nil {
		t.Fatal(err)
	}
	if listResponse.Code != http.StatusOK || len(batches) != 1 || batches[0]["batchCode"] != batchCode {
		t.Fatalf("list batches status=%d body=%s", listResponse.Code, listResponse.Body.String())
	}
	detailRequest := httptest.NewRequest(http.MethodGet, "/api/admin/card-batches/"+batchCode, nil)
	detailRequest.Header.Set("X-Admin-Token", "top-secret-admin")
	detailRequest.Header.Set("X-Admin-Username", config.DefaultAdminUsername)
	detailResponse := httptest.NewRecorder()
	router.ServeHTTP(detailResponse, detailRequest)
	var detail map[string]any
	if err := json.Unmarshal(detailResponse.Body.Bytes(), &detail); err != nil {
		t.Fatal(err)
	}
	detailCards, _ := detail["cards"].([]any)
	if detailResponse.Code != http.StatusOK || len(detailCards) != 3 {
		t.Fatalf("batch details status=%d body=%s", detailResponse.Code, detailResponse.Body.String())
	}

	downloadRequest := httptest.NewRequest(http.MethodGet, "/api/admin/card-batches/"+batchCode+"/download", nil)
	downloadRequest.Header.Set("X-Admin-Token", "top-secret-admin")
	downloadRequest.Header.Set("X-Admin-Username", config.DefaultAdminUsername)
	downloadResponse := httptest.NewRecorder()
	router.ServeHTTP(downloadResponse, downloadRequest)
	lines := strings.Split(strings.TrimSpace(downloadResponse.Body.String()), "\n")
	if downloadResponse.Code != http.StatusOK || len(lines) != 3 {
		t.Fatalf("download status=%d lines=%d body=%q", downloadResponse.Code, len(lines), downloadResponse.Body.String())
	}
	for _, line := range lines {
		if strings.TrimSpace(line) != line || !strings.HasPrefix(line, "MD-") {
			t.Fatalf("download must contain one bare card key per line: %q", line)
		}
	}
	loginResponse, _ := accountJSON(t, router, http.MethodPost, "/api/auth/login", map[string]any{
		"cardKey": lines[0], "deviceId": "batch-delete-device", "deviceName": "Windows", "platform": "windows",
	}, "")
	if loginResponse.Code != http.StatusOK {
		t.Fatalf("prepare dependent session status=%d body=%s", loginResponse.Code, loginResponse.Body.String())
	}
	_, disposition, err := mime.ParseMediaType(downloadResponse.Header().Get("Content-Disposition"))
	if err != nil || disposition["filename"] != "淘宝面试1小时+笔试5次-3张-0001.txt" {
		t.Fatalf("unexpected download filename: params=%#v err=%v", disposition, err)
	}

	deleteRequest := httptest.NewRequest(http.MethodDelete, "/api/admin/card-batches/"+batchCode, nil)
	deleteRequest.Header.Set("X-Admin-Token", "top-secret-admin")
	deleteRequest.Header.Set("X-Admin-Username", config.DefaultAdminUsername)
	deleteResponse := httptest.NewRecorder()
	router.ServeHTTP(deleteResponse, deleteRequest)
	if deleteResponse.Code != http.StatusOK || !strings.Contains(deleteResponse.Body.String(), `"deletedCards":3`) {
		t.Fatalf("delete batch status=%d body=%s", deleteResponse.Code, deleteResponse.Body.String())
	}
	detailRequest = httptest.NewRequest(http.MethodGet, "/api/admin/card-batches/"+batchCode, nil)
	detailRequest.Header.Set("X-Admin-Token", "top-secret-admin")
	detailRequest.Header.Set("X-Admin-Username", config.DefaultAdminUsername)
	detailAfterDelete := httptest.NewRecorder()
	router.ServeHTTP(detailAfterDelete, detailRequest)
	if detailAfterDelete.Code != http.StatusNotFound {
		t.Fatalf("deleted batch still exists: status=%d body=%s", detailAfterDelete.Code, detailAfterDelete.Body.String())
	}
	for _, table := range []string{"cards", "devices", "sessions", "card_batch_members", "card_batches"} {
		var count int
		if err = db.DB.QueryRow("SELECT count(*) FROM " + table).Scan(&count); err != nil || count != 0 {
			t.Fatalf("batch deletion left rows in %s: count=%d err=%v", table, count, err)
		}
	}
}

func TestAdminPageTreatsCardsAsQuotaOnly(t *testing.T) {
	if strings.Contains(adminHTML, `id="devices"`) {
		t.Fatal("admin page still lets card batches configure a device limit")
	}
	if !strings.Contains(adminHTML, "卡密只充值额度，不改变设备数；每个账号固定可登录 5 台设备") {
		t.Fatal("admin page does not explain the account-level device policy")
	}
}

func TestCardBatchDownloadNames(t *testing.T) {
	tests := []struct {
		batch store.CardBatch
		want  string
	}{
		{store.CardBatch{SalesPlatform: "liandong", WrittenQuestions: 30, CardCount: 30}, "链动笔试30次-30张"},
		{store.CardBatch{SalesPlatform: "taobao", InterviewSeconds: 3600, CardCount: 30}, "淘宝面试1小时-30张"},
		{store.CardBatch{SalesPlatform: "xianyu", InterviewSeconds: 600, WrittenQuestions: 2.5, CardCount: 8}, "闲鱼面试10分钟+笔试2.5次-8张"},
	}
	for _, test := range tests {
		if got := cardBatchDownloadName(test.batch); got != test.want {
			t.Errorf("download name=%q, want %q", got, test.want)
		}
	}
}

func TestAdminRejectsUnknownSalesPlatform(t *testing.T) {
	_, db := accountTestServer(t)
	server := New(config.Config{JWTSecret: strings.Repeat("s", 40), TokenTTL: time.Hour, AdminToken: "top-secret-admin"}, db)
	recorder, _ := adminJSON(t, server.Router(), http.MethodPost, "/api/admin/cards/create", map[string]any{
		"count": 1, "interviewSeconds": 600, "writtenQuestions": 0, "salesPlatform": "unknown",
	}, "top-secret-admin", "")
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("unknown platform status=%d body=%s", recorder.Code, recorder.Body.String())
	}
}
