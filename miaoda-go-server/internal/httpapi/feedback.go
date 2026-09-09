package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"mime/multipart"
	"net/http"
	"net/smtp"
	"net/url"
	"path/filepath"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	store "example.com/miaoda/server/internal/store/sqlite"
	"github.com/go-chi/chi/v5"
	"golang.org/x/crypto/bcrypt"
)

const (
	maxFeedbackImages = 3
	maxFeedbackBody   = 4000
	maxUserImageBytes = 50 << 20
)

func (s *Server) feedbackUser(w http.ResponseWriter, r *http.Request) (store.User, bool) {
	user, err := s.store.UserByAccountCardID(r.Context(), authOf(r).CardID)
	if err != nil {
		fail(w, http.StatusForbidden, "account_required", "请使用用户名账户登录")
		return store.User{}, false
	}
	return user, true
}

func (s *Server) changeAccountPassword(w http.ResponseWriter, r *http.Request) {
	user, ok := s.feedbackUser(w, r)
	if !ok {
		return
	}
	if !s.authGuard.allow(fmt.Sprintf("password-change:card:%d", user.AccountCardID), 6, 15*time.Minute) || !s.authGuard.allow("password-change:ip:"+clientIP(r), 18, 15*time.Minute) {
		fail(w, http.StatusTooManyRequests, "rate_limited", "尝试次数过多，请稍后再试")
		return
	}
	var q struct {
		CurrentPassword string `json:"currentPassword"`
		NewPassword     string `json:"newPassword"`
	}
	if !decode(w, r, &q) {
		return
	}
	if length := utf8.RuneCountInString(q.NewPassword); length < 8 || length > 24 {
		fail(w, http.StatusBadRequest, "invalid_password", "新密码长度须为 8～24 个字符")
		return
	}
	if q.CurrentPassword == q.NewPassword {
		fail(w, http.StatusBadRequest, "password_unchanged", "新密码不能与当前密码相同")
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(q.CurrentPassword)) != nil {
		fail(w, http.StatusUnauthorized, "invalid_current_password", "当前密码不正确")
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(q.NewPassword), 12)
	if err != nil {
		fail(w, http.StatusBadRequest, "invalid_password", "密码无法使用，请更换后重试")
		return
	}
	if err = s.store.UpdateUserPassword(r.Context(), user.ID, string(hash)); err != nil {
		fail(w, http.StatusInternalServerError, "internal_error", "修改密码失败，请稍后重试")
		return
	}
	http.SetCookie(w, &http.Cookie{Name: webSessionCookie, Value: "", Path: "/", MaxAge: -1, HttpOnly: true, Secure: requestIsHTTPS(r), SameSite: http.SameSiteStrictMode})
	write(w, http.StatusOK, map[string]any{"ok": true, "loginRequired": true})
}

func (s *Server) feedbackUnread(w http.ResponseWriter, r *http.Request) {
	user, ok := s.feedbackUser(w, r)
	if !ok {
		return
	}
	count, err := s.store.FeedbackUnread(r.Context(), user.ID)
	if err != nil {
		fail(w, http.StatusInternalServerError, "internal_error", "读取通知失败")
		return
	}
	write(w, http.StatusOK, map[string]int{"count": count})
}

func (s *Server) listFeedback(w http.ResponseWriter, r *http.Request) {
	user, ok := s.feedbackUser(w, r)
	if !ok {
		return
	}
	items, err := s.store.ListUserFeedback(r.Context(), user.ID)
	if err != nil {
		fail(w, http.StatusInternalServerError, "internal_error", "读取反馈失败")
		return
	}
	write(w, http.StatusOK, items)
}

func parseFeedbackForm(w http.ResponseWriter, r *http.Request, maxImageBytes int64) (string, []store.FeedbackAttachmentInput, bool) {
	if maxImageBytes <= 0 {
		maxImageBytes = 3 << 20
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxImageBytes*maxFeedbackImages+(1<<20))
	if err := r.ParseMultipartForm(512 << 10); err != nil {
		fail(w, http.StatusBadRequest, "invalid_feedback", "反馈内容或图片过大")
		return "", nil, false
	}
	if r.MultipartForm != nil {
		defer r.MultipartForm.RemoveAll()
	}
	body := strings.TrimSpace(r.FormValue("message"))
	if body == "" || utf8.RuneCountInString(body) > maxFeedbackBody {
		fail(w, http.StatusBadRequest, "invalid_feedback", "反馈文字须为 1～4000 个字符")
		return "", nil, false
	}
	files := []*multipart.FileHeader{}
	if r.MultipartForm != nil {
		files = r.MultipartForm.File["images"]
	}
	if len(files) > maxFeedbackImages {
		fail(w, http.StatusBadRequest, "too_many_images", "每次最多上传 3 张图片")
		return "", nil, false
	}
	attachments := make([]store.FeedbackAttachmentInput, 0, len(files))
	for _, header := range files {
		file, err := header.Open()
		if err != nil {
			fail(w, http.StatusBadRequest, "invalid_image", "读取图片失败")
			return "", nil, false
		}
		data, readErr := io.ReadAll(io.LimitReader(file, maxImageBytes+1))
		_ = file.Close()
		if readErr != nil || len(data) == 0 || int64(len(data)) > maxImageBytes {
			fail(w, http.StatusBadRequest, "invalid_image", "单张图片不能超过 "+strconv.FormatInt(maxImageBytes>>20, 10)+" MB")
			return "", nil, false
		}
		mimeType := http.DetectContentType(data)
		if mimeType != "image/jpeg" && mimeType != "image/png" && mimeType != "image/gif" && mimeType != "image/webp" {
			fail(w, http.StatusBadRequest, "invalid_image", "仅支持 JPG、PNG、GIF 或 WebP 图片")
			return "", nil, false
		}
		filename := filepath.Base(strings.ReplaceAll(header.Filename, "\\", "/"))
		if filename == "." || filename == "" {
			filename = "feedback-image"
		}
		attachments = append(attachments, store.FeedbackAttachmentInput{Filename: filename, MIME: mimeType, Data: data})
	}
	return body, attachments, true
}

func (s *Server) createFeedback(w http.ResponseWriter, r *http.Request) {
	user, ok := s.feedbackUser(w, r)
	if !ok {
		return
	}
	if !s.authGuard.allow(fmt.Sprintf("feedback:create:user:%d", user.ID), 10, time.Hour) {
		fail(w, http.StatusTooManyRequests, "rate_limited", "提交过于频繁，请稍后再试")
		return
	}
	body, attachments, ok := parseFeedbackForm(w, r, s.cfg.MaxUpload)
	if !ok {
		return
	}
	if !s.feedbackStorageAllowed(w, r, user.ID, attachments) {
		return
	}
	id, err := s.store.CreateFeedback(r.Context(), user.ID, body, attachments)
	if err != nil {
		fail(w, http.StatusInternalServerError, "internal_error", "提交失败，请稍后重试")
		return
	}
	s.notifyFeedback(user.Username, id, body, len(attachments))
	write(w, http.StatusCreated, map[string]string{"id": id})
}

func (s *Server) getFeedback(w http.ResponseWriter, r *http.Request) {
	user, ok := s.feedbackUser(w, r)
	if !ok {
		return
	}
	item, err := s.store.GetUserFeedback(r.Context(), user.ID, chi.URLParam(r, "feedbackID"), true)
	if err != nil {
		feedbackStoreError(w, err)
		return
	}
	write(w, http.StatusOK, item)
}

func (s *Server) addFeedbackMessage(w http.ResponseWriter, r *http.Request) {
	user, ok := s.feedbackUser(w, r)
	if !ok {
		return
	}
	if !s.authGuard.allow(fmt.Sprintf("feedback:message:user:%d", user.ID), 30, time.Hour) {
		fail(w, http.StatusTooManyRequests, "rate_limited", "提交过于频繁，请稍后再试")
		return
	}
	body, attachments, ok := parseFeedbackForm(w, r, s.cfg.MaxUpload)
	if !ok {
		return
	}
	if !s.feedbackStorageAllowed(w, r, user.ID, attachments) {
		return
	}
	id := chi.URLParam(r, "feedbackID")
	if err := s.store.AddFeedbackMessage(r.Context(), id, user.ID, "user", body, attachments); err != nil {
		feedbackStoreError(w, err)
		return
	}
	s.notifyFeedback(user.Username, id, body, len(attachments))
	write(w, http.StatusCreated, map[string]bool{"ok": true})
}

func (s *Server) feedbackStorageAllowed(w http.ResponseWriter, r *http.Request, userID int64, attachments []store.FeedbackAttachmentInput) bool {
	var incoming int64
	for _, attachment := range attachments {
		incoming += int64(len(attachment.Data))
	}
	if incoming == 0 {
		return true
	}
	used, err := s.store.FeedbackStorageBytes(r.Context(), userID)
	if err != nil {
		fail(w, http.StatusInternalServerError, "internal_error", "校验图片空间失败")
		return false
	}
	if used+incoming > maxUserImageBytes {
		fail(w, http.StatusRequestEntityTooLarge, "feedback_storage_full", "反馈图片空间已达 50 MB，请联系客服清理后再上传")
		return false
	}
	return true
}

func (s *Server) getFeedbackAttachment(w http.ResponseWriter, r *http.Request) {
	user, ok := s.feedbackUser(w, r)
	if !ok {
		return
	}
	attachment, err := s.store.FeedbackAttachmentForUser(r.Context(), user.ID, chi.URLParam(r, "feedbackID"), chi.URLParam(r, "attachmentID"))
	if err != nil {
		feedbackStoreError(w, err)
		return
	}
	serveFeedbackAttachment(w, attachment)
}

func (s *Server) adminFeedbackUnread(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	count, err := s.store.AdminFeedbackUnread(r.Context())
	if err != nil {
		fail(w, http.StatusInternalServerError, "internal_error", "读取通知失败")
		return
	}
	write(w, http.StatusOK, map[string]int{"count": count})
}

func (s *Server) adminListFeedback(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	items, err := s.store.ListAdminFeedback(r.Context())
	if err != nil {
		fail(w, http.StatusInternalServerError, "internal_error", "读取反馈失败")
		return
	}
	write(w, http.StatusOK, items)
}

func (s *Server) adminGetFeedback(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	item, err := s.store.GetAdminFeedback(r.Context(), chi.URLParam(r, "feedbackID"), true)
	if err != nil {
		feedbackStoreError(w, err)
		return
	}
	write(w, http.StatusOK, item)
}

func (s *Server) adminReplyFeedback(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	var q struct {
		Message string `json:"message"`
	}
	if !decode(w, r, &q) {
		return
	}
	q.Message = strings.TrimSpace(q.Message)
	if q.Message == "" || utf8.RuneCountInString(q.Message) > maxFeedbackBody {
		fail(w, http.StatusBadRequest, "invalid_feedback", "回复须为 1～4000 个字符")
		return
	}
	if err := s.store.AddFeedbackMessage(r.Context(), chi.URLParam(r, "feedbackID"), 0, "admin", q.Message, nil); err != nil {
		feedbackStoreError(w, err)
		return
	}
	write(w, http.StatusCreated, map[string]bool{"ok": true})
}

func (s *Server) adminSetFeedbackStatus(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	var q struct {
		Status string `json:"status"`
	}
	if !decode(w, r, &q) {
		return
	}
	if q.Status != "open" && q.Status != "answered" && q.Status != "closed" {
		fail(w, http.StatusBadRequest, "invalid_status", "无效的反馈状态")
		return
	}
	if err := s.store.SetFeedbackStatus(r.Context(), chi.URLParam(r, "feedbackID"), q.Status); err != nil {
		feedbackStoreError(w, err)
		return
	}
	write(w, http.StatusOK, map[string]bool{"ok": true})
}

func (s *Server) adminGetFeedbackAttachment(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	attachment, err := s.store.FeedbackAttachmentForAdmin(r.Context(), chi.URLParam(r, "feedbackID"), chi.URLParam(r, "attachmentID"))
	if err != nil {
		feedbackStoreError(w, err)
		return
	}
	serveFeedbackAttachment(w, attachment)
}

func feedbackStoreError(w http.ResponseWriter, err error) {
	if errors.Is(err, store.ErrFeedbackNotFound) {
		fail(w, http.StatusNotFound, "feedback_not_found", "反馈不存在")
		return
	}
	fail(w, http.StatusInternalServerError, "internal_error", "处理反馈失败，请稍后重试")
}

func serveFeedbackAttachment(w http.ResponseWriter, attachment store.FeedbackAttachment) {
	w.Header().Set("Content-Type", attachment.MIME)
	w.Header().Set("Content-Length", strconv.FormatInt(attachment.Size, 10))
	w.Header().Set("Content-Disposition", `inline; filename="feedback-image"`)
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(attachment.Data)
}

func (s *Server) notifyFeedback(username, feedbackID, body string, imageCount int) {
	if s.cfg.FeedbackNotifyWebhook == "" && (s.cfg.FeedbackNotifyEmail == "" || s.cfg.SMTPHost == "") {
		return
	}
	preview := []rune(strings.Join(strings.Fields(body), " "))
	if len(preview) > 240 {
		preview = append(preview[:240], []rune("……")...)
	}
	message := fmt.Sprintf("秒答收到新的问题反馈\n用户：%s\n编号：%s\n图片：%d 张\n内容：%s\n管理地址：https://api.example.invalid/admin#feedback", username, feedbackID, imageCount, string(preview))
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if s.cfg.FeedbackNotifyWebhook != "" {
			if err := s.sendFeedbackWebhook(ctx, message); err != nil {
				slog.Warn("feedback webhook notification failed", "error", err)
			}
		}
		if s.cfg.FeedbackNotifyEmail != "" && s.cfg.SMTPHost != "" {
			if err := s.sendFeedbackEmail(message); err != nil {
				slog.Warn("feedback email notification failed", "error", err)
			}
		}
	}()
}

func (s *Server) sendFeedbackWebhook(ctx context.Context, message string) error {
	if parsed, err := url.Parse(s.cfg.FeedbackNotifyWebhook); err != nil || parsed.Scheme != "https" || parsed.Host == "" {
		return errors.New("feedback webhook must use https")
	}
	var payload any
	switch s.cfg.FeedbackNotifyWebhookType {
	case "feishu":
		payload = map[string]any{"msg_type": "text", "content": map[string]string{"text": message}}
	case "dingtalk", "wecom":
		payload = map[string]any{"msgtype": "text", "text": map[string]string{"content": message}}
	default:
		payload = map[string]string{"text": message}
	}
	encoded, _ := json.Marshal(payload)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, s.cfg.FeedbackNotifyWebhook, bytes.NewReader(encoded))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	response, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("webhook status %d", response.StatusCode)
	}
	return nil
}

func (s *Server) sendFeedbackEmail(message string) error {
	from := s.cfg.SMTPFrom
	if from == "" {
		from = s.cfg.SMTPUsername
	}
	if from == "" {
		return errors.New("SMTP_FROM is required")
	}
	to := s.cfg.FeedbackNotifyEmail
	if strings.ContainsAny(from+to, "\r\n") {
		return errors.New("invalid email address")
	}
	headers := "From: " + from + "\r\nTo: " + to + "\r\nSubject: =?UTF-8?B?56eS562U5paw6Zeu6aKY5Y+N6aaI?=\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n"
	var auth smtp.Auth
	if s.cfg.SMTPUsername != "" {
		auth = smtp.PlainAuth("", s.cfg.SMTPUsername, s.cfg.SMTPPassword, s.cfg.SMTPHost)
	}
	return smtp.SendMail(s.cfg.SMTPHost+":"+strconv.Itoa(s.cfg.SMTPPort), auth, from, []string{to}, []byte(headers+message))
}
