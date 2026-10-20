package app

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"math/rand/v2"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"nuhabit/backend/internal/platform/testutil"
	"nuhabit/backend/internal/platform/whatsapp"
)

type recordingMail struct{ to []string }

func (m *recordingMail) Send(_ context.Context, to, _, subject, html string) bool {
	m.to = append(m.to, to+"|"+subject+"|"+html)
	return true
}

func TestGymChannelsHonourOptOuts(t *testing.T) {
	tx := testutil.Tx(t)
	ctx := context.Background()
	if _, err := tx.Exec(ctx, `DELETE FROM configuration.app_settings WHERE key IN ('wa_gateway_url', 'wa_gateway_token')`); err != nil {
		t.Fatal(err)
	}
	var mu sync.Mutex
	var targets []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]string
		_ = json.NewDecoder(r.Body).Decode(&body)
		mu.Lock()
		targets = append(targets, body["target"]+"|"+body["message"])
		mu.Unlock()
		_, _ = io.WriteString(w, `{"status":true}`)
	}))
	defer srv.Close()

	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	wa := whatsapp.New(log)
	wa.FonnteURL = srv.URL
	env := map[string]string{"WHATSAPP_PROVIDER": "fonnte", "FONNTE_API_KEY": "k"}
	wa.Getenv = func(k string) string { return env[k] }
	mail := &recordingMail{}
	c := gymChannels{db: tx, wa: wa, mail: mail, from: "Gym <gym@test.local>", log: log}

	member := func(phone, email string) string {
		var id string
		if err := tx.QueryRow(ctx, `INSERT INTO pos.pos_customers (phone, name, email) VALUES ($1, 'Go Gym', NULLIF($2, '')) RETURNING id::text`, phone, email).Scan(&id); err != nil {
			t.Fatal(err)
		}
		return id
	}
	suffix := fmt.Sprintf("%06d", rand.IntN(1_000_000))
	all := member("0812777"+suffix, "all@test.local")
	noWA := member("0812778"+suffix, "nowa@test.local")
	none := member("0812779"+suffix, "none@test.local")
	if _, err := tx.Exec(ctx, `INSERT INTO gym.athlete_settings (customer_id, gym_whatsapp) VALUES ($1, false)`, noWA); err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO gym.athlete_settings (customer_id, gym_whatsapp, gym_email) VALUES ($1, false, false)`, none); err != nil {
		t.Fatal(err)
	}

	for _, id := range []string{all, noWA, none} {
		c.deliver(ctx, id, "Kelas segera dimulai", "Mulai <18.00>")
	}
	if len(targets) != 1 || targets[0] != "62812777"+suffix+"|*Kelas segera dimulai*\nMulai <18.00>" {
		t.Fatalf("WhatsApp sends = %q", targets)
	}
	if len(mail.to) != 2 || !strings.HasPrefix(mail.to[0], "all@test.local|Kelas segera dimulai|") ||
		!strings.Contains(mail.to[0], "Mulai &lt;18.00&gt;") || !strings.HasPrefix(mail.to[1], "nowa@test.local|") {
		t.Fatalf("emails = %q", mail.to)
	}

	// Without a provider or a sender address nothing goes out and nothing is logged as failed.
	env = map[string]string{}
	c.from = ""
	c.deliver(ctx, all, "x", "y")
	var failed int
	if err := tx.QueryRow(ctx, `SELECT count(*)::int FROM crm.wa_messages WHERE customer_id = $1 AND status = 'failed'`, all).Scan(&failed); err != nil {
		t.Fatal(err)
	}
	if len(targets) != 1 || len(mail.to) != 2 || failed != 0 {
		t.Fatalf("unconfigured channels sent: wa=%d mail=%d failed=%d", len(targets), len(mail.to), failed)
	}
}
