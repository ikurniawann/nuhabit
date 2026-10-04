package desktop

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"nuhabit/backend/internal/platform/auth"
)

// statusRepo fakes the reads the status route makes.
type statusRepo struct {
	Repository
	pingErr        error
	pending, stuck int
	queueErr       error
	gateway        *string
	settingErr     error
}

func (r statusRepo) Ping(context.Context) error { return r.pingErr }
func (r statusRepo) PrintQueue(context.Context) (int, int, error) {
	return r.pending, r.stuck, r.queueErr
}
func (r statusRepo) Setting(context.Context, string) (*string, error) { return r.gateway, r.settingErr }

var quiet = slog.New(slog.NewTextHandler(io.Discard, nil))

func TestStatus(t *testing.T) {
	gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Header.Get("X-Case") {
		case "down":
			w.WriteHeader(503)
		case "idle":
			_, _ = w.Write([]byte(`{"connected":false,"state":"qr"}`))
		default:
			_, _ = w.Write([]byte(`{"state":"connected"}`))
		}
	}))
	defer gateway.Close()
	url := gateway.URL + "//"
	dead := "http://127.0.0.1:1"
	empty := ""

	for _, c := range []struct {
		name string
		repo statusRepo
		hdr  string
		want string
	}{
		{"healthy", statusRepo{gateway: &url}, "",
			`[{db Database ok } {print Antrian cetak ok Kosong} {wa WhatsApp ok Terhubung}] ok`},
		{"stuck printer, gateway 503", statusRepo{pending: 3, stuck: 12, gateway: &url}, "down",
			`[{db Database ok } {print Antrian cetak down 3 job, tertua 12 menit} {wa WhatsApp warn Gateway menjawab 503}] down`},
		{"session not connected", statusRepo{gateway: &url}, "idle",
			`[{db Database ok } {print Antrian cetak ok Kosong} {wa WhatsApp warn Gateway hidup, sesi belum terhubung}] warn`},
		{"db down, queue unread, no gateway", statusRepo{pingErr: errors.New("x"), queueErr: errors.New("x"), gateway: &empty}, "",
			`[{db Database down Tidak bisa dihubungi} {print Antrian cetak unknown Tidak terbaca} {wa WhatsApp unknown Belum dikonfigurasi}] down`},
		{"gateway unreachable", statusRepo{gateway: &dead}, "",
			`[{db Database ok } {print Antrian cetak ok Kosong} {wa WhatsApp down Gateway tidak menjawab}] down`},
	} {
		s := NewService(c.repo, nil, quiet, time.Now)
		s.probe = &http.Client{Transport: headerTransport{c.hdr}}
		res, err := s.Status(context.Background())
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}
		if got := strings.TrimSpace(strings.Join([]string{fmtItems(res), res.Level}, " ")); got != c.want {
			t.Errorf("%s:\n got %s\nwant %s", c.name, got, c.want)
		}
	}
	// A failed settings read fails the route, as getSetting throws in TS.
	s := NewService(statusRepo{settingErr: errors.New("db")}, nil, quiet, time.Now)
	if _, err := s.Status(context.Background()); err == nil {
		t.Fatal("setting error swallowed")
	}
}

type headerTransport struct{ value string }

func (h headerTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	r.Header.Set("X-Case", h.value)
	return http.DefaultTransport.RoundTrip(r)
}

func fmtItems(r *StatusResult) string {
	parts := make([]string, len(r.Items))
	for i, it := range r.Items {
		parts[i] = "{" + it.Key + " " + it.Label + " " + it.Level + " " + it.Detail + "}"
	}
	return "[" + strings.Join(parts, " ") + "]"
}

// The broadcaster sends a board once per change, hands a late subscriber the
// last snapshot, and stops polling when the last subscriber leaves.
func TestBroadcaster(t *testing.T) {
	boards := make(chan *Overview, 8)
	b := newBroadcaster(func(context.Context) *Overview { return <-boards }, quiet)
	board := func(cuti int) *Overview {
		return &Overview{DibuatPada: time.Now().String(), OverviewBoard: OverviewBoard{PerluKeputusan: &PendingDecisions{Cuti: cuti}, Gagal: []string{}}}
	}
	recv := func(ch <-chan overviewEvent) overviewEvent {
		t.Helper()
		select {
		case ev := <-ch:
			return ev
		case <-time.After(2 * time.Second):
			t.Fatal("no event")
		}
		return overviewEvent{}
	}

	boards <- board(1)
	first, leaveFirst := b.subscribe()
	ev := recv(first)
	if ev.Overview.PerluKeputusan.Cuti != 1 || len(ev.Hash) != 40 {
		t.Fatalf("first poll %+v", ev)
	}
	second, leaveSecond := b.subscribe()
	if late := recv(second); late.Hash != ev.Hash {
		t.Fatal("late subscriber did not get the snapshot")
	}

	// Same board, new build time: no broadcast. A changed board: broadcast.
	idle := func() {
		for {
			b.mu.Lock()
			busy := b.polling
			b.mu.Unlock()
			if !busy {
				return
			}
			time.Sleep(time.Millisecond)
		}
	}
	idle()
	boards <- board(1)
	b.poll()
	select {
	case ev := <-first:
		t.Fatalf("unchanged board broadcast %+v", ev)
	default:
	}
	boards <- board(2)
	b.poll()
	if ev := recv(first); ev.Overview.PerluKeputusan.Cuti != 2 {
		t.Fatalf("changed board %+v", ev)
	}
	recv(second)

	leaveFirst()
	leaveSecond()
	b.mu.Lock()
	running := b.stop != nil
	b.mu.Unlock()
	if running {
		t.Fatal("poller still running without subscribers")
	}
}

// boardUsers lets everyone see the board.
type boardUsers struct{}

func (boardUsers) RequireUser(*http.Request) (*auth.User, error) {
	return &auth.User{ID: "u", Role: "super_admin"}, nil
}
func (boardUsers) GrantedMenuCodes(context.Context, string, string) ([]string, error) {
	return nil, nil
}

func TestStreamHeartbeat(t *testing.T) {
	s := NewService(nil, boardUsers{}, quiet, time.Now)
	s.heartbeat = 30 * time.Millisecond
	s.board = newBroadcaster(func(context.Context) *Overview {
		return &Overview{OverviewBoard: OverviewBoard{Gagal: []string{}}}
	}, quiet)
	srv := httptest.NewServer(handlers{svc: s}.handle("desktop/stream", bare{"Gagal membuka aliran"}, handlers{svc: s}.stream))
	defer srv.Close()

	ctx, cancel := context.WithCancel(context.Background())
	req, _ := http.NewRequestWithContext(ctx, "GET", srv.URL, nil)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	var got strings.Builder
	buf := make([]byte, 4096)
	deadline := time.Now().Add(3 * time.Second)
	for !strings.Contains(got.String(), ": ping\n\n") && time.Now().Before(deadline) {
		n, err := res.Body.Read(buf)
		got.Write(buf[:n])
		if err != nil {
			break
		}
	}
	cancel()
	res.Body.Close()
	out := got.String()
	if !strings.HasPrefix(out, "event: ready\ndata: {\"at\":\"") || !strings.Contains(out, "\n\nevent: overview\ndata: {\"hash\":\"") ||
		!strings.Contains(out, ": ping\n\n") {
		t.Fatalf("stream:\n%s", out)
	}

	// The subscriber leaves with the client.
	deadline = time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		s.board.mu.Lock()
		n := len(s.board.listeners)
		s.board.mu.Unlock()
		if n == 0 {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("listener not removed after disconnect")
}
