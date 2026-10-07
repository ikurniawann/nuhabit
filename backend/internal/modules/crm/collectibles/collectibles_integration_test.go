package collectibles

import (
	"net/http"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/crm/internal/crmtest"
	"nuhabit/backend/internal/platform/testutil"
)

type fixture struct {
	t        *testing.T
	tx       pgx.Tx
	mux      http.Handler
	settings testutil.Staff
	reports  testutil.Staff
	pos      testutil.Staff
	plain    testutil.Staff
}

func setup(t *testing.T) *fixture {
	t.Helper()
	// Staff first: cleanups run in reverse, so the rolled-back transaction
	// releases its locks before the staff rows are deleted.
	f := &fixture{
		t:        t,
		settings: crmtest.Staff(t, "crm.settings"),
		reports:  crmtest.Staff(t, "crm.reports"),
		pos:      crmtest.Staff(t, "pos"),
		plain:    crmtest.Staff(t, "hris"),
	}
	f.tx = testutil.Tx(t)
	f.mux = crmtest.Mux(newHandler(f.tx, testutil.Deps(t, nil)).routes())
	return f
}

func (f *fixture) call(method, path string, body any, s *testutil.Staff) (int, map[string]any) {
	f.t.Helper()
	return crmtest.Call(f.t, f.mux, method, path, body, s)
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

func TestCollectiblesAuth(t *testing.T) {
	f := setup(t)
	for _, c := range []struct{ method, path string }{
		{"GET", "/api/crm/badges"}, {"POST", "/api/crm/badges"}, {"DELETE", "/api/crm/badges"},
		{"GET", "/api/crm/wallpapers"}, {"POST", "/api/crm/wallpapers"}, {"DELETE", "/api/crm/wallpapers"},
		{"POST", "/api/crm/avatars"}, {"DELETE", "/api/crm/avatars"}, {"GET", "/api/crm/collectibles/idle-report"},
	} {
		status, body := f.call(c.method, c.path, map[string]any{}, nil)
		expect(t, status, body, 401, "")
		status, body = f.call(c.method, c.path, map[string]any{}, &f.plain)
		expect(t, status, body, 403, "")
	}
	for _, c := range []struct{ method, path string }{
		{"GET", "/api/crm/avatars"}, {"GET", "/api/crm/avatar-inventory"},
		{"POST", "/api/crm/avatar-inventory"}, {"PATCH", "/api/crm/avatar-inventory"},
	} {
		status, body := f.call(c.method, c.path, map[string]any{}, &f.plain)
		expect(t, status, body, 401, "Authentication required")
	}
}

func TestBadgesAndWallpapers(t *testing.T) {
	f := setup(t)
	code := "go_" + testutil.RandomHex(4)

	status, body := f.call("POST", "/api/crm/badges", map[string]any{}, &f.settings)
	expect(t, status, body, 400, "Data tidak valid")
	// The refine still runs after a length check fails (zod v4 continuable issues).
	status, body = f.call("POST", "/api/crm/badges", map[string]any{"code": "a", "name": "Go Badge", "metric": "visits"}, &f.settings)
	expect(t, status, body, 400, "Ambang wajib diisi untuk metrik ini")

	status, body = f.call("POST", "/api/crm/badges", map[string]any{"code": code, "name": "Go Badge", "metric": "visits", "threshold": 5, "min_lifetime_xp": 900}, &f.settings)
	expect(t, status, body, 200, "")
	badge := data(t, body)
	if badge["threshold"] != "5.00" || badge["min_lifetime_xp"] != 0.0 || badge["bonus_xp"] != 0.0 || badge["is_active"] != true {
		t.Fatalf("badge %v", badge)
	}
	id := badge["id"].(string)
	status, body = f.call("POST", "/api/crm/badges", map[string]any{"id": id, "code": code, "name": "Go Badge 2", "min_lifetime_xp": 100}, &f.settings)
	expect(t, status, body, 200, "")
	if b := data(t, body); b["name"] != "Go Badge 2" || b["threshold"] != nil || b["min_lifetime_xp"] != 100.0 {
		t.Fatalf("badge update %v", b)
	}
	status, body = f.call("POST", "/api/crm/badges", map[string]any{"id": "550e8400-e29b-41d4-a716-446655440000", "code": code, "name": "Nope"}, &f.settings)
	expect(t, status, body, 404, "Badge tidak ditemukan")

	status, body = f.call("GET", "/api/crm/badges", nil, &f.settings)
	expect(t, status, body, 200, "")
	found := false
	for _, item := range body["data"].([]any) {
		if row := item.(map[string]any); row["id"] == id {
			found = row["awarded_count"] == 0.0
		}
	}
	if !found {
		t.Fatal("badge missing from list")
	}

	status, body = f.call("DELETE", "/api/crm/badges?id=x", nil, &f.settings)
	expect(t, status, body, 400, "ID tidak valid")
	customerID := crmtest.Scalar[string](t, f.tx, `INSERT INTO pos.pos_customers (phone, name) VALUES ('0899' || lpad((random() * 1e8)::int::text, 8, '0'), 'Go') RETURNING id::text`)
	crmtest.MustExec(t, f.tx, `INSERT INTO crm.crm_member_badges (customer_id, badge_id) VALUES ($1, $2)`, customerID, id)
	status, body = f.call("DELETE", "/api/crm/badges?id="+id, nil, &f.settings)
	expect(t, status, body, 200, "")
	if body["message"] != "Sudah diraih member — dinonaktifkan, bukan dihapus" {
		t.Fatalf("owned delete %v", body)
	}

	tier := crmtest.Scalar[string](t, f.tx, `SELECT id::text FROM crm.crm_membership_tiers WHERE code = 'gold'`)
	status, body = f.call("POST", "/api/crm/wallpapers", map[string]any{"code": code, "name": "Go Wall", "image_url": "/w.png", "required_tier_id": tier, "starts_at": "2026-10-01T00:00:00Z"}, &f.settings)
	expect(t, status, body, 200, "")
	wallID := data(t, body)["id"].(string)
	status, body = f.call("GET", "/api/crm/wallpapers", nil, &f.settings)
	expect(t, status, body, 200, "")
	if row := body["data"].([]any)[0].(map[string]any); row["id"] != wallID || row["required_tier_name"] != "Gold" {
		t.Fatalf("wallpapers %v", row)
	}
	status, body = f.call("DELETE", "/api/crm/wallpapers?id="+wallID, nil, &f.settings)
	expect(t, status, body, 200, "")
	if _, ok := body["message"]; ok {
		t.Fatalf("plain delete %v", body)
	}

	status, body = f.call("GET", "/api/crm/collectibles/idle-report", nil, &f.reports)
	expect(t, status, body, 200, "")
	if r := data(t, body); r["interval_xp"] == nil || r["members"] == nil || r["active_artworks"] == nil {
		t.Fatalf("idle report %v", r)
	}
}

func TestAvatarsAndInventory(t *testing.T) {
	f := setup(t)
	code := "GO_" + testutil.RandomHex(4)

	status, body := f.call("POST", "/api/crm/avatars", map[string]any{"code": code, "name": "Go", "image_url": "nope"}, &f.settings)
	expect(t, status, body, 400, "Validation failed")
	status, body = f.call("POST", "/api/crm/avatars", map[string]any{"code": " " + code + " ", "name": "Go", "image_url": "https://x.test/a.png", "rarity": "epic", "stock_total": 5}, &f.settings)
	expect(t, status, body, 200, "")
	avatar := data(t, body)
	if avatar["code"] != lower(code) || avatar["stock_total"] != 5.0 || avatar["metadata"] == nil {
		t.Fatalf("avatar %v", avatar)
	}
	avatarID := avatar["id"].(string)
	status, body = f.call("POST", "/api/crm/avatars", map[string]any{"code": code, "name": "Go 2", "image_url": "https://x.test/a.png", "rarity": "epic", "stock_total": 5}, &f.settings)
	expect(t, status, body, 200, "")
	if data(t, body)["id"] != avatarID || data(t, body)["name"] != "Go 2" {
		t.Fatalf("upsert %v", body)
	}
	status, body = f.call("GET", "/api/crm/avatars?rarity=epic", nil, &f.pos)
	expect(t, status, body, 200, "")
	if body["meta"].(map[string]any)["schemaReady"] != true || len(body["data"].([]any)) == 0 {
		t.Fatalf("avatars %v", body)
	}

	customerID := crmtest.Scalar[string](t, f.tx, `INSERT INTO pos.pos_customers (phone, name, total_xp) VALUES ('0899' || lpad((random() * 1e8)::int::text, 8, '0'), 'Go', 100) RETURNING id::text`)
	memberID := crmtest.Scalar[string](t, f.tx, `INSERT INTO crm.crm_member_profiles (customer_id, tier_id)
		SELECT $1, id FROM crm.crm_membership_tiers WHERE code = 'regular' RETURNING id::text`, customerID)

	status, body = f.call("GET", "/api/crm/avatar-inventory", nil, &f.pos)
	expect(t, status, body, 400, "member_id atau customer_id wajib diisi")
	status, body = f.call("GET", "/api/crm/avatar-inventory?customer_id="+customerID, nil, &f.pos)
	expect(t, status, body, 200, "")
	if len(body["data"].([]any)) != 0 {
		t.Fatalf("empty inventory %v", body)
	}

	status, body = f.call("POST", "/api/crm/avatar-inventory", map[string]any{"action": "redeem"}, &f.pos)
	expect(t, status, body, 410, "Redeem avatar dengan XP sudah dipensiunkan — gunakan grant admin (EPIC-011)")
	status, body = f.call("POST", "/api/crm/avatar-inventory", map[string]any{"action": "grant"}, &f.pos)
	expect(t, status, body, 400, "Validation failed")
	status, body = f.call("POST", "/api/crm/avatar-inventory", map[string]any{"action": "grant", "member_id": "550e8400-e29b-41d4-a716-446655440000", "avatar_id": avatarID}, &f.pos)
	expect(t, status, body, 409, "Member CRM belum aktif. Aktifkan member terlebih dahulu.")

	status, body = f.call("POST", "/api/crm/avatar-inventory", map[string]any{"action": "grant", "member_id": memberID, "avatar_id": avatarID, "note": "hi"}, &f.pos)
	expect(t, status, body, 200, "")
	inv := data(t, body)
	if inv["is_equipped"] != true || inv["acquisition_source"] != "manual" || inv["metadata"].(map[string]any)["note"] != "hi" {
		t.Fatalf("inventory %v", inv)
	}
	if active := crmtest.Scalar[string](t, f.tx, `SELECT active_avatar_id::text FROM crm.crm_member_profiles WHERE id = $1`, memberID); active != avatarID {
		t.Fatalf("active avatar %s", active)
	}
	if redeemed := crmtest.Scalar[int](t, f.tx, `SELECT stock_redeemed FROM crm.crm_collectible_avatars WHERE id = $1`, avatarID); redeemed != 1 {
		t.Fatalf("stock_redeemed %d", redeemed)
	}
	status, body = f.call("POST", "/api/crm/avatar-inventory", map[string]any{"action": "grant", "member_id": memberID, "avatar_id": avatarID}, &f.pos)
	expect(t, status, body, 409, "Member sudah memiliki avatar ini")

	locked := crmtest.Scalar[string](t, f.tx, `INSERT INTO crm.crm_collectible_avatars (code, name, image_url, min_lifetime_xp)
		VALUES ($1, 'Locked', 'https://x.test/b.png', 1600) RETURNING id::text`, "go_locked_"+testutil.RandomHex(3))
	status, body = f.call("POST", "/api/crm/avatar-inventory", map[string]any{"action": "grant", "member_id": memberID, "avatar_id": locked}, &f.pos)
	expect(t, status, body, 403, "Member belum memenuhi syarat: Kurang 1.500 XP lagi")

	status, body = f.call("PATCH", "/api/crm/avatar-inventory", map[string]any{"member_id": memberID}, &f.pos)
	expect(t, status, body, 400, "Validation failed")
	if issue := body["details"].([]any)[0].(map[string]any); issue["message"] != "inventory_id atau avatar_id wajib diisi" {
		t.Fatalf("refine issue %v", issue)
	}
	status, body = f.call("PATCH", "/api/crm/avatar-inventory", map[string]any{"member_id": memberID, "avatar_id": locked}, &f.pos)
	expect(t, status, body, 404, "Avatar belum dimiliki member")
	status, body = f.call("PATCH", "/api/crm/avatar-inventory", map[string]any{"member_id": memberID, "inventory_id": inv["id"]}, &f.pos)
	expect(t, status, body, 200, "")
	if owned := data(t, body); owned["avatar_id"] != avatarID || len(owned) != 3 {
		t.Fatalf("equip %v", owned)
	}

	status, body = f.call("GET", "/api/crm/avatar-inventory?member_id="+memberID, nil, &f.pos)
	expect(t, status, body, 200, "")
	rows := body["data"].([]any)
	if len(rows) != 1 || rows[0].(map[string]any)["avatar"].(map[string]any)["code"] != lower(code) {
		t.Fatalf("inventory list %v", body)
	}

	status, body = f.call("DELETE", "/api/crm/avatars", nil, &f.settings)
	expect(t, status, body, 400, "Avatar id wajib diisi")
	status, body = f.call("DELETE", "/api/crm/avatars?id="+locked, nil, &f.settings)
	expect(t, status, body, 200, "")
	// A PostgreSQL error aborts the test transaction, so it goes last.
	status, body = f.call("DELETE", "/api/crm/avatars?id=nope", nil, &f.settings)
	expect(t, status, body, 400, "Format data tidak valid")
}

func lower(s string) string { return strings.ToLower(s) }
