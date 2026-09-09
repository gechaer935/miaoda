package httpapi

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
	"time"

	"example.com/miaoda/server/internal/config"
	"example.com/miaoda/server/internal/provider"
	store "example.com/miaoda/server/internal/store/sqlite"
	"github.com/go-chi/chi/v5"
	"github.com/golang-jwt/jwt/v5"
)

type authKey struct{}

const webSessionCookie = "miaoda_session"

type Server struct {
	cfg       config.Config
	store     *store.Store
	models    *provider.Client
	companion *Companion
	authGuard *authLimiter
	turnGuard *interviewTurnGuard
	dummyHash []byte
}

func New(c config.Config, s *store.Store) *Server {
	c.AdminUsername = strings.TrimSpace(c.AdminUsername)
	if c.AdminUsername == "" {
		c.AdminUsername = config.DefaultAdminUsername
	}
	guard, dummyHash := newAccountSecurity()
	x := &Server{cfg: c, store: s, models: provider.New(c), authGuard: guard, turnGuard: newInterviewTurnGuard(), dummyHash: dummyHash}
	x.companion = NewCompanion(c, s, http.HandlerFunc(x.solve), guard)
	return x
}
func (s *Server) Router() http.Handler {
	r := chi.NewRouter()
	r.Use(s.recover, s.securityHeaders, s.cors, s.requestID)
	r.Get("/health", func(w http.ResponseWriter, r *http.Request) {
		write(w, 200, map[string]any{"status": "ok", "service": "miaoda-go-server", "time": time.Now().UTC()})
	})
	r.Get("/admin", s.adminPage)
	r.Get("/manage", s.managePage)
	r.Route("/api", func(r chi.Router) {
		r.Post("/auth/login", s.login)
		r.Post("/auth/register", s.registerAccount)
		r.Post("/auth/account-login", s.loginAccount)
		r.Get("/public/config", s.publicConfig)
		r.Post("/public/site-visit", s.recordSiteVisit)
		r.Post("/companion/pairings/claim", s.companion.Claim)
		r.Get("/companion/bootstrap", s.companion.Bootstrap)
		r.Method(http.MethodPost, "/mobile/solve-screen", s.companion.MobileAuth(http.HandlerFunc(s.solve)))
		r.Group(func(r chi.Router) {
			r.Use(s.auth)
			r.Post("/auth/logout", s.logout)
			r.Get("/me/quota", s.quota)
			r.Get("/account/me", s.accountMe)
			r.Post("/account/password", s.changeAccountPassword)
			r.Post("/account/redeem", s.redeemCard)
			r.Get("/feedback/unread", s.feedbackUnread)
			r.Get("/feedback", s.listFeedback)
			r.Post("/feedback", s.createFeedback)
			r.Get("/feedback/{feedbackID}", s.getFeedback)
			r.Post("/feedback/{feedbackID}/messages", s.addFeedbackMessage)
			r.Get("/feedback/{feedbackID}/attachments/{attachmentID}", s.getFeedbackAttachment)
			r.Post("/session/heartbeat", s.heartbeat)
			r.Post("/interview/answer", s.answer)
			r.Post("/interview/answer-stream", s.answerStream)
			r.Post("/interview/translate-stream", s.translateStream)
			r.Post("/interview/asr", s.asr)
			r.Post("/written/solve-screen", s.solve)
			r.Mount("/companion", s.companion.DesktopRoutes())
		})
		r.Route("/admin", func(r chi.Router) {
			r.Post("/auth/login", s.adminLogin)
			r.Get("/auth/session", s.adminSession)
			r.Post("/auth/logout", s.adminLogout)
			r.Post("/auth/password", s.changeAdminPassword)
			r.Get("/trial-offer", s.adminTrialOffer)
			r.Put("/trial-offer", s.updateAdminTrialOffer)
			r.Get("/dashboard", s.adminDashboard)
			r.Get("/interview-logs", s.adminInterviewLogs)
			r.Get("/users", s.listUsers)
			r.Post("/users/{username}/quota", s.setUserQuota)
			r.Post("/users/{username}/status", s.setUserStatus)
			r.Post("/users/{username}/reset-devices", s.resetUserDevices)
			r.Post("/users/{username}/password", s.resetUserPassword)
			r.Delete("/users/{username}", s.deleteUser)
			r.Get("/feedback/unread", s.adminFeedbackUnread)
			r.Get("/feedback", s.adminListFeedback)
			r.Get("/feedback/{feedbackID}", s.adminGetFeedback)
			r.Post("/feedback/{feedbackID}/reply", s.adminReplyFeedback)
			r.Post("/feedback/{feedbackID}/status", s.adminSetFeedbackStatus)
			r.Get("/feedback/{feedbackID}/attachments/{attachmentID}", s.adminGetFeedbackAttachment)
			r.Post("/cards/create", s.createCards)
			r.Get("/cards", s.listCards)
			r.Get("/card-batches", s.listCardBatches)
			r.Get("/card-batches/{batchCode}", s.cardBatchDetails)
			r.Get("/card-batches/{batchCode}/download", s.downloadCardBatch)
			r.Delete("/card-batches/{batchCode}", s.deleteCardBatch)
			r.Post("/cards/recharge", s.recharge)
			r.Post("/cards/reset-devices", s.resetDevices)
			r.Put("/cards/{cardKey}", s.updateCard)
			r.Delete("/cards/{cardKey}", s.deleteCard)
		})
	})
	r.Method(http.MethodGet, "/ws/companion/device", s.auth(http.HandlerFunc(s.companion.DeviceWS)))
	r.Get("/ws/companion/mobile", s.companion.MobileWS)
	r.Get("/ws/asr", s.asrWSAuth)
	return r
}

func (s *Server) securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Permissions-Policy", "camera=(), geolocation=(), microphone=()")
		if strings.HasPrefix(r.URL.Path, "/api/") || strings.HasPrefix(r.URL.Path, "/ws/") || r.URL.Path == "/admin" || r.URL.Path == "/manage" {
			w.Header().Set("Cache-Control", "no-store")
		}
		if r.URL.Path == "/admin" || r.URL.Path == "/manage" {
			w.Header().Set("Content-Security-Policy", "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'")
		}
		next.ServeHTTP(w, r)
	})
}
func write(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func fail(w http.ResponseWriter, status int, code, msg string) {
	write(w, status, map[string]any{"error": map[string]string{"code": code, "message": msg}})
}
func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	d := json.NewDecoder(r.Body)
	d.DisallowUnknownFields()
	if e := d.Decode(v); e != nil {
		fail(w, 400, "validation_failed", e.Error())
		return false
	}
	return true
}
func (s *Server) recover(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if v := recover(); v != nil {
				slog.Error("panic", "error", v)
				fail(w, 500, "internal_error", "Internal server error")
			}
		}()
		next.ServeHTTP(w, r)
	})
}
func (s *Server) requestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := r.Header.Get("X-Request-ID")
		if id == "" {
			id = randomHex(12)
		}
		w.Header().Set("X-Request-ID", id)
		next.ServeHTTP(w, r)
	})
}
func (s *Server) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		o := r.Header.Get("Origin")
		if o != "" && originOK(s.cfg.AllowOrigin, o) {
			w.Header().Set("Access-Control-Allow-Origin", o)
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Set("Vary", "Origin")
		}
		w.Header().Set("Access-Control-Allow-Headers", "Authorization,Content-Type,X-Admin-Username,X-Admin-Token,X-Device-ID")
		w.Header().Set("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS")
		if r.Method == "OPTIONS" {
			w.WriteHeader(204)
			return
		}
		next.ServeHTTP(w, r)
	})
}
func originOK(list, o string) bool {
	localMobileEnabled := false
	for _, x := range strings.Split(list, ",") {
		allowed := strings.TrimSpace(x)
		if allowed == o {
			return true
		}
		if allowed == "http://localhost:5174" || allowed == "http://127.0.0.1:5174" {
			localMobileEnabled = true
		}
	}
	if !localMobileEnabled {
		return false
	}
	u, err := url.Parse(o)
	if err != nil || u.Scheme != "http" || u.Port() != "5174" {
		return false
	}
	address, err := netip.ParseAddr(u.Hostname())
	return err == nil && (address.IsPrivate() || address.IsLoopback())
}
func randomHex(n int) string { b := make([]byte, n); _, _ = rand.Read(b); return hex.EncodeToString(b) }
func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	var q struct {
		CardKey    string `json:"cardKey"`
		DeviceID   string `json:"deviceId"`
		DeviceName string `json:"deviceName"`
		Platform   string `json:"platform"`
	}
	if !decode(w, r, &q) {
		return
	}
	q.CardKey = strings.TrimSpace(q.CardKey)
	q.DeviceID = strings.TrimSpace(q.DeviceID)
	if q.CardKey == "" || q.DeviceID == "" {
		fail(w, 400, "validation_failed", "cardKey and deviceId are required")
		return
	}
	ip := clientIP(r)
	// A card key is the only credential this endpoint takes, so without a cap an
	// attacker can grind the key space and charge every guess to a database
	// transaction. The window is never cleared by a successful login, which keeps
	// it a hard ceiling on cost per address; the lockout keys are kept separate
	// from the account login guard so neither surface can reset the other.
	lockKey := "card-login:ip:" + ip
	if s.authGuard.locked(lockKey) || !s.authGuard.allow("card-login-attempt:ip:"+ip, 60, 15*time.Minute) {
		fail(w, 429, "login_rate_limited", "登录尝试过多，请稍后再试")
		return
	}
	tid := randomHex(16)
	exp := time.Now().Add(s.cfg.TokenTTL)
	c, e := s.store.Login(r.Context(), q.CardKey, q.DeviceID, q.DeviceName, q.Platform, tid, exp.UTC().Format(time.RFC3339Nano))
	if e != nil {
		status, code, message := cardLoginFailure(e)
		// Only an unknown key signals guessing. A card that is merely expired or
		// out of device slots is a real customer retrying, and locking them out
		// would turn a support case into an outage.
		if code == "invalid_card" {
			s.authGuard.failed(lockKey)
		}
		fail(w, status, code, message)
		return
	}
	s.authGuard.succeeded(lockKey)
	s.writeSessionResponse(w, r, c, nil, q.DeviceID, tid, exp, "card", false)
}

// Store sentinels double as API error codes, but an unexpected driver,
// transaction or context error must never reach the client: that text carries
// schema and query detail. Known codes and their exact wording are pinned here
// because shipped desktop builds classify login failures by matching the
// message, so changing either string regresses installed clients.
var cardLoginStatus = map[string]int{
	"card_inactive":         http.StatusForbidden,
	"card_expired":          http.StatusForbidden,
	"device_limit_exceeded": http.StatusForbidden,
}

func cardLoginFailure(e error) (int, string, string) {
	if errors.Is(e, sql.ErrNoRows) || strings.Contains(e.Error(), "no rows") {
		return http.StatusUnauthorized, "invalid_card", "invalid card"
	}
	code := e.Error()
	if status, ok := cardLoginStatus[code]; ok {
		return status, code, strings.ReplaceAll(code, "_", " ")
	}
	slog.Error("card login failed", "error", e)
	return http.StatusInternalServerError, "internal_error", "Internal server error"
}

var sessionAuthCodes = map[string]bool{"session_inactive": true, "session_expired": true, "card_inactive": true}

func sessionAuthFailure(e error) (int, string, string) {
	code := e.Error()
	if sessionAuthCodes[code] {
		return http.StatusUnauthorized, code, strings.ReplaceAll(code, "_", " ")
	}
	slog.Error("session authentication failed", "error", e)
	return http.StatusInternalServerError, "internal_error", "Internal server error"
}
func (s *Server) auth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := r.Header.Get("Authorization")
		cookieAuth := false
		if h == "" {
			if cookie, err := r.Cookie(webSessionCookie); err == nil && cookie.Value != "" {
				h = "Bearer " + cookie.Value
				cookieAuth = true
			}
		}
		if !strings.HasPrefix(h, "Bearer ") {
			fail(w, 401, "missing_token", "Authorization token is required")
			return
		}
		t, e := jwt.Parse(strings.TrimSpace(strings.TrimPrefix(h, "Bearer ")), func(t *jwt.Token) (any, error) {
			if t.Method != jwt.SigningMethodHS256 {
				return nil, errors.New("invalid signing method")
			}
			return []byte(s.cfg.JWTSecret), nil
		})
		if e != nil || !t.Valid {
			fail(w, 401, "invalid_token", "Authorization token is invalid or expired")
			return
		}
		m := t.Claims.(jwt.MapClaims)
		cid, e := strconv.ParseInt(fmt.Sprint(m["sub"]), 10, 64)
		if e != nil {
			fail(w, 401, "invalid_token", "Invalid subject")
			return
		}
		a, e := s.store.Authenticate(r.Context(), fmt.Sprint(m["jti"]), cid, fmt.Sprint(m["did"]))
		if e != nil {
			status, code, message := sessionAuthFailure(e)
			fail(w, status, code, message)
			return
		}
		if cookieAuth && r.Method != http.MethodGet && r.Method != http.MethodHead && r.Method != http.MethodOptions {
			origin := r.Header.Get("Origin")
			if origin == "" || !originOK(s.cfg.AllowOrigin, origin) {
				fail(w, http.StatusForbidden, "origin_forbidden", "Origin is not allowed")
				return
			}
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), authKey{}, a)))
	})
}
func authOf(r *http.Request) store.Auth { return r.Context().Value(authKey{}).(store.Auth) }

func (s *Server) requireInterviewQuota(w http.ResponseWriter, r *http.Request) bool {
	if _, err := s.store.RequireInterviewQuota(r.Context(), authOf(r)); err != nil {
		if err.Error() == "interview_quota_exhausted" {
			fail(w, http.StatusPaymentRequired, "interview_quota_exhausted", "面试时间已用完，请先兑换卡密")
			return false
		}
		fail(w, http.StatusForbidden, "account_unavailable", "当前账号暂时不可用")
		return false
	}
	return true
}

func (s *Server) consumeInterviewRequest(w http.ResponseWriter, r *http.Request) bool {
	if _, err := s.store.ConsumeInterviewSeconds(r.Context(), authOf(r), 1); err != nil {
		if err.Error() == "interview_quota_exhausted" {
			fail(w, http.StatusPaymentRequired, "interview_quota_exhausted", "面试时间已用完，请先兑换卡密")
			return false
		}
		fail(w, http.StatusInternalServerError, "internal_error", "额度校验失败，请稍后重试")
		return false
	}
	return true
}

func (s *Server) allowPaidRequest(w http.ResponseWriter, r *http.Request, feature string, maximum int, window time.Duration) bool {
	a := authOf(r)
	if !s.authGuard.allow(fmt.Sprintf("paid:%s:card:%d", feature, a.CardID), maximum, window) ||
		!s.authGuard.allow("paid:"+feature+":ip:"+clientIP(r), maximum*3, window) {
		fail(w, http.StatusTooManyRequests, "rate_limited", "请求过于频繁，请稍后再试")
		return false
	}
	return true
}
func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	_ = s.store.Revoke(r.Context(), authOf(r).TokenID)
	http.SetCookie(w, &http.Cookie{Name: webSessionCookie, Value: "", Path: "/", MaxAge: -1, HttpOnly: true, Secure: requestIsHTTPS(r), SameSite: http.SameSiteStrictMode})
	write(w, 200, map[string]bool{"ok": true})
}

func requestIsHTTPS(r *http.Request) bool {
	return r.TLS != nil || strings.EqualFold(strings.TrimSpace(r.Header.Get("X-Forwarded-Proto")), "https")
}
func (s *Server) quota(w http.ResponseWriter, r *http.Request) {
	c, e := s.store.CardByID(r.Context(), authOf(r).CardID)
	if e != nil {
		fail(w, 404, "card_not_found", "Card not found")
		return
	}
	write(w, 200, map[string]any{"remainingInterviewSeconds": c.RemainingInterviewSeconds, "remainingWrittenQuestions": c.RemainingWrittenQuestions, "status": c.Status, "expiresAt": c.ExpiresAt})
}
func (s *Server) heartbeat(w http.ResponseWriter, r *http.Request) {
	var q struct {
		InterviewActive bool `json:"interviewActive"`
	}
	if !decode(w, r, &q) {
		return
	}
	n, c, e := s.store.Heartbeat(r.Context(), authOf(r), q.InterviewActive)
	if e != nil {
		status := 401
		if e.Error() == "interview_quota_exhausted" {
			status = 402
		}
		fail(w, status, e.Error(), strings.ReplaceAll(e.Error(), "_", " "))
		return
	}
	write(w, 200, map[string]any{"ok": true, "chargedSeconds": n, "remainingInterviewSeconds": c.RemainingInterviewSeconds, "remainingWrittenQuestions": c.RemainingWrittenQuestions, "status": c.Status, "expiresAt": c.ExpiresAt})
}

type answerReq struct {
	Question   string   `json:"question"`
	Job        string   `json:"job"`
	Language   string   `json:"language"`
	Model      string   `json:"model"`
	ResumeText string   `json:"resumeText"`
	Context    []string `json:"context"`
	TurnID     string   `json:"turnId,omitempty"`
	PipelineID string   `json:"pipelineId,omitempty"`
	AttemptID  int      `json:"attemptId,omitempty"`
}

func validateAnswerRequest(w http.ResponseWriter, q *answerReq) bool {
	q.Question = strings.TrimSpace(q.Question)
	q.Job = strings.TrimSpace(q.Job)
	q.Language = strings.TrimSpace(q.Language)
	q.Model = strings.TrimSpace(q.Model)
	q.ResumeText = strings.TrimSpace(q.ResumeText)
	q.TurnID = strings.TrimSpace(q.TurnID)
	q.PipelineID = strings.TrimSpace(q.PipelineID)
	valid := q.Question != "" && len(q.Question) <= 4000 && len(q.Job) <= 512 &&
		len(q.Language) <= 64 && len(q.Model) <= 128 && len(q.ResumeText) <= 20_000 && len(q.Context) <= 20 &&
		len(q.TurnID) <= 128 && len(q.PipelineID) <= 128 && q.AttemptID >= 0 && q.AttemptID <= 8 &&
		((q.TurnID == "" && q.PipelineID == "") || (q.TurnID != "" && q.PipelineID != ""))
	if valid {
		for _, turn := range q.Context {
			if len(turn) > 8000 {
				valid = false
				break
			}
		}
	}
	if !valid {
		fail(w, http.StatusBadRequest, "validation_failed", "Interview request is empty or exceeds the allowed size")
	}
	return valid
}

func (s *Server) claimInterviewTurn(w http.ResponseWriter, r *http.Request, q answerReq) (string, bool) {
	if q.TurnID == "" {
		return "", true
	}
	if s.turnGuard == nil {
		s.turnGuard = newInterviewTurnGuard()
	}
	key, ok := s.turnGuard.claim(authOf(r), q.TurnID, q.PipelineID, q.AttemptID, time.Now())
	if !ok {
		fail(w, http.StatusConflict, "duplicate_interview_turn", "This interview turn is already being answered")
	}
	return key, ok
}

const (
	interviewAnswerMaxTokens          = 1000
	interviewAnswerMaxRunesChinese    = 500
	interviewAnswerMaxRunesNonChinese = 1600
	interviewContextMaxTurns          = 6
)

func interviewChatOptions() provider.ChatOptions {
	return provider.ChatOptions{
		DisableThinking: true,
		MaxTokens:       interviewAnswerMaxTokens,
	}
}

func (s *Server) loggedInterviewOptions(ctx context.Context, requestID string) provider.ChatOptions {
	options := interviewChatOptions()
	logContext := context.WithoutCancel(ctx)
	options.AttemptObserver = func(event provider.AttemptEvent) {
		var err error
		switch event.Phase {
		case "started":
			err = s.store.StartInterviewAttempt(logContext, requestID, event.Attempt, event.Provider, event.Model)
		case "succeeded", "failed":
			message := ""
			if event.Err != nil {
				message = event.Err.Error()
			}
			err = s.store.FinishInterviewAttempt(logContext, requestID, event.Attempt, event.Phase == "succeeded", message)
		}
		if err != nil {
			slog.Warn("record interview model attempt", "request_id", requestID, "attempt", event.Attempt, "error", err)
		}
	}
	return options
}

func (s *Server) startInterviewLog(ctx context.Context, auth store.Auth, clientVersion, question, requestedModel string) string {
	requestID := randomHex(16)
	if err := s.store.StartInterviewRequest(context.WithoutCancel(ctx), requestID, auth, clientVersion, question, requestedModel); err != nil {
		slog.Warn("start interview request log", "request_id", requestID, "error", err)
	}
	return requestID
}

func (s *Server) finishInterviewLog(ctx context.Context, requestID string, success bool, finalModel string, err error) {
	message := ""
	if err != nil {
		message = err.Error()
	}
	if logErr := s.store.FinishInterviewRequest(context.WithoutCancel(ctx), requestID, success, finalModel, message); logErr != nil {
		slog.Warn("finish interview request log", "request_id", requestID, "error", logErr)
	}
}

func isChineseInterviewLanguage(language string) bool {
	language = strings.ToLower(strings.TrimSpace(language))
	return language == "" || language == "chinese" || strings.Contains(language, "中文")
}

func interviewAnswerRuneLimit(language string) int {
	if isChineseInterviewLanguage(language) {
		return interviewAnswerMaxRunesChinese
	}
	return interviewAnswerMaxRunesNonChinese
}

func compactInterviewAnswer(text string, maxRunes int) string {
	text = strings.NewReplacer("**", "", "__", "", "`", "").Replace(strings.TrimSpace(text))
	lines := strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n")
	compactLines := make([]string, 0, len(lines))
	for _, line := range lines {
		line = strings.TrimSpace(line)
		line = strings.TrimSpace(strings.TrimLeft(line, "#"))
		for _, prefix := range []string{"- ", "* ", "+ "} {
			line = strings.TrimSpace(strings.TrimPrefix(line, prefix))
		}
		if line != "" {
			compactLines = append(compactLines, line)
		}
	}
	answer := strings.Join(compactLines, "\n")
	runes := []rune(answer)
	if len(runes) <= maxRunes {
		return answer
	}
	cut := maxRunes
	// Prefer a complete sentence near the hard boundary so the safety cap does
	// not leave an otherwise useful spoken answer visibly unfinished.
	searchFloor := maxRunes * 3 / 5
	for index := cut - 1; index >= searchFloor; index-- {
		if strings.ContainsRune("。！？!?；;", runes[index]) {
			cut = index + 1
			break
		}
	}
	answer = strings.TrimSpace(string(runes[:cut]))
	answerRunes := []rune(answer)
	if len(answerRunes) > 0 && !strings.ContainsRune("。！？!?；;", answerRunes[len(answerRunes)-1]) {
		if len(answerRunes) < maxRunes {
			answerRunes = append(answerRunes, '。')
		} else {
			answerRunes[len(answerRunes)-1] = '。'
		}
		answer = string(answerRunes)
	}
	return answer
}

func messages(q answerReq) []provider.Message {
	ctx := q.Context
	if len(ctx) > interviewContextMaxTurns {
		ctx = ctx[len(ctx)-interviewContextMaxTurns:]
	}
	resume := strings.TrimSpace(q.ResumeText)
	if resume == "" {
		resume = "未提供；不要虚构具体公司、项目名称或可核验的个人经历，可结合岗位给出自然、合理的通用候选人回答。"
	}
	lengthRule := `8. 严格控制口述长度：简单问题 60-120 个汉字，普通技术问题 120-220 个汉字，项目或行为题 180-300 个汉字；任何答案不得超过 300 个汉字。优先保留结论和关键差异，不为凑结构展开所有细节。不要使用 Markdown 标题、加粗、列表符号或空行，使用紧凑自然段。`
	if !isChineseInterviewLanguage(q.Language) {
		lengthRule = `8. Strictly control spoken length: use about 40-80 words for simple questions, 80-150 words for ordinary technical questions, and 120-220 words for project or behavioral questions; never exceed 240 words. Preserve the conclusion and key distinctions instead of expanding every possible detail. Do not use Markdown headings, bold text, list markers, or blank lines; use compact natural paragraphs.`
	}
	system := `你是“秒答”面试辅助回答引擎，任务是生成自然、准确、可以直接口述的面试答案。
必须遵守：
1. 先判断问题类型，再选择回答视角：
   - 知识型问题（定义、原理、分类、区别、机制、优缺点、使用场景、如何实现）使用客观陈述，直接讲知识点，不要使用“我了解”“我认为”“我平时会”“我肯定知道”等第一人称铺垫。
   - 个人型问题（项目经历、工作习惯、个人选择、优缺点、冲突处理、职业规划，以及明确询问“你做过什么”“你平常怎么做”）才以候选人第一人称“我”回答。
2. 面试官在个人型问题中说“你”“你平常”“你做过”时，指的是候选人，不是在询问模型；绝不能自称 AI、语言模型或助手。
3. 结合求职领域、具体岗位、简历以及最近六轮对话理解追问、代词和省略信息；当前问题优先级最高。
4. 简历没有提供的信息不得虚构具体公司、项目、年限或业绩；可以说明通用做法和合理的技术取舍。
5. 只输出自然、专业、可直接口述的答案，不复述规则，不做面试点评，不寒暄，也不要主动说“如果感兴趣我可以继续讲”。
6. 继承本地题库的回答逻辑，但输出为紧凑口语：
   - 定义、原理、分类题：一句话给核心结论，再讲关键机制或分类，最后补一个实际应用；不必穷举所有细节。
   - 区别、选型题：先给选择结论，再用相同维度比较双方，优先保留最关键的 2-4 个差异和适用场景。
   - 故障、性能、排查题：按照“现象与指标 → 缩小范围 → 定位原因 → 修复并验证”的顺序回答。
   - 项目、经历、行为题：按照“背景或问题 → 我的职责与方案 → 关键实现或取舍 → 结果与复盘”的顺序，用候选人第一人称回答；简历没有的数据不得虚构。
   - 追问题：直接承接最近对话回答新增部分，不要重新复述上一轮完整答案。
7. 结论先行，每个逻辑点只说一次。答案应覆盖问题真正询问的范围，不要为了显得全面而堆砌相关知识。
` + lengthRule + `

候选人求职信息：` + strings.TrimSpace(q.Job) + `
回答语言：` + strings.TrimSpace(q.Language) + `
候选人简历：` + resume

	messages := []provider.Message{{Role: "system", Content: system}}
	for _, turn := range ctx {
		question, answer, ok := splitContextTurn(turn)
		if ok {
			messages = append(messages,
				provider.Message{Role: "user", Content: question},
				provider.Message{Role: "assistant", Content: answer},
			)
			continue
		}
		if text := strings.TrimSpace(turn); text != "" {
			messages = append(messages, provider.Message{Role: "user", Content: "此前对话：" + text})
		}
	}
	messages = append(messages, provider.Message{Role: "user", Content: strings.TrimSpace(q.Question)})
	return messages
}

func splitContextTurn(turn string) (question, answer string, ok bool) {
	turn = strings.TrimSpace(turn)
	if !strings.HasPrefix(turn, "Q:") {
		return "", "", false
	}
	parts := strings.SplitN(strings.TrimPrefix(turn, "Q:"), "\nA:", 2)
	if len(parts) != 2 {
		return "", "", false
	}
	question = strings.TrimSpace(parts[0])
	answer = strings.TrimSpace(parts[1])
	return question, answer, question != "" && answer != ""
}
func (s *Server) answer(w http.ResponseWriter, r *http.Request) {
	var q answerReq
	if !decode(w, r, &q) {
		return
	}
	if !validateAnswerRequest(w, &q) {
		return
	}
	turnClaim, ok := s.claimInterviewTurn(w, r, q)
	if !ok {
		return
	}
	if !s.allowPaidRequest(w, r, "interview-answer", 30, time.Minute) {
		s.turnGuard.release(turnClaim, q.PipelineID, q.AttemptID)
		return
	}
	if !s.consumeInterviewRequest(w, r) {
		s.turnGuard.release(turnClaim, q.PipelineID, q.AttemptID)
		return
	}
	a := authOf(r)
	requestID := s.startInterviewLog(r.Context(), a, r.Header.Get("X-Miaoda-Client-Version"), q.Question, q.Model)
	text, model, e := s.models.ChatWithOptions(r.Context(), messages(q), q.Model, s.loggedInterviewOptions(r.Context(), requestID))
	hash := hashText(q.Question + "|" + q.Job)
	if e != nil {
		s.finishInterviewLog(r.Context(), requestID, false, "", e)
		s.store.RefundInterviewSeconds(r.Context(), a, 1)
		s.store.Log(r.Context(), a, "interview", "answer", 0, "", false, e.Error(), hash)
		fail(w, 503, "model_unavailable", "AI service is temporarily unavailable")
		return
	}
	text = compactInterviewAnswer(text, interviewAnswerRuneLimit(q.Language))
	s.finishInterviewLog(r.Context(), requestID, true, model, nil)
	s.store.Log(r.Context(), a, "interview", "answer", 0, model, true, "", hash)
	write(w, 200, map[string]string{"answer": text, "model": model})
}
func (s *Server) answerStream(w http.ResponseWriter, r *http.Request) {
	var q answerReq
	if !decode(w, r, &q) {
		return
	}
	if !validateAnswerRequest(w, &q) {
		return
	}
	turnClaim, ok := s.claimInterviewTurn(w, r, q)
	if !ok {
		return
	}
	if !s.allowPaidRequest(w, r, "interview-answer", 30, time.Minute) {
		s.turnGuard.release(turnClaim, q.PipelineID, q.AttemptID)
		return
	}
	if !s.consumeInterviewRequest(w, r) {
		s.turnGuard.release(turnClaim, q.PipelineID, q.AttemptID)
		return
	}
	f, ok := w.(http.Flusher)
	if !ok {
		s.turnGuard.release(turnClaim, q.PipelineID, q.AttemptID)
		s.store.RefundInterviewSeconds(r.Context(), authOf(r), 1)
		fail(w, 500, "stream_unsupported", "Streaming unsupported")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	_ = sse(w, f, "accepted", map[string]any{"receivedAtUnixMs": time.Now().UnixMilli()})
	a := authOf(r)
	requestID := s.startInterviewLog(r.Context(), a, r.Header.Get("X-Miaoda-Client-Version"), q.Question, q.Model)
	maxRunes := interviewAnswerRuneLimit(q.Language)
	sentRunes := 0
	text, model, e := s.models.StreamWithOptions(r.Context(), messages(q), q.Model, func(t string) error {
		remaining := maxRunes - sentRunes
		if remaining <= 0 {
			return nil
		}
		runes := []rune(t)
		if len(runes) > remaining {
			runes = runes[:remaining]
		}
		sentRunes += len(runes)
		return sse(w, f, "token", map[string]string{"token": string(runes)})
	}, s.loggedInterviewOptions(r.Context(), requestID))
	if e != nil {
		s.finishInterviewLog(r.Context(), requestID, false, "", e)
		s.store.RefundInterviewSeconds(r.Context(), a, 1)
		_ = sse(w, f, "error", map[string]string{"message": "AI service is temporarily unavailable"})
		s.store.Log(r.Context(), a, "interview", "answer_stream", 0, "", false, e.Error(), hashText(q.Question))
		return
	}
	text = compactInterviewAnswer(text, maxRunes)
	s.finishInterviewLog(r.Context(), requestID, true, model, nil)
	_ = sse(w, f, "done", map[string]string{"model": model, "answer": text})
	s.store.Log(r.Context(), a, "interview", "answer_stream", 0, model, true, "", hashText(q.Question))
}

const translationTextMaxRunes = 4000

type translationReq struct {
	Text           string `json:"text"`
	SourceLanguage string `json:"sourceLanguage"`
}

var translationSourceLanguages = map[string]string{
	"auto":       "auto",
	"chinese":    "Chinese",
	"english":    "English",
	"japanese":   "Japanese",
	"korean":     "Korean",
	"vietnamese": "Vietnamese",
	"thai":       "Thai",
	"indonesian": "Indonesian",
	"malay":      "Malay",
	"filipino":   "Tagalog",
	"tagalog":    "Tagalog",
	"hindi":      "Hindi",
	"arabic":     "Arabic",
	"french":     "French",
	"german":     "German",
	"spanish":    "Spanish",
	"portuguese": "Portuguese",
	"russian":    "Russian",
	"italian":    "Italian",
	"dutch":      "Dutch",
	"swedish":    "Swedish",
	"danish":     "Danish",
	"finnish":    "Finnish",
	"norwegian":  "Norwegian",
	"greek":      "Greek",
	"polish":     "Polish",
	"czech":      "Czech",
	"hungarian":  "Hungarian",
	"romanian":   "Romanian",
	"bulgarian":  "Bulgarian",
	"croatian":   "Croatian",
	"slovak":     "Slovak",
}

func normalizeTranslationSourceLanguage(value string) (string, bool) {
	value = strings.ToLower(strings.TrimSpace(value))
	if value == "" {
		value = "auto"
	}
	normalized, ok := translationSourceLanguages[value]
	return normalized, ok
}

func validateTranslationRequest(w http.ResponseWriter, q *translationReq) bool {
	q.Text = strings.TrimSpace(q.Text)
	sourceLanguage, sourceOK := normalizeTranslationSourceLanguage(q.SourceLanguage)
	q.SourceLanguage = sourceLanguage
	if q.Text == "" || len([]rune(q.Text)) > translationTextMaxRunes || !sourceOK {
		fail(w, http.StatusBadRequest, "validation_failed", "Translation text or source language is invalid")
		return false
	}
	return true
}

func (s *Server) translateStream(w http.ResponseWriter, r *http.Request) {
	var q translationReq
	if !decode(w, r, &q) {
		return
	}
	if !validateTranslationRequest(w, &q) {
		return
	}
	if !s.allowPaidRequest(w, r, "interview-translate", 240, time.Minute) {
		return
	}
	if !s.requireInterviewQuota(w, r) {
		return
	}
	f, ok := w.(http.Flusher)
	if !ok {
		fail(w, http.StatusInternalServerError, "stream_unsupported", "Streaming unsupported")
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	_ = sse(w, f, "accepted", map[string]any{"receivedAtUnixMs": time.Now().UnixMilli()})

	a := authOf(r)
	requestCtx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	text, model, err := s.models.StreamTranslation(requestCtx, q.Text, q.SourceLanguage, "Chinese", func(token string) error {
		return sse(w, f, "token", map[string]string{"token": token})
	})
	sourceHash := hashText(q.Text)
	if err != nil {
		_ = sse(w, f, "error", map[string]string{"message": "Translation service is temporarily unavailable"})
		s.store.Log(r.Context(), a, "interview", "translate_stream", 0, "", false, err.Error(), sourceHash)
		return
	}
	_ = sse(w, f, "done", map[string]string{"model": model, "translation": text})
	s.store.Log(r.Context(), a, "interview", "translate_stream", 0, model, true, "", sourceHash)
}

func sse(w io.Writer, f http.Flusher, event string, v any) error {
	b, _ := json.Marshal(v)
	_, e := fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, b)
	f.Flush()
	return e
}
func hashText(v string) string { x := sha256.Sum256([]byte(v)); return hex.EncodeToString(x[:]) }
func imagePart(w http.ResponseWriter, r *http.Request, max int64) ([]byte, string, map[string]string, bool) {
	r.Body = http.MaxBytesReader(w, r.Body, max+1<<20)
	if e := r.ParseMultipartForm(max); e != nil {
		fail(w, 413, "upload_too_large", "Image exceeds upload limit")
		return nil, "", nil, false
	}
	f, h, e := r.FormFile("screenshot")
	if e != nil {
		fail(w, 400, "missing_screenshot", "screenshot file is required")
		return nil, "", nil, false
	}
	defer f.Close()
	b, e := io.ReadAll(io.LimitReader(f, max+1))
	if e != nil || int64(len(b)) > max {
		fail(w, 413, "upload_too_large", "Image exceeds upload limit")
		return nil, "", nil, false
	}
	mime := detectImage(b)
	if mime == "" {
		fail(w, 415, "invalid_image", "PNG, JPEG, GIF or WebP required")
		return nil, "", nil, false
	}
	return b, mime, map[string]string{"type": r.FormValue("type"), "language": r.FormValue("language"), "visionMode": r.FormValue("visionMode"), "filename": h.Filename}, true
}
func detectImage(b []byte) string {
	if len(b) > 12 {
		if b[0] == 0x89 && string(b[1:4]) == "PNG" {
			return "image/png"
		}
		if b[0] == 0xff && b[1] == 0xd8 && b[2] == 0xff {
			return "image/jpeg"
		}
		if string(b[:3]) == "GIF" {
			return "image/gif"
		}
		if string(b[:4]) == "RIFF" && string(b[8:12]) == "WEBP" {
			return "image/webp"
		}
	}
	return ""
}

const (
	writtenTypeMarker     = "<<<QUESTION_TYPE>>>"
	writtenQuestionMarker = "<<<QUESTION>>>"
	writtenAnswerMarker   = "<<<ANSWER>>>"
)

func writtenSolvePrompt(kind, language string) string {
	base := []string{
		"直接阅读截图，识别题目并完成解答，不要先单独输出 OCR 过程。",
		"严格按照下面三个标记输出，标记名称不得修改或省略：",
		writtenTypeMarker,
		"如果当前主要题目是编程题，只输出 code；否则只输出 non_code。不要输出其他内容。",
		writtenQuestionMarker,
		"用简洁文字复述题目和关键条件；若为选择题，保留必要的选项。",
		writtenAnswerMarker,
	}
	if normalizedKind := strings.ToLower(strings.TrimSpace(kind)); normalizedKind == "" || normalizedKind == "auto" {
		return strings.Join(append(base,
			"先在内部判断题型，再选择下面对应的回答格式；不要输出题型判断过程。",
			"如果是编程题，使用 "+language+" 输出代码块，代码块后输出以“思路：”开头的核心算法、关键数据结构和复杂度。",
			"编程题若明确来自 LeetCode/力扣，或题面给出了类名、方法签名、参数和返回值，则输出可直接提交的核心代码，禁止 Main/main、标准输入输出和测试用例；若没有这些平台特征，则使用 ACM/ICPC 模式，提供可编译运行的完整程序入口和标准输入输出。",
			"编程代码必须包含必要的 import/include、类型和辅助函数，禁止行注释、块注释、文档注释和无意义空行。",
			"如果是单选题、多选题、判断题、行测题或智力题，先输出“答案：”，给出选项或结论；再输出“解析：”，简洁说明关键依据。多选题必须列出全部正确选项。",
			"如果是计算题、简答题或其他题型，直接给出结论和必要步骤，不套用代码题格式。",
			"忽略截图中的导航、按钮、历史答案和其他界面文字，只解答当前最主要且内容完整的题目。",
		), "\n")
	}
	if strings.EqualFold(strings.TrimSpace(kind), "leetcode") {
		return strings.Join(append(base,
			"先在内部判断题型，不要把选择题、判断题、行测题、智力题、计算题或简答题误判为编程题。",
			"仅当题型为编程题（QUESTION_TYPE 为 code）时，才应用下面的核心代码模式规则。",
			"如果不是编程题（QUESTION_TYPE 为 non_code），忽略下面的代码格式要求：选择/判断/行测/智力题输出“答案：”和“解析：”；计算题、简答题或其他题型直接给出结论和必要步骤。",
			"先输出一个可直接粘贴到力扣的 "+language+" 代码块，代码块结束后再输出以“思路：”开头的简洁解题思路。",
			"必须使用 LeetCode（力扣）核心代码模式；严格保留截图中给出的类名、方法名、参数、返回值和平台数据结构。",
			"若截图没有指定类名且不是设计题，使用 class Solution，并根据题意给出语义明确的核心方法。",
			"禁止输出 Main/main 程序入口，禁止读取标准输入，禁止打印标准输出，禁止编写 Scanner、BufferedReader 等输入解析代码。",
			"只保留目标类、核心方法和算法必需的辅助方法或字段，不要补测试用例、调用示例和样板输入输出代码。",
			"代码中禁止任何行注释、块注释、文档注释和空行。",
			"思路放在代码块外，只说明核心算法、关键数据结构和复杂度，不重复代码。",
		), "\n")
	}
	if strings.EqualFold(strings.TrimSpace(kind), "code") {
		return strings.Join(append(base,
			"先在内部判断题型，不要把选择题、判断题、行测题、智力题、计算题或简答题误判为编程题。",
			"仅当题型为编程题（QUESTION_TYPE 为 code）时，才应用下面的 ACM 完整程序规则。",
			"如果不是编程题（QUESTION_TYPE 为 non_code），忽略下面的代码格式要求：选择/判断/行测/智力题输出“答案：”和“解析：”；计算题、简答题或其他题型直接给出结论和必要步骤。",
			"先输出一个完整且可直接编译运行的 "+language+" 代码块，代码块结束后再输出以“思路：”开头的简洁解题思路。",
			"不要套用面试口述答案的字数限制；必须完整输出正确代码和必要的思路讲解，不得为了缩短内容省略实现、边界处理或复杂度分析。",
			"必须使用 ACM/ICPC 模式，提供完整程序入口，从标准输入读取全部输入并把最终结果写入标准输出。",
			"禁止输出 LeetCode 的 class Solution、核心函数签名或依赖平台提供的数据结构。",
			"代码中禁止任何行注释、块注释、文档注释和空行。",
			"思路放在代码块外，只说明核心算法、关键数据结构和复杂度，不重复代码。",
			"自行包含所有必要的 import/include、类型和辅助函数。",
		), "\n")
	}
	return strings.Join(append(base, "给出准确、简洁、可直接使用的答案。"), "\n")
}

func parseWrittenOutput(raw string) (question, answer string, ok bool) {
	questionAt := strings.Index(raw, writtenQuestionMarker)
	answerAt := strings.Index(raw, writtenAnswerMarker)
	if questionAt < 0 || answerAt <= questionAt {
		return "", "", false
	}
	question = strings.TrimSpace(raw[questionAt+len(writtenQuestionMarker) : answerAt])
	answer = strings.TrimSpace(raw[answerAt+len(writtenAnswerMarker):])
	return question, answer, question != "" && answer != ""
}

func parseWrittenQuestionType(raw string) (string, bool) {
	typeAt := strings.Index(raw, writtenTypeMarker)
	questionAt := strings.Index(raw, writtenQuestionMarker)
	if typeAt < 0 || questionAt <= typeAt {
		return "", false
	}
	kind := strings.ToLower(strings.TrimSpace(raw[typeAt+len(writtenTypeMarker) : questionAt]))
	return kind, kind == "code" || kind == "non_code"
}

func validateWrittenOutput(kind, output string) bool {
	_, answer, valid := parseWrittenOutput(output)
	questionType, typeValid := parseWrittenQuestionType(output)
	if !valid || !typeValid {
		return false
	}
	// C/V choose the output contract only after the screenshot has been
	// classified as a programming question. Non-code questions intentionally
	// share the same answer path for both shortcuts.
	if questionType != "code" {
		return true
	}
	isACM := strings.EqualFold(strings.TrimSpace(kind), "code")
	isCoreCode := strings.EqualFold(strings.TrimSpace(kind), "leetcode")
	if (isACM || isCoreCode) && (!strings.Contains(answer, "```") || !strings.Contains(answer, "思路：")) {
		return false
	}
	if isCoreCode {
		lower := strings.ToLower(answer)
		for _, forbidden := range []string{"public static void main", "static void main", "int main(", "system.in", "scanner("} {
			if strings.Contains(lower, forbidden) {
				return false
			}
		}
	}
	return true
}

func (s *Server) solve(w http.ResponseWriter, r *http.Request) {
	startedAt := time.Now()
	a := authOf(r)
	if !s.allowPaidRequest(w, r, "written-solve", 12, time.Minute) {
		return
	}
	if err := s.store.ReserveWrittenQuestion(r.Context(), a); err != nil {
		if err.Error() == "written_quota_exhausted" {
			fail(w, http.StatusPaymentRequired, "written_quota_exhausted", "笔试次数已用完，请先兑换卡密")
			return
		}
		fail(w, http.StatusInternalServerError, "internal_error", "额度校验失败，请稍后重试")
		return
	}
	reserved := true
	refundReservation := func() {
		if reserved {
			s.store.RefundWrittenQuestion(r.Context(), a)
			reserved = false
		}
	}
	b, mime, p, ok := imagePart(w, r, s.cfg.MaxUpload)
	if !ok {
		refundReservation()
		return
	}
	uploadMs := time.Since(startedAt).Milliseconds()
	requestedRoute := strings.TrimSpace(p["visionMode"])
	lang := p["language"]
	if lang == "" {
		lang = "Java"
	}
	routes := strings.Split(s.cfg.WrittenSolverModels, ",")
	switch requestedRoute {
	case "", "auto", "aliyun:qwen3-vl-flash", "zhipu:glm-4.6v-flashx":
		// Legacy vision-only selections are migrated to the configured direct
		// screenshot solver chain so old localStorage values remain usable.
	default:
		routes = []string{requestedRoute}
	}
	kind := strings.TrimSpace(p["type"])
	prompt := writtenSolvePrompt(kind, lang)
	solverStartedAt := time.Now()
	raw, model, e := s.models.SolveImage(r.Context(), b, mime, routes, prompt, provider.SolveImageOptions{
		Thinking:       s.cfg.WrittenSolverThinking,
		Retries:        s.cfg.WrittenSolverRetries,
		AttemptTimeout: s.cfg.WrittenSolverAttemptTimeout,
		Validate:       func(output string) bool { return validateWrittenOutput(kind, output) },
	})
	if e != nil {
		refundReservation()
		slog.Warn("written solve provider failed", "error", e)
		fail(w, 503, "model_unavailable", "AI service is temporarily unavailable")
		return
	}
	solverMs := time.Since(solverStartedAt).Milliseconds()
	question, ans, valid := parseWrittenOutput(raw)
	questionType, typeValid := parseWrittenQuestionType(raw)
	if !valid || !typeValid {
		refundReservation()
		fail(w, 503, "model_invalid_response", "Written solver returned an invalid response")
		return
	}
	hash := hashText(question)
	var charged bool
	var cost float64
	var last string
	err := s.store.DB.QueryRowContext(r.Context(), "SELECT last_seen_at FROM written_question_cache WHERE card_id=? AND question_hash=?", a.CardID, hash).Scan(&last)
	repeat := err == nil
	if repeat {
		t, _ := time.Parse(time.RFC3339Nano, last)
		repeat = time.Since(t) <= 30*time.Minute
	}
	if repeat {
		refundReservation()
	} else {
		reserved = false
		charged = true
		cost = 1
	}
	_, _ = s.store.DB.ExecContext(r.Context(), "INSERT INTO written_question_cache(card_id,question_hash,first_seen_at,last_seen_at,answer_snapshot) VALUES(?,?,?,?,?) ON CONFLICT(card_id,question_hash) DO UPDATE SET last_seen_at=excluded.last_seen_at,answer_snapshot=excluded.answer_snapshot", a.CardID, hash, time.Now().UTC(), time.Now().UTC(), ans)
	s.store.Log(r.Context(), a, "written", "solve-screen", cost, model, true, "", hashText(string(b)))
	serverMs := time.Since(startedAt).Milliseconds()
	slog.Info("written solve completed",
		"solver_model", model,
		"upload_ms", uploadMs,
		"solver_ms", solverMs,
		"server_ms", serverMs,
	)
	write(w, 200, map[string]any{
		"questionText":     question,
		"questionType":     questionType,
		"answer":           ans,
		"recognitionModel": model,
		"answerModel":      model,
		"solverModel":      model,
		"charged":          charged,
		"cost":             cost,
		"uploadMs":         uploadMs,
		"solverMs":         solverMs,
		"serverMs":         serverMs,
	})
}
func (s *Server) asr(w http.ResponseWriter, r *http.Request) {
	if !s.allowPaidRequest(w, r, "interview-asr", 30, time.Minute) {
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 20<<20)
	if e := r.ParseMultipartForm(20 << 20); e != nil {
		fail(w, 413, "upload_too_large", "Audio exceeds upload limit")
		return
	}
	f, h, e := r.FormFile("audio")
	if e != nil {
		fail(w, 400, "missing_audio", "audio file is required")
		return
	}
	defer f.Close()
	b, e := io.ReadAll(io.LimitReader(f, 20<<20))
	if e != nil || len(b) == 0 {
		fail(w, 400, "empty_audio", "audio file is empty")
		return
	}
	if !s.consumeInterviewRequest(w, r) {
		return
	}
	a := authOf(r)
	text, model, e := s.models.Transcribe(r.Context(), b, h.Filename, h.Header.Get("Content-Type"), r.FormValue("language"))
	if e != nil {
		s.store.RefundInterviewSeconds(r.Context(), a, 1)
		s.store.Log(r.Context(), a, "interview", "asr", 0, "", false, e.Error(), hashText(string(b)))
		fail(w, 503, "asr_unavailable", "Speech recognition is temporarily unavailable")
		return
	}
	s.store.Log(r.Context(), a, "interview", "asr", 0, model, true, "", hashText(string(b)))
	write(w, 200, map[string]string{"text": text, "model": model})
}
