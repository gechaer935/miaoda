package sqlite

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
)

func TestLegacyCardsAreBackfilledIntoPlatformBatch(t *testing.T) {
	path := filepath.Join(t.TempDir(), "legacy.sqlite")
	store, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	if err = store.CreateCard(ctx, "MD-LEGACY-0001", 3600, 2, 1, "淘宝"); err != nil {
		t.Fatal(err)
	}
	if err = store.CreateCard(ctx, "MD-LEGACY-0002", 3600, 2, 1, "淘宝"); err != nil {
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
	batches, err := store.ListCardBatches(ctx, 10)
	if err != nil {
		t.Fatal(err)
	}
	if len(batches) != 1 || batches[0].SalesPlatform != "taobao" || batches[0].CardCount != 2 {
		t.Fatalf("unexpected backfilled batches: %#v", batches)
	}
	if batches[0].DisplayName != "淘宝面试1小时+笔试2次-2张-0001" {
		t.Fatalf("unexpected backfilled display name: %q", batches[0].DisplayName)
	}
	keys, err := store.CardBatchKeys(ctx, batches[0].BatchCode)
	if err != nil || len(keys) != 2 || keys[0] != "MD-LEGACY-0001" || keys[1] != "MD-LEGACY-0002" {
		t.Fatalf("unexpected keys: %#v err=%v", keys, err)
	}
}

func TestCardBatchDisplayNamesIncrementWithoutReuse(t *testing.T) {
	store, err := Open(filepath.Join(t.TempDir(), "batch-names.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.DB.Close() })
	ctx := context.Background()
	first, err := store.CreateCardBatch(ctx, "BATCH-ONE", []string{"MD-NAME-0001"}, 3600, 0, 5, "taobao")
	if err != nil {
		t.Fatal(err)
	}
	second, err := store.CreateCardBatch(ctx, "BATCH-TWO", []string{"MD-NAME-0002"}, 3600, 0, 5, "taobao")
	if err != nil {
		t.Fatal(err)
	}
	if first.DisplayName != "淘宝面试1小时-1张-0001" || second.DisplayName != "淘宝面试1小时-1张-0002" {
		t.Fatalf("unexpected names: first=%q second=%q", first.DisplayName, second.DisplayName)
	}
	if _, err = store.DeleteCardBatch(ctx, second.BatchCode); err != nil {
		t.Fatal(err)
	}
	third, err := store.CreateCardBatch(ctx, "BATCH-THREE", []string{"MD-NAME-0003"}, 3600, 0, 5, "taobao")
	if err != nil {
		t.Fatal(err)
	}
	if third.DisplayName != "淘宝面试1小时-1张-0003" {
		t.Fatalf("deleted sequence was reused: %q", third.DisplayName)
	}
}

func TestLegacyCardTypesAreNormalized(t *testing.T) {
	path := filepath.Join(t.TempDir(), "legacy-kinds.sqlite")
	legacy, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	for _, statement := range []string{
		`CREATE TABLE card_metadata(card_id INTEGER PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('standard','experience','account')))`,
		`CREATE TABLE card_batches(id INTEGER PRIMARY KEY AUTOINCREMENT,batch_code TEXT NOT NULL UNIQUE,sales_platform TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('standard','experience')),interview_seconds INTEGER NOT NULL,written_questions REAL NOT NULL,max_devices INTEGER NOT NULL,created_at TEXT NOT NULL)`,
		`CREATE TABLE card_redemptions(id INTEGER PRIMARY KEY AUTOINCREMENT,card_id INTEGER NOT NULL UNIQUE,user_id INTEGER NOT NULL,kind TEXT NOT NULL,interview_seconds INTEGER NOT NULL,written_questions REAL NOT NULL,redeemed_at TEXT NOT NULL)`,
		`INSERT INTO card_metadata(card_id,kind) VALUES(1,'experience')`,
		`INSERT INTO card_batches(batch_code,sales_platform,kind,interview_seconds,written_questions,max_devices,created_at) VALUES('OLD-BATCH','taobao','experience',600,0,5,'2026-07-22T00:00:00Z')`,
		`INSERT INTO card_redemptions(card_id,user_id,kind,interview_seconds,written_questions,redeemed_at) VALUES(1,1,'experience',600,0,'2026-07-22T00:00:00Z')`,
	} {
		if _, err = legacy.Exec(statement); err != nil {
			_ = legacy.Close()
			t.Fatal(err)
		}
	}
	if err = legacy.Close(); err != nil {
		t.Fatal(err)
	}

	store, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.DB.Close() })
	for _, table := range []string{"card_metadata", "card_batches", "card_redemptions"} {
		var legacyCount, standardCount int
		if err = store.DB.QueryRow("SELECT count(*) FROM " + table + " WHERE kind='experience'").Scan(&legacyCount); err != nil {
			t.Fatal(err)
		}
		if err = store.DB.QueryRow("SELECT count(*) FROM " + table + " WHERE kind='standard'").Scan(&standardCount); err != nil {
			t.Fatal(err)
		}
		if legacyCount != 0 || standardCount != 1 {
			t.Fatalf("%s kind normalization failed: legacy=%d standard=%d", table, legacyCount, standardCount)
		}
	}
}
