package app

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"nuhabit/backend/internal/modules/possales/offers"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/testutil"
)

// The POS offer backend over the stored-value promo service, called
// directly and through the pos/promo-check and pos/offer-rules routes,
// inside a rolled-back transaction with a pinned clock and a known venue.

// 2026-10-04 10:00 WIB.
var offersPinned = time.Date(2026, 10, 4, 3, 0, 0, 0, time.UTC)

type offersFixture struct {
	t        *testing.T
	tx       database.DB
	backend  possalesOffers
	mux      *http.ServeMux
	company  string
	branch   string
	sfx      string
	products map[string]string
	category string
}

type offersTestModule struct{ h *offers.Handler }

func (offersTestModule) Name() string             { return "pos-sales" }
func (m offersTestModule) Routes() []module.Route { return m.h.Routes() }

// txOffers runs the routes' backend calls on the test transaction.
type txOffers struct {
	possalesOffers
	tx database.Querier
}

func (b txOffers) FindByUnlockCode(ctx context.Context, _ database.Querier, companyID, branchID, code string) (*offers.UnlockedOffer, error) {
	return b.possalesOffers.FindByUnlockCode(ctx, b.tx, companyID, branchID, code)
}

func (b txOffers) PreviewPromo(ctx context.Context, _ database.Querier, in offers.PreviewInput) (offers.PromoPreview, error) {
	return b.possalesOffers.PreviewPromo(ctx, b.tx, in)
}

func (b txOffers) ActiveRules(ctx context.Context, _ database.Querier, companyID, branchID, customerID string) ([]offers.ActiveRule, error) {
	return b.possalesOffers.ActiveRules(ctx, b.tx, companyID, branchID, customerID)
}

type txVenue struct{ tx database.Querier }

func (v txVenue) DefaultVenue(ctx context.Context, _ database.Querier) offers.Venue {
	return offers.CrmSettingsVenue{}.DefaultVenue(ctx, v.tx)
}

func newOffersFixture(t *testing.T) *offersFixture {
	t.Helper()
	deps := testutil.Deps(t, func() time.Time { return offersPinned })
	tx := testutil.Tx(t)
	backend := newPossalesOffers(deps)
	h := offers.NewWithBackend(deps, txOffers{backend, tx}, txVenue{tx})
	f := &offersFixture{t: t, tx: tx, backend: backend, mux: testutil.Mux(offersTestModule{h}),
		sfx: strings.ToUpper(testutil.RandomHex(4)), products: map[string]string{}}
	if err := tx.QueryRow(context.Background(),
		`SELECT company_id::text, id::text FROM configuration.branches ORDER BY created_at LIMIT 1`).Scan(&f.company, &f.branch); err != nil {
		t.Fatalf("branch: %v", err)
	}
	f.exec(`INSERT INTO crm.crm_settings (key, value) VALUES
		('default_company_id', to_jsonb($1::text)), ('default_branch_id', to_jsonb($2::text))
		ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, f.company, f.branch)
	f.category = f.id(`INSERT INTO pos.pos_categories (name) VALUES ('Kopi Go') RETURNING id::text`)
	f.products["latte"] = f.product("Latte Go", &f.category)
	f.products["cake"] = f.product("Cake Go", nil)
	return f
}

func (f *offersFixture) product(name string, category *string) string {
	return f.id(`INSERT INTO pos.pos_products (sku, name, category_id, base_price) VALUES ($1, $2, $3, 10000) RETURNING id::text`,
		"GO-"+f.sfx+"-"+testutil.RandomHex(3), name, category)
}

func (f *offersFixture) exec(sql string, args ...any) {
	f.t.Helper()
	if _, err := f.tx.Exec(context.Background(), sql, args...); err != nil {
		f.t.Fatalf("exec %s: %v", sql, err)
	}
}

func (f *offersFixture) id(sql string, args ...any) string {
	f.t.Helper()
	var id string
	if err := f.tx.QueryRow(context.Background(), sql, args...).Scan(&id); err != nil {
		f.t.Fatalf("query %s: %v", sql, err)
	}
	return id
}

func (f *offersFixture) scalar(sql string, args ...any) string {
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

func (f *offersFixture) do(r *http.Request, staff *testutil.Staff) (int, string) {
	f.t.Helper()
	if staff != nil {
		testutil.AsStaff(r, *staff)
	}
	rec, _ := testutil.Do(f.t, f.mux, r)
	return rec.Code, rec.Body.String()
}

func expectResponse(t *testing.T, gotStatus int, gotBody string, status int, body string) {
	t.Helper()
	if gotStatus != status || gotBody != body {
		t.Fatalf("got %d %s\nwant %d %s", gotStatus, gotBody, status, body)
	}
}

func offersCashier(t *testing.T) *testutil.Staff {
	s := testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{"pos.operations": nil}})
	return &s
}

// campaign inserts a pos campaign with one code and returns the code id.
func (f *offersFixture) campaign(code, extraCols, extraVals string, args ...any) string {
	f.t.Helper()
	campaignID := f.id(`INSERT INTO promo.promo_campaigns (company_id, branch_id, name, discount_type, value, scope, per_phone_limit`+extraCols+`)
		VALUES ($1, $2, 'Promo Go', 'percent', 10, 'pos', NULL`+extraVals+`) RETURNING id::text`, append([]any{f.company, f.branch}, args...)...)
	return f.id(`INSERT INTO promo.promo_codes (company_id, branch_id, campaign_id, code) VALUES ($1, $2, $3, $4) RETURNING id::text`,
		f.company, f.branch, campaignID, code)
}

/* ── POST /api/pos/promo-check ───────────────────────────────────────── */

func TestPossalesOffersPromoCheck(t *testing.T) {
	f := newOffersFixture(t)
	kasir := offersCashier(t)
	post := func(body map[string]any) (int, string) {
		return f.do(testutil.Request("POST", "/api/pos/promo-check", body), kasir)
	}

	ruleID := f.id(`INSERT INTO promo.offer_rules (company_id, branch_id, offer_type, name, volume_basis, volume_min, discount_type, discount_value, unlock_code)
		VALUES ($1, $2, 'volume', 'Buka Go', 'qty', 1, 'percent', 5, $3) RETURNING id::text`, f.company, f.branch, "OPEN-"+f.sfx)
	code, body := post(map[string]any{"code": " open-" + strings.ToLower(f.sfx) + " ", "subtotal": 50_000})
	expectResponse(t, code, body, 200, `{"success":true,"data":{"ok":true,"kind":"offer","rule_id":"`+ruleID+`","offer_name":"Buka Go","discount":0}}`)

	code, body = post(map[string]any{"code": "NOPE-" + f.sfx, "subtotal": 50_000})
	expectResponse(t, code, body, 200, `{"success":true,"data":{"ok":false,"reason":"nonaktif","message":"Kode promo tidak dikenal atau sudah tidak berlaku","kind":"promo","label":"Tidak berlaku"}}`)

	f.campaign("HEMAT-"+f.sfx, "", "")
	code, body = post(map[string]any{"code": "hemat-" + f.sfx, "subtotal": 99_999})
	expectResponse(t, code, body, 200, `{"success":true,"data":{"ok":true,"discount":9999.9,"campaign_name":"Promo Go","discount_type":"percent","kind":"promo"}}`)

	// Category target: only the latte line (its category comes from the catalog) counts.
	f.campaign("KOPI-"+f.sfx, ", target_category_ids", ", ARRAY[$3]::uuid[]", f.category)
	items := []any{
		map[string]any{"product_id": f.products["latte"], "amount": 40_000},
		map[string]any{"product_id": f.products["cake"], "amount": 30_000},
	}
	code, body = post(map[string]any{"code": "KOPI-" + f.sfx, "subtotal": 70_000, "items": items})
	expectResponse(t, code, body, 200, `{"success":true,"data":{"ok":true,"discount":4000,"campaign_name":"Promo Go","discount_type":"percent","kind":"promo"}}`)
	code, body = post(map[string]any{"code": "KOPI-" + f.sfx, "subtotal": 70_000, "items": items[1:]})
	expectResponse(t, code, body, 200, `{"success":true,"data":{"ok":false,"reason":"produk-tidak-sesuai","message":"Kode ini hanya untuk produk/kategori tertentu — belum ada di keranjang","kind":"promo","label":"Produk tidak sesuai"}}`)

	// New-member campaign: a member with a paid order is rejected.
	f.campaign("BARU-"+f.sfx, ", eligibility", ", 'member_baru'")
	code, body = post(map[string]any{"code": "BARU-" + f.sfx, "subtotal": 70_000, "customer_id": nil})
	expectResponse(t, code, body, 200, `{"success":true,"data":{"ok":false,"reason":"khusus-member","message":"Kode ini khusus member — pilih member dulu","kind":"promo","label":"Khusus member"}}`)
	member := f.id(`INSERT INTO pos.pos_customers (phone, name) VALUES ($1, 'Go Member') RETURNING id::text`, "+6299"+testutil.RandomHex(4))
	code, body = post(map[string]any{"code": "BARU-" + f.sfx, "subtotal": 70_000, "customer_id": member})
	expectResponse(t, code, body, 200, `{"success":true,"data":{"ok":true,"discount":7000,"campaign_name":"Promo Go","discount_type":"percent","kind":"promo"}}`)
	f.exec(`INSERT INTO pos.pos_orders (order_number, cashier_id, customer_id, status, payment_status, subtotal, total_amount)
		VALUES ($1, $2, $3, 'completed', 'paid', 1000, 1000)`, "GO-"+f.sfx, kasir.UserID, member)
	code, body = post(map[string]any{"code": "BARU-" + f.sfx, "subtotal": 70_000, "customer_id": member})
	expectResponse(t, code, body, 200, `{"success":true,"data":{"ok":false,"reason":"bukan-member-baru","message":"Kode ini khusus member baru (transaksi pertama) — member ini tidak memenuhi syarat","kind":"promo","label":"Khusus member baru"}}`)
}

/* ── GET /api/pos/offer-rules ────────────────────────────────────────── */

func TestPossalesOffersOfferRules(t *testing.T) {
	f := newOffersFixture(t)
	kasir := offersCashier(t)
	get := func(query string) (int, string) {
		return f.do(testutil.Request("GET", "/api/pos/offer-rules"+query, nil), kasir)
	}

	code, body := f.do(testutil.Request("GET", "/api/pos/offer-rules", nil), nil)
	expectResponse(t, code, body, 401, `{"success":false,"error":"Authentication required"}`)
	code, body = get("")
	expectResponse(t, code, body, 200, `{"success":true,"data":[]}`)

	latte, cake := f.products["latte"], f.products["cake"]
	bundle := f.id(`INSERT INTO promo.offer_rules (company_id, branch_id, offer_type, name, valid_from, bundle_price, priority, unlock_code)
		VALUES ($1, $2, 'bundle', 'Paket Go', '2026-10-01', 55000, 5, 'PAKET-GO') RETURNING id::text`, f.company, f.branch)
	f.exec(`INSERT INTO promo.offer_rule_items (rule_id, role, product_id, qty, sort_order) VALUES
		($1, 'component', $2, 1, 0), ($1, 'component', $3, 2, 1)`, bundle, latte, cake)
	volume := f.id(`INSERT INTO promo.offer_rules (company_id, branch_id, offer_type, name, description, volume_basis, volume_min,
		discount_type, discount_value, sales_channels, max_uses, max_uses_per_member, is_exclusive)
		VALUES ($1, $2, 'volume', 'Kopi 10%', 'Semua kopi', 'qty', 2, 'percent', 10, ARRAY['pos'], 10, 1, true) RETURNING id::text`, f.company, f.branch)
	f.exec(`INSERT INTO promo.offer_rule_items (rule_id, role, category_id) VALUES ($1, 'eligible', $2)`, volume, f.category)
	// Neither an inactive rule nor one outside its period is listed.
	f.exec(`INSERT INTO promo.offer_rules (company_id, branch_id, offer_type, name, is_active, volume_basis, volume_min, discount_type, discount_value)
		VALUES ($1, $2, 'volume', 'Mati', false, 'qty', 1, 'fixed', 1000), ($1, $2, 'volume', 'Lewat', true, 'qty', 1, 'fixed', 1000)`, f.company, f.branch)
	f.exec(`UPDATE promo.offer_rules SET valid_until = '2026-10-03' WHERE company_id = $1 AND name = 'Lewat'`, f.company)

	member := f.id(`INSERT INTO pos.pos_customers (phone, name) VALUES ($1, 'Go Member') RETURNING id::text`, "+6299"+testutil.RandomHex(4))
	f.exec(`INSERT INTO promo.offer_usages (company_id, branch_id, rule_id, order_id, customer_id, discount_amount, status)
		VALUES ($1, $2, $3, gen_random_uuid(), $4, 1000, 'captured'),
		       ($1, $2, $3, gen_random_uuid(), NULL, 1000, 'released')`, f.company, f.branch, volume, member)

	bundleJSON := `{"id":"` + bundle + `","offer_type":"bundle","name":"Paket Go","description":null,"valid_from":"2026-10-01","valid_until":null,` +
		`"bundle_price":55000,"buy_qty":null,"get_qty":null,"get_mode":null,"volume_basis":null,"volume_min":null,"discount_type":null,"discount_value":null,` +
		`"requires_code":true,"is_exclusive":false,"items":[{"role":"component","product_id":"` + latte + `","product_name":"Latte Go","qty":1},` +
		`{"role":"component","product_id":"` + cake + `","product_name":"Cake Go","qty":2}],` +
		`"eval":{"id":"` + bundle + `","offer_type":"bundle","name":"Paket Go","description":null,"bundle_price":55000,"buy_qty":null,"get_qty":null,` +
		`"get_mode":null,"volume_basis":null,"volume_min":null,"discount_type":null,"discount_value":null,"sales_channels":null,"requires_code":true,` +
		`"is_exclusive":false,"priority":5,"max_uses":null,"used_count":0,"max_uses_per_member":null,"member_used_count":0,` +
		`"items":[{"role":"component","product_id":"` + latte + `","category_id":null,"qty":1},{"role":"component","product_id":"` + cake + `","category_id":null,"qty":2}]}}`
	volumeJSON := func(memberUsed string) string {
		return `{"id":"` + volume + `","offer_type":"volume","name":"Kopi 10%","description":"Semua kopi","valid_from":null,"valid_until":null,` +
			`"bundle_price":null,"buy_qty":null,"get_qty":null,"get_mode":null,"volume_basis":"qty","volume_min":2,"discount_type":"percent","discount_value":10,` +
			`"requires_code":false,"is_exclusive":true,"items":[{"role":"eligible","product_id":"","product_name":"Kopi Go","qty":1}],` +
			`"eval":{"id":"` + volume + `","offer_type":"volume","name":"Kopi 10%","description":"Semua kopi","bundle_price":null,"buy_qty":null,"get_qty":null,` +
			`"get_mode":null,"volume_basis":"qty","volume_min":2,"discount_type":"percent","discount_value":10,"sales_channels":["pos"],"requires_code":false,` +
			`"is_exclusive":true,"priority":0,"max_uses":10,"used_count":1,"max_uses_per_member":1,"member_used_count":` + memberUsed + `,` +
			`"items":[{"role":"eligible","product_id":"` + latte + `","qty":1}]}}`
	}

	code, body = get("")
	expectResponse(t, code, body, 200, `{"success":true,"data":[`+bundleJSON+`,`+volumeJSON("0")+`]}`)
	code, body = get("?customer_id=" + strings.ToUpper(member))
	expectResponse(t, code, body, 200, `{"success":true,"data":[`+bundleJSON+`,`+volumeJSON("1")+`]}`)
	code, body = get("?customer_id=not-a-uuid")
	expectResponse(t, code, body, 200, `{"success":true,"data":[`+bundleJSON+`,`+volumeJSON("0")+`]}`)
}

/* ── engine: offers ──────────────────────────────────────────────────── */

func TestPossalesOffersEngine(t *testing.T) {
	f := newOffersFixture(t)
	ctx := context.Background()
	e := f.backend
	latte, cake := f.products["latte"], f.products["cake"]

	bundle := f.id(`INSERT INTO promo.offer_rules (company_id, branch_id, offer_type, name, bundle_price, unlock_code, max_uses)
		VALUES ($1, $2, 'bundle', 'Paket Go', 55000, 'PAKET-GO', 1) RETURNING id::text`, f.company, f.branch)
	f.exec(`INSERT INTO promo.offer_rule_items (rule_id, role, product_id) VALUES ($1, 'component', $2), ($1, 'component', $3)`, bundle, latte, cake)
	volume := f.id(`INSERT INTO promo.offer_rules (company_id, branch_id, offer_type, name, volume_basis, volume_min, discount_type, discount_value, max_uses_per_member)
		VALUES ($1, $2, 'volume', 'Kopi 10%', 'qty', 1, 'percent', 10, 1) RETURNING id::text`, f.company, f.branch)
	f.exec(`INSERT INTO promo.offer_rule_items (rule_id, role, category_id) VALUES ($1, 'eligible', $2)`, volume, f.category)

	cart := []offers.CartLine{{ProductID: latte, Quantity: 2, UnitPrice: 40_000}, {ProductID: cake, Quantity: 1, UnitPrice: 30_000}}
	company, branch := f.company, f.branch

	t.Run("no venue evaluates nothing", func(t *testing.T) {
		got, err := e.EvaluateForPosCart(ctx, f.tx, nil, &branch, cart, "PAKET-GO", "")
		if err != nil || got.OfferDiscount != 0 || len(got.Applied) != 0 || got.UnlockedRuleID != nil {
			t.Fatalf("got %+v %v", got, err)
		}
	})

	t.Run("coded offer stays locked without its code", func(t *testing.T) {
		got, err := e.EvaluateForPosCart(ctx, f.tx, &company, &branch, cart, "", "")
		if err != nil || got.OfferDiscount != 8_000 || len(got.Applied) != 1 || got.Applied[0].RuleID != volume {
			t.Fatalf("got %+v %v", got, err)
		}
	})

	t.Run("unlock code opens the bundle and stacks with volume", func(t *testing.T) {
		got, err := e.EvaluateForPosCart(ctx, f.tx, &company, &branch, cart, " paket-go", "")
		if err != nil || got.UnlockedRuleID == nil || *got.UnlockedRuleID != bundle {
			t.Fatalf("got %+v %v", got, err)
		}
		// bundle 70k -> 55k = 15k, volume 10% of the 80k latte lines = 8k.
		if got.OfferDiscount != 23_000 || len(got.Applied) != 2 {
			t.Fatalf("got %+v", got)
		}
	})

	t.Run("empty cart still reports the unlocked rule", func(t *testing.T) {
		got, err := e.EvaluateForPosCart(ctx, f.tx, &company, &branch, nil, "PAKET-GO", "")
		if err != nil || got.UnlockedRuleID == nil || len(got.Applied) != 0 {
			t.Fatalf("got %+v %v", got, err)
		}
	})

	member := f.id(`INSERT INTO pos.pos_customers (phone, name) VALUES ($1, 'Go Member') RETURNING id::text`, "+6299"+testutil.RandomHex(4))
	applied := []offers.AppliedOffer{
		{RuleID: volume, OfferType: "volume", Name: "Kopi 10%", Discount: 8_000},
		{RuleID: bundle, OfferType: "bundle", Name: "Paket Go", Discount: 15_000},
	}
	order1, order2 := f.id(`SELECT gen_random_uuid()::text`), f.id(`SELECT gen_random_uuid()::text`)
	usage := func(order string) offers.UsageInput {
		return offers.UsageInput{CompanyID: &company, BranchID: &branch, OrderID: order, CustomerID: member, Applied: applied, Status: "held", Enforce: true}
	}

	t.Run("record usage then caps reject the next order", func(t *testing.T) {
		if err := e.RecordUsage(ctx, f.tx, usage(order1)); err != nil {
			t.Fatal(err)
		}
		if err := e.RecordUsage(ctx, f.tx, usage(order1)); err == nil {
			t.Fatal("second claim on a full cap must fail")
		}
		in := usage(order2)
		in.Applied = applied[1:]
		err := e.RecordUsage(ctx, f.tx, in)
		var capErr *offers.CapReachedError
		if !errors.As(err, &capErr) || err.Error() != `Kuota penawaran "Paket Go" sudah habis — muat ulang keranjang` {
			t.Fatalf("got %v", err)
		}
		in.Enforce, in.Status = false, "captured"
		if err := e.RecordUsage(ctx, f.tx, in); err != nil {
			t.Fatal(err)
		}
		if got := f.scalar(`SELECT string_agg(status || ':' || discount_amount::text, ',' ORDER BY discount_amount) FROM promo.offer_usages WHERE order_id = $1`, order1); got != "held:8000.00,held:15000.00" {
			t.Fatalf("usages %s", got)
		}
	})

	t.Run("capture and release are idempotent", func(t *testing.T) {
		for range 2 {
			if err := e.CaptureUsage(ctx, f.tx, order1); err != nil {
				t.Fatal(err)
			}
		}
		if got := f.scalar(`SELECT string_agg(DISTINCT status, ',') FROM promo.offer_usages WHERE order_id = $1`, order1); got != "captured" {
			t.Fatalf("status %s", got)
		}
		for range 2 {
			if err := e.ReleaseUsage(ctx, f.tx, order1); err != nil {
				t.Fatal(err)
			}
		}
		if got := f.scalar(`SELECT string_agg(DISTINCT status, ',') FROM promo.offer_usages WHERE order_id = $1`, order1); got != "released" {
			t.Fatalf("status %s", got)
		}
	})
}

/* ── engine: promo codes ─────────────────────────────────────────────── */

func TestPossalesOffersPromo(t *testing.T) {
	f := newOffersFixture(t)
	ctx := context.Background()
	e := f.backend
	codeID := f.campaign("SEKALI-"+f.sfx, ", max_discount", ", 5000")
	f.exec(`UPDATE promo.promo_codes SET usage_limit = 1 WHERE id = $1`, codeID)

	hold := func(contextID string) (*offers.PromoHold, error) {
		return e.HoldPromo(ctx, f.tx, offers.HoldInput{
			CompanyID: f.company, BranchID: f.branch, Code: " sekali-" + f.sfx, Channel: "pos",
			ContextType: offers.ContextPosOrder, ContextID: contextID, Subtotal: 100_000,
		})
	}
	order1, order2 := f.id(`SELECT gen_random_uuid()::text`), f.id(`SELECT gen_random_uuid()::text`)

	got, err := hold(order1)
	if err != nil || got.Discount != 5_000 || got.CodeID != codeID || got.CampaignName != "Promo Go" || got.RedemptionID == "" {
		t.Fatalf("hold %+v %v", got, err)
	}
	if n := f.scalar(`SELECT usage_count::text FROM promo.promo_codes WHERE id = $1`, codeID); n != "1" {
		t.Fatalf("usage_count %s", n)
	}
	if row := f.scalar(`SELECT status || ':' || discount_amount::text || ':' || value::text FROM promo.promo_redemptions WHERE context_id = $1`, order1); row != "held:5000.00:10.00" {
		t.Fatalf("redemption %s", row)
	}

	_, err = hold(order2)
	var rejected *offers.PromoRejectedError
	if !errors.As(err, &rejected) || rejected.Reason != "kuota-habis" || err.Error() != "Kuota kode promo sudah habis" {
		t.Fatalf("second hold: %v", err)
	}
	if _, err := e.HoldPromo(ctx, f.tx, offers.HoldInput{CompanyID: f.company, BranchID: f.branch, Code: "NOPE", Channel: "pos",
		ContextType: offers.ContextPosOrder, ContextID: order2, Subtotal: 1}); err == nil || err.Error() != "Kode promo tidak dikenal atau sudah tidak berlaku" {
		t.Fatalf("unknown code: %v", err)
	}

	preview, err := e.PreviewPromo(ctx, f.tx, offers.PreviewInput{CompanyID: f.company, BranchID: f.branch, Code: "SEKALI-" + f.sfx, Channel: "pos", Subtotal: 100_000})
	if err != nil || preview.OK || preview.Reason != "kuota-habis" || preview.Message != "Kuota kode promo sudah habis" || preview.Label != "Kuota habis" {
		t.Fatalf("preview %+v %v", preview, err)
	}

	if err := e.CapturePromo(ctx, f.tx, offers.ContextPosOrder, order1); err != nil {
		t.Fatal(err)
	}
	if s := f.scalar(`SELECT status FROM promo.promo_redemptions WHERE context_id = $1`, order1); s != "captured" {
		t.Fatalf("status %s", s)
	}
	for range 2 {
		if err := e.ReleasePromo(ctx, f.tx, offers.ContextPosOrder, order1); err != nil {
			t.Fatal(err)
		}
	}
	if s := f.scalar(`SELECT status || ':' || (SELECT usage_count FROM promo.promo_codes WHERE id = $2)::text
		FROM promo.promo_redemptions WHERE context_id = $1`, order1, codeID); s != "released:0" {
		t.Fatalf("after release %s", s)
	}
	if got, err := hold(order2); err != nil || got.Discount != 5_000 {
		t.Fatalf("hold after release %+v %v", got, err)
	}
}
