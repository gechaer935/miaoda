package sqlite

import (
	"context"
	"database/sql"
)

type AdminCredential struct {
	Username       string
	PasswordHash   string
	SessionVersion int64
	UpdatedAt      string
}

func scanAdminCredential(row interface{ Scan(...any) error }) (AdminCredential, error) {
	var credential AdminCredential
	err := row.Scan(&credential.Username, &credential.PasswordHash, &credential.SessionVersion, &credential.UpdatedAt)
	return credential, err
}

func (s *Store) AdminCredential(ctx context.Context) (AdminCredential, error) {
	return scanAdminCredential(s.DB.QueryRowContext(ctx,
		"SELECT username,password_hash,session_version,updated_at FROM admin_credentials WHERE id=1"))
}

func (s *Store) InitializeAdminCredential(ctx context.Context, username, passwordHash string) (AdminCredential, error) {
	if _, err := s.DB.ExecContext(ctx, `INSERT INTO admin_credentials(id,username,password_hash,session_version,updated_at)
		VALUES(1,?,?,1,?) ON CONFLICT(id) DO NOTHING`, username, passwordHash, now()); err != nil {
		return AdminCredential{}, err
	}
	return s.AdminCredential(ctx)
}

func (s *Store) ChangeAdminPassword(ctx context.Context, expectedVersion int64, passwordHash string) (AdminCredential, error) {
	result, err := s.DB.ExecContext(ctx, `UPDATE admin_credentials
		SET password_hash=?,session_version=session_version+1,updated_at=?
		WHERE id=1 AND session_version=?`, passwordHash, now(), expectedVersion)
	if err != nil {
		return AdminCredential{}, err
	}
	changed, _ := result.RowsAffected()
	if changed != 1 {
		return AdminCredential{}, sql.ErrNoRows
	}
	return s.AdminCredential(ctx)
}

type SiteVisitDay struct {
	Date           string `json:"date"`
	UniqueVisitors int64  `json:"uniqueVisitors"`
	PageViews      int64  `json:"pageViews"`
}

type SiteVisitTotals struct {
	TodayUnique int64 `json:"todayUnique"`
	TodayViews  int64 `json:"todayViews"`
	TotalUnique int64 `json:"totalUnique"`
	TotalViews  int64 `json:"totalViews"`
}

type UserSignupDay struct {
	Date     string `json:"date"`
	NewUsers int64  `json:"newUsers"`
}

func (s *Store) RecordSiteVisit(ctx context.Context, visitDate, visitorHash, seenAt string) error {
	_, err := s.DB.ExecContext(ctx, `INSERT INTO site_daily_visitors(
			visit_date,visitor_hash,first_seen_at,last_seen_at,page_views
		) VALUES(?,?,?,?,1)
		ON CONFLICT(visit_date,visitor_hash) DO UPDATE SET
			last_seen_at=excluded.last_seen_at,
			page_views=site_daily_visitors.page_views+1`,
		visitDate, visitorHash, seenAt, seenAt)
	return err
}

func (s *Store) SiteVisitStats(ctx context.Context, startDate, today string) (SiteVisitTotals, []SiteVisitDay, error) {
	var totals SiteVisitTotals
	if err := s.DB.QueryRowContext(ctx, `SELECT count(*),COALESCE(sum(page_views),0)
		FROM site_daily_visitors WHERE visit_date=?`, today).Scan(&totals.TodayUnique, &totals.TodayViews); err != nil {
		return totals, nil, err
	}
	if err := s.DB.QueryRowContext(ctx, `SELECT count(DISTINCT visitor_hash),COALESCE(sum(page_views),0)
		FROM site_daily_visitors`).Scan(&totals.TotalUnique, &totals.TotalViews); err != nil {
		return totals, nil, err
	}
	rows, err := s.DB.QueryContext(ctx, `SELECT visit_date,count(*),COALESCE(sum(page_views),0)
		FROM site_daily_visitors WHERE visit_date>=? AND visit_date<=?
		GROUP BY visit_date ORDER BY visit_date`, startDate, today)
	if err != nil {
		return totals, nil, err
	}
	defer rows.Close()
	days := make([]SiteVisitDay, 0)
	for rows.Next() {
		var day SiteVisitDay
		if err = rows.Scan(&day.Date, &day.UniqueVisitors, &day.PageViews); err != nil {
			return totals, nil, err
		}
		days = append(days, day)
	}
	return totals, days, rows.Err()
}

func (s *Store) UserSignupStats(ctx context.Context, startDate, today string) ([]UserSignupDay, error) {
	rows, err := s.DB.QueryContext(ctx, `SELECT date(created_at,'+8 hours'),count(*)
		FROM users
		WHERE date(created_at,'+8 hours')>=? AND date(created_at,'+8 hours')<=?
		GROUP BY date(created_at,'+8 hours')
		ORDER BY date(created_at,'+8 hours')`, startDate, today)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	days := make([]UserSignupDay, 0)
	for rows.Next() {
		var day UserSignupDay
		if err = rows.Scan(&day.Date, &day.NewUsers); err != nil {
			return nil, err
		}
		days = append(days, day)
	}
	return days, rows.Err()
}

type RedemptionSalesGroup struct {
	InterviewSeconds int64
	WrittenQuestions float64
	SalesPlatform    string
	Count            int64
}

func (s *Store) RedemptionSalesGroups(ctx context.Context) ([]RedemptionSalesGroup, error) {
	rows, err := s.DB.QueryContext(ctx, `SELECT interview_seconds,written_questions,sales_platform,count(*)
		FROM sales_ledger
		GROUP BY interview_seconds,written_questions,sales_platform
		ORDER BY interview_seconds,written_questions,sales_platform`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	groups := make([]RedemptionSalesGroup, 0)
	for rows.Next() {
		var group RedemptionSalesGroup
		if err = rows.Scan(&group.InterviewSeconds, &group.WrittenQuestions, &group.SalesPlatform, &group.Count); err != nil {
			return nil, err
		}
		groups = append(groups, group)
	}
	return groups, rows.Err()
}

func (s *Store) UserCount(ctx context.Context) (int64, error) {
	var count int64
	err := s.DB.QueryRowContext(ctx, "SELECT count(*) FROM users").Scan(&count)
	return count, err
}
