package httpapi

import (
	"crypto/rand"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
	"unicode/utf8"

	store "example.com/miaoda/server/internal/store/sqlite"
	"github.com/go-chi/chi/v5"
	"golang.org/x/crypto/bcrypt"
)

func (s *Server) adminIPAllowed(r *http.Request) bool {
	allowList := strings.TrimSpace(s.cfg.AdminAllowIPs)
	if allowList == "" {
		return true
	}
	requestIP, err := netip.ParseAddr(strings.Trim(clientIP(r), "[]"))
	if err != nil {
		return false
	}
	for _, entry := range strings.Split(allowList, ",") {
		entry = strings.TrimSpace(entry)
		if entry == "" {
			continue
		}
		if prefix, err := netip.ParsePrefix(entry); err == nil && prefix.Contains(requestIP) {
			return true
		}
		if allowed, err := netip.ParseAddr(strings.Trim(entry, "[]")); err == nil && allowed == requestIP {
			return true
		}
	}
	return false
}

func (s *Server) requireAdmin(w http.ResponseWriter, r *http.Request) bool {
	return s.authorizeAdmin(w, r)
}

func (s *Server) listUsers(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit < 1 {
		limit = 100
	}
	if limit > 500 {
		limit = 500
	}
	users, err := s.store.ListUsers(r.Context(), strings.TrimSpace(r.URL.Query().Get("search")), limit)
	if err != nil {
		fail(w, 500, "internal_error", "读取用户列表失败")
		return
	}
	write(w, 200, users)
}

func (s *Server) setUserQuota(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	var q struct {
		InterviewSeconds int64   `json:"interviewSeconds"`
		WrittenQuestions float64 `json:"writtenQuestions"`
	}
	if !decode(w, r, &q) {
		return
	}
	if q.InterviewSeconds < 0 || q.WrittenQuestions < 0 {
		fail(w, 400, "validation_failed", "额度不能小于 0")
		return
	}
	if err := s.store.SetUserQuota(r.Context(), chi.URLParam(r, "username"), q.InterviewSeconds, q.WrittenQuestions); err != nil {
		if err == sql.ErrNoRows {
			fail(w, 404, "user_not_found", "用户不存在")
			return
		}
		fail(w, 500, "internal_error", "更新额度失败")
		return
	}
	write(w, 200, map[string]bool{"ok": true})
}

func (s *Server) setUserStatus(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	var q struct {
		Status string `json:"status"`
	}
	if !decode(w, r, &q) {
		return
	}
	if err := s.store.SetUserStatus(r.Context(), chi.URLParam(r, "username"), q.Status); err != nil {
		if err == sql.ErrNoRows {
			fail(w, 404, "user_not_found", "用户不存在")
			return
		}
		fail(w, 400, "validation_failed", "状态只能是 active 或 disabled")
		return
	}
	write(w, 200, map[string]bool{"ok": true})
}

func (s *Server) resetUserDevices(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	deleted, err := s.store.ResetUserDevices(r.Context(), chi.URLParam(r, "username"))
	if err != nil {
		if err == sql.ErrNoRows {
			fail(w, 404, "user_not_found", "用户不存在")
			return
		}
		fail(w, 500, "internal_error", "清除设备失败")
		return
	}
	write(w, 200, map[string]any{"ok": true, "deleted": deleted})
}

func (s *Server) resetUserPassword(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	var q struct {
		Password string `json:"password"`
	}
	if !decode(w, r, &q) {
		return
	}
	if length := utf8.RuneCountInString(q.Password); length < 8 || length > 24 {
		fail(w, 400, "invalid_password", "密码长度须为 8～24 个字符")
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(q.Password), 12)
	if err != nil {
		fail(w, 400, "invalid_password", "密码无法使用，请更换后重试")
		return
	}
	if err = s.store.SetUserPasswordHash(r.Context(), chi.URLParam(r, "username"), string(hash)); err != nil {
		if err == sql.ErrNoRows {
			fail(w, 404, "user_not_found", "用户不存在")
			return
		}
		fail(w, 500, "internal_error", "重置密码失败")
		return
	}
	write(w, 200, map[string]bool{"ok": true})
}

func (s *Server) deleteUser(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	var q struct {
		ConfirmUsername string `json:"confirmUsername"`
	}
	if !decode(w, r, &q) {
		return
	}
	username, err := s.store.DeleteUser(r.Context(), chi.URLParam(r, "username"), q.ConfirmUsername)
	if err != nil {
		switch {
		case errors.Is(err, sql.ErrNoRows):
			fail(w, http.StatusNotFound, "user_not_found", "用户不存在")
		case errors.Is(err, store.ErrUserDeleteConfirmation):
			fail(w, http.StatusBadRequest, "confirmation_mismatch", "请输入完整且大小写一致的用户名确认删除")
		default:
			fail(w, http.StatusInternalServerError, "internal_error", "删除账号失败")
		}
		return
	}
	write(w, http.StatusOK, map[string]any{"ok": true, "username": username})
}

func cardKey() string {
	const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	for i := range b {
		b[i] = chars[int(b[i])%len(chars)]
	}
	return "MD-" + string(b[:4]) + "-" + string(b[4:8]) + "-" + string(b[8:])
}
func batchCode() string {
	return "BATCH-" + strings.TrimPrefix(cardKey(), "MD-")
}

func normalizeSalesPlatform(platform string) string {
	switch strings.ToLower(strings.TrimSpace(platform)) {
	case "taobao", "淘宝":
		return "taobao"
	case "xianyu", "闲鱼", "咸鱼":
		return "xianyu"
	case "liandong", "链动", "链动小铺":
		return "liandong"
	default:
		return ""
	}
}

func (s *Server) createCards(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	q := struct {
		Count            *int     `json:"count"`
		InterviewSeconds *int64   `json:"interviewSeconds"`
		WrittenQuestions *float64 `json:"writtenQuestions"`
		// Kept for compatibility with an already-open older admin page. The
		// value is intentionally ignored because device entitlement belongs to
		// the account and every new batch uses the fixed compatibility value.
		MaxDevices    *int   `json:"maxDevices"`
		SalesPlatform string `json:"salesPlatform"`
	}{}
	if r.ContentLength > 0 && !decode(w, r, &q) {
		return
	}
	count := 1
	if q.Count != nil {
		count = *q.Count
	}
	if count < 1 {
		count = 1
	}
	if count > 100 {
		count = 100
	}
	secs := int64(10800)
	if q.InterviewSeconds != nil {
		secs = *q.InterviewSeconds
	}
	written := 30.0
	if q.WrittenQuestions != nil {
		written = *q.WrittenQuestions
	}
	if secs < 0 || written < 0 {
		fail(w, 400, "validation_failed", "额度不能小于 0")
		return
	}
	platform := normalizeSalesPlatform(q.SalesPlatform)
	if platform == "" {
		fail(w, 400, "validation_failed", "销售平台必须是淘宝、闲鱼或链动小铺")
		return
	}
	keys := make([]string, 0, count)
	for i := 0; i < count; i++ {
		keys = append(keys, cardKey())
	}
	batch, err := s.store.CreateCardBatch(r.Context(), batchCode(), keys, secs, written, store.DefaultDeviceLimit, platform)
	if err != nil {
		fail(w, 500, "internal_error", err.Error())
		return
	}
	write(w, 200, map[string]any{"batch": batch, "cards": keys})
}

func (s *Server) listCardBatches(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit < 1 {
		limit = 50
	}
	if limit > 200 {
		limit = 200
	}
	batches, err := s.store.ListCardBatches(r.Context(), limit)
	if err != nil {
		fail(w, 500, "internal_error", err.Error())
		return
	}
	write(w, 200, batches)
}

func (s *Server) cardBatchDetails(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	code := strings.TrimSpace(chi.URLParam(r, "batchCode"))
	batch, err := s.store.CardBatchByCode(r.Context(), code)
	if err == sql.ErrNoRows {
		fail(w, 404, "batch_not_found", "卡密分组不存在")
		return
	}
	if err != nil {
		fail(w, 500, "internal_error", err.Error())
		return
	}
	cards, err := s.store.CardsByBatch(r.Context(), code)
	if err != nil {
		fail(w, 500, "internal_error", err.Error())
		return
	}
	write(w, 200, map[string]any{"batch": batch, "cards": cards})
}

func platformDownloadName(platform string) string {
	switch platform {
	case "taobao":
		return "淘宝"
	case "xianyu":
		return "闲鱼"
	case "liandong":
		return "链动"
	default:
		return "历史"
	}
}

func interviewQuotaName(seconds int64) string {
	if seconds%3600 == 0 {
		return strconv.FormatInt(seconds/3600, 10) + "小时"
	}
	if seconds%60 == 0 {
		return strconv.FormatInt(seconds/60, 10) + "分钟"
	}
	return strconv.FormatInt(seconds, 10) + "秒"
}

func cardBatchDownloadName(batch store.CardBatch) string {
	if strings.TrimSpace(batch.DisplayName) != "" {
		return batch.DisplayName
	}
	parts := make([]string, 0, 2)
	if batch.InterviewSeconds > 0 {
		parts = append(parts, "面试"+interviewQuotaName(batch.InterviewSeconds))
	}
	if batch.WrittenQuestions > 0 {
		parts = append(parts, "笔试"+strconv.FormatFloat(batch.WrittenQuestions, 'f', -1, 64)+"次")
	}
	if len(parts) == 0 {
		parts = append(parts, "空额度")
	}
	return platformDownloadName(batch.SalesPlatform) + strings.Join(parts, "+") + "-" + strconv.Itoa(batch.CardCount) + "张"
}

func (s *Server) downloadCardBatch(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	code := strings.TrimSpace(chi.URLParam(r, "batchCode"))
	batch, err := s.store.CardBatchByCode(r.Context(), code)
	if err == sql.ErrNoRows {
		fail(w, 404, "batch_not_found", "卡密分组不存在")
		return
	}
	if err != nil {
		fail(w, 500, "internal_error", err.Error())
		return
	}
	keys, err := s.store.CardBatchKeys(r.Context(), code)
	if err == sql.ErrNoRows {
		fail(w, 404, "batch_not_found", "卡密分组不存在")
		return
	}
	if err != nil {
		fail(w, 500, "internal_error", err.Error())
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	filename := cardBatchDownloadName(batch) + ".txt"
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="cards.txt"; filename*=UTF-8''%s`, url.PathEscape(filename)))
	_, _ = fmt.Fprintln(w, strings.Join(keys, "\n"))
}

func (s *Server) deleteCardBatch(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	deleted, err := s.store.DeleteCardBatch(r.Context(), strings.TrimSpace(chi.URLParam(r, "batchCode")))
	if err == sql.ErrNoRows {
		fail(w, 404, "batch_not_found", "卡密分组不存在")
		return
	}
	if err != nil {
		fail(w, 500, "internal_error", err.Error())
		return
	}
	write(w, 200, map[string]any{"ok": true, "deletedCards": deleted})
}
func (s *Server) listCards(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	n, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if n < 1 {
		n = 50
	}
	if n > 200 {
		n = 200
	}
	cards, e := s.store.ListCards(r.Context(), n)
	if e != nil {
		fail(w, 500, "internal_error", e.Error())
		return
	}
	write(w, 200, cards)
}
func (s *Server) recharge(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	var q struct {
		CardKey          string  `json:"cardKey"`
		InterviewSeconds int64   `json:"interviewSeconds"`
		WrittenQuestions float64 `json:"writtenQuestions"`
	}
	if !decode(w, r, &q) {
		return
	}
	if q.InterviewSeconds < 0 || q.WrittenQuestions < 0 || (q.InterviewSeconds == 0 && q.WrittenQuestions == 0) {
		fail(w, 400, "validation_failed", "充值额度不能小于 0，且至少填写一项")
		return
	}
	ok, e := s.store.Recharge(r.Context(), strings.TrimSpace(q.CardKey), q.InterviewSeconds, q.WrittenQuestions)
	if e != nil {
		fail(w, 500, "internal_error", e.Error())
		return
	}
	if !ok {
		fail(w, 404, "card_not_found", "Card not found")
		return
	}
	write(w, 200, map[string]bool{"ok": true})
}
func (s *Server) resetDevices(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	var q struct {
		CardKey string `json:"cardKey"`
	}
	if !decode(w, r, &q) {
		return
	}
	n, e := s.store.ResetDevices(r.Context(), strings.TrimSpace(q.CardKey))
	if e != nil {
		fail(w, 500, "internal_error", e.Error())
		return
	}
	write(w, 200, map[string]any{"ok": true, "deleted": n})
}
func (s *Server) updateCard(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	var q struct {
		Status           string  `json:"status"`
		InterviewSeconds int64   `json:"interviewSeconds"`
		WrittenQuestions float64 `json:"writtenQuestions"`
		MaxDevices       int     `json:"maxDevices"`
		Note             *string `json:"note"`
	}
	if !decode(w, r, &q) {
		return
	}
	e := s.store.UpdateCard(r.Context(), store.Card{CardKey: chi.URLParam(r, "cardKey"), Status: q.Status, RemainingInterviewSeconds: q.InterviewSeconds, RemainingWrittenQuestions: q.WrittenQuestions, MaxDevices: q.MaxDevices, Note: q.Note})
	if e == sql.ErrNoRows {
		fail(w, 404, "card_not_found", "Card not found")
		return
	}
	if e != nil {
		fail(w, 400, "validation_failed", e.Error())
		return
	}
	write(w, 200, map[string]bool{"ok": true})
}
func (s *Server) deleteCard(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	e := s.store.DeleteCard(r.Context(), chi.URLParam(r, "cardKey"))
	if e == sql.ErrNoRows {
		fail(w, 404, "card_not_found", "Card not found")
		return
	}
	if e != nil {
		fail(w, 500, "internal_error", e.Error())
		return
	}
	write(w, 200, map[string]bool{"ok": true})
}
func (s *Server) adminPage(w http.ResponseWriter, r *http.Request) {
	if !s.adminIPAllowed(r) {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = fmt.Fprint(w, adminHTML)
}

func (s *Server) managePage(w http.ResponseWriter, r *http.Request) {
	if !s.adminIPAllowed(r) {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = fmt.Fprint(w, manageHTML)
}
