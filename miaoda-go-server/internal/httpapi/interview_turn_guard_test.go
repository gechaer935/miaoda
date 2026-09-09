package httpapi

import (
	"testing"
	"time"

	store "example.com/miaoda/server/internal/store/sqlite"
)

func TestInterviewTurnGuardAllowsOnePipelineAndDistinctFallbackAttempts(t *testing.T) {
	guard := newInterviewTurnGuard()
	auth := store.Auth{CardID: 12, DeviceID: "device-a"}
	now := time.Date(2026, 8, 14, 12, 0, 0, 0, time.UTC)

	if _, ok := guard.claim(auth, "turn-1", "pipeline-a", 0, now); !ok {
		t.Fatal("first attempt should be accepted")
	}
	if _, ok := guard.claim(auth, "turn-1", "pipeline-a", 0, now.Add(time.Second)); ok {
		t.Fatal("the same attempt must be idempotently rejected")
	}
	if _, ok := guard.claim(auth, "turn-1", "pipeline-a", 1, now.Add(2*time.Second)); !ok {
		t.Fatal("the owning pipeline must be allowed to use a fallback attempt")
	}
	if _, ok := guard.claim(auth, "turn-1", "pipeline-b", 2, now.Add(3*time.Second)); ok {
		t.Fatal("a second pipeline must not answer the same logical turn")
	}
}

func TestInterviewTurnGuardScopesTurnByAccountAndDevice(t *testing.T) {
	guard := newInterviewTurnGuard()
	now := time.Date(2026, 8, 14, 12, 0, 0, 0, time.UTC)

	if _, ok := guard.claim(store.Auth{CardID: 1, DeviceID: "a"}, "same-turn", "p1", 0, now); !ok {
		t.Fatal("first device should be accepted")
	}
	if _, ok := guard.claim(store.Auth{CardID: 1, DeviceID: "b"}, "same-turn", "p2", 0, now); !ok {
		t.Fatal("another device must have an independent namespace")
	}
	if _, ok := guard.claim(store.Auth{CardID: 2, DeviceID: "a"}, "same-turn", "p3", 0, now); !ok {
		t.Fatal("another account must have an independent namespace")
	}
}

func TestInterviewTurnGuardReleaseBeforeProviderWork(t *testing.T) {
	guard := newInterviewTurnGuard()
	auth := store.Auth{CardID: 3, DeviceID: "device"}
	now := time.Date(2026, 8, 14, 12, 0, 0, 0, time.UTC)

	key, ok := guard.claim(auth, "turn", "pipeline", 0, now)
	if !ok {
		t.Fatal("claim should succeed")
	}
	guard.release(key, "pipeline", 0)
	if _, ok = guard.claim(auth, "turn", "new-pipeline", 0, now.Add(time.Second)); !ok {
		t.Fatal("preflight rejection should release the logical turn")
	}
}

func TestInterviewTurnGuardExpiresOldOwner(t *testing.T) {
	guard := newInterviewTurnGuard()
	guard.ttl = time.Second
	auth := store.Auth{CardID: 4, DeviceID: "device"}
	now := time.Date(2026, 8, 14, 12, 0, 0, 0, time.UTC)

	if _, ok := guard.claim(auth, "turn", "old", 0, now); !ok {
		t.Fatal("claim should succeed")
	}
	if _, ok := guard.claim(auth, "turn", "new", 0, now.Add(2*time.Second)); !ok {
		t.Fatal("expired owner should not block a later pipeline")
	}
}
