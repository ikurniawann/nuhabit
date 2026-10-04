package lookup

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"nuhabit/backend/internal/modules/possales/lookup/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/testutil"
)

// fixture mounts the routes on a rolled-back transaction with a pinned clock.
type fixture struct {
	t   *testing.T
	tx  database.DB
	mux *http.ServeMux
}

type testModule struct{ h *Handler }

func (testModule) Name() string             { return "pos-sales" }
func (m testModule) Routes() []module.Route { return m.h.Routes() }

// 2026-10-04 10:00 WIB.
var pinned = time.Date(2026, 10, 4, 3, 0, 0, 0, time.UTC)

func newFixture(t *testing.T, p Ports) *fixture {
	t.Helper()
	deps := testutil.Deps(t, func() time.Time { return pinned })
	tx := testutil.Tx(t)
	f := &fixture{t: t, tx: tx}
	f.mux = testutil.Mux(testModule{newHandler(deps, tx, p)})
	return f
}

func (f *fixture) do(r *http.Request, staff *testutil.Staff) (int, string) {
	f.t.Helper()
	if staff != nil {
		testutil.AsStaff(r, *staff)
	}
	rec, _ := testutil.Do(f.t, f.mux, r)
	return rec.Code, rec.Body.String()
}

func (f *fixture) exec(sql string, args ...any) {
	f.t.Helper()
	if _, err := f.tx.Exec(context.Background(), sql, args...); err != nil {
		f.t.Fatalf("exec %s: %v", sql, err)
	}
}

func (f *fixture) scalar(sql string, args ...any) string {
	f.t.Helper()
	var v *string
	if err := f.tx.QueryRow(context.Background(), sql, args...).Scan(&v); err != nil {
		f.t.Fatalf("scalar %s: %v", sql, err)
	}
	if v == nil {
		return "<nil>"
	}
	return *v
}

func expect(t *testing.T, gotStatus int, gotBody string, status int, body string) {
	t.Helper()
	if gotStatus != status || gotBody != body {
		t.Fatalf("got %d %s\nwant %d %s", gotStatus, gotBody, status, body)
	}
}

func posStaff(t *testing.T, menu string) *testutil.Staff {
	s := testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{menu: nil}})
	return &s
}

// ── GET /api/pos/pass-lookup ───────────────────────────────────────────────

func TestPassLookup(t *testing.T) {
	// Accounts first: their cleanup must run after the fixture rolls back.
	cashier := posStaff(t, "pos.operations")
	outsider := posStaff(t, "gym.packages")
	f := newFixture(t, Ports{})
	get := func(code string) *http.Request {
		return testutil.Request("GET", "/api/pos/pass-lookup?code="+code, nil)
	}

	// Fixtures: one season-pass product with a 12.5% member discount.
	sfx := strings.ToUpper(testutil.RandomHex(4))
	var productID string
	if err := f.tx.QueryRow(context.Background(), `INSERT INTO ticketing.ticket_products (company_id, branch_id, code, name, product_kind)
		SELECT company_id, id, $1, 'Pass Tahunan Go', 'season_pass' FROM configuration.branches ORDER BY created_at LIMIT 1
		RETURNING id::text`, "GO-"+sfx).Scan(&productID); err != nil {
		t.Fatalf("product: %v", err)
	}
	f.exec(`INSERT INTO ticketing.ticket_pass_configs (company_id, branch_id, ticket_product_id, member_discount_percent)
		SELECT company_id, branch_id, id, 12.50 FROM ticketing.ticket_products WHERE id = $1`, productID)
	token := strings.Repeat("ab", 28) + testutil.RandomHex(4)
	pass := func(code, token, status string, from, until, band any) {
		f.exec(`INSERT INTO ticketing.ticket_season_passes
			(company_id, branch_id, ticket_product_id, pass_code, access_token, holder_name, status, valid_from, valid_until, band_uid)
			SELECT company_id, branch_id, id, $2, $3, 'Ana', $4, $5::date, $6::date, $7 FROM ticketing.ticket_products WHERE id = $1`,
			productID, code, token, status, from, until, band)
	}
	pass("SP-GO-A"+sfx, token, "active", "2026-01-01", "2026-12-31", "04A1B2"+sfx)
	pass("SP-GO-B"+sfx, testutil.RandomHex(32), "suspended", nil, nil, nil)
	pass("SP-GO-C"+sfx, testutil.RandomHex(32), "active", "2026-10-05", nil, nil)
	pass("SP-GO-D"+sfx, testutil.RandomHex(32), "active", nil, nil, nil)

	t.Run("guards", func(t *testing.T) {
		code, body := f.do(get("SP-1"), nil)
		expect(t, code, body, 401, `{"success":false,"error":"Authentication required"}`)
		code, body = f.do(get("SP-1"), outsider)
		expect(t, code, body, 401, `{"success":false,"error":"Authentication required"}`)
		code, body = f.do(get("%20"), cashier)
		expect(t, code, body, 400, `{"success":false,"error":"Kode pass kosong"}`)
		code, body = f.do(testutil.Request("GET", "/api/pos/pass-lookup", nil), cashier)
		expect(t, code, body, 400, `{"success":false,"error":"Kode pass kosong"}`)
	})

	found := `{"success":true,"data":{"found":true,"pass_code":"SP-GO-A` + sfx +
		`","holder_name":"Ana","product_name":"Pass Tahunan Go","discount_percent":12.5,"valid_until":"2026-12-31"}}`
	cases := []struct{ name, code, body string }{
		{"pass code, any case", "+sp-go-a" + strings.ToLower(sfx) + "+", found},
		{"QR access token, upper case", strings.ToUpper(token), found},
		{"wristband UID with separators", "04:a1:b2:" + strings.ToLower(sfx), found},
		{"unknown", "SP-NOPE-" + sfx, `{"success":true,"data":{"found":false,"reason":"Pass tidak ditemukan"}}`},
		{"not active", "SP-GO-B" + sfx, `{"success":true,"data":{"found":false,"reason":"Pass suspended","pass_code":"SP-GO-B` + sfx + `"}}`},
		{"not yet valid", "SP-GO-C" + sfx, `{"success":true,"data":{"found":false,"reason":"Pass di luar masa berlaku","pass_code":"SP-GO-C` + sfx + `"}}`},
		{"open-ended", "SP-GO-D" + sfx, `{"success":true,"data":{"found":true,"pass_code":"SP-GO-D` + sfx +
			`","holder_name":"Ana","product_name":"Pass Tahunan Go","discount_percent":12.5,"valid_until":null}}`},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			code, body := f.do(get(c.code), cashier)
			expect(t, code, body, 200, c.body)
		})
	}

	t.Run("lookup failure", func(t *testing.T) {
		broken := newFixture(t, Ports{Passes: failingPasses{}})
		code, body := broken.do(get("SP-1"), cashier)
		expect(t, code, body, 500, `{"success":false,"error":"Gagal memeriksa pass"}`)
	})
}

type failingPasses struct{}

func (failingPasses) FindSeasonPass(context.Context, database.Querier, domain.PassKey) (*domain.SeasonPass, error) {
	return nil, errors.New("boom")
}

// ── POST /api/pos/member-qr ────────────────────────────────────────────────

type fakeGym struct {
	res        *GymCheckInResult
	err        error
	customerID string
	scannedBy  string
}

func (g *fakeGym) CheckInAtPos(_ context.Context, _ database.DB, customerID, scannedBy string) (*GymCheckInResult, error) {
	g.customerID, g.scannedBy = customerID, scannedBy
	return g.res, g.err
}

func TestMemberQr(t *testing.T) {
	noBooking := "no_booking"
	gym := &fakeGym{res: &GymCheckInResult{Decision: "denied", Reason: &noBooking, Message: "Tidak ada booking kelas"}}
	cashier := posStaff(t, "pos.operations")
	reportsOnly := posStaff(t, "pos.reports")
	member := testutil.CreateMember(t)
	f := newFixture(t, Ports{Gym: gym})
	post := func(body any) *http.Request { return testutil.Request("POST", "/api/pos/member-qr", body) }
	issue := func(expires string, consumed bool) string {
		token := "nhqr_go" + testutil.RandomHex(8)
		f.exec(`INSERT INTO crm.member_qr_tokens (token, customer_id, expires_at, consumed_at)
			VALUES ($1, $2, $3::timestamptz, CASE WHEN $4 THEN now() END)`, token, member.CustomerID, expires, consumed)
		return token
	}
	checkins := func() string {
		return f.scalar(`SELECT string_agg(decision || ':' || coalesce(reason, '-') || ':' || coalesce(customer_id::text, '-'), ',' ORDER BY decision, reason)
			FROM crm.member_checkins WHERE scanned_by = $1`, cashier.UserID)
	}

	t.Run("guards and validation", func(t *testing.T) {
		code, body := f.do(post(map[string]any{"token": "token-123456"}), nil)
		expect(t, code, body, 401, `{"success":false,"error":"Authentication required"}`)
		code, body = f.do(post(map[string]any{"token": "token-123456"}), reportsOnly)
		expect(t, code, body, 403, `{"success":false,"error":"Insufficient permissions"}`)
		code, body = f.do(post(map[string]any{"token": " x "}), cashier)
		expect(t, code, body, 400, `{"success":false,"error":"QR tidak valid","details":[{"code":"too_small","path":["token"],"message":"Too small: expected string to have >=8 characters"}]}`)
		code, body = f.do(post("not json"), cashier)
		expect(t, code, body, 400, `{"success":false,"error":"QR tidak valid","details":[{"code":"invalid_type","path":["token"],"message":"Invalid input: expected string, received undefined"}]}`)
	})

	t.Run("refused QR is logged and answered with its label", func(t *testing.T) {
		expired := issue("2026-10-04T02:59:00Z", false)
		consumed := issue("2026-10-04T03:01:00Z", true)
		for token, want := range map[string]string{
			"nhqr_unknown-" + testutil.RandomHex(4): "QR tidak dikenal",
			expired:                                 "QR kedaluwarsa, minta member membuka ulang kartunya",
			consumed:                                "QR sudah dipakai",
		} {
			code, body := f.do(post(map[string]any{"token": token}), cashier)
			expect(t, code, body, 409, `{"success":false,"error":"`+want+`"}`)
		}
		got := checkins()
		for _, want := range []string{"denied:not_found:-", "denied:expired:" + member.CustomerID, "denied:consumed:" + member.CustomerID} {
			if !strings.Contains(got, want) {
				t.Errorf("checkins %q lack %q", got, want)
			}
		}
		if gym.customerID != "" {
			t.Error("a refused QR must not reach the gym check-in")
		}
	})

	t.Run("accepted QR returns the customer and the gym decision", func(t *testing.T) {
		token := issue("2026-10-04T03:01:00Z", false)
		f.exec(`UPDATE pos.pos_customers SET name = 'Ana' WHERE id = $1`, member.CustomerID)
		code, body := f.do(post(map[string]any{"token": "  " + strings.ToUpper(token) + " "}), cashier)
		expect(t, code, body, 200, `{"success":true,"data":{"customer_id":"`+member.CustomerID+`","name":"Ana","phone":"`+member.Phone+
			`","gym":{"decision":"denied","reason":"no_booking","entryKind":null,"message":"Tidak ada booking kelas","customerId":null,"memberName":null,"booking":null,"creditsDeducted":0,"balanceAfter":null}}}`)
		if gym.customerID != member.CustomerID || gym.scannedBy != cashier.UserID {
			t.Errorf("gym check-in got %q by %q", gym.customerID, gym.scannedBy)
		}
		if got := f.scalar(`SELECT (consumed_at IS NOT NULL)::text FROM crm.member_qr_tokens WHERE token = $1`, token); got != "true" {
			t.Error("token not consumed")
		}
		if got := checkins(); strings.Count(got, "accepted:-:"+member.CustomerID) != 1 {
			t.Errorf("checkins %q", got)
		}
		if got := f.scalar(`SELECT type || '|' || title || '|' || body FROM crm.member_notifications WHERE customer_id = $1`, member.CustomerID); got !=
			"visit_recorded|Kunjungan tercatat|Terima kasih sudah mampir, Ana. Kunjungan Min, 4 Okt, 10.00 sudah tercatat." {
			t.Errorf("notification %q", got)
		}
		code, body = f.do(post(map[string]any{"token": token}), cashier)
		expect(t, code, body, 409, `{"success":false,"error":"QR sudah dipakai"}`)
	})

	t.Run("gym check-in failure leaves gym null", func(t *testing.T) {
		gym.err = errors.New("boom")
		defer func() { gym.err = nil }()
		code, body := f.do(post(map[string]any{"token": issue("2026-10-04T03:01:00Z", false)}), cashier)
		expect(t, code, body, 200, `{"success":true,"data":{"customer_id":"`+member.CustomerID+`","name":"Ana","phone":"`+member.Phone+`","gym":null}}`)
	})
}
