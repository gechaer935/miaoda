package httpapi

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	store "example.com/miaoda/server/internal/store/sqlite"
	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

const (
	adminSessionCookie = "miaoda_admin_session"
	adminJWTIssuer     = "miaoda-admin"
	adminCSRFFlag      = "1"
)

type adminSessionClaims struct {
	Scope          string `json:"scope"`
	Username       string `json:"username"`
	SessionVersion int64  `json:"sessionVersion"`
	jwt.RegisteredClaims
}

func constantTimeTextMatches(expected, provided string) bool {
	return expected != "" &&
		len(provided) == len(expected) &&
		subtle.ConstantTimeCompare([]byte(provided), []byte(expected)) == 1
}

func configuredAdminPasswordMatches(configured, provided string) bool {
	return constantTimeTextMatches(configured, provided)
}

func (s *Server) adminCredentialsMatch(ctx context.Context, username, password string) (store.AdminCredential, bool, error) {
	credential, err := s.store.AdminCredential(ctx)
	switch {
	case err == nil:
		passwordMatches := bcrypt.CompareHashAndPassword([]byte(credential.PasswordHash), []byte(password)) == nil
		usernameMatches := constantTimeTextMatches(credential.Username, strings.TrimSpace(username))
		return credential, usernameMatches && passwordMatches, nil
	case errors.Is(err, sql.ErrNoRows):
		usernameMatches := constantTimeTextMatches(s.cfg.AdminUsername, strings.TrimSpace(username))
		passwordMatches := configuredAdminPasswordMatches(s.cfg.AdminToken, password)
		return store.AdminCredential{}, usernameMatches && passwordMatches, nil
	default:
		return store.AdminCredential{}, false, err
	}
}

func (s *Server) adminPasswordMatches(ctx context.Context, password string) (store.AdminCredential, bool, error) {
	credential, err := s.store.AdminCredential(ctx)
	switch {
	case err == nil:
		return credential, bcrypt.CompareHashAndPassword([]byte(credential.PasswordHash), []byte(password)) == nil, nil
	case errors.Is(err, sql.ErrNoRows):
		return store.AdminCredential{}, configuredAdminPasswordMatches(s.cfg.AdminToken, password), nil
	default:
		return store.AdminCredential{}, false, err
	}
}

func (s *Server) initializeAdminCredential(ctx context.Context, username, password string) (store.AdminCredential, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), 12)
	if err != nil {
		return store.AdminCredential{}, err
	}
	return s.store.InitializeAdminCredential(ctx, strings.TrimSpace(username), string(hash))
}

func adminPasswordValidLength(password string) bool {
	return utf8.ValidString(password) && utf8.RuneCountInString(password) >= 12 && len([]byte(password)) <= 72
}

func adminSessionTTL(configured time.Duration) time.Duration {
	if configured <= 0 {
		return 12 * time.Hour
	}
	if configured > 24*time.Hour {
		return 24 * time.Hour
	}
	return configured
}

func randomAdminSessionID() (string, error) {
	raw := make([]byte, 18)
	if _, err := rand.Read(raw); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

func adminCookieSecure(r *http.Request) bool {
	return r.TLS != nil || strings.EqualFold(strings.TrimSpace(r.Header.Get("X-Forwarded-Proto")), "https")
}

func (s *Server) setAdminSessionCookie(w http.ResponseWriter, r *http.Request, username string, sessionVersion int64) (time.Time, error) {
	ttl := adminSessionTTL(s.cfg.TokenTTL)
	now := time.Now()
	expiresAt := now.Add(ttl)
	sessionID, err := randomAdminSessionID()
	if err != nil {
		return time.Time{}, err
	}
	claims := adminSessionClaims{
		Scope:          "admin",
		Username:       username,
		SessionVersion: sessionVersion,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    adminJWTIssuer,
			Subject:   "admin",
			ID:        sessionID,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(expiresAt),
		},
	}
	signed, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(s.cfg.JWTSecret))
	if err != nil {
		return time.Time{}, err
	}
	http.SetCookie(w, &http.Cookie{
		Name:     adminSessionCookie,
		Value:    signed,
		Path:     "/",
		Expires:  expiresAt,
		MaxAge:   int(ttl.Seconds()),
		HttpOnly: true,
		Secure:   adminCookieSecure(r),
		SameSite: http.SameSiteStrictMode,
	})
	return expiresAt, nil
}

func clearAdminSessionCookie(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{
		Name:     adminSessionCookie,
		Value:    "",
		Path:     "/",
		Expires:  time.Unix(1, 0),
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   adminCookieSecure(r),
		SameSite: http.SameSiteStrictMode,
	})
}

func (s *Server) validAdminSession(r *http.Request) bool {
	cookie, err := r.Cookie(adminSessionCookie)
	if err != nil || strings.TrimSpace(cookie.Value) == "" {
		return false
	}
	claims := &adminSessionClaims{}
	parsed, err := jwt.ParseWithClaims(cookie.Value, claims, func(token *jwt.Token) (any, error) {
		if token.Method != jwt.SigningMethodHS256 {
			return nil, errors.New("unexpected signing method")
		}
		return []byte(s.cfg.JWTSecret), nil
	}, jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}), jwt.WithIssuer(adminJWTIssuer), jwt.WithSubject("admin"), jwt.WithExpirationRequired())
	if err != nil || !parsed.Valid || claims.Scope != "admin" || claims.Username == "" || claims.SessionVersion < 1 {
		return false
	}
	credential, err := s.store.AdminCredential(r.Context())
	return err == nil && credential.SessionVersion == claims.SessionVersion && constantTimeTextMatches(credential.Username, claims.Username)
}

func adminUnsafeMethod(method string) bool {
	return method != http.MethodGet && method != http.MethodHead && method != http.MethodOptions
}

func (s *Server) authorizeAdmin(w http.ResponseWriter, r *http.Request) bool {
	if !s.adminIPAllowed(r) {
		http.NotFound(w, r)
		return false
	}
	if provided := strings.TrimSpace(r.Header.Get("X-Admin-Token")); provided != "" {
		username := strings.TrimSpace(r.Header.Get("X-Admin-Username"))
		_, matches, err := s.adminCredentialsMatch(r.Context(), username, provided)
		if err != nil {
			fail(w, http.StatusInternalServerError, "admin_auth_failed", "管理员认证暂时不可用")
			return false
		}
		if !matches {
			fail(w, http.StatusUnauthorized, "invalid_admin_credentials", "管理员用户名或密码错误")
			return false
		}
		return true
	}
	if !s.validAdminSession(r) {
		fail(w, http.StatusUnauthorized, "admin_auth_required", "请先登录管理后台")
		return false
	}
	if adminUnsafeMethod(r.Method) && r.Header.Get("X-Admin-CSRF") != adminCSRFFlag {
		fail(w, http.StatusForbidden, "csrf_validation_failed", "请求安全校验失败，请刷新页面后重试")
		return false
	}
	return true
}

func (s *Server) adminLogin(w http.ResponseWriter, r *http.Request) {
	if !s.adminIPAllowed(r) {
		http.NotFound(w, r)
		return
	}
	var q struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if !decode(w, r, &q) {
		return
	}
	ipKey := "admin-login:ip:" + clientIP(r)
	if !s.authGuard.allow(ipKey, 30, 15*time.Minute) || s.authGuard.locked(ipKey) {
		fail(w, http.StatusTooManyRequests, "admin_login_rate_limited", "登录尝试过多，请稍后再试")
		return
	}
	credential, matches, err := s.adminCredentialsMatch(r.Context(), q.Username, q.Password)
	if err != nil {
		fail(w, http.StatusInternalServerError, "admin_auth_failed", "管理员认证暂时不可用")
		return
	}
	if !matches {
		_ = bcrypt.CompareHashAndPassword(s.dummyHash, []byte(q.Password))
		s.authGuard.failed(ipKey)
		fail(w, http.StatusUnauthorized, "invalid_admin_credentials", "管理员用户名或密码错误")
		return
	}
	if credential.SessionVersion == 0 {
		if s.cfg.AdminToken == "" {
			fail(w, http.StatusForbidden, "admin_disabled", "管理后台尚未配置初始密码")
			return
		}
		credential, err = s.initializeAdminCredential(r.Context(), q.Username, q.Password)
		if err != nil {
			fail(w, http.StatusInternalServerError, "admin_auth_failed", "管理员认证暂时不可用")
			return
		}
	}
	expiresAt, err := s.setAdminSessionCookie(w, r, credential.Username, credential.SessionVersion)
	if err != nil {
		fail(w, http.StatusInternalServerError, "admin_auth_failed", "管理员认证暂时不可用")
		return
	}
	s.authGuard.succeeded(ipKey)
	write(w, http.StatusOK, map[string]any{"ok": true, "username": credential.Username, "expiresAt": expiresAt.UTC()})
}

func (s *Server) adminSession(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	credential, err := s.store.AdminCredential(r.Context())
	if err != nil {
		fail(w, http.StatusInternalServerError, "admin_auth_failed", "管理员认证暂时不可用")
		return
	}
	write(w, http.StatusOK, map[string]any{"authenticated": true, "username": credential.Username})
}

func (s *Server) adminLogout(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	clearAdminSessionCookie(w, r)
	write(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) changeAdminPassword(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	var q struct {
		CurrentPassword string `json:"currentPassword"`
		NewPassword     string `json:"newPassword"`
	}
	if !decode(w, r, &q) {
		return
	}
	if !adminPasswordValidLength(q.NewPassword) {
		fail(w, http.StatusBadRequest, "invalid_admin_password", "新密码至少 12 个字符，且不能超过 72 个字节")
		return
	}
	if q.NewPassword == q.CurrentPassword {
		fail(w, http.StatusBadRequest, "password_unchanged", "新密码不能与当前密码相同")
		return
	}
	credential, matches, err := s.adminPasswordMatches(r.Context(), q.CurrentPassword)
	if err != nil {
		fail(w, http.StatusInternalServerError, "admin_auth_failed", "管理员认证暂时不可用")
		return
	}
	if !matches {
		fail(w, http.StatusUnauthorized, "invalid_admin_password", "当前密码错误")
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(q.NewPassword), 12)
	if err != nil {
		fail(w, http.StatusBadRequest, "invalid_admin_password", "新密码无法使用，请更换后重试")
		return
	}
	if credential.SessionVersion == 0 {
		credential, err = s.store.InitializeAdminCredential(r.Context(), s.cfg.AdminUsername, string(hash))
	} else {
		credential, err = s.store.ChangeAdminPassword(r.Context(), credential.SessionVersion, string(hash))
	}
	if err != nil {
		fail(w, http.StatusConflict, "admin_password_changed", "密码已在其他会话中修改，请重新登录")
		return
	}
	expiresAt, err := s.setAdminSessionCookie(w, r, credential.Username, credential.SessionVersion)
	if err != nil {
		fail(w, http.StatusInternalServerError, "admin_auth_failed", "密码已修改，请重新登录")
		return
	}
	write(w, http.StatusOK, map[string]any{"ok": true, "expiresAt": expiresAt.UTC()})
}
