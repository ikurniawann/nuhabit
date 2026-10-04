package offers

import (
	"context"
	"testing"
	"time"

	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/testutil"
)

// The promo-check guards answer before the backend is reached; the
// stored-value backend and the full route responses are covered in
// internal/app (adapters_possales_offers_test.go).

type testModule struct{ h *Handler }

func (testModule) Name() string             { return "pos-sales" }
func (m testModule) Routes() []module.Route { return m.h.Routes() }

func TestPromoCheckGuards(t *testing.T) {
	ctx := context.Background()
	tx := testutil.Tx(t)
	h := NewWithBackend(testutil.Deps(t, time.Now), nil, CrmSettingsVenue{})
	h.db = tx
	mux := testutil.Mux(testModule{h})
	var company, branch string
	if err := tx.QueryRow(ctx, `SELECT company_id::text, id::text FROM configuration.branches ORDER BY created_at LIMIT 1`).Scan(&company, &branch); err != nil {
		t.Fatalf("branch: %v", err)
	}
	if _, err := tx.Exec(ctx, `INSERT INTO crm.crm_settings (key, value) VALUES
		('default_company_id', to_jsonb($1::text)), ('default_branch_id', to_jsonb($2::text))
		ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, company, branch); err != nil {
		t.Fatal(err)
	}
	kasir := testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{"pos.operations": nil}})
	outsider := testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{"crm.members": nil}})
	post := func(body any, staff *testutil.Staff) (int, string) {
		r := testutil.Request("POST", "/api/pos/promo-check", body)
		if staff != nil {
			testutil.AsStaff(r, *staff)
		}
		rec, _ := testutil.Do(t, mux, r)
		return rec.Code, rec.Body.String()
	}
	expect := func(gotStatus int, gotBody string, status int, body string) {
		t.Helper()
		if gotStatus != status || gotBody != body {
			t.Fatalf("got %d %s\nwant %d %s", gotStatus, gotBody, status, body)
		}
	}

	unauth := `{"success":false,"error":"Authentication required"}`
	code, body := post(map[string]any{"code": "ABC", "subtotal": 1}, nil)
	expect(code, body, 401, unauth)
	code, body = post(map[string]any{"code": "ABC", "subtotal": 1}, &outsider)
	expect(code, body, 401, unauth)

	missing := `{"success":false,"error":"Validation failed","details":[` +
		`{"code":"invalid_type","path":["code"],"message":"Invalid input: expected string, received undefined"},` +
		`{"code":"invalid_type","path":["subtotal"],"message":"Invalid input: expected number, received undefined"}]}`
	code, body = post("not json", &kasir)
	expect(code, body, 400, missing)

	code, body = post(map[string]any{"code": " ab ", "subtotal": -1, "items": []any{map[string]any{"product_id": "x", "amount": 1}}, "customer_id": "nope"}, &kasir)
	expect(code, body, 400, `{"success":false,"error":"Validation failed","details":[`+
		`{"code":"too_small","path":["code"],"message":"Too small: expected string to have >=3 characters"},`+
		`{"code":"too_small","path":["subtotal"],"message":"Too small: expected number to be >=0"},`+
		`{"code":"invalid_format","path":["items",0,"product_id"],"message":"Invalid UUID"},`+
		`{"code":"invalid_format","path":["customer_id"],"message":"Invalid UUID"}]}`)

	if _, err := tx.Exec(ctx, `DELETE FROM crm.crm_settings WHERE key = 'default_branch_id'`); err != nil {
		t.Fatal(err)
	}
	code, body = post(map[string]any{"code": "ABC", "subtotal": 1}, &kasir)
	expect(code, body, 400, `{"success":false,"error":"Venue belum dikonfigurasi"}`)

	for range 30 {
		h.limiter.Allow("pos-promo-check:"+kasir.UserID, 30)
	}
	code, body = post(map[string]any{"code": "ABC", "subtotal": 1}, &kasir)
	expect(code, body, 429, `{"success":false,"error":"Terlalu banyak percobaan — tunggu sebentar"}`)
}
