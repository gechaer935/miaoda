package sqlite

import (
	"context"
	"database/sql"
	"strings"
)

type InterviewAttemptLog struct {
	AttemptNumber int     `json:"attemptNumber"`
	Provider      string  `json:"provider"`
	Model         string  `json:"model"`
	Status        string  `json:"status"`
	ErrorMessage  string  `json:"errorMessage"`
	StartedAt     string  `json:"startedAt"`
	CompletedAt   *string `json:"completedAt"`
}

type InterviewRequestLog struct {
	RequestID      string                `json:"requestId"`
	Username       string                `json:"username"`
	DeviceID       string                `json:"deviceId"`
	ClientVersion  string                `json:"clientVersion"`
	QuestionText   string                `json:"questionText"`
	RequestedModel string                `json:"requestedModel"`
	FinalModel     string                `json:"finalModel"`
	Status         string                `json:"status"`
	AttemptCount   int64                 `json:"attemptCount"`
	RetryCount     int64                 `json:"retryCount"`
	ErrorMessage   string                `json:"errorMessage"`
	StartedAt      string                `json:"startedAt"`
	CompletedAt    *string               `json:"completedAt"`
	Attempts       []InterviewAttemptLog `json:"attempts"`
}

type InterviewLogSummary struct {
	Requests       int64 `json:"requests"`
	Succeeded      int64 `json:"succeeded"`
	Failed         int64 `json:"failed"`
	Running        int64 `json:"running"`
	Retried        int64 `json:"retried"`
	Attempts       int64 `json:"attempts"`
	FailedAttempts int64 `json:"failedAttempts"`
}

type InterviewLogDay struct {
	Date      string `json:"date"`
	Requests  int64  `json:"requests"`
	Succeeded int64  `json:"succeeded"`
	Failed    int64  `json:"failed"`
	Retried   int64  `json:"retried"`
}

func cleanInterviewLogError(value string) string {
	value = strings.Join(strings.Fields(value), " ")
	if len([]rune(value)) > 500 {
		value = string([]rune(value)[:500])
	}
	return value
}

func cleanInterviewQuestion(value string) string {
	value = strings.Join(strings.Fields(value), " ")
	runes := []rune(value)
	if len(runes) > 1000 {
		value = string(runes[:999]) + "…"
	}
	return value
}

func cleanInterviewClientVersion(value string) string {
	value = strings.Join(strings.Fields(value), " ")
	runes := []rune(value)
	if len(runes) > 64 {
		value = string(runes[:64])
	}
	return value
}

func (s *Store) StartInterviewRequest(ctx context.Context, requestID string, auth Auth, clientVersion, question, requestedModel string) error {
	_, err := s.DB.ExecContext(ctx, `INSERT INTO interview_request_logs(
		request_id,username,device_id,client_version,question_text,requested_model,status,started_at
	) VALUES(?,COALESCE((SELECT username FROM users WHERE account_card_id=?),'卡密用户'),?,?,?,?, 'running',?)`,
		requestID, auth.CardID, auth.DeviceID, cleanInterviewClientVersion(clientVersion), cleanInterviewQuestion(question), strings.TrimSpace(requestedModel), now())
	return err
}

func (s *Store) StartInterviewAttempt(ctx context.Context, requestID string, attempt int, provider, model string) error {
	n := now()
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err = tx.ExecContext(ctx, `INSERT INTO interview_attempt_logs(
		request_id,attempt_number,provider,model,status,started_at
	) VALUES(?,?,?,?, 'running',?) ON CONFLICT(request_id,attempt_number) DO UPDATE SET
		provider=excluded.provider,model=excluded.model,status='running',error_message='',started_at=excluded.started_at,completed_at=NULL`,
		requestID, attempt, provider, model, n); err != nil {
		return err
	}
	if _, err = tx.ExecContext(ctx, `UPDATE interview_request_logs SET
		attempt_count=CASE WHEN attempt_count<? THEN ? ELSE attempt_count END,
		retry_count=CASE WHEN ? > 1 THEN ?-1 ELSE 0 END WHERE request_id=?`,
		attempt, attempt, attempt, attempt, requestID); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) FinishInterviewAttempt(ctx context.Context, requestID string, attempt int, success bool, message string) error {
	status := "failed"
	if success {
		status = "succeeded"
	}
	_, err := s.DB.ExecContext(ctx, `UPDATE interview_attempt_logs SET status=?,error_message=?,completed_at=?
		WHERE request_id=? AND attempt_number=?`, status, cleanInterviewLogError(message), now(), requestID, attempt)
	return err
}

func (s *Store) FinishInterviewRequest(ctx context.Context, requestID string, success bool, finalModel, message string) error {
	status := "failed"
	if success {
		status = "succeeded"
	}
	_, err := s.DB.ExecContext(ctx, `UPDATE interview_request_logs SET
		status=?,final_model=?,error_message=?,completed_at=? WHERE request_id=?`,
		status, strings.TrimSpace(finalModel), cleanInterviewLogError(message), now(), requestID)
	return err
}

func (s *Store) InterviewLogSummary(ctx context.Context, today string) (InterviewLogSummary, error) {
	var summary InterviewLogSummary
	err := s.DB.QueryRowContext(ctx, `SELECT count(*),
		COALESCE(sum(CASE WHEN status='succeeded' THEN 1 ELSE 0 END),0),
		COALESCE(sum(CASE WHEN status='failed' THEN 1 ELSE 0 END),0),
		COALESCE(sum(CASE WHEN status='running' THEN 1 ELSE 0 END),0),
		COALESCE(sum(CASE WHEN retry_count>0 THEN 1 ELSE 0 END),0),COALESCE(sum(attempt_count),0)
		FROM interview_request_logs WHERE date(started_at,'+8 hours')=?`, today).
		Scan(&summary.Requests, &summary.Succeeded, &summary.Failed, &summary.Running, &summary.Retried, &summary.Attempts)
	if err != nil {
		return summary, err
	}
	err = s.DB.QueryRowContext(ctx, `SELECT count(*) FROM interview_attempt_logs a
		JOIN interview_request_logs r ON r.request_id=a.request_id
		WHERE a.status='failed' AND date(r.started_at,'+8 hours')=?`, today).Scan(&summary.FailedAttempts)
	return summary, err
}

func (s *Store) InterviewLogDays(ctx context.Context, startDate, today string) ([]InterviewLogDay, error) {
	rows, err := s.DB.QueryContext(ctx, `SELECT date(started_at,'+8 hours'),count(*),
		COALESCE(sum(CASE WHEN status='succeeded' THEN 1 ELSE 0 END),0),
		COALESCE(sum(CASE WHEN status='failed' THEN 1 ELSE 0 END),0),
		COALESCE(sum(CASE WHEN retry_count>0 THEN 1 ELSE 0 END),0)
		FROM interview_request_logs WHERE date(started_at,'+8 hours') BETWEEN ? AND ?
		GROUP BY date(started_at,'+8 hours') ORDER BY date(started_at,'+8 hours')`, startDate, today)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	days := make([]InterviewLogDay, 0)
	for rows.Next() {
		var day InterviewLogDay
		if err = rows.Scan(&day.Date, &day.Requests, &day.Succeeded, &day.Failed, &day.Retried); err != nil {
			return nil, err
		}
		days = append(days, day)
	}
	return days, rows.Err()
}

func (s *Store) RecentInterviewLogs(ctx context.Context, limit int) ([]InterviewRequestLog, error) {
	rows, err := s.DB.QueryContext(ctx, `SELECT request_id,username,device_id,client_version,question_text,requested_model,final_model,status,
		attempt_count,retry_count,error_message,started_at,completed_at
		FROM interview_request_logs ORDER BY started_at DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	return s.scanInterviewLogs(ctx, rows, limit)
}

func (s *Store) InterviewLogsByDatePage(ctx context.Context, date string, limit, offset int) ([]InterviewRequestLog, error) {
	rows, err := s.DB.QueryContext(ctx, `SELECT request_id,username,device_id,client_version,question_text,requested_model,final_model,status,
		attempt_count,retry_count,error_message,started_at,completed_at
		FROM interview_request_logs WHERE date(started_at,'+8 hours')=? ORDER BY started_at DESC LIMIT ? OFFSET ?`, date, limit, offset)
	if err != nil {
		return nil, err
	}
	return s.scanInterviewLogs(ctx, rows, limit)
}

func (s *Store) scanInterviewLogs(ctx context.Context, rows *sql.Rows, capacity int) ([]InterviewRequestLog, error) {
	var err error
	logs := make([]InterviewRequestLog, 0, capacity)
	requestIDs := make([]string, 0, capacity)
	for rows.Next() {
		var item InterviewRequestLog
		if err = rows.Scan(&item.RequestID, &item.Username, &item.DeviceID, &item.ClientVersion, &item.QuestionText, &item.RequestedModel, &item.FinalModel,
			&item.Status, &item.AttemptCount, &item.RetryCount, &item.ErrorMessage, &item.StartedAt, &item.CompletedAt); err != nil {
			_ = rows.Close()
			return nil, err
		}
		item.Attempts = make([]InterviewAttemptLog, 0)
		logs = append(logs, item)
		requestIDs = append(requestIDs, item.RequestID)
	}
	if err = rows.Close(); err != nil {
		return nil, err
	}
	if len(requestIDs) == 0 {
		return logs, nil
	}
	indexes := make(map[string]int, len(logs))
	for index := range logs {
		indexes[logs[index].RequestID] = index
	}
	const requestBatchSize = 500
	for start := 0; start < len(requestIDs); start += requestBatchSize {
		end := start + requestBatchSize
		if end > len(requestIDs) {
			end = len(requestIDs)
		}
		batch := requestIDs[start:end]
		placeholders := strings.TrimRight(strings.Repeat("?,", len(batch)), ",")
		args := make([]any, len(batch))
		for index, requestID := range batch {
			args[index] = requestID
		}
		attemptRows, queryErr := s.DB.QueryContext(ctx, `SELECT request_id,attempt_number,provider,model,status,error_message,started_at,completed_at
			FROM interview_attempt_logs WHERE request_id IN (`+placeholders+`) ORDER BY request_id,attempt_number`, args...)
		if queryErr != nil {
			return nil, queryErr
		}
		for attemptRows.Next() {
			var requestID string
			var attempt InterviewAttemptLog
			if err = attemptRows.Scan(&requestID, &attempt.AttemptNumber, &attempt.Provider, &attempt.Model, &attempt.Status,
				&attempt.ErrorMessage, &attempt.StartedAt, &attempt.CompletedAt); err != nil {
				_ = attemptRows.Close()
				return nil, err
			}
			if index, ok := indexes[requestID]; ok {
				logs[index].Attempts = append(logs[index].Attempts, attempt)
			}
		}
		if err = attemptRows.Close(); err != nil {
			return nil, err
		}
		if err = attemptRows.Err(); err != nil {
			return nil, err
		}
	}
	return logs, nil
}
