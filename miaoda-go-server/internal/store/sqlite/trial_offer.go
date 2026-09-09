package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"time"
)

const (
	DefaultTrialInterviewSeconds = int64(300)
	DefaultTrialWrittenQuestions = float64(1)
	DefaultTrialMaxGrantsPerIP   = 2
	DefaultTrialIPWindowHours    = 30 * 24
)

type TrialOfferSettings struct {
	Enabled          bool    `json:"enabled"`
	InterviewSeconds int64   `json:"interviewSeconds"`
	WrittenQuestions float64 `json:"writtenQuestions"`
	MaxGrantsPerIP   int     `json:"maxGrantsPerIp"`
	IPWindowHours    int     `json:"ipWindowHours"`
	UpdatedAt        string  `json:"updatedAt"`
}

func scanTrialOffer(row interface{ Scan(...any) error }) (TrialOfferSettings, error) {
	var settings TrialOfferSettings
	var enabled int
	err := row.Scan(
		&enabled,
		&settings.InterviewSeconds,
		&settings.WrittenQuestions,
		&settings.MaxGrantsPerIP,
		&settings.IPWindowHours,
		&settings.UpdatedAt,
	)
	settings.Enabled = enabled == 1
	return settings, err
}

func trialOfferFromQuerier(ctx context.Context, query interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}) (TrialOfferSettings, error) {
	return scanTrialOffer(query.QueryRowContext(ctx, `SELECT enabled,interview_seconds,written_questions,
		max_grants_per_ip,ip_window_hours,updated_at FROM trial_offer_settings WHERE id=1`))
}

func (s *Store) TrialOfferSettings(ctx context.Context) (TrialOfferSettings, error) {
	return trialOfferFromQuerier(ctx, s.DB)
}

func validateTrialOffer(settings TrialOfferSettings) error {
	if settings.InterviewSeconds < 0 || settings.InterviewSeconds > 24*60*60 {
		return errors.New("invalid trial interview seconds")
	}
	if settings.WrittenQuestions < 0 || settings.WrittenQuestions > 100 {
		return errors.New("invalid trial written questions")
	}
	if settings.Enabled && settings.InterviewSeconds == 0 && settings.WrittenQuestions == 0 {
		return errors.New("enabled trial offer must include quota")
	}
	if settings.MaxGrantsPerIP < 1 || settings.MaxGrantsPerIP > 20 {
		return errors.New("invalid trial IP limit")
	}
	if settings.IPWindowHours < 1 || settings.IPWindowHours > 365*24 {
		return errors.New("invalid trial IP window")
	}
	return nil
}

func (s *Store) UpdateTrialOfferSettings(ctx context.Context, settings TrialOfferSettings) (TrialOfferSettings, error) {
	if err := validateTrialOffer(settings); err != nil {
		return TrialOfferSettings{}, err
	}
	settings.UpdatedAt = now()
	enabled := 0
	if settings.Enabled {
		enabled = 1
	}
	_, err := s.DB.ExecContext(ctx, `UPDATE trial_offer_settings SET enabled=?,interview_seconds=?,
		written_questions=?,max_grants_per_ip=?,ip_window_hours=?,updated_at=? WHERE id=1`,
		enabled, settings.InterviewSeconds, settings.WrittenQuestions, settings.MaxGrantsPerIP, settings.IPWindowHours, settings.UpdatedAt)
	if err != nil {
		return TrialOfferSettings{}, err
	}
	return settings, nil
}

func trialGrantQuota(ctx context.Context, tx *sql.Tx, settings TrialOfferSettings, deviceHash, registrationIP string) (int64, float64, bool, error) {
	if !settings.Enabled || deviceHash == "" || (settings.InterviewSeconds == 0 && settings.WrittenQuestions == 0) {
		return 0, 0, false, nil
	}
	var deviceClaims int
	if err := tx.QueryRowContext(ctx, "SELECT count(*) FROM trial_claim_history WHERE device_hash=?", deviceHash).Scan(&deviceClaims); err != nil {
		return 0, 0, false, err
	}
	if deviceClaims > 0 {
		return 0, 0, false, nil
	}
	cutoff := time.Now().UTC().Add(-time.Duration(settings.IPWindowHours) * time.Hour).Format(time.RFC3339Nano)
	var ipClaims int
	if err := tx.QueryRowContext(ctx, "SELECT count(*) FROM trial_claim_history WHERE ip_address=? AND created_at>=?", registrationIP, cutoff).Scan(&ipClaims); err != nil {
		return 0, 0, false, err
	}
	if ipClaims >= settings.MaxGrantsPerIP {
		return 0, 0, false, nil
	}
	return settings.InterviewSeconds, settings.WrittenQuestions, true, nil
}
