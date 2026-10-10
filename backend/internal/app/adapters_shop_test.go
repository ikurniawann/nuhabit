package app

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/posops"
	"nuhabit/backend/internal/modules/shop"
	"nuhabit/backend/internal/modules/ticketing"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/testutil"
)

// The shop's POS catalog, stock and member adapters, the Xendit invoice
// client and the public booking ports, on a rolled-back transaction.
func TestShopCatalogStockAndMemberAdapters(t *testing.T) {
	member := testutil.CreateMember(t) // before the transaction: its cleanup runs after the rollback
	tx := testutil.Tx(t)
	ctx := context.Background()
	scalar := func(sql string, args ...any) string {
		t.Helper()
		var v string
		if err := tx.QueryRow(ctx, sql, args...).Scan(&v); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
		return v
	}
	flat := scalar(`INSERT INTO pos.pos_products (sku, name, product_kind, base_price, weight_gram, inventory_quantity, inventory_tracking, is_active, is_available)
		VALUES ($1, 'Aa Go Topi', 'merchandise', 50000, 250, 4, true, true, true) RETURNING id::text`, "GO-"+testutil.RandomHex(4))
	variants := scalar(`INSERT INTO pos.pos_products (sku, name, product_kind, base_price, is_active, is_available)
		VALUES ($1, 'Aa Go Kaos', 'merchandise', 90000, true, true) RETURNING id::text`, "GO-"+testutil.RandomHex(4))
	sku := scalar(`INSERT INTO pos.pos_product_skus (product_id, sku, name, price_override, stock_quantity) VALUES ($1, $2, 'L', 95000, 3) RETURNING id::text`,
		variants, "GO-L-"+testutil.RandomHex(3))
	scalar(`INSERT INTO pos.pos_product_images (product_id, url, display_order) VALUES ($1, '/img/kaos.png', 0) RETURNING id::text`, variants)
	scalar(`INSERT INTO shop.product_channels (product_id, channel_code, is_distributed, price_override)
		VALUES ($1, 'web', true, 45000), ($2, 'web', true, NULL) RETURNING 'ok'`, flat, variants)

	c := shopCatalog{}
	products, err := c.WebProducts(ctx, tx)
	if err != nil {
		t.Fatal(err)
	}
	found := map[string]shop.WebProduct{}
	for _, p := range products {
		found[p.ID] = p
	}
	if p := found[flat]; p.Name != "Aa Go Topi" || p.BasePrice != "50000.00" || *p.ChannelPrice != "45000.00" || *p.WeightGram != "250.00" || p.HasActiveSKU {
		t.Errorf("flat = %+v", p)
	}
	if p := found[variants]; !p.HasActiveSKU || p.ChannelPrice != nil {
		t.Errorf("variants = %+v", p)
	}
	one, err := c.WebProduct(ctx, tx, variants)
	if err != nil || one == nil || one.Name != "Aa Go Kaos" {
		t.Errorf("WebProduct = %+v %v", one, err)
	}
	skus, _ := c.ActiveSKUs(ctx, tx, []string{variants})
	if len(skus) != 1 || skus[0].ID != sku || *skus[0].PriceOverride != "95000.00" || skus[0].StockQuantity != "3.00" {
		t.Errorf("skus = %+v", skus)
	}
	if got, _ := c.ActiveSKU(ctx, tx, sku, flat); got != nil {
		t.Error("a SKU of another product is not found")
	}
	images, _ := c.Images(ctx, tx, []string{variants})
	if len(images) != 1 || images[0].URL != "/img/kaos.png" {
		t.Errorf("images = %+v", images)
	}
	if weight, price, ok, err := c.Cargo(ctx, tx, flat); err != nil || !ok || *weight != "250.00" || price != "50000.00" {
		t.Errorf("cargo = %v %s %v %v", weight, price, ok, err)
	}
	if kind, ok, _ := c.ProductKind(ctx, tx, flat); !ok || kind != "merchandise" {
		t.Errorf("kind = %s", kind)
	}
	names, skuLabels, _ := c.Labels(ctx, tx, []string{flat}, []string{sku})
	if names[flat] != "Aa Go Topi" || skuLabels[sku] != (shop.SKULabel{Name: "L", Code: scalar(`SELECT sku FROM pos.pos_product_skus WHERE id = $1`, sku)}) {
		t.Errorf("labels = %v %v", names, skuLabels)
	}

	// Claims go through the POS functions: a product with variants needs
	// one, a tracked product loses stock and gets it back.
	s := posops.Merchandise{}
	if ok, reason, _ := s.Sell(ctx, tx, variants, nil, 1); ok == nil || *ok || reason != "variant_required" {
		t.Errorf("variant claim = %v %s", ok, reason)
	}
	if ok, _, err := s.Sell(ctx, tx, flat, nil, 3); err != nil || ok == nil || !*ok {
		t.Fatalf("claim = %v %v", ok, err)
	}
	if stock, _ := c.LocalStock(ctx, tx, flat, nil); *stock != "1.00" {
		t.Errorf("stock after claim = %s", *stock)
	}
	if _, _, err := s.Sell(ctx, tx, flat, nil, -3); err != nil {
		t.Fatal(err)
	}
	if stock, _ := c.LocalStock(ctx, tx, variants, &sku); *stock != "3.00" {
		t.Errorf("sku stock = %s", *stock)
	}

	digits := member.Phone[len(member.Phone)-10:]
	if id, err := (shopMembers{}).ByPhoneSuffix(ctx, tx, digits); err != nil || id != member.CustomerID {
		t.Errorf("member = %s %v", id, err)
	}
}

func TestXenditInvoiceClient(t *testing.T) {
	var got map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if user, _, _ := r.BasicAuth(); user != "xnd_secret" {
			w.WriteHeader(401)
			return
		}
		_ = json.NewDecoder(r.Body).Decode(&got)
		_, _ = w.Write([]byte(`{"id":"inv-9","invoice_url":"https://checkout.xendit.co/inv-9","expiry_date":"2026-10-05T05:00:00.000Z"}`))
	}))
	defer srv.Close()
	env := map[string]string{"XENDIT_SECRET_KEY": "xnd_secret", "XENDIT_WEBHOOK_TOKEN": "cb-token"}
	x := newXenditInvoices(func(k string) string { return env[k] }, slog.New(slog.NewTextHandler(io.Discard, nil)))
	x.url = srv.URL

	pay := shopPayments{x}
	if !pay.Configured() || !pay.ValidWebhookToken("cb-token") || pay.ValidWebhookToken("cb-toke") || pay.ValidWebhookToken("") {
		t.Fatal("configured / webhook token")
	}
	inv, err := pay.CreateInvoice(context.Background(), shop.InvoiceRequest{ExternalID: "shop-order-1", Amount: 112500, PayerName: "Budi",
		Description: "Order SHOP-1 — Toko", RedirectURL: "https://app.example/shop/order/t"})
	if err != nil || inv.ID != "inv-9" || inv.ExpiresAt.UTC().Format("15:04") != "05:00" {
		t.Fatalf("invoice = %+v %v", inv, err)
	}
	if got["external_id"] != "shop-order-1" || got["amount"] != 112500.0 || got["invoice_duration"] != 7200.0 ||
		got["success_redirect_url"] != "https://app.example/shop/order/t" || got["currency"] != "IDR" {
		t.Errorf("request = %v", got)
	}

	env["XENDIT_SECRET_KEY"], env["XENDIT_MOCK"] = "", "1"
	mock, err := ticketingPayments{x}.CreateInvoice(context.Background(), ticketing.InvoiceRequest{ExternalID: "tkt-booking-1", RedirectURL: "https://app.example/booking/status/t"})
	if err != nil || mock.ID != "mock-tkt-booking-1" || mock.URL != "https://app.example/booking/status/t" {
		t.Errorf("mock = %+v %v", mock, err)
	}
	env["XENDIT_MOCK"] = ""
	if (ticketingPayments{x}).Configured() {
		t.Error("no key and no mock is not configured")
	}
}

// The shop's promo, wallet, branch and member adapters on real rows: a
// campaign of the default CRM venue held for a shop order, captured and
// released; ARK Coin debited or refused; public branches; the member
// behind a session cookie.
func TestShopCheckoutAdapters(t *testing.T) {
	member := testutil.CreateMember(t) // before the transaction: its cleanup runs after the rollback
	deps := testutil.Deps(t, nil)
	tx := testutil.Tx(t)
	ctx := context.Background()
	org := testutil.CreateOrg(t, tx)
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := tx.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	exec(`INSERT INTO crm.crm_settings (key, value) VALUES ('default_company_id', to_jsonb($1::text)), ('default_branch_id', to_jsonb($2::text))
		ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, org.CompanyID, org.BranchID)
	var campaign string
	if err := tx.QueryRow(ctx, `INSERT INTO promo.promo_campaigns (company_id, branch_id, name, discount_type, value, scope, per_phone_limit)
		VALUES ($1, $2, 'Go launch', 'fixed', 15000, 'semua', NULL) RETURNING id::text`, org.CompanyID, org.BranchID).Scan(&campaign); err != nil {
		t.Fatal(err)
	}
	exec(`INSERT INTO promo.promo_codes (company_id, branch_id, campaign_id, code) VALUES ($1, $2, $3, 'GOSHOP')`, org.CompanyID, org.BranchID, campaign)
	exec(`UPDATE configuration.branches SET is_public = true, address = 'Jl. Dago 10', city = 'Bandung' WHERE id = $1`, org.BranchID)
	exec(`UPDATE pos.pos_customers SET ark_coin_balance = 50000 WHERE id = $1`, member.CustomerID)

	ports := ShopPorts(deps)
	check := shop.PromoCheck{Code: "goshop", Subtotal: 100000, Lines: []shop.PromoLine{{ProductID: "00000000-0000-4000-8000-000000000009", Amount: 100000}}}
	preview, err := ports.Promo.Preview(ctx, tx, check)
	if err != nil || !preview.OK || preview.Discount != 15000 || preview.Label != "Go launch" {
		t.Fatalf("preview = %+v %v", preview, err)
	}
	if p, _ := ports.Promo.Preview(ctx, tx, shop.PromoCheck{Code: "NOPE", Subtotal: 100000}); p.OK || p.Reason != "nonaktif" {
		t.Errorf("unknown code = %+v", p)
	}
	const order = "00000000-0000-4000-8000-000000000031"
	discount, label, err := ports.Promo.Hold(ctx, tx, check, order)
	if err != nil || discount != 15000 || label != "Go launch" {
		t.Fatalf("hold = %v %s %v", discount, label, err)
	}
	status := func() string {
		var s string
		if err := tx.QueryRow(ctx, `SELECT r.status || '|' || k.usage_count FROM promo.promo_redemptions r JOIN promo.promo_codes k ON k.id = r.code_id
			WHERE r.context_type = 'shop_order' AND r.context_id = $1`, order).Scan(&s); err != nil {
			t.Fatal(err)
		}
		return s
	}
	if got := status(); got != "held|1" {
		t.Errorf("after hold = %s", got)
	}
	if err := ports.Promo.Capture(ctx, tx, order); err != nil || status() != "captured|1" {
		t.Errorf("capture = %v %s", err, status())
	}
	if err := ports.Promo.Release(ctx, tx, order); err != nil || status() != "released|0" {
		t.Errorf("release = %v %s", err, status())
	}
	_, _, err = ports.Promo.Hold(ctx, tx, shop.PromoCheck{Code: "NOPE", Subtotal: 100000}, order)
	if rej, ok := errors.AsType[*shop.PromoRejectedError](err); !ok || rej.Reason != "nonaktif" {
		t.Errorf("unknown code hold = %v", err)
	}

	// The wallet: the refusal runs in a savepoint so the transaction stays usable.
	err = database.WithTx(ctx, tx, func(inner pgx.Tx) error {
		return ports.Wallet.Pay(ctx, inner, member.CustomerID, 80000, order, "Shop order SHOP-1")
	})
	if !errors.Is(err, shop.ErrArkInsufficient) {
		t.Errorf("over balance = %v", err)
	}
	if err := ports.Wallet.Pay(ctx, tx, member.CustomerID, 30000, order, "Shop order SHOP-1"); err != nil {
		t.Fatal(err)
	}
	if balance, _ := ports.Wallet.Balance(ctx, tx, member.CustomerID); balance != 20000 {
		t.Errorf("balance = %v", balance)
	}
	var notes string
	if err := tx.QueryRow(ctx, `SELECT notes FROM pos.pos_wallet_transactions WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 1`, member.CustomerID).Scan(&notes); err != nil || notes != "Shop order SHOP-1" {
		t.Errorf("wallet row = %q %v", notes, err)
	}

	branches, err := ports.Branches.Public(ctx, tx)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, b := range branches {
		found = found || (b.ID == org.BranchID && *b.Address == "Jl. Dago 10" && *b.City == "Bandung")
	}
	if !found {
		t.Errorf("public branches = %+v", branches)
	}
	if b, err := ports.Branches.Get(ctx, tx, org.BranchID); err != nil || b == nil || b.Name == "" {
		t.Errorf("branch = %+v %v", b, err)
	}
	if b, err := ports.Branches.Get(ctx, tx, order); err != nil || b != nil {
		t.Errorf("missing branch = %+v %v", b, err)
	}

	r := testutil.Request("GET", "/api/public/shop/toko/me", nil)
	if m, err := ports.Members.FromRequest(r); err != nil || m != nil {
		t.Errorf("guest = %+v %v", m, err)
	}
	m, err := ports.Members.FromRequest(testutil.AsMember(r, member))
	if err != nil || m == nil || m.ID != member.CustomerID || m.Phone != member.Phone || *m.Name != "Go Test Member" {
		t.Errorf("member = %+v %v", m, err)
	}
}

// A rejected promo hold reaches the booking route as a 422 with the promo
// message; an unknown code previews as "nonaktif" (anti-enumeration).
func TestTicketingPromoAdapter(t *testing.T) {
	deps := testutil.Deps(t, nil)
	tx := testutil.Tx(t)
	ctx := context.Background()
	p := ticketingPublicPorts(deps).Promo
	check := ticketing.PromoCheck{CompanyID: "00000000-0000-4000-8000-000000000001", BranchID: "00000000-0000-4000-8000-000000000002",
		Code: "TIDAKADA", Channel: "ticketing_online", Subtotal: 100000}
	preview, err := p.Preview(ctx, tx, check)
	if err != nil || preview.OK || preview.Reason != "nonaktif" || preview.Message == "" {
		t.Fatalf("preview = %+v %v", preview, err)
	}
	_, err = p.Hold(ctx, tx, check, "ticket_booking", "00000000-0000-4000-8000-000000000003")
	if e, ok := errors.AsType[*httpx.Error](err); !ok || e.Status != 422 || e.Message != preview.Message {
		t.Fatalf("hold = %v", err)
	}
}
