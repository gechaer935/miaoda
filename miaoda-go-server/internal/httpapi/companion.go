package httpapi

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"
	"example.com/miaoda/server/internal/config"
	store "example.com/miaoda/server/internal/store/sqlite"
	"github.com/go-chi/chi/v5"
)

const mobileCookie = "miaoda_mobile_session"

type Envelope struct {
	V         int             `json:"v"`
	Type      string          `json:"type,omitempty"`
	SessionID string          `json:"sessionId,omitempty"`
	RequestID string          `json:"requestId,omitempty"`
	Seq       int64           `json:"seq"`
	Timestamp int64           `json:"timestamp"`
	Payload   json.RawMessage `json:"payload,omitempty"`
}
type peer struct {
	conn    *websocket.Conn
	role    string
	writeMu sync.Mutex
}
type room struct {
	mu     sync.Mutex
	peers  map[*peer]bool
	events []Envelope
	seq    int64
}
type Companion struct {
	cfg   config.Config
	store *store.Store
	guard *authLimiter
	mu    sync.Mutex
	rooms map[string]*room
	solve http.Handler
}

func NewCompanion(c config.Config, s *store.Store, solve http.Handler, guard *authLimiter) *Companion {
	return &Companion{cfg: c, store: s, guard: guard, rooms: map[string]*room{}, solve: solve}
}
func (c *Companion) DesktopRoutes() http.Handler {
	r := chi.NewRouter()
	r.Post("/pairings", c.Create)
	r.Get("/pairings/current", c.Current)
	r.Post("/pairings/{pairId}/confirm", c.Confirm)
	r.Delete("/pairings/{pairId}", c.Revoke)
	r.Post("/captures/{captureId}", c.CaptureUpload)
	return r
}
func token(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}
func digest(v string) string { x := sha256.Sum256([]byte(v)); return hex.EncodeToString(x[:]) }
func code6() string {
	b := make([]byte, 3)
	_, _ = rand.Read(b)
	n := (int(b[0])<<16 | int(b[1])<<8 | int(b[2])) % 1000000
	return fmt.Sprintf("%06d", n)
}
func (c *Companion) Create(w http.ResponseWriter, r *http.Request) {
	a := authOf(r)
	if !c.guard.allow(fmt.Sprintf("pair-create:card:%d", a.CardID), 12, time.Minute) ||
		!c.guard.allow("pair-create:ip:"+clientIP(r), 36, time.Minute) {
		fail(w, http.StatusTooManyRequests, "rate_limited", "Too many pairing requests")
		return
	}
	mobileBase := strings.TrimRight(strings.TrimSpace(c.cfg.MobileBaseURL), "/")
	mobileURL, urlErr := url.Parse(mobileBase)
	if urlErr != nil || mobileURL.Scheme == "" || mobileURL.Hostname() == "" {
		fail(w, 500, "mobile_base_url_invalid", "MOBILE_BASE_URL is invalid; restart with a valid LAN IP")
		return
	}
	id := token(18)
	ticket := token(24)
	code := code6()
	now := time.Now().UTC()
	exp := now.Add(120 * time.Second)
	var oldPairIDs []string
	rows, queryErr := c.store.DB.QueryContext(r.Context(), "SELECT id FROM companion_pairings WHERE card_id=? AND desktop_device_id=? AND revoked_at IS NULL", a.CardID, a.DeviceID)
	if queryErr == nil {
		for rows.Next() {
			var oldID string
			if rows.Scan(&oldID) == nil {
				oldPairIDs = append(oldPairIDs, oldID)
			}
		}
		rows.Close()
	}
	revokedAt := now.Format(time.RFC3339Nano)
	e := c.store.WithTx(r.Context(), func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(r.Context(), "UPDATE companion_mobile_sessions SET revoked_at=? WHERE pairing_id IN (SELECT id FROM companion_pairings WHERE card_id=? AND desktop_device_id=?) AND revoked_at IS NULL", revokedAt, a.CardID, a.DeviceID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(r.Context(), "UPDATE companion_pairings SET status='revoked',revoked_at=? WHERE card_id=? AND desktop_device_id=? AND revoked_at IS NULL", revokedAt, a.CardID, a.DeviceID); err != nil {
			return err
		}
		_, err := tx.ExecContext(r.Context(), "INSERT INTO companion_pairings(id,card_id,desktop_device_id,ticket_hash,code_hash,status,created_at,expires_at) VALUES(?,?,?,?,?,'pending',?,?)", id, a.CardID, a.DeviceID, digest(ticket), digest(code), revokedAt, exp.Format(time.RFC3339Nano))
		return err
	})
	if e != nil {
		fail(w, 500, "pairing_create_failed", e.Error())
		return
	}
	for _, oldID := range oldPairIDs {
		c.closeRoom(oldID)
	}
	write(w, 201, map[string]any{"pairId": id, "qrUrl": mobileBase + "/pair/" + id + "?ticket=" + url.QueryEscape(ticket), "code": code, "expiresAt": exp})
}
func (c *Companion) Claim(w http.ResponseWriter, r *http.Request) {
	if !c.guard.allow("pair-claim:ip:"+clientIP(r), 10, time.Minute) {
		fail(w, http.StatusTooManyRequests, "rate_limited", "Too many pairing attempts")
		return
	}
	var q struct {
		PairID string `json:"pairId"`
		Ticket string `json:"ticket"`
		Code   string `json:"code"`
	}
	if !decode(w, r, &q) {
		return
	}
	var id, ticketHash, codeHash, status, expires string
	var card int64
	var device string
	query := "SELECT id,card_id,desktop_device_id,ticket_hash,code_hash,status,expires_at FROM companion_pairings WHERE "
	arg := q.PairID
	if q.PairID != "" {
		query += "id=?"
	} else {
		query += "code_hash=?"
		arg = digest(q.Code)
	}
	e := c.store.DB.QueryRowContext(r.Context(), query, arg).Scan(&id, &card, &device, &ticketHash, &codeHash, &status, &expires)
	if e != nil {
		fail(w, 404, "pairing_not_found", "Pairing not found")
		return
	}
	ex, _ := time.Parse(time.RFC3339Nano, expires)
	if status != "pending" || time.Now().After(ex) {
		fail(w, 410, "pairing_expired", "Pairing expired or already used")
		return
	}
	if q.PairID != "" && !secureEqual(digest(q.Ticket), ticketHash) {
		fail(w, 401, "invalid_pairing_ticket", "Invalid pairing ticket")
		return
	}
	if q.PairID == "" && !secureEqual(digest(q.Code), codeHash) {
		fail(w, 401, "invalid_pairing_code", "Invalid pairing code")
		return
	}
	sid := token(18)
	secret := token(32)
	now := time.Now().UTC()
	mobileExp := now.Add(12 * time.Hour)
	e = c.store.WithTx(r.Context(), func(tx *sql.Tx) error {
		res, e := tx.ExecContext(r.Context(), "UPDATE companion_pairings SET status='claimed',claimed_at=? WHERE id=? AND status='pending'", now.Format(time.RFC3339Nano), id)
		if e != nil {
			return e
		}
		n, _ := res.RowsAffected()
		if n != 1 {
			return errors.New("already claimed")
		}
		_, e = tx.ExecContext(r.Context(), "INSERT INTO companion_mobile_sessions(id,pairing_id,token_hash,created_at,expires_at,last_seen_at) VALUES(?,?,?,?,?,?)", sid, id, digest(secret), now.Format(time.RFC3339Nano), mobileExp.Format(time.RFC3339Nano), now.Format(time.RFC3339Nano))
		return e
	})
	if e != nil {
		fail(w, 409, "pairing_claimed", "Pairing already claimed")
		return
	}
	http.SetCookie(w, &http.Cookie{Name: mobileCookie, Value: sid + "." + secret, Path: "/", HttpOnly: true, Secure: requestIsHTTPS(r), SameSite: http.SameSiteStrictMode, Expires: mobileExp})
	write(w, 200, map[string]any{"ok": true, "pairingId": id, "expiresAt": mobileExp})
	c.broadcast(id, "connection.state", "", "", map[string]any{"mobileConnected": true})
}
func secureEqual(a, b string) bool {
	return len(a) == len(b) && subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}
func (c *Companion) mobileSession(r *http.Request) (string, store.Auth, error) {
	cookie, e := r.Cookie(mobileCookie)
	if e != nil {
		return "", store.Auth{}, e
	}
	parts := strings.SplitN(cookie.Value, ".", 2)
	if len(parts) != 2 {
		return "", store.Auth{}, errors.New("bad cookie")
	}
	var pair, hash, expires string
	var revoked sql.NullString
	var card int64
	var device string
	e = c.store.DB.QueryRowContext(r.Context(), "SELECT s.pairing_id,s.token_hash,s.expires_at,s.revoked_at,p.card_id,p.desktop_device_id FROM companion_mobile_sessions s JOIN companion_pairings p ON p.id=s.pairing_id WHERE s.id=?", parts[0]).Scan(&pair, &hash, &expires, &revoked, &card, &device)
	if e != nil || revoked.Valid || !secureEqual(digest(parts[1]), hash) {
		return "", store.Auth{}, errors.New("invalid mobile session")
	}
	ex, _ := time.Parse(time.RFC3339Nano, expires)
	if time.Now().After(ex) {
		return "", store.Auth{}, errors.New("expired mobile session")
	}
	_, _ = c.store.DB.ExecContext(r.Context(), "UPDATE companion_mobile_sessions SET last_seen_at=? WHERE id=?", time.Now().UTC().Format(time.RFC3339Nano), parts[0])
	return pair, store.Auth{CardID: card, DeviceID: device, TokenID: "mobile:" + parts[0]}, nil
}
func (c *Companion) MobileAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, a, e := c.mobileSession(r)
		if e != nil {
			fail(w, 401, "invalid_mobile_session", "Mobile session is invalid or expired")
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), authKey{}, a)))
	})
}
func (c *Companion) Bootstrap(w http.ResponseWriter, r *http.Request) {
	pair, a, e := c.mobileSession(r)
	if e != nil {
		fail(w, 401, "invalid_mobile_session", "Mobile session is invalid or expired")
		return
	}
	card, e := c.store.CardByID(r.Context(), a.CardID)
	if e != nil {
		fail(w, 404, "card_not_found", "Card not found")
		return
	}
	write(w, 200, map[string]any{"pairingId": pair, "desktopDeviceId": a.DeviceID, "quota": map[string]any{"remainingInterviewSeconds": card.RemainingInterviewSeconds, "remainingWrittenQuestions": card.RemainingWrittenQuestions}, "serverTime": time.Now().UTC()})
}
func (c *Companion) Current(w http.ResponseWriter, r *http.Request) {
	a := authOf(r)
	rows, e := c.store.DB.QueryContext(r.Context(), `
		SELECT p.id,p.status,p.expires_at,p.claimed_at,
			(SELECT MAX(s.last_seen_at) FROM companion_mobile_sessions s WHERE s.pairing_id=p.id AND s.revoked_at IS NULL) AS last_seen_at
		FROM companion_pairings p
		WHERE p.card_id=? AND p.desktop_device_id=? AND p.revoked_at IS NULL
		ORDER BY (last_seen_at IS NULL), last_seen_at DESC, p.created_at DESC
		LIMIT 10`, a.CardID, a.DeviceID)
	if e != nil {
		fail(w, 500, "internal_error", e.Error())
		return
	}
	defer rows.Close()
	var out []map[string]any
	for rows.Next() {
		var id, status, exp string
		var claimed, lastSeen sql.NullString
		_ = rows.Scan(&id, &status, &exp, &claimed, &lastSeen)
		out = append(out, map[string]any{"pairId": id, "status": status, "expiresAt": exp, "claimedAt": claimed, "lastSeenAt": lastSeen})
	}
	write(w, 200, map[string]any{"pairings": out})
}
func (c *Companion) owns(r *http.Request, id string) bool {
	a := authOf(r)
	var n int
	_ = c.store.DB.QueryRowContext(r.Context(), "SELECT count(*) FROM companion_pairings WHERE id=? AND card_id=? AND desktop_device_id=?", id, a.CardID, a.DeviceID).Scan(&n)
	return n == 1
}
func (c *Companion) Confirm(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "pairId")
	if !c.owns(r, id) {
		fail(w, 404, "pairing_not_found", "Pairing not found")
		return
	}
	_, _ = c.store.DB.ExecContext(r.Context(), "UPDATE companion_pairings SET status='active' WHERE id=? AND status='claimed'", id)
	write(w, 200, map[string]bool{"ok": true})
}
func (c *Companion) Revoke(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "pairId")
	if !c.owns(r, id) {
		fail(w, 404, "pairing_not_found", "Pairing not found")
		return
	}
	n := time.Now().UTC().Format(time.RFC3339Nano)
	_, _ = c.store.DB.ExecContext(r.Context(), "UPDATE companion_pairings SET status='revoked',revoked_at=? WHERE id=?", n, id)
	_, _ = c.store.DB.ExecContext(r.Context(), "UPDATE companion_mobile_sessions SET revoked_at=? WHERE pairing_id=? AND revoked_at IS NULL", n, id)
	c.closeRoom(id)
	write(w, 200, map[string]bool{"ok": true})
}
func (c *Companion) CaptureUpload(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "captureId")
	var pair, status string
	e := c.store.DB.QueryRowContext(r.Context(), "SELECT pairing_id,status FROM companion_capture_requests WHERE id=?", id).Scan(&pair, &status)
	if e != nil || !c.owns(r, pair) {
		fail(w, 404, "capture_not_found", "Capture request not found")
		return
	}
	if status != "pending" {
		fail(w, 409, "capture_already_processed", "Capture request already processed")
		return
	}
	rr := httptest.NewRecorder()
	c.solve.ServeHTTP(rr, r)
	for k, values := range rr.Header() {
		for _, value := range values {
			w.Header().Add(k, value)
		}
	}
	w.WriteHeader(rr.Code)
	_, _ = w.Write(rr.Body.Bytes())
	if rr.Code/100 != 2 {
		return
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	_, _ = c.store.DB.ExecContext(r.Context(), "UPDATE companion_capture_requests SET status='completed',completed_at=?,request_hash=? WHERE id=? AND status='pending'", now, digest(rr.Body.String()), id)
	var payload json.RawMessage = append([]byte(nil), rr.Body.Bytes()...)
	c.broadcast(pair, "capture.result", "", id, payload)
}
func (c *Companion) room(id string) *room {
	c.mu.Lock()
	defer c.mu.Unlock()
	r := c.rooms[id]
	if r == nil {
		r = &room{peers: map[*peer]bool{}}
		c.rooms[id] = r
	}
	return r
}
func (c *Companion) broadcast(id, typ, session, request string, payload any) {
	b, _ := json.Marshal(payload)
	r := c.room(id)
	r.mu.Lock()
	r.seq++
	ev := Envelope{V: 1, Type: typ, SessionID: session, RequestID: request, Seq: r.seq, Timestamp: time.Now().UnixMilli(), Payload: b}
	r.events = append(r.events, ev)
	if len(r.events) > 200 {
		r.events = r.events[len(r.events)-200:]
	}
	cut := time.Now().Add(-10 * time.Minute).UnixMilli()
	for len(r.events) > 0 && r.events[0].Timestamp < cut {
		r.events = r.events[1:]
	}
	peers := make([]*peer, 0, len(r.peers))
	for p := range r.peers {
		peers = append(peers, p)
	}
	r.mu.Unlock()
	for _, p := range peers {
		p.writeMu.Lock()
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		e := wsjson(ctx, p.conn, ev)
		cancel()
		p.writeMu.Unlock()
		if e != nil {
			r.mu.Lock()
			if r.peers[p] {
				delete(r.peers, p)
				_ = p.conn.CloseNow()
			}
			r.mu.Unlock()
		}
	}
}

func companionEventLimit(role, typ, pairID string) (string, int) {
	if role == "device" {
		if contentKind := desktopContentKind(typ); contentKind != "" {
			return "companion-content:" + contentKind + ":pair:" + pairID, 150
		}
	}
	return "companion-event:pair:" + pairID, 120
}

func desktopContentKind(typ string) string {
	switch typ {
	case "transcript.partial", "transcript.final":
		return "transcript"
	case "answer.started", "answer.token", "answer.done", "answer.error":
		return "answer"
	}
	return ""
}
func wsjson(ctx context.Context, c *websocket.Conn, v any) error {
	b, e := json.Marshal(v)
	if e != nil {
		return e
	}
	return c.Write(ctx, websocket.MessageText, b)
}
func (c *Companion) DeviceWS(w http.ResponseWriter, r *http.Request) {
	pair := r.URL.Query().Get("pairingId")
	if pair == "" || !c.owns(r, pair) {
		fail(w, 403, "pairing_forbidden", "Invalid pairing")
		return
	}
	c.serveWS(w, r, pair, "device")
}
func (c *Companion) MobileWS(w http.ResponseWriter, r *http.Request) {
	pair, _, e := c.mobileSession(r)
	if e != nil || pair != r.URL.Query().Get("pairingId") {
		fail(w, 401, "invalid_mobile_session", "Invalid mobile session")
		return
	}
	c.serveWS(w, r, pair, "mobile")
}
func (c *Companion) serveWS(w http.ResponseWriter, r *http.Request, id, role string) {
	if o := r.Header.Get("Origin"); o != "" && !originOK(c.cfg.AllowOrigin, o) {
		fail(w, 403, "origin_forbidden", "Origin is not allowed")
		return
	}
	// The full browser Origin has already been checked against ALLOW_ORIGIN
	// above. OriginPatterns expects hostname patterns rather than full URLs, so
	// passing entries such as "http://10.0.0.2:5174" rejects valid mobile
	// handshakes a second time. Skip only the library's duplicate check here.
	conn, e := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
	if e != nil {
		return
	}
	defer conn.Close(websocket.StatusNormalClosure, "closed")
	conn.SetReadLimit(64 << 10)
	p := &peer{conn: conn, role: role}
	room := c.room(id)
	room.mu.Lock()
	room.peers[p] = true
	last, _ := strconv.ParseInt(r.URL.Query().Get("lastSeq"), 10, 64)
	events := append([]Envelope(nil), room.events...)
	room.mu.Unlock()
	for _, ev := range events {
		if ev.Seq > last {
			p.writeMu.Lock()
			_ = wsjson(r.Context(), conn, ev)
			p.writeMu.Unlock()
		}
	}
	c.broadcast(id, "connection.state", "", "", map[string]any{role + "Connected": true})
	defer func() {
		room.mu.Lock()
		delete(room.peers, p)
		room.mu.Unlock()
		c.broadcast(id, "connection.state", "", "", map[string]any{role + "Connected": false})
	}()
	for {
		_, b, e := conn.Read(r.Context())
		if e != nil {
			return
		}
		var in Envelope
		if json.Unmarshal(b, &in) != nil || in.V != 1 {
			continue
		}
		limitKey, maximum := companionEventLimit(role, in.Type, id)
		if !c.guard.allow(limitKey, maximum, time.Minute) {
			_ = conn.Close(websocket.StatusPolicyViolation, "event rate limit exceeded")
			return
		}
		if role == "mobile" && !allowedMobile(in.Type) {
			continue
		}
		if in.Type == "heartbeat" {
			p.writeMu.Lock()
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			e = wsjson(ctx, conn, Envelope{V: 1, Type: "heartbeat", Seq: 0, Timestamp: time.Now().UnixMilli(), Payload: json.RawMessage(`{}`)})
			cancel()
			p.writeMu.Unlock()
			if e != nil {
				return
			}
			continue
		}
		if in.Type == "capture.request" {
			if !c.guard.allow("companion-capture:pair:"+id, 12, time.Minute) {
				_ = conn.Close(websocket.StatusPolicyViolation, "capture rate limit exceeded")
				return
			}
			cid := token(18)
			_, _ = c.store.DB.ExecContext(r.Context(), "INSERT INTO companion_capture_requests(id,pairing_id,status,created_at,expires_at) VALUES(?,?,'pending',?,?)", cid, id, time.Now().UTC().Format(time.RFC3339Nano), time.Now().Add(30*time.Second).UTC().Format(time.RFC3339Nano))
			in.RequestID = cid
		}
		c.broadcast(id, in.Type, in.SessionID, in.RequestID, json.RawMessage(in.Payload))
	}
}
func allowedMobile(t string) bool {
	switch t {
	case "interview.start", "interview.stop", "question.manual", "answer.cancel", "capture.request", "written.language.set", "written.mode.set", "display.mode.set", "heartbeat":
		return true
	}
	return false
}
func (c *Companion) closeRoom(id string) {
	c.mu.Lock()
	r := c.rooms[id]
	delete(c.rooms, id)
	c.mu.Unlock()
	if r == nil {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	for p := range r.peers {
		_ = p.conn.Close(websocket.StatusPolicyViolation, "pairing revoked")
	}
}
