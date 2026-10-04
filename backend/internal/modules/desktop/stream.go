package desktop

import (
	"bytes"
	"context"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"sync"
	"time"
)

// Stream timings: the board is rebuilt every 30 seconds while anyone
// listens, and a comment every 20 seconds keeps proxies (Cloudflare, the
// Next rewrite's 30-second idle timeout) from closing the connection.
const (
	pollEvery      = 30 * time.Second
	heartbeatEvery = 20 * time.Second
)

// overviewEvent is the data of an "overview" event.
type overviewEvent struct {
	Hash     string    `json:"hash"`
	Overview *Overview `json:"overview"`
}

// broadcaster is lib/desktop/overview-broadcast.ts: one poller serves every
// subscriber and only broadcasts when the board changed. It runs while at
// least one subscriber is connected; the last snapshot survives a stop, so
// (as in TS) a poller restarted onto an unchanged board sends nothing until
// the board changes.
type broadcaster struct {
	build func(ctx context.Context) *Overview
	log   *slog.Logger
	every time.Duration

	mu           sync.Mutex
	listeners    map[chan overviewEvent]struct{}
	stop         chan struct{} // nil while no poller runs
	polling      bool
	lastHash     string
	lastOverview *Overview
}

func newBroadcaster(build func(ctx context.Context) *Overview, log *slog.Logger) *broadcaster {
	return &broadcaster{build: build, log: log, every: pollEvery, listeners: map[chan overviewEvent]struct{}{}}
}

// subscribe registers a listener; the first one starts the poller, a later
// one gets the last snapshot right away.
func (b *broadcaster) subscribe() (<-chan overviewEvent, func()) {
	ch := make(chan overviewEvent, 4)
	b.mu.Lock()
	b.listeners[ch] = struct{}{}
	if b.stop == nil {
		b.stop = make(chan struct{})
		go b.run(b.stop)
	} else if b.lastOverview != nil && b.lastHash != "" {
		ch <- overviewEvent{Hash: b.lastHash, Overview: b.lastOverview}
	}
	b.mu.Unlock()
	return ch, func() {
		b.mu.Lock()
		defer b.mu.Unlock()
		delete(b.listeners, ch)
		if len(b.listeners) == 0 && b.stop != nil {
			close(b.stop)
			b.stop = nil
		}
	}
}

func (b *broadcaster) run(stop chan struct{}) {
	b.poll()
	t := time.NewTicker(b.every)
	defer t.Stop()
	for {
		select {
		case <-stop:
			return
		case <-t.C:
			b.poll()
		}
	}
}

// poll rebuilds the board (one poll at a time) and broadcasts it when its
// hash changed. A full listener buffer drops the event for that listener
// instead of stalling the others.
func (b *broadcaster) poll() {
	b.mu.Lock()
	if b.polling {
		b.mu.Unlock()
		return
	}
	b.polling = true
	b.mu.Unlock()
	defer func() {
		b.mu.Lock()
		b.polling = false
		b.mu.Unlock()
	}()

	ctx, cancel := context.WithTimeout(context.Background(), b.every)
	defer cancel()
	overview := b.build(ctx)
	hash, err := hashOverview(overview)
	if err != nil {
		b.log.Warn("[desktop:broadcast] poll gagal", "error", err)
		return
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	b.lastOverview = overview
	if hash == b.lastHash {
		return
	}
	b.lastHash = hash
	for ch := range b.listeners {
		select {
		case ch <- overviewEvent{Hash: hash, Overview: overview}:
		default:
		}
	}
}

// hashOverview is the SHA-1 of the board's JSON without dibuatPada, which
// changes on every poll.
func hashOverview(o *Overview) (string, error) {
	raw, err := marshalJS(o.OverviewBoard)
	if err != nil {
		return "", err
	}
	sum := sha1.Sum(raw)
	return hex.EncodeToString(sum[:]), nil
}

// marshalJS is JSON.stringify: no HTML escaping, no trailing newline.
func marshalJS(v any) ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	return bytes.TrimRight(buf.Bytes(), "\n"), nil
}

// stream is GET /api/desktop/stream: Server-Sent Events with a "ready"
// event, "overview" events when the board changes, and ": ping" comments.
// Access is the overview route's.
func (h handlers) stream(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.svc.requireBoard(r); err != nil {
		return err
	}
	rc := http.NewResponseController(w)
	// The server's WriteTimeout would cut the stream; it lives until the
	// client leaves.
	_ = rc.SetWriteDeadline(time.Time{})
	hdr := w.Header()
	hdr.Set("Content-Type", "text/event-stream; charset=utf-8")
	hdr.Set("Cache-Control", "no-cache, no-transform")
	hdr.Set("Connection", "keep-alive")
	hdr.Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	send := func(event string, data any) error {
		raw, err := marshalJS(data)
		if err != nil {
			return err
		}
		if _, err := fmt.Fprintf(w, "event: %s\ndata: %s\n\n", event, raw); err != nil {
			return err
		}
		return rc.Flush()
	}
	// Once the headers are out, failures end the stream quietly.
	if send("ready", struct {
		At string `json:"at"`
	}{jsISO(h.svc.now())}) != nil {
		return nil
	}
	events, unsubscribe := h.svc.board.subscribe()
	defer unsubscribe()
	heartbeat := time.NewTicker(h.svc.heartbeat)
	defer heartbeat.Stop()
	for {
		select {
		case <-r.Context().Done():
			return nil
		case ev := <-events:
			if send("overview", ev) != nil {
				return nil
			}
		case <-heartbeat.C:
			if _, err := fmt.Fprint(w, ": ping\n\n"); err != nil || rc.Flush() != nil {
				return nil
			}
		}
	}
}
