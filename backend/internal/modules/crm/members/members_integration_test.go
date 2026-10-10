package members

import (
	"net/http"
	"testing"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/crm/internal/crmtest"
	"nuhabit/backend/internal/modules/crm/xp"
	"nuhabit/backend/internal/platform/testutil"
)

type fixture struct {
	t     *testing.T
	tx    pgx.Tx
	mux   http.Handler
	pos   testutil.Staff
	crm   testutil.Staff
	plain testutil.Staff
	wa    *fakeMessenger
}

func setup(t *testing.T) *fixture {
	t.Helper()
	// Staff first: cleanups run in reverse, so the rolled-back transaction
	// releases its locks before the staff rows are deleted.
	f := &fixture{
		t:     t,
		pos:   crmtest.Staff(t, "pos"),
		crm:   crmtest.Staff(t, "crm.members", "crm.loyalty"),
		plain: crmtest.Staff(t, "hris"),
	}
	f.tx = testutil.Tx(t)
	f.wa = &fakeMessenger{}
	d := testutil.Deps(t, nil)
	engine := &xp.Engine{Now: d.Now, Log: d.Log}
	f.mux = crmtest.Mux(newHandler(f.tx, d, engine, Ports{Orders: OrdersSQL{}, Wallet: WalletSQL{}, WhatsApp: f.wa}).routes())
	return f
}

func (f *fixture) call(method, path string, body any, s *testutil.Staff) (int, map[string]any) {
	f.t.Helper()
	return crmtest.Call(f.t, f.mux, method, path, body, s)
}

func (f *fixture) customer(name string) string {
	f.t.Helper()
	return crmtest.Scalar[string](f.t, f.tx, `INSERT INTO pos.pos_customers (phone, name, email, total_xp, membership_tier)
		VALUES ('0899' || lpad((random() * 1e8)::int::text, 8, '0'), $1, 'old@example.com', 120, 'silver') RETURNING id::text`, name)
}

func expect(t *testing.T, status int, body map[string]any, wantStatus int, wantError string) {
	t.Helper()
	if status != wantStatus {
		t.Fatalf("status %d, want %d: %v", status, wantStatus, body)
	}
	if wantError != "" && body["error"] != wantError {
		t.Fatalf("error %v, want %q", body["error"], wantError)
	}
}

func data(t *testing.T, body map[string]any) map[string]any {
	t.Helper()
	d, ok := body["data"].(map[string]any)
	if !ok {
		t.Fatalf("data is not an object: %v", body)
	}
	return d
}

func TestMembersAuth(t *testing.T) {
	f := setup(t)
	for _, c := range []struct{ method, path string }{
		{"GET", "/api/crm/members"}, {"POST", "/api/crm/members"},
		{"GET", "/api/crm/members/x"}, {"PATCH", "/api/crm/members/x"},
	} {
		status, body := f.call(c.method, c.path, map[string]any{}, nil)
		expect(t, status, body, 401, "Authentication required")
		status, body = f.call(c.method, c.path, map[string]any{}, &f.plain)
		expect(t, status, body, 401, "Authentication required")
	}
	for _, c := range []struct{ method, path string }{
		{"GET", "/api/crm/members/x/activity?tab=checkins"}, {"GET", "/api/crm/members/x/consent"},
		{"PUT", "/api/crm/members/x/consent"}, {"GET", "/api/crm/members/x/badges"}, {"POST", "/api/crm/members/x/badges"},
	} {
		status, body := f.call(c.method, c.path, map[string]any{}, nil)
		expect(t, status, body, 401, "")
		status, body = f.call(c.method, c.path, map[string]any{}, &f.plain)
		expect(t, status, body, 403, "")
	}
}

func TestEnrollListAndDetail(t *testing.T) {
	f := setup(t)
	name := "GoMember" + testutil.RandomHex(4)
	customerID := f.customer(name)

	status, body := f.call("POST", "/api/crm/members", map[string]any{}, &f.pos)
	expect(t, status, body, 400, "Validation failed")
	status, body = f.call("POST", "/api/crm/members", map[string]any{"customer_id": "550e8400-e29b-41d4-a716-446655440000"}, &f.pos)
	expect(t, status, body, 404, "Customer tidak ditemukan")

	// Synthetic list member before enrolment.
	status, body = f.call("GET", "/api/crm/members?search="+name, nil, &f.pos)
	expect(t, status, body, 200, "")
	list := body["data"].([]any)
	if len(list) != 1 || list[0].(map[string]any)["id"] != "pos-"+customerID || list[0].(map[string]any)["source"] != "pos_customers" {
		t.Fatalf("synthetic list %v", body)
	}

	status, body = f.call("POST", "/api/crm/members", map[string]any{"customer_id": customerID, "metadata": map[string]any{"via": "go", "n": 1.50}}, &f.pos)
	expect(t, status, body, 200, "")
	m := data(t, body)
	if m["source"] != "crm_member_profiles" || m["tier"] != nil || m["lifetime_xp"] != 120.0 || m["customer_id"] != customerID {
		t.Fatalf("enrolled %v", m)
	}
	if meta := m["metadata"].(map[string]any); meta["n"] != 1.5 {
		t.Fatalf("metadata %v", meta)
	}
	profileID := m["id"].(string)
	if tier := crmtest.Scalar[string](t, f.tx, `SELECT t.code FROM crm.crm_member_profiles p JOIN crm.crm_membership_tiers t ON t.id = p.tier_id WHERE p.id = $1`, profileID); tier != "silver" {
		t.Fatalf("tier %s", tier)
	}

	status, body = f.call("GET", "/api/crm/members?search="+name, nil, &f.pos)
	expect(t, status, body, 200, "")
	list = body["data"].([]any)
	got := list[0].(map[string]any)
	if len(list) != 1 || got["id"] != profileID || got["tier"].(map[string]any)["code"] != "silver" || body["meta"].(map[string]any)["schemaReady"] != true {
		t.Fatalf("list %v", body)
	}
	if got["customer"].(map[string]any)["name"] != name {
		t.Fatalf("list customer %v", got)
	}

	status, body = f.call("GET", "/api/crm/members/"+profileID, nil, &f.pos)
	expect(t, status, body, 200, "")
	d := data(t, body)
	member := d["member"].(map[string]any)
	if member["id"] != profileID || member["customer"].(map[string]any)["is_kol"] != false || len(d["xpLedger"].([]any)) != 0 || len(d["recentOrders"].([]any)) != 0 {
		t.Fatalf("detail %v", d)
	}
	if _, ok := member["tier"].(map[string]any)["min_total_spend"]; !ok {
		t.Fatalf("detail tier %v", member["tier"])
	}

	// A PostgreSQL error aborts the test transaction, so it goes last.
	status, body = f.call("GET", "/api/crm/members?limit=abc", nil, &f.pos)
	expect(t, status, body, 400, "Format data tidak valid")
}

func TestDetailSyntheticAndPatch(t *testing.T) {
	f := setup(t)
	customerID := f.customer("Go Synthetic")

	status, body := f.call("GET", "/api/crm/members/pos-"+customerID, nil, &f.pos)
	expect(t, status, body, 200, "")
	member := data(t, body)["member"].(map[string]any)
	if member["id"] != "pos-"+customerID || member["status"] != "active" || member["joined_at"] != nil {
		t.Fatalf("synthetic detail %v", member)
	}
	status, body = f.call("GET", "/api/crm/members/550e8400-e29b-41d4-a716-446655440000", nil, &f.pos)
	expect(t, status, body, 404, "Member tidak ditemukan")

	status, body = f.call("PATCH", "/api/crm/members/pos-"+customerID, map[string]any{"customer": map[string]any{"email": "bad"}}, &f.pos)
	expect(t, status, body, 400, "Validation failed")
	issue := body["details"].([]any)[0].(map[string]any)
	if issue["message"] != "Invalid email address" {
		t.Fatalf("email issue %v", issue)
	}

	// Name only: an absent email keeps the stored one.
	status, body = f.call("PATCH", "/api/crm/members/pos-"+customerID, map[string]any{"customer": map[string]any{"name": " Renamed "}}, &f.pos)
	expect(t, status, body, 200, "")
	member = data(t, body)["member"].(map[string]any)
	if member["customer"].(map[string]any)["name"] != "Renamed" || member["customer"].(map[string]any)["email"] != "old@example.com" {
		t.Fatalf("patched %v", member)
	}

	// An explicit null clears it (the edit form sends null for an empty field).
	status, body = f.call("PATCH", "/api/crm/members/pos-"+customerID, map[string]any{"customer": map[string]any{"email": nil}}, &f.pos)
	expect(t, status, body, 200, "")
	if email := data(t, body)["member"].(map[string]any)["customer"].(map[string]any)["email"]; email != "" {
		t.Fatalf("cleared email %v", email)
	}

	status, body = f.call("POST", "/api/crm/members", map[string]any{"customer_id": customerID}, &f.pos)
	expect(t, status, body, 200, "")
	profileID := data(t, body)["id"].(string)
	gold := crmtest.Scalar[string](t, f.tx, `SELECT id::text FROM crm.crm_membership_tiers WHERE code = 'gold'`)
	status, body = f.call("PATCH", "/api/crm/members/"+profileID, map[string]any{"member": map[string]any{"tier_id": gold, "status": "suspended"}}, &f.pos)
	expect(t, status, body, 200, "")
	member = data(t, body)["member"].(map[string]any)
	if member["status"] != "suspended" || member["tier"].(map[string]any)["code"] != "gold" {
		t.Fatalf("member patch %v", member)
	}
	if _, ok := data(t, body)["xpLedger"]; ok {
		t.Fatal("profile patch returns only the member")
	}
	if tier := crmtest.Scalar[string](t, f.tx, `SELECT membership_tier FROM pos.pos_customers WHERE id = $1`, customerID); tier != "gold" {
		t.Fatalf("membership_tier %s", tier)
	}

	// A PostgreSQL error aborts the test transaction, so it goes last.
	status, body = f.call("GET", "/api/crm/members/pos-garbage", nil, &f.pos)
	expect(t, status, body, 400, "Format data tidak valid")
}

func TestActivityConsentAndBadges(t *testing.T) {
	f := setup(t)
	customerID := f.customer("Go Activity")
	base := "/api/crm/members/pos-" + customerID

	status, body := f.call("GET", base+"/activity?tab=nope", nil, &f.crm)
	expect(t, status, body, 400, "Tab tidak dikenal")
	for _, tab := range []string{"checkins", "bookings", "challenges", "notifications", "wallet"} {
		status, body = f.call("GET", base+"/activity?tab="+tab, nil, &f.crm)
		expect(t, status, body, 200, "")
		if rows, ok := body["data"].([]any); !ok || len(rows) != 0 {
			t.Fatalf("%s: %v", tab, body)
		}
	}
	status, body = f.call("GET", "/api/crm/members/nope/activity?tab=wallet", nil, &f.crm)
	expect(t, status, body, 404, "Member tidak ditemukan")

	status, body = f.call("GET", base+"/consent", nil, &f.crm)
	expect(t, status, body, 200, "")
	if c := data(t, body); c["wa_consent"] != false || c["marketing_opt_out"] != false {
		t.Fatalf("consent %v", c)
	}
	status, body = f.call("PUT", base+"/consent", map[string]any{"note": 5}, &f.crm)
	expect(t, status, body, 400, "Data tidak valid")
	status, body = f.call("PUT", base+"/consent", map[string]any{"wa_consent": true, "marketing_opt_out": true}, &f.crm)
	expect(t, status, body, 200, "")
	if c := data(t, body); c["wa_consent"] != true || c["marketing_opt_out"] != true || c["optout_note"] != "Dari detail member" || body["message"] != "Persetujuan disimpan" {
		t.Fatalf("consent put %v", body)
	}
	status, body = f.call("PUT", base+"/consent", map[string]any{"marketing_opt_out": false}, &f.crm)
	expect(t, status, body, 200, "")
	if data(t, body)["marketing_opt_out"] != false {
		t.Fatalf("opt back in %v", body)
	}

	badgeID := crmtest.Scalar[string](t, f.tx, `INSERT INTO crm.crm_badges (code, name, min_lifetime_xp, metric, bonus_xp)
		VALUES ($1, 'Go Badge', 0, 'manual', 50) RETURNING id::text`, "go_"+testutil.RandomHex(4))
	status, body = f.call("POST", base+"/badges", map[string]any{"badge_id": "x", "action": "award"}, &f.crm)
	expect(t, status, body, 400, "Data tidak valid")
	status, body = f.call("POST", base+"/badges", map[string]any{"badge_id": badgeID, "action": "award"}, &f.crm)
	expect(t, status, body, 200, "")
	if data(t, body)["awarded"] != true || body["message"] != "Badge diberikan" {
		t.Fatalf("award %v", body)
	}
	if xpTotal := crmtest.Scalar[int](t, f.tx, `SELECT total_xp FROM pos.pos_customers WHERE id = $1`, customerID); xpTotal != 170 {
		t.Fatalf("bonus XP not posted: total_xp %d", xpTotal)
	}
	status, body = f.call("POST", base+"/badges", map[string]any{"badge_id": badgeID, "action": "award"}, &f.crm)
	expect(t, status, body, 200, "")
	if data(t, body)["awarded"] != false || body["message"] != "Member sudah memiliki badge ini" {
		t.Fatalf("award again %v", body)
	}
	status, body = f.call("POST", base+"/badges", map[string]any{"badge_id": badgeID, "action": "revoke", "reason": " spam "}, &f.crm)
	expect(t, status, body, 200, "")
	if data(t, body)["revoked"] != true || body["message"] != "Badge dicabut" {
		t.Fatalf("revoke %v", body)
	}
	status, body = f.call("GET", base+"/badges", nil, &f.crm)
	expect(t, status, body, 200, "")
	for _, item := range body["data"].([]any) {
		row := item.(map[string]any)
		if row["id"] == badgeID && row["revoke_reason"] != "spam" {
			t.Fatalf("badge row %v", row)
		}
	}
}
