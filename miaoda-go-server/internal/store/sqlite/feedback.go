package sqlite

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
)

var ErrFeedbackNotFound = errors.New("feedback_not_found")

type FeedbackAttachmentInput struct {
	Filename, MIME string
	Data           []byte
}

type FeedbackAttachment struct {
	ID       string `json:"id"`
	Filename string `json:"filename"`
	MIME     string `json:"mimeType"`
	Size     int64  `json:"sizeBytes"`
	Data     []byte `json:"-"`
}

type FeedbackMessage struct {
	ID          int64                `json:"id"`
	Sender      string               `json:"sender"`
	Body        string               `json:"body"`
	CreatedAt   string               `json:"createdAt"`
	Attachments []FeedbackAttachment `json:"attachments"`
}

type FeedbackThread struct {
	ID           string            `json:"id"`
	Username     string            `json:"username,omitempty"`
	Status       string            `json:"status"`
	CreatedAt    string            `json:"createdAt"`
	UpdatedAt    string            `json:"updatedAt"`
	LatestBody   string            `json:"latestBody,omitempty"`
	LatestSender string            `json:"latestSender,omitempty"`
	MessageCount int               `json:"messageCount"`
	Unread       bool              `json:"unread"`
	Messages     []FeedbackMessage `json:"messages,omitempty"`
}

func feedbackID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func (s *Store) CreateFeedback(ctx context.Context, userID int64, body string, attachments []FeedbackAttachmentInput) (string, error) {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return "", err
	}
	id, created := feedbackID(), now()
	if _, err = tx.ExecContext(ctx, `INSERT INTO feedback_threads(id,user_id,status,created_at,updated_at) VALUES(?,?,'open',?,?)`, id, userID, created, created); err != nil {
		_ = tx.Rollback()
		return "", err
	}
	messageID, err := insertFeedbackMessage(ctx, tx, id, "user", body, attachments, created)
	_ = messageID
	if err != nil {
		_ = tx.Rollback()
		return "", err
	}
	if err = tx.Commit(); err != nil {
		return "", err
	}
	return id, nil
}

func insertFeedbackMessage(ctx context.Context, tx *sql.Tx, threadID, sender, body string, attachments []FeedbackAttachmentInput, created string) (int64, error) {
	result, err := tx.ExecContext(ctx, `INSERT INTO feedback_messages(thread_id,sender,body,created_at) VALUES(?,?,?,?)`, threadID, sender, body, created)
	if err != nil {
		return 0, err
	}
	messageID, err := result.LastInsertId()
	if err != nil {
		return 0, err
	}
	for _, attachment := range attachments {
		if _, err = tx.ExecContext(ctx, `INSERT INTO feedback_attachments(id,message_id,filename,mime_type,size_bytes,data,created_at) VALUES(?,?,?,?,?,?,?)`, feedbackID(), messageID, attachment.Filename, attachment.MIME, len(attachment.Data), attachment.Data, created); err != nil {
			return 0, err
		}
	}
	return messageID, nil
}

func (s *Store) AddFeedbackMessage(ctx context.Context, threadID string, userID int64, sender, body string, attachments []FeedbackAttachmentInput) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	var ownerID int64
	if err = tx.QueryRowContext(ctx, `SELECT user_id FROM feedback_threads WHERE id=?`, threadID).Scan(&ownerID); err != nil {
		_ = tx.Rollback()
		if errors.Is(err, sql.ErrNoRows) {
			return ErrFeedbackNotFound
		}
		return err
	}
	if sender == "user" && ownerID != userID {
		_ = tx.Rollback()
		return ErrFeedbackNotFound
	}
	created := now()
	if _, err = insertFeedbackMessage(ctx, tx, threadID, sender, body, attachments, created); err != nil {
		_ = tx.Rollback()
		return err
	}
	status := "answered"
	if sender == "user" {
		status = "open"
	}
	if _, err = tx.ExecContext(ctx, `UPDATE feedback_threads SET status=?,updated_at=? WHERE id=?`, status, created, threadID); err != nil {
		_ = tx.Rollback()
		return err
	}
	return tx.Commit()
}

func (s *Store) FeedbackUnread(ctx context.Context, userID int64) (int, error) {
	var count int
	err := s.DB.QueryRowContext(ctx, `SELECT count(*) FROM feedback_threads t WHERE t.user_id=? AND EXISTS (
		SELECT 1 FROM feedback_messages m WHERE m.thread_id=t.id AND m.sender='admin' AND (t.user_last_read_at IS NULL OR m.created_at>t.user_last_read_at))`, userID).Scan(&count)
	return count, err
}

func (s *Store) AdminFeedbackUnread(ctx context.Context) (int, error) {
	var count int
	err := s.DB.QueryRowContext(ctx, `SELECT count(*) FROM feedback_threads t WHERE EXISTS (
		SELECT 1 FROM feedback_messages m WHERE m.thread_id=t.id AND m.sender='user' AND (t.admin_last_read_at IS NULL OR m.created_at>t.admin_last_read_at))`).Scan(&count)
	return count, err
}

func (s *Store) FeedbackStorageBytes(ctx context.Context, userID int64) (int64, error) {
	var size int64
	err := s.DB.QueryRowContext(ctx, `SELECT COALESCE(sum(a.size_bytes),0) FROM feedback_attachments a
		JOIN feedback_messages m ON m.id=a.message_id JOIN feedback_threads t ON t.id=m.thread_id WHERE t.user_id=?`, userID).Scan(&size)
	return size, err
}

func (s *Store) ListUserFeedback(ctx context.Context, userID int64) ([]FeedbackThread, error) {
	return s.listFeedback(ctx, `WHERE t.user_id=?`, userID, false)
}

func (s *Store) ListAdminFeedback(ctx context.Context) ([]FeedbackThread, error) {
	return s.listFeedback(ctx, ``, nil, true)
}

func (s *Store) listFeedback(ctx context.Context, where string, arg any, admin bool) ([]FeedbackThread, error) {
	unreadSender, readColumn := "admin", "user_last_read_at"
	if admin {
		unreadSender, readColumn = "user", "admin_last_read_at"
	}
	query := `SELECT t.id,u.username,t.status,t.created_at,t.updated_at,
		COALESCE((SELECT body FROM feedback_messages WHERE thread_id=t.id ORDER BY id DESC LIMIT 1),''),
		COALESCE((SELECT sender FROM feedback_messages WHERE thread_id=t.id ORDER BY id DESC LIMIT 1),''),
		(SELECT count(*) FROM feedback_messages WHERE thread_id=t.id),
		EXISTS(SELECT 1 FROM feedback_messages m WHERE m.thread_id=t.id AND m.sender='` + unreadSender + `' AND (t.` + readColumn + ` IS NULL OR m.created_at>t.` + readColumn + `))
		FROM feedback_threads t JOIN users u ON u.id=t.user_id ` + where + ` ORDER BY t.updated_at DESC LIMIT 500`
	var rows *sql.Rows
	var err error
	if where == "" {
		rows, err = s.DB.QueryContext(ctx, query)
	} else {
		rows, err = s.DB.QueryContext(ctx, query, arg)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]FeedbackThread, 0)
	for rows.Next() {
		var item FeedbackThread
		if err = rows.Scan(&item.ID, &item.Username, &item.Status, &item.CreatedAt, &item.UpdatedAt, &item.LatestBody, &item.LatestSender, &item.MessageCount, &item.Unread); err != nil {
			return nil, err
		}
		if !admin {
			item.Username = ""
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) GetUserFeedback(ctx context.Context, userID int64, threadID string, markRead bool) (FeedbackThread, error) {
	return s.getFeedback(ctx, threadID, userID, false, markRead)
}

func (s *Store) GetAdminFeedback(ctx context.Context, threadID string, markRead bool) (FeedbackThread, error) {
	return s.getFeedback(ctx, threadID, 0, true, markRead)
}

func (s *Store) getFeedback(ctx context.Context, threadID string, userID int64, admin, markRead bool) (FeedbackThread, error) {
	var item FeedbackThread
	query := `SELECT t.id,u.username,t.status,t.created_at,t.updated_at FROM feedback_threads t JOIN users u ON u.id=t.user_id WHERE t.id=?`
	args := []any{threadID}
	if !admin {
		query += ` AND t.user_id=?`
		args = append(args, userID)
	}
	if err := s.DB.QueryRowContext(ctx, query, args...).Scan(&item.ID, &item.Username, &item.Status, &item.CreatedAt, &item.UpdatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return item, ErrFeedbackNotFound
		}
		return item, err
	}
	if !admin {
		item.Username = ""
	}
	if markRead {
		column := "user_last_read_at"
		if admin {
			column = "admin_last_read_at"
		}
		if _, err := s.DB.ExecContext(ctx, `UPDATE feedback_threads SET `+column+`=? WHERE id=?`, now(), threadID); err != nil {
			return item, err
		}
	}
	rows, err := s.DB.QueryContext(ctx, `SELECT id,sender,body,created_at FROM feedback_messages WHERE thread_id=? ORDER BY id`, threadID)
	if err != nil {
		return item, err
	}
	item.Messages = make([]FeedbackMessage, 0)
	for rows.Next() {
		var message FeedbackMessage
		if err = rows.Scan(&message.ID, &message.Sender, &message.Body, &message.CreatedAt); err != nil {
			_ = rows.Close()
			return item, err
		}
		item.Messages = append(item.Messages, message)
	}
	if err = rows.Err(); err != nil {
		_ = rows.Close()
		return item, err
	}
	if err = rows.Close(); err != nil {
		return item, err
	}
	for index := range item.Messages {
		item.Messages[index].Attachments, err = s.messageAttachments(ctx, item.Messages[index].ID)
		if err != nil {
			return item, err
		}
	}
	item.MessageCount = len(item.Messages)
	return item, nil
}

func (s *Store) messageAttachments(ctx context.Context, messageID int64) ([]FeedbackAttachment, error) {
	rows, err := s.DB.QueryContext(ctx, `SELECT id,filename,mime_type,size_bytes FROM feedback_attachments WHERE message_id=? ORDER BY created_at,id`, messageID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]FeedbackAttachment, 0)
	for rows.Next() {
		var item FeedbackAttachment
		if err = rows.Scan(&item.ID, &item.Filename, &item.MIME, &item.Size); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) FeedbackAttachmentForUser(ctx context.Context, userID int64, threadID, attachmentID string) (FeedbackAttachment, error) {
	return s.feedbackAttachment(ctx, threadID, attachmentID, userID, false)
}

func (s *Store) FeedbackAttachmentForAdmin(ctx context.Context, threadID, attachmentID string) (FeedbackAttachment, error) {
	return s.feedbackAttachment(ctx, threadID, attachmentID, 0, true)
}

func (s *Store) feedbackAttachment(ctx context.Context, threadID, attachmentID string, userID int64, admin bool) (FeedbackAttachment, error) {
	var item FeedbackAttachment
	query := `SELECT a.id,a.filename,a.mime_type,a.size_bytes,a.data FROM feedback_attachments a JOIN feedback_messages m ON m.id=a.message_id JOIN feedback_threads t ON t.id=m.thread_id WHERE t.id=? AND a.id=?`
	args := []any{threadID, attachmentID}
	if !admin {
		query += ` AND t.user_id=?`
		args = append(args, userID)
	}
	err := s.DB.QueryRowContext(ctx, query, args...).Scan(&item.ID, &item.Filename, &item.MIME, &item.Size, &item.Data)
	if errors.Is(err, sql.ErrNoRows) {
		err = ErrFeedbackNotFound
	}
	return item, err
}

func (s *Store) SetFeedbackStatus(ctx context.Context, threadID, status string) error {
	result, err := s.DB.ExecContext(ctx, `UPDATE feedback_threads SET status=?,updated_at=? WHERE id=?`, status, now(), threadID)
	if err != nil {
		return err
	}
	if changed, _ := result.RowsAffected(); changed == 0 {
		return ErrFeedbackNotFound
	}
	return nil
}

func (s *Store) UpdateUserPassword(ctx context.Context, userID int64, passwordHash string) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	result, err := tx.ExecContext(ctx, `UPDATE users SET password_hash=? WHERE id=?`, passwordHash, userID)
	if err != nil {
		_ = tx.Rollback()
		return err
	}
	if changed, _ := result.RowsAffected(); changed == 0 {
		_ = tx.Rollback()
		return sql.ErrNoRows
	}
	if _, err = tx.ExecContext(ctx, `UPDATE sessions SET status='revoked' WHERE card_id=(SELECT account_card_id FROM users WHERE id=?)`, userID); err != nil {
		_ = tx.Rollback()
		return err
	}
	return tx.Commit()
}
