package promo

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/storedvalue/kit"
	"nuhabit/backend/internal/modules/storedvalue/promo/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/testutil"
)

// Integration tests against TEST_DATABASE_URL. Every write runs inside one
// transaction that is rolled back (the handlers share it as their DB); the
// staff fixture comes from testutil. The POS catalog and member history
// ports are in-memory fakes.

type fakeDir struct {
	kit.Directory
	venue kit.Venue
}

func (d fakeDir) UserScope(context.Context, database.Querier, string) (*kit.UserScope, error) {
	return nil, nil
}

func (d fakeDir) DefaultVenue(context.Context, database.Querier) kit.Venue { return d.venue }

type fakeCatalog struct {
	products   []CatalogProduct
	categories []CatalogCategory
}

func (c *fakeCatalog) Active(context.Context, database.Querier) (Catalog, error) {
	return Catalog{Products: c.products, Categories: c.categories}, nil
}

func (c *fakeCatalog) ProductCategories(_ context.Context, _ database.Querier, ids []string) (map[string]*string, error) {
	out := map[string]*string{}
	for _, p := range c.products {
		if slices.Contains(ids, p.ID) {
			out[p.ID] = p.CategoryID
		}
	}
	return out, nil
}

func (c *fakeCatalog) CategoryProducts(_ context.Context, _ database.Querier, ids []string) (map[string][]string, error) {
	out := map[string][]string{}
	for _, p := range c.products {
		if p.CategoryID != nil && slices.Contains(ids, *p.CategoryID) {
			out[*p.CategoryID] = append(out[*p.CategoryID], p.ID)
		}
	}
	return out, nil
}

func (c *fakeCatalog) Names(_ context.Context, _ database.Querier, productIDs, categoryIDs []string) (map[string]string, map[string]string, error) {
	products, categories := map[string]string{}, map[string]string{}
	for _, p := range c.products {
		if slices.Contains(productIDs, p.ID) {
			products[p.ID] = p.Name
		}
	}
	for _, cat := range c.categories {
		if slices.Contains(categoryIDs, cat.ID) {
			categories[cat.ID] = cat.Name
		}
	}
	return products, categories, nil
}

type fakeMembers map[string]domain.MemberContext

func (m fakeMembers) PromoContext(_ context.Context, _ database.Querier, id string) (*domain.MemberContext, error) {
	if c, ok := m[id]; ok {
		return &c, nil
	}
	return nil, nil
}

const (
	latteID   = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1"
	cakeID    = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2"
	teaID     = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3"
	coffeeCat = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1"
	memberID  = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1"
)

type env struct {
	t       *testing.T
	ctx     context.Context
	tx      pgx.Tx
	mux     *http.ServeMux
	svc     *Service
	dir     *fakeDir
	staff   testutil.Staff
	company string
	branch  string
}

func setup(t *testing.T) *env {
	t.Helper()
	deps := testutil.Deps(t, nil)
	staff := testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{"crm.promo": nil}})
	tx := testutil.Tx(t)
	e := &env{t: t, ctx: context.Background(), tx: tx, staff: staff}
	e.scalar(`INSERT INTO configuration.branches (company_id, name, code)
		SELECT id, 'Go promo test', 'GOPROMO-' || $1 FROM configuration.companies ORDER BY created_at LIMIT 1
		RETURNING company_id::text || ' ' || id::text`, []any{&e.company}, testutil.RandomHex(4))
	e.company, e.branch, _ = strings.Cut(e.company, " ")
	e.dir = &fakeDir{venue: kit.Venue{CompanyID: &e.company, BranchID: &e.branch}}
	cat := coffeeCat
	catalog := &fakeCatalog{
		products: []CatalogProduct{
			{ID: latteID, Name: "Latte", Price: "40000.00", CategoryID: &cat},
			{ID: cakeID, Name: "Cake", Price: "30000.00"},
			{ID: teaID, Name: "Tea", Price: "25000.00", CategoryID: &cat},
		},
		categories: []CatalogCategory{{ID: coffeeCat, Name: "Kopi"}},
	}
	members := fakeMembers{memberID: {PriorPaidOrders: 0, JoinedDaysAgo: 3}}
	e.svc = NewService(tx, Ports{Catalog: catalog, Members: members}, deps.Now, deps.Log)
	k := &kit.Kit{Auth: deps.Auth, Log: deps.Log, Now: deps.Now, DB: tx, Dir: e.dir}
	e.mux = http.NewServeMux()
	for _, r := range Routes(k, e.svc) {
		e.mux.Handle(r.Pattern, r.Handler)
	}
	return e
}

func (e *env) scalar(sql string, dst []any, args ...any) {
	e.t.Helper()
	if err := e.tx.QueryRow(e.ctx, sql, args...).Scan(dst...); err != nil {
		e.t.Fatalf("query %q: %v", sql, err)
	}
}

func (e *env) exec(sql string, args ...any) {
	e.t.Helper()
	if _, err := e.tx.Exec(e.ctx, sql, args...); err != nil {
		e.t.Fatalf("exec %q: %v", sql, err)
	}
}

// call serves a staff request and checks the status; it returns the raw
// body.
func (e *env) call(method, path string, body any, status int) string {
	e.t.Helper()
	r := testutil.AsStaff(testutil.Request(method, path, body), e.staff)
	// A failing statement aborts the shared transaction; in production each
	// request has its own, so every call runs in a savepoint.
	e.exec(`SAVEPOINT call`)
	rec, _ := testutil.Do(e.t, e.mux, r)
	if rec.Code >= 400 {
		e.exec(`ROLLBACK TO SAVEPOINT call`)
	}
	e.exec(`RELEASE SAVEPOINT call`)
	if rec.Code != status {
		e.t.Fatalf("%s %s: status %d want %d: %s", method, path, rec.Code, status, rec.Body.String())
	}
	return rec.Body.String()
}

func (e *env) expect(method, path string, body any, status int, want string) {
	e.t.Helper()
	if got := e.call(method, path, body, status); got != want {
		e.t.Fatalf("%s %s:\n got %s\nwant %s", method, path, got, want)
	}
}

// dataID returns data.id of a success body.
func dataID(t *testing.T, raw string) string {
	t.Helper()
	var b struct {
		Data struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal([]byte(raw), &b); err != nil || b.Data.ID == "" {
		t.Fatalf("no data.id in %s", raw)
	}
	return b.Data.ID
}

func (e *env) createdAt(table, id string) string {
	var at time.Time
	e.scalar(`SELECT created_at FROM `+table+` WHERE id = $1`, []any{&at}, id)
	return at.UTC().Format(httpx.JSTimeLayout)
}

func TestGuardsAndMalformedBody(t *testing.T) {
	e := setup(t)
	rec, _ := testutil.Do(t, e.mux, testutil.Request("GET", "/api/promo/campaigns", nil))
	if rec.Code != 401 || rec.Body.String() != `{"success":false,"error":"Authentication required"}` {
		t.Fatalf("anon: %d %s", rec.Code, rec.Body.String())
	}
	e.dir.venue = kit.Venue{}
	e.expect("GET", "/api/promo/campaigns", nil, 400, `{"success":false,"error":"`+kit.VenueNotConfigured+`"}`)
	e.dir.venue = kit.Venue{CompanyID: &e.company, BranchID: &e.branch}
	e.expect("POST", "/api/promo/campaigns", "{not json", 500, `{"success":false,"error":"Terjadi kesalahan server"}`)
	e.expect("GET", "/api/promo/campaigns", nil, 200, `{"success":true,"data":[]}`)
}

func TestCampaignCreateListPatch(t *testing.T) {
	e := setup(t)
	e.expect("POST", "/api/promo/campaigns", map[string]any{"name": "Promo", "discount_type": "percent", "value": 150}, 400,
		`{"success":false,"error":"Validation failed","details":[{"code":"custom","path":["value"],"message":"Diskon persen maksimal 100"}]}`)
	e.expect("POST", "/api/promo/campaigns", map[string]any{"name": "P", "discount_type": "x", "value": 150, "valid_from": "2026-02-30"}, 400,
		`{"success":false,"error":"Validation failed","details":[`+
			`{"code":"too_small","path":["name"],"message":"Too small: expected string to have >=2 characters"},`+
			`{"code":"invalid_value","path":["discount_type"],"message":"Invalid option: expected one of \"percent\"|\"fixed\""},`+
			`{"code":"custom","path":["valid_from"],"message":"Tanggal tidak valid"}]}`)

	raw := e.call("POST", "/api/promo/campaigns", map[string]any{
		"name": "  Merdeka  ", "discount_type": "fixed", "value": 25000, "max_discount": 5000,
		"valid_from": "2026-08-01", "valid_until": "2026-08-31", "scope": "pos",
		"target_product_ids": []string{latteID}, "eligibility": "member_baru", "new_member_days": 30,
		"public_code": " merdeka45 ",
	}, 200)
	id := dataID(t, raw)
	if raw != `{"success":true,"data":{"id":"`+id+`"},"message":"Campaign promo dibuat"}` {
		t.Fatalf("create body %s", raw)
	}
	e.expect("POST", "/api/promo/campaigns", map[string]any{"name": "Dup", "discount_type": "percent", "value": 10, "public_code": "MERDEKA45"}, 409,
		`{"success":false,"error":"Kode sudah dipakai campaign lain — pilih kode lain"}`)

	want := `{"success":true,"data":[{"id":"` + id + `","name":"Merdeka","description":null,"discount_type":"fixed",` +
		`"value":"25000.00","max_discount":null,"min_purchase":"0.00","valid_from":"2026-08-01","valid_until":"2026-08-31",` +
		`"usage_limit":null,"per_phone_limit":1,"scope":"pos","is_active":true,"show_in_member_portal":false,` +
		`"target_product_ids":["` + latteID + `"],"target_category_ids":[],"eligibility":"member_baru","new_member_days":30,` +
		`"created_at":"` + e.createdAt("promo.promo_campaigns", id) + `","codes_count":"1","held_count":"0","captured_count":"0","discount_captured":"0"}]}`
	e.expect("GET", "/api/promo/campaigns", nil, 200, want)

	path := "/api/promo/campaigns/" + id
	e.expect("PATCH", "/api/promo/campaigns/c1", map[string]any{"name": "Baru"}, 400, `{"success":false,"error":"Format data tidak valid"}`)
	e.expect("PATCH", "/api/promo/campaigns/"+memberID, map[string]any{"name": "Baru"}, 404, `{"success":false,"error":"Campaign tidak ditemukan"}`)
	e.expect("PATCH", path, map[string]any{"value": -1}, 400,
		`{"success":false,"error":"Validation failed","details":[{"code":"too_small","path":["value"],"message":"Too small: expected number to be >0"}]}`)
	e.expect("PATCH", path, map[string]any{"discount_type": "percent", "value": 120}, 400, `{"success":false,"error":"Diskon persen maksimal 100"}`)
	e.expect("PATCH", path, map[string]any{"valid_until": "2026-07-01"}, 400, `{"success":false,"error":"Tanggal akhir sebelum tanggal mulai"}`)
	e.expect("PATCH", path, map[string]any{"discount_type": "percent", "value": 20, "max_discount": 7000, "eligibility": "member"}, 200,
		`{"success":true,"data":{"id":"`+id+`"},"message":"Campaign diperbarui"}`)
	var value, maxDiscount, eligibility string
	var days *int
	e.scalar(`SELECT value::text, max_discount::text, eligibility, new_member_days FROM promo.promo_campaigns WHERE id = $1`,
		[]any{&value, &maxDiscount, &eligibility, &days}, id)
	if value != "20.00" || maxDiscount != "7000.00" || eligibility != "member" || days != nil {
		t.Fatalf("after patch: %s %s %s %v", value, maxDiscount, eligibility, days)
	}

	// Once a voucher is captured only the toggles may change.
	var codeID string
	e.scalar(`SELECT id FROM promo.promo_codes WHERE campaign_id = $1`, []any{&codeID}, id)
	e.exec(`INSERT INTO promo.promo_redemptions (company_id, branch_id, code_id, campaign_id, campaign_name, discount_type, value,
		context_type, context_id, discount_amount, status) VALUES ($1,$2,$3,$4,'Merdeka','percent',20,'pos_order',gen_random_uuid(),5000,'captured')`,
		e.company, e.branch, codeID, id)
	e.expect("PATCH", path, map[string]any{"value": 30}, 409,
		`{"success":false,"error":"Campaign sudah punya voucher terpakai — hanya status aktif yang boleh diubah"}`)
	e.expect("PATCH", path, map[string]any{"is_active": false}, 200, `{"success":true,"data":{"id":"`+id+`"},"message":"Campaign diperbarui"}`)

	var redemptionID, contextID string
	e.scalar(`SELECT id, context_id FROM promo.promo_redemptions WHERE campaign_id = $1`, []any{&redemptionID, &contextID}, id)
	e.expect("GET", path+"/redemptions", nil, 200, `{"success":true,"data":[{"id":"`+redemptionID+`","code":"MERDEKA45",`+
		`"context_type":"pos_order","context_id":"`+contextID+`","phone":null,"discount_amount":"5000.00","status":"captured",`+
		`"created_at":"`+e.createdAt("promo.promo_redemptions", redemptionID)+`"}]}`)
	e.expect("GET", "/api/promo/campaigns/"+memberID+"/redemptions", nil, 404, `{"success":false,"error":"Campaign tidak ditemukan"}`)
}

func (e *env) campaign(body map[string]any) string {
	e.t.Helper()
	base := map[string]any{"name": "Kampanye", "discount_type": "percent", "value": 10, "scope": "pos", "per_phone_limit": nil}
	for k, v := range body {
		base[k] = v
	}
	return dataID(e.t, e.call("POST", "/api/promo/campaigns", base, 200))
}

func TestCodes(t *testing.T) {
	e := setup(t)
	id := e.campaign(nil)
	codes := "/api/promo/campaigns/" + id + "/codes"

	e.expect("POST", codes, map[string]any{"mode": "x"}, 400, `{"success":false,"error":"Validation failed","details":[`+
		`{"code":"invalid_union","path":["mode"],"message":"Invalid discriminator value. Expected 'single' | 'batch'"}]}`)
	e.expect("POST", codes, map[string]any{"mode": "single", "code": "a b"}, 400, `{"success":false,"error":"Validation failed","details":[`+
		`{"code":"invalid_format","path":["code"],"message":"Kode: huruf/angka/strip, 3-40 karakter"}]}`)

	raw := e.call("POST", codes, map[string]any{"mode": "single", "code": "publik"}, 200)
	single := dataID(t, raw)
	if raw != `{"success":true,"data":{"id":"`+single+`","code":"PUBLIK","usage_limit":null,"usage_count":0,"is_active":true,`+
		`"created_at":"`+e.createdAt("promo.promo_codes", single)+`"},"message":"Kode ditambahkan"}` {
		t.Fatalf("single: %s", raw)
	}
	// Rows of one transaction share now(); age the public code so the sync
	// below removes vouchers first, as it would in production.
	e.exec(`UPDATE promo.promo_codes SET created_at = now() - interval '1 hour' WHERE id = $1`, single)
	e.expect("POST", codes, map[string]any{"mode": "single", "code": "PUBLIK"}, 409, `{"success":false,"error":"Kode sudah dipakai — pilih kode lain"}`)

	var batch struct {
		Data struct {
			Count int      `json:"count"`
			Codes []string `json:"codes"`
		} `json:"data"`
		Message string `json:"message"`
	}
	_ = json.Unmarshal([]byte(e.call("POST", codes, map[string]any{"mode": "batch", "prefix": "tix", "count": 3}, 200)), &batch)
	if batch.Data.Count != 3 || len(batch.Data.Codes) != 3 || batch.Message != "3 voucher dibuat" || !strings.HasPrefix(batch.Data.Codes[0], "TIX-") {
		t.Fatalf("batch: %+v", batch)
	}

	var list struct {
		Data []codeRow `json:"data"`
	}
	_ = json.Unmarshal([]byte(e.call("GET", codes, nil, 200)), &list)
	if len(list.Data) != 4 {
		t.Fatalf("list: %+v", list.Data)
	}

	e.expect("PATCH", codes, map[string]any{"target_count": 4}, 200, `{"success":true,"data":{"count":4,"added":0,"removed":0},"message":"Jumlah voucher tidak berubah"}`)
	e.expect("PATCH", codes, map[string]any{"target_count": 2}, 200, `{"success":true,"data":{"count":2,"added":0,"removed":2},"message":"2 voucher dihapus"}`)
	e.expect("PATCH", codes, map[string]any{"target_count": 5}, 200, `{"success":true,"data":{"count":5,"added":3,"removed":0},"message":"3 voucher ditambah"}`)
	var withPrefix int
	e.scalar(`SELECT COUNT(*)::int FROM promo.promo_codes WHERE campaign_id = $1 AND code LIKE 'TIX-%'`, []any{&withPrefix}, id)
	if withPrefix != 4 {
		t.Fatalf("TIX codes %d", withPrefix)
	}

	other := e.campaign(nil)
	e.expect("PATCH", "/api/promo/campaigns/"+other+"/codes", map[string]any{"target_count": 1}, 400,
		`{"success":false,"error":"Prefix tidak tersedia — pastikan kanal campaign valid atau isi prefix"}`)

	code := "/api/promo/codes/" + single
	e.expect("PATCH", code, map[string]any{}, 400, `{"success":false,"error":"Tidak ada field yang diubah"}`)
	e.expect("PATCH", "/api/promo/codes/"+memberID, map[string]any{"is_active": false}, 404, `{"success":false,"error":"Kode tidak ditemukan"}`)
	e.expect("PATCH", code, map[string]any{"code": "baru-1", "usage_limit": nil}, 200, `{"success":true,"data":{"id":"`+single+`"},"message":"Kode diperbarui"}`)
	var taken string
	e.scalar(`SELECT code FROM promo.promo_codes WHERE campaign_id = $1 AND id <> $2 LIMIT 1`, []any{&taken}, id, single)
	e.expect("PATCH", code, map[string]any{"code": taken}, 409, `{"success":false,"error":"Kode sudah dipakai — pilih kode lain"}`)

	e.exec(`UPDATE promo.promo_codes SET usage_count = 1 WHERE id = $1`, single)
	e.expect("PATCH", code, map[string]any{"usage_limit": 5}, 409, `{"success":false,"error":"Voucher sudah terpakai — hanya status aktif yang boleh diubah"}`)
	e.expect("PATCH", code, map[string]any{"is_active": false}, 200, `{"success":true,"data":{"id":"`+single+`"},"message":"Kode diperbarui"}`)
	e.expect("DELETE", code, nil, 409, `{"success":false,"error":"Voucher sudah terpakai — tidak bisa dihapus"}`)
	e.expect("PATCH", codes, map[string]any{"target_count": 1}, 409, `{"success":false,"error":"Sudah ada voucher terpakai — jumlah tidak bisa diubah"}`)

	e.exec(`UPDATE promo.promo_codes SET usage_count = 0 WHERE id = $1`, single)
	e.expect("DELETE", code, nil, 200, `{"success":true,"data":{"id":"`+single+`"},"message":"Kode dihapus"}`)
	e.expect("DELETE", code, nil, 404, `{"success":false,"error":"Kode tidak ditemukan"}`)
}

func TestCatalog(t *testing.T) {
	e := setup(t)
	e.expect("GET", "/api/promo/catalog", nil, 200, `{"success":true,"data":{"products":[`+
		`{"id":"`+latteID+`","name":"Latte","price":"40000.00","category_id":"`+coffeeCat+`"},`+
		`{"id":"`+cakeID+`","name":"Cake","price":"30000.00","category_id":null},`+
		`{"id":"`+teaID+`","name":"Tea","price":"25000.00","category_id":"`+coffeeCat+`"}],`+
		`"categories":[{"id":"`+coffeeCat+`","name":"Kopi"}]}}`)
}

func TestOfferRules(t *testing.T) {
	e := setup(t)
	e.expect("GET", "/api/promo/offers", nil, 400, `{"success":false,"error":"Query type=bundle|bxgy|volume wajib"}`)
	e.expect("GET", "/api/promo/offers?type=bundle", nil, 200, `{"success":true,"data":[]}`)
	e.expect("POST", "/api/promo/offers", map[string]any{"offer_type": "bundle", "name": "Paket", "bundle_price": 50000,
		"items": []any{map[string]any{"role": "component", "product_id": latteID, "qty": 1}}}, 400,
		`{"success":false,"error":"Bundling minimal 2 produk komponen"}`)
	e.expect("POST", "/api/promo/offers", map[string]any{"offer_type": "bundle", "name": "", "items": []any{map[string]any{"role": "x"}}}, 400,
		`{"success":false,"error":"Validation failed","details":[`+
			`{"code":"too_small","path":["name"],"message":"Too small: expected string to have >=1 characters"},`+
			`{"code":"invalid_value","path":["items",0,"role"],"message":"Invalid option: expected one of \"component\"|\"buy\"|\"get\"|\"eligible\""}]}`)

	raw := e.call("POST", "/api/promo/offers", map[string]any{
		"offer_type": "bundle", "name": " Latte + Cake ", "description": "  ", "valid_from": "2026-01-01",
		"bundle_price": 55000, "priority": 3, "unlock_code": " paket-1 ", "sales_channels": []string{},
		"items": []any{
			map[string]any{"role": "component", "product_id": latteID, "qty": 1},
			map[string]any{"role": "component", "product_id": cakeID, "qty": 2, "sort_order": 5},
		},
	}, 201)
	id := dataID(t, raw)
	var itemIDs []string
	rows, _ := e.tx.Query(e.ctx, `SELECT id::text FROM promo.offer_rule_items WHERE rule_id = $1 ORDER BY sort_order`, id)
	itemIDs, _ = pgx.CollectRows(rows, pgx.RowTo[string])
	var updatedAt time.Time
	e.scalar(`SELECT updated_at FROM promo.offer_rules WHERE id = $1`, []any{&updatedAt}, id)
	detail := func(name, updated string) string {
		return `{"id":"` + id + `","company_id":"` + e.company + `","branch_id":"` + e.branch + `","offer_type":"bundle",` +
			`"name":"` + name + `","description":null,"valid_from":"2026-01-01","valid_until":null,"is_active":true,` +
			`"bundle_price":"55000.00","buy_qty":null,"get_qty":null,"get_mode":null,"volume_basis":null,"volume_min":null,` +
			`"discount_type":null,"discount_value":null,"sales_channels":null,"max_uses":null,"max_uses_per_member":null,` +
			`"is_exclusive":false,"priority":3,"unlock_code":"PAKET-1","used_count":0,"member_used_count":0,` +
			`"created_at":"` + e.createdAt("promo.offer_rules", id) + `","updated_at":"` + updated + `","items":[` +
			`{"id":"` + itemIDs[0] + `","rule_id":"` + id + `","role":"component","product_id":"` + latteID + `","category_id":null,` +
			`"qty":"1.000","sort_order":0,"product_name":"Latte","category_name":null},` +
			`{"id":"` + itemIDs[1] + `","rule_id":"` + id + `","role":"component","product_id":"` + cakeID + `","category_id":null,` +
			`"qty":"2.000","sort_order":5,"product_name":"Cake","category_name":null}]}`
	}
	if want := `{"success":true,"data":` + detail("Latte + Cake", updatedAt.UTC().Format(httpx.JSTimeLayout)) + `,"message":"Aturan promo dibuat"}`; raw != want {
		t.Fatalf("create:\n got %s\nwant %s", raw, want)
	}
	e.expect("GET", "/api/promo/offers/"+id, nil, 200, `{"success":true,"data":`+detail("Latte + Cake", updatedAt.UTC().Format(httpx.JSTimeLayout))+`}`)
	e.expect("GET", "/api/promo/offers?type=bundle", nil, 200, `{"success":true,"data":[`+detail("Latte + Cake", updatedAt.UTC().Format(httpx.JSTimeLayout))+`]}`)
	e.expect("GET", "/api/promo/offers?type=volume", nil, 200, `{"success":true,"data":[]}`)
	e.expect("GET", "/api/promo/offers/"+memberID, nil, 404, `{"success":false,"error":"Aturan tidak ditemukan"}`)

	e.expect("POST", "/api/promo/offers", map[string]any{"offer_type": "volume", "name": "Vol", "volume_basis": "qty", "volume_min": 2,
		"discount_type": "percent", "discount_value": 10, "unlock_code": "PAKET-1"}, 400,
		`{"success":false,"error":"Kode pembuka sudah dipakai penawaran lain — pilih kode lain"}`)

	// PATCH keeps the stored type; items default to [] like the TS.
	raw = e.call("PATCH", "/api/promo/offers/"+id, map[string]any{"offer_type": "volume", "name": "Paket Baru", "bundle_price": 55000,
		"priority": 3, "valid_from": "2026-01-01", "unlock_code": "paket-1",
		"items": []any{
			map[string]any{"role": "component", "product_id": latteID, "qty": 1},
			map[string]any{"role": "component", "product_id": cakeID, "qty": 2, "sort_order": 5},
		}}, 200)
	var patched struct {
		Data    OfferRuleDetail `json:"data"`
		Message string          `json:"message"`
	}
	_ = json.Unmarshal([]byte(raw), &patched)
	if patched.Data.OfferType != "bundle" || patched.Data.Name != "Paket Baru" || len(patched.Data.Items) != 2 || patched.Message != "Aturan promo diperbarui" {
		t.Fatalf("patch: %s", raw)
	}
	e.expect("PATCH", "/api/promo/offers/"+id, map[string]any{"name": "Paket"}, 400, `{"success":false,"error":"Bundling minimal 2 produk komponen"}`)
	e.expect("PATCH", "/api/promo/offers/"+memberID, map[string]any{"name": "Paket"}, 404, `{"success":false,"error":"Aturan tidak ditemukan"}`)

	rec, _ := testutil.Do(t, e.mux, testutil.AsStaff(testutil.Request("DELETE", "/api/promo/offers/"+id, nil), e.staff))
	if rec.Code != 204 || rec.Body.Len() != 0 {
		t.Fatalf("delete: %d %q", rec.Code, rec.Body.String())
	}
	e.expect("DELETE", "/api/promo/offers/"+id, nil, 404, `{"success":false,"error":"Aturan tidak ditemukan"}`)
}

func TestPromoCodeLifecycle(t *testing.T) {
	e := setup(t)
	id := e.campaign(map[string]any{"usage_limit": 1, "public_code": "HEMAT10"})
	scope := VenueScope{CompanyID: e.company, BranchID: e.branch}

	preview, err := e.svc.PreviewPromoCode(e.ctx, e.tx, PreviewInput{Scope: scope, Code: "nope", Channel: "pos", Subtotal: 100_000})
	if err != nil || preview.OK || preview.Reason != domain.RejectInactive || preview.Message != "Kode promo tidak dikenal atau sudah tidak berlaku" {
		t.Fatalf("unknown code: %+v %v", preview, err)
	}
	preview, err = e.svc.PreviewPromoCode(e.ctx, e.tx, PreviewInput{Scope: scope, Code: " hemat10 ", Channel: "pos", Subtotal: 100_000})
	if err != nil || preview != (PromoPreview{OK: true, Discount: 10_000, CampaignName: "Kampanye", DiscountType: "percent"}) {
		t.Fatalf("preview: %+v %v", preview, err)
	}

	order := memberID
	hold, err := e.svc.HoldPromoRedemption(e.ctx, e.tx, HoldInput{Scope: scope, Code: "HEMAT10", Channel: "pos",
		ContextType: ContextPosOrder, ContextID: order, Subtotal: 100_000})
	if err != nil || hold.Discount != 10_000 || hold.CampaignName != "Kampanye" || hold.RedemptionID == "" {
		t.Fatalf("hold: %+v %v", hold, err)
	}
	_, err = e.svc.HoldPromoRedemption(e.ctx, e.tx, HoldInput{Scope: scope, Code: "HEMAT10", Channel: "pos",
		ContextType: ContextPosOrder, ContextID: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1", Subtotal: 100_000})
	var rejected *PromoRejectedError
	if !errors.As(err, &rejected) || rejected.Reason != domain.RejectQuotaUsed || rejected.Error() != "Kuota kode promo sudah habis" || rejected.StatusCode() != 422 {
		t.Fatalf("second hold: %v", err)
	}

	usage := func() (n int) {
		e.scalar(`SELECT usage_count FROM promo.promo_codes WHERE campaign_id = $1`, []any{&n}, id)
		return n
	}
	if usage() != 1 {
		t.Fatalf("usage after hold %d", usage())
	}
	for i, want := range []bool{true, false} {
		if got, err := e.svc.CapturePromoRedemption(e.ctx, e.tx, ContextPosOrder, order); err != nil || got != want {
			t.Fatalf("capture %d: %v %v", i, got, err)
		}
	}
	for i, want := range []bool{true, false} {
		if got, err := e.svc.ReleasePromoRedemption(e.ctx, e.tx, ContextPosOrder, order); err != nil || got != want {
			t.Fatalf("release %d: %v %v", i, got, err)
		}
	}
	if usage() != 0 {
		t.Fatalf("usage after release %d", usage())
	}
}

func TestPromoTargetsAndEligibility(t *testing.T) {
	e := setup(t)
	e.campaign(map[string]any{"value": 50, "public_code": "KOPI50", "target_category_ids": []string{coffeeCat}})
	e.campaign(map[string]any{"public_code": "BARU", "eligibility": "member_baru", "new_member_days": 2})
	scope := VenueScope{CompanyID: e.company, BranchID: e.branch}
	lines := []LineInput{{ProductID: latteID, Amount: 40_000}, {ProductID: cakeID, Amount: 30_000}}

	p, err := e.svc.PreviewPromoCode(e.ctx, e.tx, PreviewInput{Scope: scope, Code: "KOPI50", Channel: "pos", Subtotal: 70_000, Lines: lines})
	if err != nil || !p.OK || p.Discount != 20_000 {
		t.Fatalf("targeted: %+v %v", p, err)
	}
	p, _ = e.svc.PreviewPromoCode(e.ctx, e.tx, PreviewInput{Scope: scope, Code: "KOPI50", Channel: "pos", Subtotal: 70_000, Lines: lines[1:]})
	if p.Reason != domain.RejectProductMismatch {
		t.Fatalf("no coffee: %+v", p)
	}
	p, _ = e.svc.PreviewPromoCode(e.ctx, e.tx, PreviewInput{Scope: scope, Code: "BARU", Channel: "pos", Subtotal: 70_000})
	if p.Reason != domain.RejectMembersOnly {
		t.Fatalf("no member: %+v", p)
	}
	member := memberID
	p, _ = e.svc.PreviewPromoCode(e.ctx, e.tx, PreviewInput{Scope: scope, Code: "BARU", Channel: "pos", Subtotal: 70_000, CustomerID: &member})
	if p.Reason != domain.RejectNotNewMember {
		t.Fatalf("member joined 3 days ago: %+v", p)
	}
}

func (e *env) offer(body map[string]any) string {
	e.t.Helper()
	return dataID(e.t, e.call("POST", "/api/promo/offers", body, 201))
}

func TestOfferCheckout(t *testing.T) {
	e := setup(t)
	vol := e.offer(map[string]any{"offer_type": "volume", "name": "Kopi 10%", "volume_basis": "qty", "volume_min": 1,
		"discount_type": "percent", "discount_value": 10, "max_uses": 1,
		"items": []any{map[string]any{"role": "eligible", "category_id": coffeeCat}}})
	coded := e.offer(map[string]any{"offer_type": "bxgy", "name": "Latte B1G1", "buy_qty": 1, "get_qty": 1, "unlock_code": "NGOPI",
		"items": []any{map[string]any{"role": "buy", "product_id": latteID}}})
	cart := []domain.OfferCartLine{{ProductID: latteID, Quantity: 2, UnitPrice: 40_000}, {ProductID: cakeID, Quantity: 1, UnitPrice: 30_000}}

	details, rules, err := e.svc.LoadActiveOfferEvalRules(e.ctx, e.tx, e.company, e.branch, nil)
	if err != nil || len(details) != 2 || len(rules) != 2 {
		t.Fatalf("load: %v %d %d", err, len(details), len(rules))
	}
	evalJSON, _ := json.Marshal(rules[slices.IndexFunc(rules, func(r domain.OfferEvalRule) bool { return r.ID == vol })])
	want := `{"id":"` + vol + `","offer_type":"volume","name":"Kopi 10%","description":null,"bundle_price":null,"buy_qty":null,` +
		`"get_qty":null,"get_mode":null,"volume_basis":"qty","volume_min":1,"discount_type":"percent","discount_value":10,` +
		`"sales_channels":null,"requires_code":false,"is_exclusive":false,"priority":0,"max_uses":1,"used_count":0,` +
		`"max_uses_per_member":null,"member_used_count":0,"items":[` +
		`{"role":"eligible","product_id":"` + latteID + `","qty":1},{"role":"eligible","product_id":"` + teaID + `","qty":1}]}`
	if string(evalJSON) != want {
		t.Fatalf("eval rule:\n got %s\nwant %s", evalJSON, want)
	}

	res, err := e.svc.EvaluateActiveOffersForPosCart(e.ctx, e.tx, PosCartInput{CompanyID: e.company, BranchID: e.branch, Items: cart})
	if err != nil || res.OfferDiscount != 8_000 || res.UnlockedRuleID != nil {
		t.Fatalf("no code: %+v %v", res, err)
	}
	res, _ = e.svc.EvaluateActiveOffersForPosCart(e.ctx, e.tx, PosCartInput{CompanyID: e.company, BranchID: e.branch, Items: cart, Code: " ngopi "})
	if res.OfferDiscount != 48_000 || res.UnlockedRuleID == nil || *res.UnlockedRuleID != coded {
		t.Fatalf("with code: %+v", res)
	}
	raw, _ := json.Marshal(PosOfferResult{Applied: []domain.AppliedOffer{}})
	if string(raw) != `{"offer_discount":0,"applied":[],"unlocked_rule_id":null}` {
		t.Fatalf("empty result json %s", raw)
	}

	order1, order2 := "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1", "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2"
	record := func(order string) error {
		return e.svc.RecordOfferUsage(e.ctx, e.tx, RecordOfferUsageInput{CompanyID: &e.company, BranchID: &e.branch,
			OrderID: order, Applied: res.Applied, Status: "held", Enforce: true})
	}
	if err := record(order1); err != nil {
		t.Fatalf("record: %v", err)
	}
	if err := record(order1); err == nil {
		t.Fatal("re-recording the same order under enforce must hit the spent quota")
	}
	var capErr *OfferCapReachedError
	if err := record(order2); !errors.As(err, &capErr) || capErr.Error() != `Kuota penawaran "Kopi 10%" sudah habis — muat ulang keranjang` {
		t.Fatalf("cap: %v", err)
	}
	if err := e.svc.RecordOfferUsage(e.ctx, e.tx, RecordOfferUsageInput{OrderID: order1, Applied: res.Applied, Status: "captured"}); err != nil {
		t.Fatalf("idempotent insert: %v", err)
	}
	status := func() (s []string) {
		rows, _ := e.tx.Query(e.ctx, `SELECT status FROM promo.offer_usages WHERE order_id = $1 ORDER BY rule_id`, order1)
		s, _ = pgx.CollectRows(rows, pgx.RowTo[string])
		return s
	}
	if got := status(); !slices.Equal(got, []string{"held", "held"}) {
		t.Fatalf("held: %v", got)
	}
	_ = e.svc.CaptureOfferUsage(e.ctx, e.tx, order1)
	if got := status(); !slices.Equal(got, []string{"captured", "captured"}) {
		t.Fatalf("captured: %v", got)
	}
	_ = e.svc.ReleaseOfferUsage(e.ctx, e.tx, order1)
	if got := status(); !slices.Equal(got, []string{"released", "released"}) {
		t.Fatalf("released: %v", got)
	}
	if err := record(order2); err != nil {
		t.Fatalf("quota back after release: %v", err)
	}
	appliedJSON, _ := json.Marshal(res.Applied)
	if want := `[{"rule_id":"` + coded + `","offer_type":"bxgy","name":"Latte B1G1","discount":40000,` +
		`"free_units":[{"productId":"` + latteID + `","qty":1,"unitPrice":40000}]},` +
		`{"rule_id":"` + vol + `","offer_type":"volume","name":"Kopi 10%","discount":8000,"free_units":[]}]`; string(appliedJSON) != want {
		t.Fatalf("applied:\n got %s\nwant %s", appliedJSON, want)
	}
}
