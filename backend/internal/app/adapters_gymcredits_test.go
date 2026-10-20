package app

import (
	"context"
	"testing"

	"nuhabit/backend/internal/modules/gymcredits"
	"nuhabit/backend/internal/platform/testutil"
)

// Gym package purchases redeem promo codes through the real promo engine:
// gym-scoped and every-channel campaigns apply, the per-member limit counts
// the member's phone, other channels are turned away, and a released hold
// gives the code its use back.
func TestGymVouchersAgainstPromoEngine(t *testing.T) {
	member := testutil.CreateMember(t)
	deps := testutil.Deps(t, nil)
	tx := testutil.Tx(t)
	ctx := context.Background()
	org := testutil.CreateOrg(t, tx)
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := tx.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("exec %q: %v", sql, err)
		}
	}
	scalar := func(sql string, args ...any) string {
		t.Helper()
		var v string
		if err := tx.QueryRow(ctx, sql, args...).Scan(&v); err != nil {
			t.Fatalf("query %q: %v", sql, err)
		}
		return v
	}
	exec(`INSERT INTO crm.crm_settings (key, value) VALUES ('default_company_id', to_jsonb($1::text)), ('default_branch_id', to_jsonb($2::text))
		ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, org.CompanyID, org.BranchID)
	hex := testutil.RandomHex(4)
	campaign := func(code, scope string, perPhone any) string {
		id := scalar(`INSERT INTO promo.promo_campaigns (company_id, branch_id, name, discount_type, value, scope, per_phone_limit)
			VALUES ($1, $2, 'Gym ' || $3, 'percent', 10, $3, $4) RETURNING id::text`, org.CompanyID, org.BranchID, scope, perPhone)
		exec(`INSERT INTO promo.promo_codes (company_id, branch_id, campaign_id, code) VALUES ($1, $2, $3, $4)`,
			org.CompanyID, org.BranchID, id, code)
		return id
	}
	gymCode, posCode, allCode := "GYM"+hex, "POS"+hex, "ALL"+hex
	campaign(gymCode, "gym", 1)
	campaign(posCode, "pos", nil)
	campaign(allCode, "semua", nil)
	pkg := scalar(`INSERT INTO gym.credit_packages (name, credits, price_idr, validity_days) VALUES ('Go Promo Pack', 4, 300000, 30) RETURNING id::text`)
	exec(`UPDATE pos.pos_customers SET ark_coin_balance = 1000000 WHERE id = $1`, member.CustomerID)

	vouchers := newGymVouchers(deps)
	svc := gymcredits.NewDefaultService(deps, tx).WithVouchers(vouchers)

	quote, err := svc.PreviewVoucher(ctx, member.CustomerID, pkg, " "+gymCode+" ", nil)
	if err != nil || quote.DiscountIdr != 30_000 || quote.TotalIdr != 270_000 || quote.Label != "Gym gym" {
		t.Fatalf("preview %+v %v", quote, err)
	}
	if _, err := svc.PreviewVoucher(ctx, member.CustomerID, pkg, posCode, nil); err == nil || err.Error() != "Kode voucher ini tidak berlaku untuk paket kelas" {
		t.Fatalf("pos code: %v", err)
	}

	paid, err := svc.BuyWithArk(ctx, gymcredits.MemberPurchase{CustomerID: member.CustomerID, PackageID: pkg, VoucherCode: gymCode})
	if err != nil || paid.Status != "paid" || paid.TotalIdr != 270_000 {
		t.Fatalf("buy %+v %v", paid, err)
	}
	redemption := scalar(`SELECT status || '|' || discount_amount::float8 || '|' || phone FROM promo.promo_redemptions
		WHERE context_type = 'gym_purchase' AND context_id = $1`, paid.ID)
	if redemption != "captured|30000|"+member.Phone {
		t.Fatalf("redemption %q", redemption)
	}
	if _, err := svc.BuyWithArk(ctx, gymcredits.MemberPurchase{CustomerID: member.CustomerID, PackageID: pkg, VoucherCode: gymCode}); err == nil || err.Error() != "Nomor ini sudah memakai kode promo ini" {
		t.Fatalf("second use: %v", err)
	}

	// A hold released (expired purchase) gives the code its use back.
	purchase := scalar(`INSERT INTO gym.credit_purchases (customer_id, package_id, credits, price_idr, discount_idr, total_idr, channel, payment_method)
		VALUES ($1, $2, 4, 300000, 30000, 270000, 'member_portal', 'qris') RETURNING id::text`, member.CustomerID, pkg)
	check := gymcredits.VoucherCheck{Code: allCode, Subtotal: 300_000, CustomerID: member.CustomerID, Phone: member.Phone}
	if held, err := vouchers.Hold(ctx, tx, check, purchase); err != nil || !held.OK || held.Discount != 30_000 {
		t.Fatalf("hold %+v %v", held, err)
	}
	if err := vouchers.Release(ctx, tx, purchase); err != nil {
		t.Fatal(err)
	}
	if got := scalar(`SELECT r.status || '|' || k.usage_count FROM promo.promo_redemptions r JOIN promo.promo_codes k ON k.id = r.code_id
		WHERE r.context_type = 'gym_purchase' AND r.context_id = $1`, purchase); got != "released|0" {
		t.Fatalf("released %q", got)
	}
}
