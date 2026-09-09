package sqlite

import (
	"database/sql"
	"path/filepath"
	"strings"
	"testing"

	_ "modernc.org/sqlite"
)

func TestOpenAddsQuestionTextAndClientVersionToLegacyInterviewLogs(t *testing.T) {
	path := filepath.Join(t.TempDir(), "legacy-interview-logs.sqlite")
	db, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	_, err = db.Exec(`CREATE TABLE interview_request_logs (
		request_id TEXT PRIMARY KEY, username TEXT NOT NULL, device_id TEXT NOT NULL DEFAULT '',
		requested_model TEXT NOT NULL DEFAULT '', final_model TEXT NOT NULL DEFAULT '',
		status TEXT NOT NULL CHECK(status IN ('running','succeeded','failed')),
		attempt_count INTEGER NOT NULL DEFAULT 0, retry_count INTEGER NOT NULL DEFAULT 0,
		error_message TEXT NOT NULL DEFAULT '', started_at TEXT NOT NULL, completed_at TEXT
	);
	INSERT INTO interview_request_logs(request_id,username,status,started_at)
	VALUES('legacy-request','legacy-user','succeeded','2026-08-04T00:00:00Z');`)
	if err != nil {
		_ = db.Close()
		t.Fatal(err)
	}
	if err = db.Close(); err != nil {
		t.Fatal(err)
	}

	store, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer store.DB.Close()
	var question, clientVersion string
	if err = store.DB.QueryRow(`SELECT question_text,client_version FROM interview_request_logs WHERE request_id='legacy-request'`).Scan(&question, &clientVersion); err != nil {
		t.Fatal(err)
	}
	if question != "" {
		t.Fatalf("legacy question must default to empty, got %q", question)
	}
	if clientVersion != "" {
		t.Fatalf("legacy client version must default to empty, got %q", clientVersion)
	}
}

func TestCleanInterviewClientVersionNormalizesAndBoundsText(t *testing.T) {
	got := cleanInterviewClientVersion("  1.0.10\n" + strings.Repeat("x", 80))
	if !strings.HasPrefix(got, "1.0.10 ") {
		t.Fatalf("client version whitespace was not normalized: %q", got)
	}
	if len([]rune(got)) != 64 {
		t.Fatalf("client version must be bounded to 64 runes, got runes=%d", len([]rune(got)))
	}
}

func TestCleanInterviewQuestionNormalizesAndBoundsText(t *testing.T) {
	input := "  重复   问题\n" + strings.Repeat("测", 1100)
	got := cleanInterviewQuestion(input)
	if !strings.HasPrefix(got, "重复 问题 ") {
		t.Fatalf("question whitespace was not normalized: %q", got[:20])
	}
	if len([]rune(got)) != 1000 || !strings.HasSuffix(got, "…") {
		t.Fatalf("question must be bounded to 1000 runes with ellipsis, got runes=%d", len([]rune(got)))
	}
}
