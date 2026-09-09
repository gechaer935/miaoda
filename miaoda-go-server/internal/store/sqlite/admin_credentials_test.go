package sqlite

import (
	"database/sql"
	"path/filepath"
	"testing"
)

func TestOpenMigratesAdminUsernameWithoutChangingPasswordHash(t *testing.T) {
	path := filepath.Join(t.TempDir(), "legacy-admin.sqlite")
	legacy, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	const passwordHash = "existing-bcrypt-hash-must-stay-unchanged"
	if _, err = legacy.Exec(`CREATE TABLE admin_credentials (
		id INTEGER PRIMARY KEY CHECK(id = 1),
		password_hash TEXT NOT NULL,
		session_version INTEGER NOT NULL DEFAULT 1,
		updated_at TEXT NOT NULL
	); INSERT INTO admin_credentials(id,password_hash,session_version,updated_at)
	VALUES(1,?,7,'2026-08-01T00:00:00Z')`, passwordHash); err != nil {
		_ = legacy.Close()
		t.Fatal(err)
	}
	if err = legacy.Close(); err != nil {
		t.Fatal(err)
	}

	store, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	credential, err := store.AdminCredential(t.Context())
	if err != nil {
		_ = store.DB.Close()
		t.Fatal(err)
	}
	if credential.Username != "admin" || credential.PasswordHash != passwordHash || credential.SessionVersion != 7 {
		_ = store.DB.Close()
		t.Fatalf("unexpected migrated credential: username=%q hashPreserved=%t version=%d", credential.Username, credential.PasswordHash == passwordHash, credential.SessionVersion)
	}
	if err = store.DB.Close(); err != nil {
		t.Fatal(err)
	}

	reopened, err := Open(path)
	if err != nil {
		t.Fatalf("idempotent reopen failed: %v", err)
	}
	defer reopened.DB.Close()
	credential, err = reopened.AdminCredential(t.Context())
	if err != nil || credential.Username != "admin" || credential.PasswordHash != passwordHash || credential.SessionVersion != 7 {
		t.Fatalf("credential changed after reopen: credential=%+v err=%v", credential, err)
	}
}
