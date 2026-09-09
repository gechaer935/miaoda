package httpapi

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"sync"
	"time"

	store "example.com/miaoda/server/internal/store/sqlite"
)

const interviewTurnGuardTTL = 10 * time.Minute

type interviewTurnOwner struct {
	pipelineID string
	attempts   map[int]struct{}
	expiresAt  time.Time
}

// interviewTurnGuard provides a server-side backstop for buggy or duplicated
// clients. One logical turn is owned by one renderer pipeline; that pipeline
// may advance through distinct fallback attempts, but another pipeline cannot
// start the same turn and each attempt number is accepted only once.
type interviewTurnGuard struct {
	mu      sync.Mutex
	ttl     time.Duration
	entries map[string]*interviewTurnOwner
}

func newInterviewTurnGuard() *interviewTurnGuard {
	return &interviewTurnGuard{
		ttl:     interviewTurnGuardTTL,
		entries: make(map[string]*interviewTurnOwner),
	}
}

func interviewTurnKey(auth store.Auth, turnID string) string {
	digest := sha256.Sum256([]byte(turnID))
	return fmt.Sprintf("%d:%s:%s", auth.CardID, auth.DeviceID, hex.EncodeToString(digest[:16]))
}

func (g *interviewTurnGuard) claim(
	auth store.Auth,
	turnID string,
	pipelineID string,
	attemptID int,
	now time.Time,
) (string, bool) {
	if turnID == "" {
		return "", true
	}
	key := interviewTurnKey(auth, turnID)
	g.mu.Lock()
	defer g.mu.Unlock()

	for entryKey, entry := range g.entries {
		if !entry.expiresAt.After(now) {
			delete(g.entries, entryKey)
		}
	}

	entry := g.entries[key]
	if entry == nil {
		entry = &interviewTurnOwner{
			pipelineID: pipelineID,
			attempts:   make(map[int]struct{}),
			expiresAt:  now.Add(g.ttl),
		}
		g.entries[key] = entry
	} else if entry.pipelineID != pipelineID {
		return key, false
	}

	if _, exists := entry.attempts[attemptID]; exists {
		return key, false
	}
	entry.attempts[attemptID] = struct{}{}
	entry.expiresAt = now.Add(g.ttl)
	return key, true
}

// release is used only when a request is rejected before quota consumption and
// before any provider call. Once work begins, the claim intentionally remains
// until TTL expiry, regardless of model success or failure.
func (g *interviewTurnGuard) release(key, pipelineID string, attemptID int) {
	if key == "" {
		return
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	entry := g.entries[key]
	if entry == nil || entry.pipelineID != pipelineID {
		return
	}
	delete(entry.attempts, attemptID)
	if len(entry.attempts) == 0 {
		delete(g.entries, key)
	}
}
