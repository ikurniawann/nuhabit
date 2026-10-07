package master_test

import (
	"context"
	"regexp"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/app"
	"nuhabit/backend/internal/modules/configuration/master"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/testutil"
)

type mod []module.Route

func (m mod) Name() string           { return "configuration" }
func (m mod) Routes() []module.Route { return m }

// setup mounts the routes on a rolled-back transaction; create staff first
// so the rollback releases FK locks before their cleanup runs.
func setup(t *testing.T) (func(*testutil.Staff, string, string, any) (int, string, map[string]any), pgx.Tx) {
	deps := testutil.Deps(t, nil)
	tx := testutil.Tx(t)
	mux := testutil.Mux(mod(master.Routes(deps, tx, app.ConfigurationPorts(deps).Master)))
	return func(s *testutil.Staff, method, path string, body any) (int, string, map[string]any) {
		t.Helper()
		r := testutil.Request(method, path, body)
		if s != nil {
			r = testutil.AsStaff(r, *s)
		}
		rec, parsed := testutil.Do(t, mux, r)
		return rec.Code, rec.Body.String(), parsed
	}, tx
}

func check(t *testing.T, label string, code int, raw string, wantCode int, want string) {
	t.Helper()
	if code != wantCode || (want != "" && raw != want) {
		t.Fatalf("%s = %d %s, want %d %s", label, code, raw, wantCode, want)
	}
}

func TestBrandsAndSections(t *testing.T) {
	hr := testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{"hris": nil, "hris.organization": nil}})
	biz := testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{"settings.business": nil}})
	call, _ := setup(t)

	code, raw, _ := call(&biz, "GET", "/api/brands", nil)
	check(t, "brands without hris", code, raw, 403, `{"success":false,"error":"Insufficient permissions"}`)
	code, raw, _ = call(&hr, "POST", "/api/brands", map[string]any{"name": "x"})
	check(t, "create without settings.business", code, raw, 403, "")
	code, raw, _ = call(&biz, "POST", "/api/brands", map[string]any{"name": "  ", "industry": 5})
	check(t, "invalid brand", code, raw, 400, `{"success":false,"error":"Validation failed","details":[{"code":"too_small","path":["name"],"message":"Nama brand wajib diisi"},{"code":"invalid_type","path":["industry"],"message":"Invalid input: expected string, received number"}]}`)

	name := "Go Brand " + testutil.RandomHex(3)
	code, raw, body := call(&biz, "POST", "/api/brands", map[string]any{"name": " " + name + " ", "industry": "", "logo_url": "  "})
	if code != 201 || !regexp.MustCompile(`^\{"data":\{"id":"[0-9a-f-]{36}","name":"`+name+`","industry":"F&B","logo_url":null,"is_active":true,"created_at":"[0-9T:.-]+Z"\}\}$`).MatchString(raw) {
		t.Fatalf("create brand = %d %s", code, raw)
	}
	brand := body["data"].(map[string]any)["id"].(string)

	code, _, body = call(&hr, "GET", "/api/brands?active=true", nil)
	if code != 200 || body["count"] != float64(len(body["data"].([]any))) || !strings.Contains(raw, name) {
		t.Fatalf("list brands = %d %v", code, body)
	}

	code, raw, _ = call(&biz, "PATCH", "/api/brands/nope", map[string]any{})
	check(t, "patch bad id", code, raw, 400, `{"success":false,"error":"ID brand tidak valid"}`)
	code, raw, _ = call(&biz, "PATCH", "/api/brands/00000000-0000-4000-8000-000000000000", map[string]any{"is_active": true})
	check(t, "patch unknown", code, raw, 404, `{"success":false,"error":"Brand tidak ditemukan"}`)
	code, _, body = call(&biz, "PATCH", "/api/brands/"+brand, map[string]any{})
	if code != 200 || body["data"].(map[string]any)["name"] != name {
		t.Fatalf("empty patch = %d %v", code, body)
	}
	code, _, body = call(&biz, "PATCH", "/api/brands/"+brand, map[string]any{"logo_url": nil, "name": " Baru ", "is_active": false, "industry": "Gym"})
	got := body["data"].(map[string]any)
	if code != 200 || got["name"] != "Baru" || got["is_active"] != false || got["industry"] != "Gym" || got["logo_url"] != nil {
		t.Fatalf("patch = %d %v", code, body)
	}

	// Sections
	code, raw, _ = call(&biz, "GET", "/api/sections", nil)
	check(t, "sections without readers", code, raw, 403, "")
	code, raw, _ = call(&hr, "GET", "/api/sections?brand_id=nope", nil)
	check(t, "sections bad brand", code, raw, 400, `{"success":false,"error":"Brand tidak valid"}`)
	code, raw, _ = call(&hr, "POST", "/api/sections", map[string]any{"brand_id": "x", "name": "", "code": " "})
	check(t, "invalid section", code, raw, 400, `{"success":false,"error":"Validation failed","details":[{"code":"invalid_format","path":["brand_id"],"message":"Brand tidak valid"},{"code":"too_small","path":["name"],"message":"Nama wajib diisi"},{"code":"too_small","path":["code"],"message":"Kode wajib diisi"}]}`)
	code, raw, body = call(&hr, "POST", "/api/sections", map[string]any{"brand_id": brand, "name": " Bar ", "code": "BAR", "description": "", "color": ""})
	if code != 201 || !regexp.MustCompile(`^\{"data":\{"id":"[0-9a-f-]{36}","brand_id":"`+brand+`","name":"Bar","code":"BAR","description":null,"color":"#6B7280","is_active":true,"created_at":"[0-9T:.-]+Z"\}\}$`).MatchString(raw) {
		t.Fatalf("create section = %d %s", code, raw)
	}
	section := body["data"].(map[string]any)["id"].(string)
	code, raw, _ = call(&hr, "GET", "/api/sections?brand_id="+brand, nil)
	if code != 200 || !regexp.MustCompile(`^\{"data":\[\{"id":"`+section+`",.*"brands":\{"name":"Baru"\}\}\],"count":1\}$`).MatchString(raw) {
		t.Fatalf("list sections = %d %s", code, raw)
	}
}

func TestAudit(t *testing.T) {
	auditor := testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{"settings.audit": nil}, FullName: "Go Auditor"})
	other := testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{"settings.users": nil}})
	call, tx := setup(t)

	code, raw, _ := call(nil, "GET", "/api/audit", nil)
	check(t, "anonymous", code, raw, 401, `{"success":false,"error":"Authentication required"}`)
	code, raw, _ = call(&other, "GET", "/api/audit", nil)
	check(t, "no grant", code, raw, 403, `{"success":false,"error":"Insufficient permissions"}`)
	for _, q := range []string{"?limit=101", "?page=0", "?page=1.5", "?actor_id=x", "?date_from=2026-1-1"} {
		code, raw, _ = call(&auditor, "GET", "/api/audit"+q, nil)
		check(t, q, code, raw, 400, `{"success":false,"message":"Filter tidak valid"}`)
	}

	entityID := "go-test-" + testutil.RandomHex(4)
	for i, label := range []string{"Pertama", "Kedua", "Ketiga"} {
		if _, err := tx.Exec(context.Background(), `INSERT INTO audit.audit_log (actor_id, action, entity, entity_id, entity_label, after, reason, created_at)
			VALUES ($1, 'update', 'go_test', $2, $3, '{"b": 1, "a": [1.50, "x"]}', 'uji', '2026-10-01 10:00:00+07'::timestamptz + make_interval(mins => $4))`,
			auditor.UserID, entityID, label, i); err != nil {
			t.Fatal(err)
		}
	}
	code, raw, body := call(&auditor, "GET", "/api/audit?entity=go_test&action=all&entity_id="+entityID+"&search=&limit=2&page=1&date_from=2026-10-01&date_to=2026-10-01", nil)
	if code != 200 || !regexp.MustCompile(`^\{"success":true,"data":\[\{"id":"[0-9a-f-]{36}","created_at":"2026-10-01 10:02:00\+07","actor_id":"`+auditor.UserID+`","actor_name":"Go Auditor","action":"update","entity":"go_test","entity_id":"`+entityID+`","entity_label":"Ketiga","before":null,"after":\{"a":\[1.5,"x"\],"b":1\},"reason":"uji","ip":null\},`).MatchString(raw) ||
		!strings.HasSuffix(raw, `"meta":{"page":1,"limit":2,"total":3,"totalPages":2}}`) {
		t.Fatalf("audit page = %d %s", code, raw)
	}
	if len(body["data"].([]any)) != 2 {
		t.Fatalf("limit ignored: %s", raw)
	}
	code, raw, _ = call(&auditor, "GET", "/api/audit?entity_id="+entityID+"&search=kedua&page=1", nil)
	if code != 200 || !strings.Contains(raw, `"entity_label":"Kedua"`) || !strings.HasSuffix(raw, `"meta":{"page":1,"limit":30,"total":1,"totalPages":1}}`) {
		t.Fatalf("audit search = %d %s", code, raw)
	}
	code, raw, _ = call(&auditor, "GET", "/api/audit?entity_id="+entityID+"&date_from=2026-10-02", nil)
	if code != 200 || !strings.Contains(raw, `"data":[],"actors":[`) || !strings.HasSuffix(raw, `"total":0,"totalPages":0}}`) {
		t.Fatalf("audit date filter = %d %s", code, raw)
	}
	// A date the regex accepts but PostgreSQL rejects is the route's 500.
	code, raw, _ = call(&auditor, "GET", "/api/audit?date_from=2026-13-45", nil)
	check(t, "bad date", code, raw, 500, `{"success":false,"message":"Gagal memuat jejak audit"}`)
}
