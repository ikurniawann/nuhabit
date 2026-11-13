package idempotency_test

import (
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/idempotency"
	"nuhabit/backend/internal/platform/testutil"
)

var discard = slog.New(slog.NewTextHandler(io.Discard, nil))

// counting answers status (201 when 0) with the call number and the body.
func counting(calls *atomic.Int32, status int) http.Handler {
	if status == 0 {
		status = http.StatusCreated
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := calls.Add(1)
		body, _ := io.ReadAll(r.Body)
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = fmt.Fprintf(w, `{"call":%d,"echo":%s}`, n, body)
	})
}

func send(h http.Handler, method, key, session, body string) *httptest.ResponseRecorder {
	r := httptest.NewRequest(method, "/api/pos/checkouts", strings.NewReader(body))
	if key != "" {
		r.Header.Set(idempotency.Header, key)
	}
	if session != "" {
		r.AddCookie(&http.Cookie{Name: auth.SessionCookie, Value: session})
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, r)
	return rec
}

func TestReplaysSameKey(t *testing.T) {
	rdb := testutil.Redis(t)
	var calls atomic.Int32
	h := idempotency.Middleware(rdb, discard)(counting(&calls, 0))
	key, session := testutil.RandomHex(8), testutil.RandomHex(8)

	first := send(h, "POST", key, session, `{"total":1}`)
	again := send(h, "POST", key, session, `{"total":1}`)
	if calls.Load() != 1 {
		t.Fatalf("handler ran %d times, want 1", calls.Load())
	}
	if again.Code != first.Code || again.Body.String() != first.Body.String() {
		t.Fatalf("replay %d %q, want %d %q", again.Code, again.Body, first.Code, first.Body)
	}
	if again.Header().Get("Idempotent-Replayed") != "true" || again.Header().Get("Content-Type") != "application/json" {
		t.Fatalf("replay headers %v", again.Header())
	}

	if rec := send(h, "POST", key, session, `{"total":2}`); rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("reused key with another body: %d, want 422", rec.Code)
	}
	if send(h, "POST", key, testutil.RandomHex(8), `{"total":1}`); calls.Load() != 2 {
		t.Fatalf("another session must not share the key: %d calls", calls.Load())
	}
	if send(h, "POST", "", session, `{"total":1}`); calls.Load() != 3 {
		t.Fatalf("request without a key must run: %d calls", calls.Load())
	}
}

func TestErrorReleasesKey(t *testing.T) {
	rdb := testutil.Redis(t)
	for _, status := range []int{http.StatusUnprocessableEntity, http.StatusInternalServerError} {
		var calls atomic.Int32
		h := idempotency.Middleware(rdb, discard)(counting(&calls, status))
		key := testutil.RandomHex(8)
		send(h, "POST", key, "s", `{}`)
		send(h, "POST", key, "s", `{}`)
		if calls.Load() != 2 {
			t.Fatalf("a %d must not be replayed: %d calls, want 2", status, calls.Load())
		}
	}
}

func TestPendingAnswersConflict(t *testing.T) {
	rdb := testutil.Redis(t)
	key := testutil.RandomHex(8)
	entered, release := make(chan struct{}), make(chan struct{})
	slow := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(entered)
		<-release
		w.WriteHeader(http.StatusCreated)
	})
	h := idempotency.Middleware(rdb, discard)(slow)
	done := make(chan struct{})
	go func() { send(h, "POST", key, "s", `{}`); close(done) }()
	<-entered
	if rec := send(h, "POST", key, "s", `{}`); rec.Code != http.StatusConflict {
		t.Fatalf("repeat while the first runs: %d, want 409", rec.Code)
	}
	close(release)
	<-done
	if rec := send(h, "POST", key, "s", `{}`); rec.Code != http.StatusCreated {
		t.Fatalf("repeat after the first finished: %d, want replayed 201", rec.Code)
	}
}

func TestWithoutRedisPassesThrough(t *testing.T) {
	var calls atomic.Int32
	h := idempotency.Middleware(nil, discard)(counting(&calls, 0))
	send(h, "POST", "k", "s", `{}`)
	send(h, "POST", "k", "s", `{}`)
	if calls.Load() != 2 {
		t.Fatalf("without Redis every request runs: %d calls", calls.Load())
	}
}
