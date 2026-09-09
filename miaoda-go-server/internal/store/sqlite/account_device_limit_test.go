package sqlite

import (
	"path/filepath"
	"testing"
)

func TestOpenMigratesOnlyAccountCardsToFiveDevices(t *testing.T) {
	path := filepath.Join(t.TempDir(), "account-device-limit.sqlite")
	store, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}

	accountResult, err := store.DB.Exec(`INSERT INTO cards(card_key,status,max_devices,created_at,note) VALUES('ACCOUNT-OLD','active',1,'2026-07-01T00:00:00Z','internal account card')`)
	if err != nil {
		t.Fatal(err)
	}
	accountCardID, err := accountResult.LastInsertId()
	if err != nil {
		t.Fatal(err)
	}
	if _, err = store.DB.Exec(`INSERT INTO card_metadata(card_id,kind) VALUES(?,'account')`, accountCardID); err != nil {
		t.Fatal(err)
	}
	if _, err = store.DB.Exec(`INSERT INTO users(username,password_hash,account_card_id,created_at) VALUES('legacy-user','hash',?,'2026-07-01T00:00:00Z')`, accountCardID); err != nil {
		t.Fatal(err)
	}
	if _, err = store.DB.Exec(`INSERT INTO cards(card_key,status,max_devices,created_at,note) VALUES('PUBLIC-OLD','active',1,'2026-07-01T00:00:00Z','legacy redemption card')`); err != nil {
		t.Fatal(err)
	}
	if err = store.DB.Close(); err != nil {
		t.Fatal(err)
	}

	store, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.DB.Close() })

	var accountLimit, publicCardLimit int
	if err = store.DB.QueryRow(`SELECT max_devices FROM cards WHERE card_key='ACCOUNT-OLD'`).Scan(&accountLimit); err != nil {
		t.Fatal(err)
	}
	if err = store.DB.QueryRow(`SELECT max_devices FROM cards WHERE card_key='PUBLIC-OLD'`).Scan(&publicCardLimit); err != nil {
		t.Fatal(err)
	}
	if accountLimit != DefaultDeviceLimit {
		t.Fatalf("account device limit=%d, want %d", accountLimit, DefaultDeviceLimit)
	}
	if publicCardLimit != 1 {
		t.Fatalf("legacy public card device limit=%d, want 1", publicCardLimit)
	}
}
