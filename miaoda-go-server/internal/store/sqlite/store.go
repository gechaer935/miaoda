package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"example.com/miaoda/server/migrations"
	_ "modernc.org/sqlite"
)

type Store struct{ DB *sql.DB }
type Card struct {
	ID                        int64   `json:"id"`
	CardKey                   string  `json:"cardKey"`
	Status                    string  `json:"status"`
	CreatedAt                 string  `json:"createdAt"`
	RemainingInterviewSeconds int64   `json:"remainingInterviewSeconds"`
	RemainingWrittenQuestions float64 `json:"remainingWrittenQuestions"`
	MaxDevices                int     `json:"maxDevices"`
	ActivatedAt               *string `json:"activatedAt"`
	ExpiresAt                 *string `json:"expiresAt"`
	Note                      *string `json:"note"`
	Kind                      string  `json:"kind"`
}
type User struct {
	ID            int64  `json:"id"`
	Username      string `json:"username"`
	PasswordHash  string `json:"-"`
	AccountCardID int64  `json:"-"`
	CreatedAt     string `json:"createdAt"`
}
type Auth struct {
	CardID            int64
	DeviceID, TokenID string
}

const DefaultDeviceLimit = 5

func Open(path string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if _, err = db.Exec(migrations.Schema); err != nil {
		db.Close()
		return nil, fmt.Errorf("initialize database: %w", err)
	}
	if err = ensureInterviewRequestQuestionText(db); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate interview question logs: %w", err)
	}
	if err = ensureInterviewRequestClientVersion(db); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate interview client versions: %w", err)
	}
	if _, err = db.Exec(`UPDATE interview_request_logs SET status='failed',
		error_message='服务重启前请求未完成',completed_at=? WHERE status='running'`, now()); err != nil {
		db.Close()
		return nil, fmt.Errorf("finish interrupted interview logs: %w", err)
	}
	if err = ensureAdminCredentialUsername(db); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate admin username: %w", err)
	}
	if err = normalizeLegacyCardKinds(db); err != nil {
		db.Close()
		return nil, fmt.Errorf("normalize card kinds: %w", err)
	}
	if err = backfillLegacyCardBatches(db); err != nil {
		db.Close()
		return nil, fmt.Errorf("backfill card batches: %w", err)
	}
	if err = backfillCardBatchNames(db); err != nil {
		db.Close()
		return nil, fmt.Errorf("backfill card batch names: %w", err)
	}
	return &Store{db}, nil
}
func now() string { return time.Now().UTC().Format(time.RFC3339Nano) }

func ensureInterviewRequestQuestionText(db *sql.DB) error {
	rows, err := db.Query("PRAGMA table_info(interview_request_logs)")
	if err != nil {
		return err
	}
	found := false
	for rows.Next() {
		var columnID, notNull, primaryKey int
		var name, columnType string
		var defaultValue any
		if err = rows.Scan(&columnID, &name, &columnType, &notNull, &defaultValue, &primaryKey); err != nil {
			_ = rows.Close()
			return err
		}
		if name == "question_text" {
			found = true
		}
	}
	if err = rows.Close(); err != nil {
		return err
	}
	if !found {
		_, err = db.Exec("ALTER TABLE interview_request_logs ADD COLUMN question_text TEXT NOT NULL DEFAULT ''")
	}
	return err
}

func ensureInterviewRequestClientVersion(db *sql.DB) error {
	rows, err := db.Query("PRAGMA table_info(interview_request_logs)")
	if err != nil {
		return err
	}
	found := false
	for rows.Next() {
		var columnID, notNull, primaryKey int
		var name, columnType string
		var defaultValue any
		if err = rows.Scan(&columnID, &name, &columnType, &notNull, &defaultValue, &primaryKey); err != nil {
			_ = rows.Close()
			return err
		}
		if name == "client_version" {
			found = true
		}
	}
	if err = rows.Close(); err != nil {
		return err
	}
	if !found {
		_, err = db.Exec("ALTER TABLE interview_request_logs ADD COLUMN client_version TEXT NOT NULL DEFAULT ''")
	}
	return err
}

func ensureAdminCredentialUsername(db *sql.DB) error {
	rows, err := db.Query("PRAGMA table_info(admin_credentials)")
	if err != nil {
		return err
	}
	found := false
	for rows.Next() {
		var columnID, notNull, primaryKey int
		var name, columnType string
		var defaultValue any
		if err = rows.Scan(&columnID, &name, &columnType, &notNull, &defaultValue, &primaryKey); err != nil {
			_ = rows.Close()
			return err
		}
		if name == "username" {
			found = true
		}
	}
	if err = rows.Close(); err != nil {
		return err
	}
	if !found {
		if _, err = db.Exec("ALTER TABLE admin_credentials ADD COLUMN username TEXT NOT NULL DEFAULT 'admin'"); err != nil {
			return err
		}
	}
	_, err = db.Exec("UPDATE admin_credentials SET username='admin' WHERE trim(username)='' OR username IS NULL")
	return err
}

// Experience cards were a short-lived product label. They have the same
// single-use and quota semantics as every other redemption card, so existing
// databases are normalized without changing quota, status, or ownership.
func normalizeLegacyCardKinds(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	for _, statement := range []string{
		"UPDATE card_metadata SET kind='standard' WHERE kind='experience'",
		"UPDATE card_batches SET kind='standard' WHERE kind='experience'",
		"UPDATE card_redemptions SET kind='standard' WHERE kind='experience'",
	} {
		if _, err = tx.Exec(statement); err != nil {
			_ = tx.Rollback()
			return err
		}
	}
	return tx.Commit()
}

type legacyBatchCard struct {
	ID              int64
	Seconds         int64
	Written         float64
	MaxDevices      int
	CreatedAt, Note string
	Kind, Platform  string
}

type legacyBatchKey struct {
	Seconds        int64
	Written        float64
	MaxDevices     int
	Minute, Note   string
	Kind, Platform string
}

func legacySalesPlatform(note string) string {
	switch {
	case strings.Contains(note, "淘宝"):
		return "taobao"
	case strings.Contains(note, "闲鱼"), strings.Contains(note, "咸鱼"):
		return "xianyu"
	case strings.Contains(note, "链动"):
		return "liandong"
	default:
		return "legacy"
	}
}

func cardBatchPlatformName(platform string) string {
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

func cardBatchInterviewName(seconds int64) string {
	if seconds%3600 == 0 {
		return fmt.Sprintf("%d小时", seconds/3600)
	}
	if seconds%60 == 0 {
		return fmt.Sprintf("%d分钟", seconds/60)
	}
	return fmt.Sprintf("%d秒", seconds)
}

// CardBatchBaseName is the human-facing part shared by a batch name and its
// TXT filename. The immutable sequence suffix is assigned separately.
func CardBatchBaseName(platform string, seconds int64, written float64, count int) string {
	parts := make([]string, 0, 2)
	if seconds > 0 {
		parts = append(parts, "面试"+cardBatchInterviewName(seconds))
	}
	if written > 0 {
		parts = append(parts, "笔试"+fmt.Sprintf("%g", written)+"次")
	}
	if len(parts) == 0 {
		parts = append(parts, "空额度")
	}
	return cardBatchPlatformName(platform) + strings.Join(parts, "+") + fmt.Sprintf("-%d张", count)
}

func nextCardBatchDisplayNameTx(ctx context.Context, tx *sql.Tx, baseName string) (string, int, error) {
	var sequence int
	err := tx.QueryRowContext(ctx, "SELECT last_sequence FROM card_batch_name_sequences WHERE base_name=?", baseName).Scan(&sequence)
	switch {
	case err == sql.ErrNoRows:
		sequence = 1
		if _, err = tx.ExecContext(ctx, "INSERT INTO card_batch_name_sequences(base_name,last_sequence) VALUES(?,?)", baseName, sequence); err != nil {
			return "", 0, err
		}
	case err != nil:
		return "", 0, err
	default:
		sequence++
		if _, err = tx.ExecContext(ctx, "UPDATE card_batch_name_sequences SET last_sequence=? WHERE base_name=?", sequence, baseName); err != nil {
			return "", 0, err
		}
	}
	return fmt.Sprintf("%s-%04d", baseName, sequence), sequence, nil
}

// backfillCardBatchNames gives historical batches stable readable names in
// creation order. The counter table is intentionally retained after deletion
// so a previously issued name is never reused.
func backfillCardBatchNames(db *sql.DB) error {
	rows, err := db.Query(`SELECT b.id,b.sales_platform,b.interview_seconds,b.written_questions,count(m.card_id)
		FROM card_batches b LEFT JOIN card_batch_members m ON m.batch_id=b.id
		LEFT JOIN card_batch_names n ON n.batch_id=b.id WHERE n.batch_id IS NULL
		GROUP BY b.id ORDER BY b.id`)
	if err != nil {
		return err
	}
	type unnamedBatch struct {
		id, seconds int64
		platform    string
		written     float64
		count       int
	}
	var batches []unnamedBatch
	for rows.Next() {
		var batch unnamedBatch
		if err = rows.Scan(&batch.id, &batch.platform, &batch.seconds, &batch.written, &batch.count); err != nil {
			_ = rows.Close()
			return err
		}
		batches = append(batches, batch)
	}
	if err = rows.Close(); err != nil {
		return err
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	if _, err = tx.Exec(`INSERT INTO card_batch_name_sequences(base_name,last_sequence)
		SELECT base_name,max(sequence) FROM card_batch_names GROUP BY base_name
		ON CONFLICT(base_name) DO UPDATE SET last_sequence=max(last_sequence,excluded.last_sequence)`); err != nil {
		_ = tx.Rollback()
		return err
	}
	ctx := context.Background()
	for _, batch := range batches {
		baseName := CardBatchBaseName(batch.platform, batch.seconds, batch.written, batch.count)
		displayName, sequence, nameErr := nextCardBatchDisplayNameTx(ctx, tx, baseName)
		if nameErr != nil {
			_ = tx.Rollback()
			return nameErr
		}
		if _, err = tx.Exec("INSERT INTO card_batch_names(batch_id,display_name,base_name,sequence) VALUES(?,?,?,?)", batch.id, displayName, baseName, sequence); err != nil {
			_ = tx.Rollback()
			return err
		}
	}
	return tx.Commit()
}

// backfillLegacyCardBatches keeps cards created before batch management
// visible. Cards generated with identical settings in the same minute are
// treated as one historical batch; no quota or redemption data is changed.
func backfillLegacyCardBatches(db *sql.DB) error {
	rows, err := db.Query(`SELECT c.id,c.remaining_interview_seconds,c.remaining_written_questions,c.max_devices,c.created_at,COALESCE(c.note,''),
		COALESCE((SELECT kind FROM card_metadata WHERE card_id=c.id),'standard')
		FROM cards c WHERE COALESCE((SELECT kind FROM card_metadata WHERE card_id=c.id),'standard')!='account'
		AND NOT EXISTS(SELECT 1 FROM card_batch_members m WHERE m.card_id=c.id) ORDER BY c.id`)
	if err != nil {
		return err
	}
	var cards []legacyBatchCard
	for rows.Next() {
		var card legacyBatchCard
		if err = rows.Scan(&card.ID, &card.Seconds, &card.Written, &card.MaxDevices, &card.CreatedAt, &card.Note, &card.Kind); err != nil {
			_ = rows.Close()
			return err
		}
		card.Platform = legacySalesPlatform(card.Note)
		cards = append(cards, card)
	}
	if err = rows.Close(); err != nil {
		return err
	}
	if len(cards) == 0 {
		return nil
	}

	type legacyBatchGroup struct {
		key   legacyBatchKey
		cards []legacyBatchCard
	}
	groups := make([]legacyBatchGroup, 0)
	indexes := make(map[legacyBatchKey]int)
	for _, card := range cards {
		minute := card.CreatedAt
		if len(minute) > 16 {
			minute = minute[:16]
		}
		key := legacyBatchKey{Seconds: card.Seconds, Written: card.Written, MaxDevices: card.MaxDevices, Minute: minute, Note: card.Note, Kind: card.Kind, Platform: card.Platform}
		index, exists := indexes[key]
		if !exists {
			index = len(groups)
			indexes[key] = index
			groups = append(groups, legacyBatchGroup{key: key})
		}
		groups[index].cards = append(groups[index].cards, card)
	}

	tx, err := db.Begin()
	if err != nil {
		return err
	}
	for _, group := range groups {
		batchCode := fmt.Sprintf("LEGACY-%06d", group.cards[0].ID)
		result, execErr := tx.Exec(`INSERT INTO card_batches(batch_code,sales_platform,kind,interview_seconds,written_questions,max_devices,created_at)
			VALUES(?,?,?,?,?,?,?)`, batchCode, group.key.Platform, group.key.Kind, group.key.Seconds, group.key.Written, group.key.MaxDevices, group.cards[0].CreatedAt)
		if execErr != nil {
			_ = tx.Rollback()
			return execErr
		}
		batchID, execErr := result.LastInsertId()
		if execErr != nil {
			_ = tx.Rollback()
			return execErr
		}
		for position, card := range group.cards {
			if _, execErr = tx.Exec("INSERT INTO card_batch_members(batch_id,card_id,position) VALUES(?,?,?)", batchID, card.ID, position+1); execErr != nil {
				_ = tx.Rollback()
				return execErr
			}
		}
	}
	return tx.Commit()
}

func (s *Store) WithTx(ctx context.Context, fn func(*sql.Tx) error) error {
	tx, e := s.DB.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	if e = fn(tx); e != nil {
		_ = tx.Rollback()
		return e
	}
	return tx.Commit()
}
func scanCard(row interface{ Scan(...any) error }) (Card, error) {
	var c Card
	e := row.Scan(&c.ID, &c.CardKey, &c.Status, &c.RemainingInterviewSeconds, &c.RemainingWrittenQuestions, &c.MaxDevices, &c.CreatedAt, &c.ActivatedAt, &c.ExpiresAt, &c.Note, &c.Kind)
	return c, e
}

const cardCols = "id,card_key,status,remaining_interview_seconds,remaining_written_questions,max_devices,created_at,activated_at,expires_at,note,COALESCE((SELECT kind FROM card_metadata WHERE card_id=cards.id),'standard')"

func (s *Store) CardByKey(ctx context.Context, key string) (Card, error) {
	return scanCard(s.DB.QueryRowContext(ctx, "SELECT "+cardCols+" FROM cards WHERE card_key=?", key))
}
func (s *Store) CardByID(ctx context.Context, id int64) (Card, error) {
	return scanCard(s.DB.QueryRowContext(ctx, "SELECT "+cardCols+" FROM cards WHERE id=?", id))
}

// RequireInterviewQuota is the server-side authorization boundary for every
// interview operation. Renderer checks are only user experience; callers must
// never reach an ASR or model provider on the strength of cached client state.
func (s *Store) RequireInterviewQuota(ctx context.Context, a Auth) (Card, error) {
	card, err := s.CardByID(ctx, a.CardID)
	if err != nil {
		return Card{}, err
	}
	if card.Status != "active" {
		return Card{}, errors.New("card_inactive")
	}
	if card.RemainingInterviewSeconds <= 0 {
		return Card{}, errors.New("interview_quota_exhausted")
	}
	return card, nil
}

// ConsumeInterviewSeconds atomically reserves a small amount of interview
// quota before a paid upstream request. This closes the concurrent-request
// race where several requests could all pass a read-only balance check.
func (s *Store) ConsumeInterviewSeconds(ctx context.Context, a Auth, seconds int64) (Card, error) {
	if seconds <= 0 {
		return s.RequireInterviewQuota(ctx, a)
	}
	var card Card
	err := s.WithTx(ctx, func(tx *sql.Tx) error {
		result, err := tx.ExecContext(ctx, "UPDATE cards SET remaining_interview_seconds=remaining_interview_seconds-? WHERE id=? AND status='active' AND remaining_interview_seconds>=?", seconds, a.CardID, seconds)
		if err != nil {
			return err
		}
		changed, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if changed != 1 {
			return errors.New("interview_quota_exhausted")
		}
		card, err = scanCard(tx.QueryRowContext(ctx, "SELECT "+cardCols+" FROM cards WHERE id=?", a.CardID))
		return err
	})
	return card, err
}

func (s *Store) RefundInterviewSeconds(ctx context.Context, a Auth, seconds int64) {
	if seconds <= 0 {
		return
	}
	_, _ = s.DB.ExecContext(ctx, "UPDATE cards SET remaining_interview_seconds=remaining_interview_seconds+? WHERE id=?", seconds, a.CardID)
}

// ReserveWrittenQuestion prevents zero-balance and concurrent requests from
// consuming model capacity before a written-question unit has been reserved.
func (s *Store) ReserveWrittenQuestion(ctx context.Context, a Auth) error {
	result, err := s.DB.ExecContext(ctx, "UPDATE cards SET remaining_written_questions=remaining_written_questions-1 WHERE id=? AND status='active' AND remaining_written_questions>=1", a.CardID)
	if err != nil {
		return err
	}
	changed, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if changed != 1 {
		return errors.New("written_quota_exhausted")
	}
	return nil
}

func (s *Store) RefundWrittenQuestion(ctx context.Context, a Auth) {
	_, _ = s.DB.ExecContext(ctx, "UPDATE cards SET remaining_written_questions=remaining_written_questions+1 WHERE id=?", a.CardID)
}
func (s *Store) Login(ctx context.Context, key, deviceID, name, platform, tokenID, expires string) (Card, error) {
	var card Card
	err := s.WithTx(ctx, func(tx *sql.Tx) error {
		var e error
		card, e = scanCard(tx.QueryRowContext(ctx, "SELECT "+cardCols+" FROM cards WHERE card_key=?", key))
		if e != nil {
			return e
		}
		return loginCardTx(ctx, tx, card, deviceID, name, platform, tokenID, expires)
	})
	return card, err
}

func loginCardTx(ctx context.Context, tx *sql.Tx, card Card, deviceID, name, platform, tokenID, expires string) error {
	if card.Status != "active" {
		return errors.New("card_inactive")
	}
	if card.ExpiresAt != nil {
		t, _ := time.Parse(time.RFC3339, *card.ExpiresAt)
		if t.Before(time.Now()) {
			return errors.New("card_expired")
		}
	}
	n := now()
	// Website sessions let users manage balances and redeem cards, but they do
	// not consume the desktop device allowance. Otherwise the browser used to
	// register would immediately prevent the one permitted desktop from logging
	// in. Account passwords still protect every web session.
	usesDeviceSlot := card.Kind != "account" || !strings.EqualFold(platform, "web")
	if usesDeviceSlot {
		var id int64
		e := tx.QueryRowContext(ctx, "SELECT id FROM devices WHERE card_id=? AND device_id=?", card.ID, deviceID).Scan(&id)
		if errors.Is(e, sql.ErrNoRows) {
			var count int
			_ = tx.QueryRowContext(ctx, "SELECT count(*) FROM devices WHERE card_id=?", card.ID).Scan(&count)
			if count >= card.MaxDevices {
				return errors.New("device_limit_exceeded")
			}
			_, e = tx.ExecContext(ctx, "INSERT INTO devices(card_id,device_id,device_name,platform,first_seen_at,last_seen_at) VALUES(?,?,?,?,?,?)", card.ID, deviceID, name, platform, n, n)
		} else if e == nil {
			_, e = tx.ExecContext(ctx, "UPDATE devices SET device_name=?,platform=?,last_seen_at=? WHERE id=?", name, platform, n, id)
		}
		if e != nil {
			return e
		}
	}
	_, _ = tx.ExecContext(ctx, "UPDATE cards SET activated_at=? WHERE id=? AND activated_at IS NULL", n, card.ID)
	_, err := tx.ExecContext(ctx, "INSERT INTO sessions(card_id,device_id,token_id,status,created_at,expires_at,last_seen_at,last_billed_at) VALUES(?,?,?,'active',?,?,?,?)", card.ID, deviceID, tokenID, n, expires, n, n)
	return err
}

func (s *Store) LoginByCardID(ctx context.Context, cardID int64, deviceID, name, platform, tokenID, expires string) (Card, error) {
	var card Card
	err := s.WithTx(ctx, func(tx *sql.Tx) error {
		var e error
		card, e = scanCard(tx.QueryRowContext(ctx, "SELECT "+cardCols+" FROM cards WHERE id=?", cardID))
		if e != nil {
			return e
		}
		return loginCardTx(ctx, tx, card, deviceID, name, platform, tokenID, expires)
	})
	return card, err
}
func (s *Store) Authenticate(ctx context.Context, tokenID string, cardID int64, deviceID string) (Auth, error) {
	var a Auth
	var status, expires string
	e := s.DB.QueryRowContext(ctx, "SELECT card_id,device_id,token_id,status,expires_at FROM sessions WHERE token_id=?", tokenID).Scan(&a.CardID, &a.DeviceID, &a.TokenID, &status, &expires)
	if e != nil || status != "active" || a.CardID != cardID || a.DeviceID != deviceID {
		return a, errors.New("session_inactive")
	}
	t, e := time.Parse(time.RFC3339Nano, expires)
	if e != nil || t.Before(time.Now()) {
		return a, errors.New("session_expired")
	}
	c, e := s.CardByID(ctx, a.CardID)
	if e != nil || c.Status != "active" {
		return a, errors.New("card_inactive")
	}
	_, _ = s.DB.ExecContext(ctx, "UPDATE sessions SET last_seen_at=? WHERE token_id=?", now(), tokenID)
	return a, nil
}
func (s *Store) Revoke(ctx context.Context, id string) error {
	_, e := s.DB.ExecContext(ctx, "UPDATE sessions SET status='revoked' WHERE token_id=?", id)
	return e
}
func (s *Store) Heartbeat(ctx context.Context, a Auth, active bool) (int64, Card, error) {
	var charged int64
	var card Card
	e := s.WithTx(ctx, func(tx *sql.Tx) error {
		var last string
		if e := tx.QueryRowContext(ctx, "SELECT last_billed_at FROM sessions WHERE token_id=?", a.TokenID).Scan(&last); e != nil {
			return e
		}
		var e error
		card, e = scanCard(tx.QueryRowContext(ctx, "SELECT "+cardCols+" FROM cards WHERE id=?", a.CardID))
		if e != nil {
			return e
		}
		n := time.Now().UTC()
		if active {
			if card.RemainingInterviewSeconds <= 0 {
				return errors.New("interview_quota_exhausted")
			}
			lt, _ := time.Parse(time.RFC3339Nano, last)
			charged = int64(n.Sub(lt).Seconds())
			if charged < 0 {
				charged = 0
			}
			if charged > 60 {
				charged = 60
			}
			if charged > card.RemainingInterviewSeconds {
				charged = card.RemainingInterviewSeconds
			}
			if charged > 0 {
				_, e = tx.ExecContext(ctx, "UPDATE cards SET remaining_interview_seconds=remaining_interview_seconds-? WHERE id=? AND remaining_interview_seconds>=?", charged, a.CardID, charged)
				if e != nil {
					return e
				}
				card.RemainingInterviewSeconds -= charged
			}
		}
		_, e = tx.ExecContext(ctx, "UPDATE sessions SET last_seen_at=?,last_billed_at=? WHERE token_id=?", n.Format(time.RFC3339Nano), n.Format(time.RFC3339Nano), a.TokenID)
		return e
	})
	return charged, card, e
}
func (s *Store) Log(ctx context.Context, a Auth, feature, action string, cost float64, model string, success bool, msg, hash string) {
	ok := 0
	if success {
		ok = 1
	}
	_, _ = s.DB.ExecContext(ctx, "INSERT INTO usage_logs(card_id,device_id,feature,action,cost,model,success,error_message,request_hash,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)", a.CardID, a.DeviceID, feature, action, cost, model, ok, msg, hash, now())
}
func (s *Store) CreateCard(ctx context.Context, key string, secs int64, written float64, max int, note string) error {
	return s.WithTx(ctx, func(tx *sql.Tx) error {
		r, e := tx.ExecContext(ctx, "INSERT INTO cards(card_key,status,remaining_interview_seconds,remaining_written_questions,max_devices,created_at,note) VALUES(?,'active',?,?,?,?,?)", key, secs, written, max, now(), note)
		if e != nil {
			return e
		}
		id, e := r.LastInsertId()
		if e != nil {
			return e
		}
		_, e = tx.ExecContext(ctx, "INSERT INTO card_metadata(card_id,kind) VALUES(?,'standard')", id)
		return e
	})
}

type CardBatch struct {
	ID               int64   `json:"id"`
	BatchCode        string  `json:"batchCode"`
	DisplayName      string  `json:"displayName"`
	SalesPlatform    string  `json:"salesPlatform"`
	InterviewSeconds int64   `json:"interviewSeconds"`
	WrittenQuestions float64 `json:"writtenQuestions"`
	MaxDevices       int     `json:"maxDevices"`
	CreatedAt        string  `json:"createdAt"`
	CardCount        int     `json:"cardCount"`
	ActiveCount      int     `json:"activeCount"`
	RedeemedCount    int     `json:"redeemedCount"`
	DisabledCount    int     `json:"disabledCount"`
}

func validSalesPlatform(platform string) bool {
	return platform == "taobao" || platform == "xianyu" || platform == "liandong" || platform == "legacy"
}

func (s *Store) CreateCardBatch(ctx context.Context, batchCode string, keys []string, secs int64, written float64, max int, platform string) (CardBatch, error) {
	var batch CardBatch
	if len(keys) == 0 || secs < 0 || written < 0 || max < 1 {
		return batch, errors.New("invalid card batch")
	}
	if !validSalesPlatform(platform) || platform == "legacy" {
		return batch, errors.New("invalid sales platform")
	}
	createdAt := now()
	err := s.WithTx(ctx, func(tx *sql.Tx) error {
		result, err := tx.ExecContext(ctx, `INSERT INTO card_batches(batch_code,sales_platform,kind,interview_seconds,written_questions,max_devices,created_at)
			VALUES(?,?,'standard',?,?,?,?)`, batchCode, platform, secs, written, max, createdAt)
		if err != nil {
			return err
		}
		batchID, err := result.LastInsertId()
		if err != nil {
			return err
		}
		baseName := CardBatchBaseName(platform, secs, written, len(keys))
		displayName, sequence, err := nextCardBatchDisplayNameTx(ctx, tx, baseName)
		if err != nil {
			return err
		}
		if _, err = tx.ExecContext(ctx, "INSERT INTO card_batch_names(batch_id,display_name,base_name,sequence) VALUES(?,?,?,?)", batchID, displayName, baseName, sequence); err != nil {
			return err
		}
		for position, key := range keys {
			cardResult, err := tx.ExecContext(ctx, "INSERT INTO cards(card_key,status,remaining_interview_seconds,remaining_written_questions,max_devices,created_at,note) VALUES(?,'active',?,?,?,?,NULL)", key, secs, written, max, createdAt)
			if err != nil {
				return err
			}
			cardID, err := cardResult.LastInsertId()
			if err != nil {
				return err
			}
			if _, err = tx.ExecContext(ctx, "INSERT INTO card_metadata(card_id,kind) VALUES(?,'standard')", cardID); err != nil {
				return err
			}
			if _, err = tx.ExecContext(ctx, "INSERT INTO card_batch_members(batch_id,card_id,position) VALUES(?,?,?)", batchID, cardID, position+1); err != nil {
				return err
			}
		}
		batch = CardBatch{ID: batchID, BatchCode: batchCode, DisplayName: displayName, SalesPlatform: platform, InterviewSeconds: secs, WrittenQuestions: written, MaxDevices: max, CreatedAt: createdAt, CardCount: len(keys), ActiveCount: len(keys)}
		return nil
	})
	return batch, err
}

func (s *Store) ListCardBatches(ctx context.Context, limit int) ([]CardBatch, error) {
	rows, err := s.DB.QueryContext(ctx, `SELECT b.id,b.batch_code,COALESCE(n.display_name,b.batch_code),b.sales_platform,b.interview_seconds,b.written_questions,b.max_devices,b.created_at,
		count(m.card_id),sum(CASE WHEN c.status='active' THEN 1 ELSE 0 END),sum(CASE WHEN c.status='redeemed' THEN 1 ELSE 0 END),sum(CASE WHEN c.status='disabled' THEN 1 ELSE 0 END)
		FROM card_batches b LEFT JOIN card_batch_names n ON n.batch_id=b.id JOIN card_batch_members m ON m.batch_id=b.id JOIN cards c ON c.id=m.card_id
		GROUP BY b.id ORDER BY b.id DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var batches []CardBatch
	for rows.Next() {
		var batch CardBatch
		if err = rows.Scan(&batch.ID, &batch.BatchCode, &batch.DisplayName, &batch.SalesPlatform, &batch.InterviewSeconds, &batch.WrittenQuestions, &batch.MaxDevices, &batch.CreatedAt, &batch.CardCount, &batch.ActiveCount, &batch.RedeemedCount, &batch.DisabledCount); err != nil {
			return nil, err
		}
		batches = append(batches, batch)
	}
	return batches, rows.Err()
}

func (s *Store) CardBatchByCode(ctx context.Context, batchCode string) (CardBatch, error) {
	var batch CardBatch
	err := s.DB.QueryRowContext(ctx, `SELECT b.id,b.batch_code,COALESCE(n.display_name,b.batch_code),b.sales_platform,b.interview_seconds,b.written_questions,b.max_devices,b.created_at,
		count(m.card_id),sum(CASE WHEN c.status='active' THEN 1 ELSE 0 END),sum(CASE WHEN c.status='redeemed' THEN 1 ELSE 0 END),sum(CASE WHEN c.status='disabled' THEN 1 ELSE 0 END)
		FROM card_batches b LEFT JOIN card_batch_names n ON n.batch_id=b.id JOIN card_batch_members m ON m.batch_id=b.id JOIN cards c ON c.id=m.card_id
		WHERE b.batch_code=? GROUP BY b.id`, batchCode).
		Scan(&batch.ID, &batch.BatchCode, &batch.DisplayName, &batch.SalesPlatform, &batch.InterviewSeconds, &batch.WrittenQuestions, &batch.MaxDevices, &batch.CreatedAt, &batch.CardCount, &batch.ActiveCount, &batch.RedeemedCount, &batch.DisabledCount)
	return batch, err
}

func (s *Store) CardsByBatch(ctx context.Context, batchCode string) ([]Card, error) {
	const batchCardCols = "cards.id,cards.card_key,cards.status,cards.remaining_interview_seconds,cards.remaining_written_questions,cards.max_devices,cards.created_at,cards.activated_at,cards.expires_at,cards.note,COALESCE((SELECT kind FROM card_metadata WHERE card_id=cards.id),'standard')"
	rows, err := s.DB.QueryContext(ctx, `SELECT `+batchCardCols+` FROM cards
		JOIN card_batch_members m ON m.card_id=cards.id JOIN card_batches b ON b.id=m.batch_id
		WHERE b.batch_code=? ORDER BY m.position`, batchCode)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	cards := make([]Card, 0)
	for rows.Next() {
		card, scanErr := scanCard(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		cards = append(cards, card)
	}
	if err = rows.Err(); err != nil {
		return nil, err
	}
	if len(cards) == 0 {
		return nil, sql.ErrNoRows
	}
	return cards, nil
}

func (s *Store) CardBatchKeys(ctx context.Context, batchCode string) ([]string, error) {
	rows, err := s.DB.QueryContext(ctx, `SELECT c.card_key FROM cards c
		JOIN card_batch_members m ON m.card_id=c.id JOIN card_batches b ON b.id=m.batch_id
		WHERE b.batch_code=? ORDER BY m.position`, batchCode)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var keys []string
	for rows.Next() {
		var key string
		if err = rows.Scan(&key); err != nil {
			return nil, err
		}
		keys = append(keys, key)
	}
	if len(keys) == 0 {
		return nil, sql.ErrNoRows
	}
	return keys, rows.Err()
}
func (s *Store) ListCards(ctx context.Context, limit int) ([]Card, error) {
	rows, e := s.DB.QueryContext(ctx, "SELECT "+cardCols+" FROM cards WHERE COALESCE((SELECT kind FROM card_metadata WHERE card_id=cards.id),'standard')!='account' ORDER BY id DESC LIMIT ?", limit)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	var out []Card
	for rows.Next() {
		c, e := scanCard(rows)
		if e != nil {
			return nil, e
		}
		out = append(out, c)
	}
	return out, rows.Err()
}
func (s *Store) Recharge(ctx context.Context, key string, secs int64, written float64) (bool, error) {
	if secs < 0 || written < 0 || (secs == 0 && written == 0) {
		return false, errors.New("invalid recharge quota")
	}
	r, e := s.DB.ExecContext(ctx, "UPDATE cards SET remaining_interview_seconds=remaining_interview_seconds+?,remaining_written_questions=remaining_written_questions+? WHERE card_key=?", secs, written, key)
	if e != nil {
		return false, e
	}
	n, _ := r.RowsAffected()
	return n == 1, nil
}

func scanUser(row interface{ Scan(...any) error }) (User, error) {
	var u User
	err := row.Scan(&u.ID, &u.Username, &u.PasswordHash, &u.AccountCardID, &u.CreatedAt)
	return u, err
}

const userCols = "id,username,password_hash,account_card_id,created_at"

func (s *Store) UserByUsername(ctx context.Context, username string) (User, error) {
	return scanUser(s.DB.QueryRowContext(ctx, "SELECT "+userCols+" FROM users WHERE username=? COLLATE NOCASE", username))
}

func (s *Store) UserByAccountCardID(ctx context.Context, cardID int64) (User, error) {
	return scanUser(s.DB.QueryRowContext(ctx, "SELECT "+userCols+" FROM users WHERE account_card_id=?", cardID))
}

type AdminUser struct {
	ID                        int64   `json:"id"`
	Username                  string  `json:"username"`
	Status                    string  `json:"status"`
	RemainingInterviewSeconds int64   `json:"remainingInterviewSeconds"`
	RemainingWrittenQuestions float64 `json:"remainingWrittenQuestions"`
	CreatedAt                 string  `json:"createdAt"`
	RegistrationIP            string  `json:"registrationIp"`
	LastSeenAt                *string `json:"lastSeenAt"`
	DeviceCount               int     `json:"deviceCount"`
	ActiveSessionCount        int     `json:"activeSessionCount"`
	RedemptionCount           int     `json:"redemptionCount"`
}

var ErrUserDeleteConfirmation = errors.New("user delete confirmation mismatch")

func (s *Store) ListUsers(ctx context.Context, search string, limit int) ([]AdminUser, error) {
	rows, err := s.DB.QueryContext(ctx, `SELECT u.id,u.username,c.status,c.remaining_interview_seconds,c.remaining_written_questions,
		u.created_at,COALESCE(m.registration_ip,''),
		(SELECT max(last_seen_at) FROM sessions WHERE card_id=c.id),
		(SELECT count(*) FROM devices WHERE card_id=c.id),
		(SELECT count(*) FROM sessions WHERE card_id=c.id AND status='active'),
		(SELECT count(*) FROM card_redemptions WHERE user_id=u.id)
		FROM users u JOIN cards c ON c.id=u.account_card_id
		LEFT JOIN user_metadata m ON m.user_id=u.id
		WHERE (?='' OR u.username LIKE '%'||?||'%') ORDER BY u.id DESC LIMIT ?`, search, search, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]AdminUser, 0)
	for rows.Next() {
		var user AdminUser
		if err = rows.Scan(&user.ID, &user.Username, &user.Status, &user.RemainingInterviewSeconds, &user.RemainingWrittenQuestions, &user.CreatedAt, &user.RegistrationIP, &user.LastSeenAt, &user.DeviceCount, &user.ActiveSessionCount, &user.RedemptionCount); err != nil {
			return nil, err
		}
		out = append(out, user)
	}
	return out, rows.Err()
}

func (s *Store) SetUserQuota(ctx context.Context, username string, seconds int64, written float64) error {
	if seconds < 0 || written < 0 {
		return errors.New("invalid user quota")
	}
	result, err := s.DB.ExecContext(ctx, `UPDATE cards SET remaining_interview_seconds=?,remaining_written_questions=?
		WHERE id=(SELECT account_card_id FROM users WHERE username=? COLLATE NOCASE)`, seconds, written, username)
	if err != nil {
		return err
	}
	changed, _ := result.RowsAffected()
	if changed != 1 {
		return sql.ErrNoRows
	}
	return nil
}

func (s *Store) SetUserStatus(ctx context.Context, username, status string) error {
	if status != "active" && status != "disabled" {
		return errors.New("invalid user status")
	}
	return s.WithTx(ctx, func(tx *sql.Tx) error {
		result, err := tx.ExecContext(ctx, "UPDATE cards SET status=? WHERE id=(SELECT account_card_id FROM users WHERE username=? COLLATE NOCASE)", status, username)
		if err != nil {
			return err
		}
		changed, _ := result.RowsAffected()
		if changed != 1 {
			return sql.ErrNoRows
		}
		if status == "disabled" {
			_, err = tx.ExecContext(ctx, "UPDATE sessions SET status='revoked' WHERE card_id=(SELECT account_card_id FROM users WHERE username=? COLLATE NOCASE) AND status='active'", username)
		}
		return err
	})
}

func (s *Store) ResetUserDevices(ctx context.Context, username string) (int64, error) {
	var deleted int64
	err := s.WithTx(ctx, func(tx *sql.Tx) error {
		var cardID int64
		if err := tx.QueryRowContext(ctx, "SELECT account_card_id FROM users WHERE username=? COLLATE NOCASE", username).Scan(&cardID); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, "UPDATE sessions SET status='revoked' WHERE card_id=? AND status='active'", cardID); err != nil {
			return err
		}
		result, err := tx.ExecContext(ctx, "DELETE FROM devices WHERE card_id=?", cardID)
		if err != nil {
			return err
		}
		deleted, _ = result.RowsAffected()
		return nil
	})
	return deleted, err
}

func (s *Store) SetUserPasswordHash(ctx context.Context, username, passwordHash string) error {
	return s.WithTx(ctx, func(tx *sql.Tx) error {
		result, err := tx.ExecContext(ctx, "UPDATE users SET password_hash=? WHERE username=? COLLATE NOCASE", passwordHash, username)
		if err != nil {
			return err
		}
		changed, _ := result.RowsAffected()
		if changed != 1 {
			return sql.ErrNoRows
		}
		_, err = tx.ExecContext(ctx, "UPDATE sessions SET status='revoked' WHERE card_id=(SELECT account_card_id FROM users WHERE username=? COLLATE NOCASE) AND status='active'", username)
		return err
	})
}

// DeleteUser permanently removes account-owned data while preserving immutable
// sales facts and lifetime trial-claim history. The exact canonical username is
// checked inside the same transaction as the deletion.
func (s *Store) DeleteUser(ctx context.Context, username, confirmUsername string) (string, error) {
	canonicalUsername := ""
	err := s.WithTx(ctx, func(tx *sql.Tx) error {
		var userID, accountCardID int64
		if err := tx.QueryRowContext(ctx, `SELECT id,username,account_card_id FROM users
			WHERE username=? COLLATE NOCASE`, username).Scan(&userID, &canonicalUsername, &accountCardID); err != nil {
			return err
		}
		if confirmUsername != canonicalUsername {
			return ErrUserDeleteConfirmation
		}
		for _, query := range []string{
			"DELETE FROM feedback_threads WHERE user_id=?",
			"DELETE FROM trial_grants WHERE user_id=?",
			"DELETE FROM card_redemptions WHERE user_id=?",
			"DELETE FROM user_metadata WHERE user_id=?",
			"DELETE FROM users WHERE id=?",
		} {
			if _, err := tx.ExecContext(ctx, query, userID); err != nil {
				return err
			}
		}
		return deleteCardIDTx(ctx, tx, accountCardID)
	})
	return canonicalUsername, err
}

func (s *Store) RegisterUser(ctx context.Context, username, passwordHash, registrationIP, trialDeviceHash, accountKey, deviceID, deviceName, platform, tokenID, expires string) (User, Card, error) {
	var user User
	var card Card
	err := s.WithTx(ctx, func(tx *sql.Tx) error {
		n := now()
		cutoff := time.Now().UTC().Add(-time.Hour).Format(time.RFC3339Nano)
		_, _ = tx.ExecContext(ctx, "DELETE FROM registration_events WHERE created_at<?", cutoff)
		var registrations int
		if err := tx.QueryRowContext(ctx, "SELECT count(*) FROM registration_events WHERE ip_address=? AND created_at>=?", registrationIP, cutoff).Scan(&registrations); err != nil {
			return err
		}
		if registrations >= 5 {
			return errors.New("registration_rate_limited")
		}
		settings, err := trialOfferFromQuerier(ctx, tx)
		if err != nil {
			return err
		}
		trialSeconds, trialWritten, trialGranted, err := trialGrantQuota(ctx, tx, settings, trialDeviceHash, registrationIP)
		if err != nil {
			return err
		}
		r, err := tx.ExecContext(ctx, "INSERT INTO cards(card_key,status,remaining_interview_seconds,remaining_written_questions,max_devices,created_at,note) VALUES(?,'active',?,?,?,?,'internal account card')", accountKey, trialSeconds, trialWritten, DefaultDeviceLimit, n)
		if err != nil {
			return err
		}
		cardID, err := r.LastInsertId()
		if err != nil {
			return err
		}
		if _, err = tx.ExecContext(ctx, "INSERT INTO card_metadata(card_id,kind) VALUES(?,'account')", cardID); err != nil {
			return err
		}
		r, err = tx.ExecContext(ctx, "INSERT INTO users(username,password_hash,account_card_id,created_at) VALUES(?,?,?,?)", username, passwordHash, cardID, n)
		if err != nil {
			return err
		}
		userID, err := r.LastInsertId()
		if err != nil {
			return err
		}
		user = User{ID: userID, Username: username, PasswordHash: passwordHash, AccountCardID: cardID, CreatedAt: n}
		card = Card{ID: cardID, CardKey: accountKey, Status: "active", RemainingInterviewSeconds: trialSeconds, RemainingWrittenQuestions: trialWritten, MaxDevices: DefaultDeviceLimit, CreatedAt: n, Kind: "account"}
		if _, err = tx.ExecContext(ctx, "INSERT INTO user_metadata(user_id,registration_ip) VALUES(?,?)", userID, registrationIP); err != nil {
			return err
		}
		if trialGranted {
			if _, err = tx.ExecContext(ctx, `INSERT INTO trial_grants(user_id,device_hash,ip_address,interview_seconds,written_questions,created_at)
				VALUES(?,?,?,?,?,?)`, userID, trialDeviceHash, registrationIP, trialSeconds, trialWritten, n); err != nil {
				return err
			}
			if _, err = tx.ExecContext(ctx, `INSERT INTO trial_claim_history(device_hash,ip_address,created_at)
				VALUES(?,?,?)`, trialDeviceHash, registrationIP, n); err != nil {
				return err
			}
		}
		if _, err = tx.ExecContext(ctx, "INSERT INTO registration_events(ip_address,created_at) VALUES(?,?)", registrationIP, n); err != nil {
			return err
		}
		return loginCardTx(ctx, tx, card, deviceID, deviceName, platform, tokenID, expires)
	})
	return user, card, err
}

type RedemptionResult struct {
	AddedInterviewSeconds     int64   `json:"addedInterviewSeconds"`
	AddedWrittenQuestions     float64 `json:"addedWrittenQuestions"`
	RemainingInterviewSeconds int64   `json:"remainingInterviewSeconds"`
	RemainingWrittenQuestions float64 `json:"remainingWrittenQuestions"`
}

func (s *Store) RedeemCard(ctx context.Context, accountCardID int64, key string) (RedemptionResult, error) {
	var out RedemptionResult
	err := s.WithTx(ctx, func(tx *sql.Tx) error {
		user, err := scanUser(tx.QueryRowContext(ctx, "SELECT "+userCols+" FROM users WHERE account_card_id=?", accountCardID))
		if err != nil {
			return errors.New("account_required")
		}
		source, err := scanCard(tx.QueryRowContext(ctx, "SELECT "+cardCols+" FROM cards WHERE card_key=?", key))
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return errors.New("invalid_redemption_code")
			}
			return err
		}
		if source.Kind == "account" || source.Status != "active" {
			return errors.New("invalid_redemption_code")
		}
		if source.ActivatedAt != nil {
			return errors.New("card_already_activated")
		}
		if source.ExpiresAt != nil {
			expiresAt, parseErr := time.Parse(time.RFC3339, *source.ExpiresAt)
			if parseErr == nil && expiresAt.Before(time.Now()) {
				return errors.New("card_expired")
			}
		}
		if source.RemainingInterviewSeconds <= 0 && source.RemainingWrittenQuestions <= 0 {
			return errors.New("empty_redemption_code")
		}
		result, err := tx.ExecContext(ctx, "UPDATE cards SET status='redeemed' WHERE id=? AND status='active'", source.ID)
		if err != nil {
			return err
		}
		changed, _ := result.RowsAffected()
		if changed != 1 {
			return errors.New("invalid_redemption_code")
		}
		if _, err = tx.ExecContext(ctx, "UPDATE cards SET remaining_interview_seconds=remaining_interview_seconds+?,remaining_written_questions=remaining_written_questions+? WHERE id=? AND status='active'", source.RemainingInterviewSeconds, source.RemainingWrittenQuestions, accountCardID); err != nil {
			return err
		}
		if _, err = tx.ExecContext(ctx, "INSERT INTO card_redemptions(card_id,user_id,kind,interview_seconds,written_questions,redeemed_at) VALUES(?,?,'standard',?,?,?)", source.ID, user.ID, source.RemainingInterviewSeconds, source.RemainingWrittenQuestions, now()); err != nil {
			return err
		}
		if _, err = tx.ExecContext(ctx, `INSERT INTO sales_ledger(
				card_id,sales_platform,interview_seconds,written_questions,redeemed_at
			) VALUES(
				?,COALESCE((SELECT b.sales_platform FROM card_batch_members m JOIN card_batches b ON b.id=m.batch_id WHERE m.card_id=?),'legacy'),?,?,?
			)`, source.ID, source.ID, source.RemainingInterviewSeconds, source.RemainingWrittenQuestions, now()); err != nil {
			return err
		}
		account, err := scanCard(tx.QueryRowContext(ctx, "SELECT "+cardCols+" FROM cards WHERE id=?", accountCardID))
		if err != nil {
			return err
		}
		out = RedemptionResult{
			AddedInterviewSeconds:     source.RemainingInterviewSeconds,
			AddedWrittenQuestions:     source.RemainingWrittenQuestions,
			RemainingInterviewSeconds: account.RemainingInterviewSeconds,
			RemainingWrittenQuestions: account.RemainingWrittenQuestions,
		}
		return nil
	})
	return out, err
}

func (s *Store) ResetDevices(ctx context.Context, key string) (int64, error) {
	r, e := s.DB.ExecContext(ctx, "DELETE FROM devices WHERE card_id=(SELECT id FROM cards WHERE card_key=?)", key)
	if e != nil {
		return 0, e
	}
	return r.RowsAffected()
}

func (s *Store) UpdateCard(ctx context.Context, c Card) error {
	if c.Status != "active" && c.Status != "disabled" {
		return errors.New("invalid card status")
	}
	if c.MaxDevices < 1 || c.RemainingInterviewSeconds < 0 || c.RemainingWrittenQuestions < 0 {
		return errors.New("invalid card quota")
	}
	r, e := s.DB.ExecContext(ctx, "UPDATE cards SET status=?,remaining_interview_seconds=?,remaining_written_questions=?,max_devices=?,note=? WHERE card_key=?", c.Status, c.RemainingInterviewSeconds, c.RemainingWrittenQuestions, c.MaxDevices, c.Note, c.CardKey)
	if e != nil {
		return e
	}
	n, _ := r.RowsAffected()
	if n != 1 {
		return sql.ErrNoRows
	}
	return nil
}

func deleteCardIDTx(ctx context.Context, tx *sql.Tx, id int64) error {
	for _, query := range []string{
		"DELETE FROM card_redemptions WHERE card_id=?",
		"DELETE FROM card_batch_members WHERE card_id=?",
		"DELETE FROM companion_mobile_sessions WHERE pairing_id IN (SELECT id FROM companion_pairings WHERE card_id=?)",
		"DELETE FROM companion_capture_requests WHERE pairing_id IN (SELECT id FROM companion_pairings WHERE card_id=?)",
		"DELETE FROM companion_pairings WHERE card_id=?", "DELETE FROM mobile_pairings WHERE card_id=?",
		"DELETE FROM written_question_cache WHERE card_id=?", "DELETE FROM usage_logs WHERE card_id=?",
		"DELETE FROM sessions WHERE card_id=?", "DELETE FROM devices WHERE card_id=?", "DELETE FROM card_metadata WHERE card_id=?", "DELETE FROM cards WHERE id=?",
	} {
		if _, err := tx.ExecContext(ctx, query, id); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) DeleteCard(ctx context.Context, key string) error {
	return s.WithTx(ctx, func(tx *sql.Tx) error {
		var id int64
		var batchID sql.NullInt64
		if err := tx.QueryRowContext(ctx, `SELECT c.id,m.batch_id FROM cards c LEFT JOIN card_batch_members m ON m.card_id=c.id WHERE c.card_key=?`, key).Scan(&id, &batchID); err != nil {
			return err
		}
		if err := deleteCardIDTx(ctx, tx, id); err != nil {
			return err
		}
		if batchID.Valid {
			if _, err := tx.ExecContext(ctx, "DELETE FROM card_batch_names WHERE batch_id=? AND NOT EXISTS(SELECT 1 FROM card_batch_members WHERE batch_id=?)", batchID.Int64, batchID.Int64); err != nil {
				return err
			}
			_, err := tx.ExecContext(ctx, "DELETE FROM card_batches WHERE id=? AND NOT EXISTS(SELECT 1 FROM card_batch_members WHERE batch_id=?)", batchID.Int64, batchID.Int64)
			return err
		}
		return nil
	})
}

func (s *Store) DeleteCardBatch(ctx context.Context, batchCode string) (int, error) {
	deleted := 0
	err := s.WithTx(ctx, func(tx *sql.Tx) error {
		var batchID int64
		if err := tx.QueryRowContext(ctx, "SELECT id FROM card_batches WHERE batch_code=?", batchCode).Scan(&batchID); err != nil {
			return err
		}
		rows, err := tx.QueryContext(ctx, "SELECT card_id FROM card_batch_members WHERE batch_id=? ORDER BY position", batchID)
		if err != nil {
			return err
		}
		var cardIDs []int64
		for rows.Next() {
			var cardID int64
			if err = rows.Scan(&cardID); err != nil {
				_ = rows.Close()
				return err
			}
			cardIDs = append(cardIDs, cardID)
		}
		if err = rows.Close(); err != nil {
			return err
		}
		for _, cardID := range cardIDs {
			if err = deleteCardIDTx(ctx, tx, cardID); err != nil {
				return err
			}
		}
		if _, err = tx.ExecContext(ctx, "DELETE FROM card_batch_names WHERE batch_id=?", batchID); err != nil {
			return err
		}
		result, err := tx.ExecContext(ctx, "DELETE FROM card_batches WHERE id=?", batchID)
		if err != nil {
			return err
		}
		changed, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if changed != 1 {
			return sql.ErrNoRows
		}
		deleted = len(cardIDs)
		return nil
	})
	return deleted, err
}
