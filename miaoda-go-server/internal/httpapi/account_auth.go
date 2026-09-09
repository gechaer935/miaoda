package httpapi

import (
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"
	"unicode/utf8"

	store "example.com/miaoda/server/internal/store/sqlite"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

type limitWindow struct {
	Events []time.Time
}

type loginFailure struct {
	Count       int
	LastFailure time.Time
	LockedUntil time.Time
}

type authLimiter struct {
	mu       sync.Mutex
	windows  map[string]*limitWindow
	failures map[string]*loginFailure
}

func newAccountSecurity() (*authLimiter, []byte) {
	dummy, _ := bcrypt.GenerateFromPassword([]byte("miaoda-dummy-password"), bcrypt.DefaultCost)
	return &authLimiter{windows: map[string]*limitWindow{}, failures: map[string]*loginFailure{}}, dummy
}

func (l *authLimiter) allow(key string, maximum int, window time.Duration) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	state := l.windows[key]
	if state == nil {
		if len(l.windows) >= 50_000 {
			for oldKey, oldState := range l.windows {
				if len(oldState.Events) == 0 || oldState.Events[len(oldState.Events)-1].Before(now.Add(-24*time.Hour)) {
					delete(l.windows, oldKey)
				}
				if len(l.windows) < 40_000 {
					break
				}
			}
			if len(l.windows) >= 50_000 {
				return false
			}
		}
		state = &limitWindow{}
		l.windows[key] = state
	}
	cutoff := now.Add(-window)
	kept := state.Events[:0]
	for _, event := range state.Events {
		if event.After(cutoff) {
			kept = append(kept, event)
		}
	}
	state.Events = kept
	if len(state.Events) >= maximum {
		return false
	}
	state.Events = append(state.Events, now)
	return true
}

func (l *authLimiter) locked(keys ...string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	for _, key := range keys {
		if state := l.failures[key]; state != nil && state.LockedUntil.After(now) {
			return true
		}
	}
	return false
}

func (l *authLimiter) failed(keys ...string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	for _, key := range keys {
		state := l.failures[key]
		if state == nil || now.Sub(state.LastFailure) > time.Hour {
			if state == nil && len(l.failures) >= 50_000 {
				for oldKey, oldState := range l.failures {
					if oldState.LockedUntil.Before(now) && oldState.LastFailure.Before(now.Add(-24*time.Hour)) {
						delete(l.failures, oldKey)
					}
					if len(l.failures) < 40_000 {
						break
					}
				}
				if len(l.failures) >= 50_000 {
					continue
				}
			}
			state = &loginFailure{}
			l.failures[key] = state
		}
		state.Count++
		state.LastFailure = now
		if state.Count >= 5 {
			shift := state.Count - 5
			if shift > 5 {
				shift = 5
			}
			delay := 30 * time.Second * time.Duration(1<<shift)
			if delay > 15*time.Minute {
				delay = 15 * time.Minute
			}
			state.LockedUntil = now.Add(delay)
		}
	}
}

func (l *authLimiter) succeeded(keys ...string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	for _, key := range keys {
		delete(l.failures, key)
	}
}

func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = strings.TrimSpace(r.RemoteAddr)
	}
	peerIP := net.ParseIP(host)
	// Forwarding headers are attacker-controlled unless the immediate peer is
	// our loopback reverse proxy. This protects the admin IP allow-list and all
	// IP based rate limits if the application port is ever exposed by mistake.
	if peerIP != nil && peerIP.IsLoopback() {
		forwarded := r.Header.Get("X-Forwarded-For")
		parts := strings.Split(forwarded, ",")
		if len(parts) > 0 {
			if value := strings.TrimSpace(parts[len(parts)-1]); net.ParseIP(value) != nil {
				return value
			}
		}
	}
	if peerIP != nil {
		return host
	}
	return r.RemoteAddr
}

func validUsername(value string) bool {
	if value != strings.TrimSpace(value) || !utf8.ValidString(value) {
		return false
	}
	length := utf8.RuneCountInString(value)
	if length < 4 || length > 32 {
		return false
	}
	for _, r := range value {
		if !unicode.IsLetter(r) && !unicode.IsDigit(r) && r != '_' && r != '-' {
			return false
		}
	}
	return true
}

type accountCredentials struct {
	Username   string `json:"username"`
	Password   string `json:"password"`
	DeviceID   string `json:"deviceId"`
	DeviceName string `json:"deviceName"`
	Platform   string `json:"platform"`
}

func trialDeviceIdentityHash(secret, deviceID string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	_, _ = mac.Write([]byte("trial-offer\x00" + deviceID))
	return hex.EncodeToString(mac.Sum(nil))
}

func (s *Server) registerAccount(w http.ResponseWriter, r *http.Request) {
	var q accountCredentials
	if !decode(w, r, &q) {
		return
	}
	q.Username = strings.TrimSpace(q.Username)
	q.DeviceID = strings.TrimSpace(q.DeviceID)
	if !validUsername(q.Username) {
		fail(w, 400, "invalid_username", "用户名须为 4～32 个字符，仅支持字母、数字、中文、下划线和连字符")
		return
	}
	if len([]rune(q.Password)) < 8 || len([]rune(q.Password)) > 24 {
		fail(w, 400, "invalid_password", "密码长度须为 8～24 个字符")
		return
	}
	if q.DeviceID == "" {
		fail(w, 400, "validation_failed", "deviceId is required")
		return
	}
	ip := clientIP(r)
	if _, err := s.store.UserByUsername(r.Context(), q.Username); err == nil {
		fail(w, 409, "username_unavailable", "该用户名不可用")
		return
	} else if !errors.Is(err, sql.ErrNoRows) {
		fail(w, 500, "internal_error", "注册失败，请稍后重试")
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(q.Password), 12)
	if err != nil {
		fail(w, 500, "internal_error", "注册失败，请稍后重试")
		return
	}
	tid := randomHex(16)
	expiresAt := time.Now().Add(s.cfg.TokenTTL)
	user, card, err := s.store.RegisterUser(r.Context(), q.Username, string(hash), ip, trialDeviceIdentityHash(s.cfg.JWTSecret, q.DeviceID), "ACCOUNT-"+strings.ToUpper(randomHex(18)), q.DeviceID, q.DeviceName, q.Platform, tid, expiresAt.UTC().Format(time.RFC3339Nano))
	if err != nil {
		if err.Error() == "registration_rate_limited" {
			fail(w, 429, "registration_rate_limited", "同一 IP 每小时最多注册 5 个账户")
			return
		}
		if strings.Contains(strings.ToLower(err.Error()), "unique") {
			fail(w, 409, "username_unavailable", "该用户名不可用")
			return
		}
		fail(w, 500, "internal_error", "注册失败，请稍后重试")
		return
	}
	s.writeSessionResponse(w, r, card, &user, q.DeviceID, tid, expiresAt, "account", strings.EqualFold(q.Platform, "web"))
}

func (s *Server) loginAccount(w http.ResponseWriter, r *http.Request) {
	var q accountCredentials
	if !decode(w, r, &q) {
		return
	}
	q.Username = strings.TrimSpace(q.Username)
	q.DeviceID = strings.TrimSpace(q.DeviceID)
	if q.Username == "" || q.Password == "" || q.DeviceID == "" {
		fail(w, 401, "invalid_credentials", "用户名或密码错误")
		return
	}
	ip := clientIP(r)
	normalizedUsername := strings.ToLower(q.Username)
	userKey := "login:user:" + normalizedUsername
	ipKey := "login:ip:" + ip
	if s.authGuard.locked(userKey, ipKey) || !s.authGuard.allow("login-attempt:user:"+normalizedUsername, 10, 15*time.Minute) || !s.authGuard.allow("login-attempt:ip:"+ip, 30, 15*time.Minute) {
		fail(w, 429, "login_rate_limited", "登录尝试过多，请稍后再试")
		return
	}
	user, lookupErr := s.store.UserByUsername(r.Context(), q.Username)
	hash := s.dummyHash
	if lookupErr == nil {
		hash = []byte(user.PasswordHash)
	}
	compareErr := bcrypt.CompareHashAndPassword(hash, []byte(q.Password))
	if lookupErr != nil || compareErr != nil {
		s.authGuard.failed(userKey, ipKey)
		fail(w, 401, "invalid_credentials", "用户名或密码错误")
		return
	}
	tid := randomHex(16)
	expiresAt := time.Now().Add(s.cfg.TokenTTL)
	card, err := s.store.LoginByCardID(r.Context(), user.AccountCardID, q.DeviceID, q.DeviceName, q.Platform, tid, expiresAt.UTC().Format(time.RFC3339Nano))
	if err != nil {
		if strings.Contains(err.Error(), "device_limit") {
			fail(w, 403, "device_limit_exceeded", "设备数量已达上限，请联系客服")
			return
		}
		fail(w, 403, "account_unavailable", "账户暂时不可用，请联系客服")
		return
	}
	s.authGuard.succeeded(userKey, ipKey)
	s.writeSessionResponse(w, r, card, &user, q.DeviceID, tid, expiresAt, "account", strings.EqualFold(q.Platform, "web"))
}

func (s *Server) writeSessionResponse(w http.ResponseWriter, r *http.Request, card store.Card, user *store.User, deviceID, tokenID string, expiresAt time.Time, mode string, webSession bool) {
	claims := jwt.MapClaims{"jti": tokenID, "sub": strconv.FormatInt(card.ID, 10), "did": deviceID, "iat": time.Now().Unix(), "exp": expiresAt.Unix()}
	token, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(s.cfg.JWTSecret))
	if webSession {
		http.SetCookie(w, &http.Cookie{
			Name:     webSessionCookie,
			Value:    token,
			Path:     "/",
			MaxAge:   max(1, int(time.Until(expiresAt).Seconds())),
			HttpOnly: true,
			Secure:   requestIsHTTPS(r),
			SameSite: http.SameSiteStrictMode,
		})
	}
	response := map[string]any{
		"token":     token,
		"expiresAt": expiresAt.UTC().Format(time.RFC3339Nano),
		"authMode":  mode,
		"card":      map[string]any{"remainingInterviewSeconds": card.RemainingInterviewSeconds, "remainingWrittenQuestions": card.RemainingWrittenQuestions, "maxDevices": card.MaxDevices},
	}
	if user != nil {
		response["user"] = map[string]any{"username": user.Username}
	}
	write(w, 200, response)
}

func (s *Server) accountMe(w http.ResponseWriter, r *http.Request) {
	auth := authOf(r)
	user, err := s.store.UserByAccountCardID(r.Context(), auth.CardID)
	if err != nil {
		fail(w, 403, "account_required", "请使用用户名账户登录")
		return
	}
	card, err := s.store.CardByID(r.Context(), auth.CardID)
	if err != nil {
		fail(w, 500, "internal_error", "读取账户失败")
		return
	}
	write(w, 200, map[string]any{
		"username":                  user.Username,
		"remainingInterviewSeconds": card.RemainingInterviewSeconds,
		"remainingWrittenQuestions": card.RemainingWrittenQuestions,
	})
}

func (s *Server) redeemCard(w http.ResponseWriter, r *http.Request) {
	var q struct {
		CardKey string `json:"cardKey"`
	}
	if !decode(w, r, &q) {
		return
	}
	key := strings.ToUpper(strings.ReplaceAll(strings.TrimSpace(q.CardKey), " ", ""))
	if key == "" {
		fail(w, 400, "validation_failed", "请输入卡密")
		return
	}
	result, err := s.store.RedeemCard(r.Context(), authOf(r).CardID, key)
	if err != nil {
		code := err.Error()
		messages := map[string]string{
			"account_required":        "请使用用户名账户登录",
			"invalid_redemption_code": "卡密无效或已被兑换",
			"card_already_activated":  "该卡密已经用于旧版客户端登录，无法再次兑换",
			"card_expired":            "该卡密已过期",
			"empty_redemption_code":   "该卡密没有可兑换额度",
		}
		message := messages[code]
		if message == "" {
			code, message = "redemption_failed", "兑换失败，请稍后重试"
		}
		fail(w, 400, code, message)
		return
	}
	write(w, 200, result)
}

func (s *Server) publicConfig(w http.ResponseWriter, r *http.Request) {
	trialOffer, err := s.store.TrialOfferSettings(r.Context())
	if err != nil {
		fail(w, 500, "internal_error", "读取公开配置失败")
		return
	}
	write(w, 200, map[string]any{
		"supportQQ":     s.cfg.SupportQQ,
		"supportWeChat": s.cfg.SupportWeChat,
		"supportEmail":  s.cfg.SupportEmail,
		"trialOffer": map[string]any{
			"enabled":             trialOffer.Enabled,
			"interviewSeconds":    trialOffer.InterviewSeconds,
			"writtenQuestions":    trialOffer.WrittenQuestions,
			"announcementVersion": trialOffer.UpdatedAt,
		},
	})
}
