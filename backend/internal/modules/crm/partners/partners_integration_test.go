package partners

import (
	"context"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/crm/internal/crmtest"
	"nuhabit/backend/internal/modules/crm/partners/domain"
	"nuhabit/backend/internal/modules/crm/xp"
	xpdomain "nuhabit/backend/internal/modules/crm/xp/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/testutil"
)

// testPos is a minimal PosReads (the real adapter lives in internal/app).
type testPos struct{}

func (testPos) LoyaltySettings(context.Context, database.Querier) (xpdomain.PosSettings, error) {
	return xpdomain.DefaultPosSettings(), nil
}
func (testPos) ProductXP(context.Context, database.Querier, []string) (map[string]float64, error) {
	return map[string]float64{}, nil
}
func (testPos) ProductBonusXP(context.Context, database.Querier, []string) (map[string]float64, error) {
	return map[string]float64{}, nil
}
func (testPos) OrderNumber(context.Context, database.Querier, string) string { return "" }

type env struct {
	t     *testing.T
	tx    pgx.Tx
	mux   *http.ServeMux
	staff testutil.Staff
}

func setup(t *testing.T) env {
	t.Helper()
	tx := testutil.Tx(t)
	d := testutil.Deps(t, nil)
	eng := &xp.Engine{Pos: testPos{}, Log: d.Log, Now: d.Now}
	return env{t: t, tx: tx, mux: crmtest.Mux(newHandler(tx, d, eng).routes()), staff: crmtest.Staff(t, "crm.loyalty.partners")}
}

func (e env) call(method, path string, body any) (int, map[string]any) {
	e.t.Helper()
	return crmtest.Call(e.t, e.mux, method, path, body, &e.staff)
}

func data(t *testing.T, body map[string]any) map[string]any {
	t.Helper()
	d, ok := body["data"].(map[string]any)
	if !ok {
		t.Fatalf("no data object: %v", body)
	}
	return d
}

var hex64 = regexp.MustCompile(`^[0-9a-f]{64}$`)

func TestPartnersAuth(t *testing.T) {
	e := setup(t)
	other := crmtest.Staff(t, "crm.engagement")
	for _, c := range []struct{ method, path string }{
		{"GET", "/api/crm/partners"}, {"POST", "/api/crm/partners"}, {"PATCH", "/api/crm/partners/x"},
		{"GET", "/api/crm/partners/events"}, {"POST", "/api/crm/partners/events/rematch"},
	} {
		if code, body := crmtest.Call(t, e.mux, c.method, c.path, map[string]any{}, nil); code != 401 || body["error"] != "Authentication required" {
			t.Errorf("%s %s anon: %d %v", c.method, c.path, code, body)
		}
		if code, _ := crmtest.Call(t, e.mux, c.method, c.path, map[string]any{}, &other); code != 403 {
			t.Errorf("%s %s without menu: %d", c.method, c.path, code)
		}
	}
}

func TestPartnerAdmin(t *testing.T) {
	e := setup(t)
	code, body := e.call("POST", "/api/crm/partners", map[string]any{"code": "x", "name": "Booth", "partner_type": "photobooth"})
	if code != 400 || body["error"] != "Data tidak valid" ||
		body["details"].([]any)[0].(map[string]any)["message"] != "Kode 2–40 karakter: huruf, angka, - atau _" {
		t.Fatalf("code regex: %d %v", code, body)
	}
	partnerCode := "go-" + testutil.RandomHex(3)
	code, body = e.call("POST", "/api/crm/partners", map[string]any{"code": " " + partnerCode + " ", "name": "Booth", "partner_type": "photobooth"})
	created := data(t, body)
	id, _ := created["id"].(string)
	if code != 200 || body["message"] != "Partner dibuat" || created["code"] != strings.ToUpper(partnerCode) || !hex64.MatchString(created["secret"].(string)) {
		t.Fatalf("create: %d %v", code, body)
	}
	stored := crmtest.Scalar[string](t, e.tx, `SELECT secret_hash FROM crm.crm_integration_partners WHERE id = $1`, id)
	if stored != domain.HashSecret(created["secret"].(string)) {
		t.Fatal("secret_hash must be sha256(secret)")
	}
	if code, body = e.call("POST", "/api/crm/partners", map[string]any{"code": partnerCode, "name": "Booth", "partner_type": "other"}); code != 409 || body["error"] != "Kode partner sudah dipakai" {
		t.Fatalf("duplicate: %d %v", code, body)
	}

	code, body = e.call("GET", "/api/crm/partners", nil)
	var row map[string]any
	for _, it := range body["data"].([]any) {
		if m := it.(map[string]any); m["id"] == id {
			row = m
		}
	}
	if code != 200 || row == nil || row["has_secret"] != true || row["event_count"] != float64(0) || row["last_event_at"] != nil {
		t.Fatalf("list: %d %v", code, row)
	}
	if _, leaked := row["signing_secret"]; leaked {
		t.Fatal("secret must never be listed")
	}

	path := "/api/crm/partners/" + id
	if code, body = e.call("PATCH", path, map[string]any{}); code != 400 || body["error"] != "Tidak ada perubahan" {
		t.Fatalf("empty patch: %d %v", code, body)
	}
	if code, body = e.call("PATCH", path, map[string]any{"rotate_secret": false}); code != 400 ||
		body["details"].([]any)[0].(map[string]any)["message"] != "Invalid input: expected true" {
		t.Fatalf("literal: %d %v", code, body)
	}
	code, body = e.call("PATCH", path, map[string]any{"name": "Booth 2"})
	if d := data(t, body); code != 200 || body["message"] != "Partner diperbarui" || d["id"] != id || d["secret"] != nil {
		t.Fatalf("rename: %d %v", code, body)
	}
	code, body = e.call("PATCH", path, map[string]any{"rotate_secret": true})
	rotated, _ := data(t, body)["secret"].(string)
	if code != 200 || body["message"] != "Secret baru dibuat" || !hex64.MatchString(rotated) || rotated == created["secret"] {
		t.Fatalf("rotate: %d %v", code, body)
	}
	if code, body = e.call("PATCH", "/api/crm/partners/00000000-0000-4000-8000-000000000000", map[string]any{"is_active": false}); code != 404 || body["error"] != "Partner tidak ditemukan" {
		t.Fatalf("missing: %d %v", code, body)
	}
	if code, body = e.call("PATCH", "/api/crm/partners/bad", map[string]any{"is_active": false}); code != 400 || body["error"] != "Format data tidak valid" {
		t.Fatalf("bad id: %d %v", code, body)
	}
}

func TestPartnerEventsAndRematch(t *testing.T) {
	e := setup(t)
	partnerID := crmtest.Scalar[string](t, e.tx, `INSERT INTO crm.crm_integration_partners (code, name, partner_type, awards_xp, xp_per_event, signing_secret)
		VALUES ($1, 'Go Booth', 'photobooth', true, 50, 's') RETURNING id::text`, "GO"+testutil.RandomHex(3))
	tail := fmt.Sprintf("%08d", time.Now().UnixNano()%100_000_000)
	member := crmtest.Scalar[string](t, e.tx, `INSERT INTO pos.pos_customers (phone, name) VALUES ($1, 'Partner Member') RETURNING id::text`, "+62812"+tail)
	event := func(identifier string) string {
		return crmtest.Scalar[string](t, e.tx, `INSERT INTO crm.crm_external_events (partner_id, external_event_id, source_channel, event_type, customer_identifier, processing_status)
			VALUES ($1, $2, 'photobooth', 'photo_session', $3, 'unmatched') RETURNING id::text`, partnerID, testutil.RandomHex(6), identifier)
	}
	manual := event("nobody@example.invalid")
	auto := event("0812" + tail)

	code, body := e.call("GET", "/api/crm/partners/events?partner_id="+partnerID+"&status=unmatched", nil)
	if rows := body["data"].([]any); code != 200 || len(rows) != 2 || rows[0].(map[string]any)["partner_name"] != "Go Booth" {
		t.Fatalf("events: %d %v", code, body)
	}

	code, body = e.call("POST", "/api/crm/partners/events/rematch", map[string]any{"mode": "x"})
	if code != 400 || body["error"] != "Data tidak valid" || body["details"].([]any)[0].(map[string]any)["note"] != "No matching discriminator" {
		t.Fatalf("discriminator: %d %v", code, body)
	}
	code, body = e.call("POST", "/api/crm/partners/events/rematch", map[string]any{"mode": "manual", "event_id": manual, "identifier": "nobody@else.invalid"})
	if code != 404 || body["error"] != "Member dengan telepon/email itu tidak ditemukan (atau lebih dari satu)" {
		t.Fatalf("unknown member: %d %v", code, body)
	}
	code, body = e.call("POST", "/api/crm/partners/events/rematch", map[string]any{"mode": "manual", "event_id": "00000000-0000-4000-8000-000000000000", "identifier": "+62812" + tail})
	if code != 404 || body["error"] != "Event tidak ditemukan" {
		t.Fatalf("unknown event: %d %v", code, body)
	}
	code, body = e.call("POST", "/api/crm/partners/events/rematch", map[string]any{"mode": "manual", "event_id": manual, "identifier": "+62812" + tail})
	d := data(t, body)
	if code != 200 || body["message"] != "Event dicocokkan ke member" || d["status"] != "processed" || d["customer_id"] != member || d["xp_awarded"] != float64(50) {
		t.Fatalf("manual: %d %v", code, body)
	}
	if by := crmtest.Scalar[string](t, e.tx, `SELECT matched_by::text FROM crm.crm_external_events WHERE id = $1`, manual); by != e.staff.UserID {
		t.Fatalf("matched_by %s", by)
	}

	code, body = e.call("POST", "/api/crm/partners/events/rematch", map[string]any{"mode": "auto", "partner_id": partnerID})
	d = data(t, body)
	if code != 200 || d["checked"] != float64(1) || d["matched"] != float64(1) || body["message"] != "1 dari 1 event berhasil dicocokkan" {
		t.Fatalf("auto: %d %v", code, body)
	}
	if n := crmtest.Scalar[int](t, e.tx, `SELECT count(*)::int FROM crm.crm_xp_ledger WHERE customer_id = $1 AND source_type = 'partner_event'`, member); n != 2 {
		t.Fatalf("ledger rows %d", n)
	}
	if id := crmtest.Scalar[*string](t, e.tx, `SELECT xp_ledger_id::text FROM crm.crm_external_events WHERE id = $1`, auto); id == nil {
		t.Fatal("ledger id not linked")
	}
	// Last: the failed read aborts the test transaction.
	if code, body = e.call("GET", "/api/crm/partners/events?partner_id=------------------------------------", nil); code != 400 || body["error"] != "Format data tidak valid" {
		t.Fatalf("loose uuid reaches pg: %d %v", code, body)
	}
}
