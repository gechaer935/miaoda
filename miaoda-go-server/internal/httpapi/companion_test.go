package httpapi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func TestAllowedMobileWrittenLanguageChange(t *testing.T) {
	if !allowedMobile("written.language.set") {
		t.Fatal("mobile written language changes must be relayed to the desktop")
	}
	if allowedMobile("written.language.changed") {
		t.Fatal("desktop-only language broadcasts must not be accepted from mobile clients")
	}
}

func TestAllowedMobileWrittenModeChange(t *testing.T) {
	if !allowedMobile("written.mode.set") {
		t.Fatal("mobile written mode changes must be relayed to the desktop")
	}
	if allowedMobile("written.mode.changed") {
		t.Fatal("desktop-only mode broadcasts must not be accepted from mobile clients")
	}
}

func TestDesktopContentUsesIndependentRateLimit(t *testing.T) {
	contentTypes := map[string]string{
		"transcript.partial": "transcript", "transcript.final": "transcript",
		"answer.started": "answer", "answer.token": "answer", "answer.done": "answer", "answer.error": "answer",
	}
	for eventType, kind := range contentTypes {
		key, maximum := companionEventLimit("device", eventType, "pair-1")
		expectedKey := "companion-content:" + kind + ":pair:pair-1"
		if key != expectedKey || maximum != 150 {
			t.Fatalf("desktop content %q must use the independent 150/minute limit, got %q %d", eventType, key, maximum)
		}
	}

	key, maximum := companionEventLimit("mobile", "question.manual", "pair-1")
	if key != "companion-event:pair:pair-1" || maximum != 120 {
		t.Fatalf("mobile controls must retain the generic limit, got %q %d", key, maximum)
	}
	key, maximum = companionEventLimit("device", "written.done", "pair-1")
	if key != "companion-event:pair:pair-1" || maximum != 120 {
		t.Fatalf("non-streaming desktop events must retain the generic limit, got %q %d", key, maximum)
	}
}

func TestDesktopContentRateLimitAllowsExactly150EventsPerMinute(t *testing.T) {
	guard := &authLimiter{windows: map[string]*limitWindow{}, failures: map[string]*loginFailure{}}
	key, maximum := companionEventLimit("device", "answer.token", "pair-1")
	for index := 0; index < 150; index++ {
		if !guard.allow(key, maximum, time.Minute) {
			t.Fatalf("event %d should remain inside the 150/minute content limit", index+1)
		}
	}
	if guard.allow(key, maximum, time.Minute) {
		t.Fatal("event 151 must be rejected by the desktop content limit")
	}
	transcriptKey, transcriptMaximum := companionEventLimit("device", "transcript.partial", "pair-1")
	if transcriptKey == key {
		t.Fatal("answer and transcript streams must not consume the same rate-limit bucket")
	}
	if !guard.allow(transcriptKey, transcriptMaximum, time.Minute) {
		t.Fatal("the independent transcript bucket must still accept its first event")
	}
}

func TestBroadcastRemovesAnUnwritablePeer(t *testing.T) {
	serverConnections := make(chan *websocket.Conn, 1)
	releaseHandler := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{InsecureSkipVerify: true})
		if err != nil {
			return
		}
		serverConnections <- conn
		<-releaseHandler
	}))
	defer server.Close()
	defer close(releaseHandler)

	client, _, err := websocket.Dial(context.Background(), strings.Replace(server.URL, "http://", "ws://", 1), nil)
	if err != nil {
		t.Fatalf("dial test websocket: %v", err)
	}
	serverConn := <-serverConnections
	testPeer := &peer{conn: serverConn, role: "mobile"}
	testRoom := &room{peers: map[*peer]bool{testPeer: true}}
	companion := &Companion{rooms: map[string]*room{"pair-1": testRoom}}
	_ = client.CloseNow()
	_ = serverConn.CloseNow()

	companion.broadcast("pair-1", "answer.token", "", "request-1", map[string]any{"token": "hello"})
	testRoom.mu.Lock()
	_, remains := testRoom.peers[testPeer]
	testRoom.mu.Unlock()
	if remains {
		t.Fatal("a failed WebSocket write must remove the peer so it cannot remain falsely online")
	}
}
