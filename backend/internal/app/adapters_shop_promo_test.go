package app

import (
	"context"
	"slices"
	"testing"

	"nuhabit/backend/internal/modules/shop"
	"nuhabit/backend/internal/platform/testutil"
)

// Campaign codes that target products, a storefront collection or a POS
// category discount the matching cart lines only, on the real catalog,
// promo engine and shop service. A storefront collection is the POS
// category of its products, so a collection target is a category target.
func TestShopTargetedPromoCodes(t *testing.T) {
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
	scalar := func(sql string, args ...any) (v string) {
		t.Helper()
		if err := tx.QueryRow(ctx, sql, args...).Scan(&v); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
		return v
	}
	exec(`INSERT INTO crm.crm_settings (key, value) VALUES ('default_company_id', to_jsonb($1::text)), ('default_branch_id', to_jsonb($2::text))
		ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, org.CompanyID, org.BranchID)
	suffix := testutil.RandomHex(4)
	tees := scalar(`INSERT INTO pos.pos_categories (name) VALUES ('Tees ` + suffix + `') RETURNING id::text`)
	caps := scalar(`INSERT INTO pos.pos_categories (name) VALUES ('Caps ` + suffix + `') RETURNING id::text`)
	product := func(name string, category *string, price int) string {
		id := scalar(`INSERT INTO pos.pos_products (sku, name, category_id, base_price, product_kind) VALUES ($1, $2, $3::uuid, $4, 'merchandise')
			RETURNING id::text`, "GO-"+testutil.RandomHex(4), name, category, price)
		exec(`INSERT INTO shop.product_channels (product_id, channel_code, is_distributed) VALUES ($1::uuid, 'web', true)`, id)
		return id
	}
	tee := product("Tee "+suffix, &tees, 100000)
	hat := product("Cap "+suffix, &caps, 50000)
	mug := product("Mug "+suffix, nil, 40000)
	code := func(name string, sets string, args ...any) {
		t.Helper()
		campaign := scalar(`INSERT INTO promo.promo_campaigns (company_id, branch_id, name, discount_type, value, scope, per_phone_limit`+sets+`)
			RETURNING id::text`, append([]any{org.CompanyID, org.BranchID, name}, args...)...)
		exec(`INSERT INTO promo.promo_codes (company_id, branch_id, campaign_id, code) VALUES ($1, $2, $3, $4)`, org.CompanyID, org.BranchID, campaign, name)
	}
	code("ALL10", `) VALUES ($1, $2, $3, 'percent', 10, 'semua', NULL`)
	code("TEE10", `, target_product_ids) VALUES ($1, $2, $3, 'percent', 10, 'semua', NULL, ARRAY[$4::uuid]`, tee)
	code("TEES20", `, target_category_ids) VALUES ($1, $2, $3, 'percent', 20, 'semua', NULL, ARRAY[$4::uuid]`, tees)
	code("GEAR5K", `, target_product_ids, target_category_ids) VALUES ($1, $2, $3, 'fixed', 5000, 'semua', NULL, ARRAY[$4::uuid], ARRAY[$5::uuid]`, mug, caps)

	ports := ShopPorts(deps)
	svc := shop.NewService(tx, ports, nil, nil)
	catalog, err := svc.BuildCatalog(ctx, 3)
	if err != nil {
		t.Fatal(err)
	}
	collectionOf := map[string]string{}
	for _, p := range catalog.Products {
		if p.Collection != nil {
			collectionOf[p.ID] = p.Collection.ID
		}
	}
	if collectionOf[tee] != tees || collectionOf[hat] != caps {
		t.Fatalf("collections = %v", collectionOf)
	}

	cart := []shop.CartItem{{ProductID: tee, Quantity: 2}, {ProductID: hat, Quantity: 1}, {ProductID: mug, Quantity: 1}}
	for _, c := range []struct {
		code     string
		items    []shop.CartItem
		discount float64
		eligible []string
		err      string
	}{
		// Untargeted: the whole 290,000 cart.
		{code: "ALL10", items: cart, discount: 29000},
		// Product: the two tees only (200,000).
		{code: "TEE10", items: cart, discount: 20000, eligible: []string{tee}},
		// Collection / category: the Tees collection only.
		{code: "TEES20", items: cart, discount: 40000, eligible: []string{tee}},
		// A product and a category together: the mug and the cap.
		{code: "GEAR5K", items: cart, discount: 5000, eligible: []string{hat, mug}},
		// Nothing eligible: the preview names what the code covers.
		{code: "TEES20", items: cart[1:], err: "This promo code applies to Tees " + suffix + " only. Add one to your cart to use it."},
		{code: "GEAR5K", items: cart[:1], err: "This promo code applies to Mug " + suffix + " and Caps " + suffix + " only. Add one to your cart to use it."},
	} {
		view, err := svc.PreviewPromo(ctx, c.code, c.items, nil)
		if c.err != "" {
			if err == nil || err.Error() != c.err {
				t.Errorf("%s: err = %v, want %q", c.code, err, c.err)
			}
			continue
		}
		if err != nil || view.DiscountAmount != c.discount || !slices.Equal(view.EligibleProductIDs, c.eligible) {
			t.Errorf("%s: view = %+v %v", c.code, view, err)
		}
	}

	// The hold at checkout computes the same eligible-lines discount.
	check := shop.PromoCheck{Code: "TEES20", Subtotal: 290000, Lines: []shop.PromoLine{
		{ProductID: tee, Amount: 200000}, {ProductID: hat, Amount: 50000}, {ProductID: mug, Amount: 40000}}}
	discount, _, err := ports.Promo.Hold(ctx, tx, check, "00000000-0000-4000-8000-000000000041")
	if err != nil || discount != 40000 {
		t.Errorf("hold = %v %v", discount, err)
	}
}
