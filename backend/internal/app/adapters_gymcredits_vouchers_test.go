package app

import (
	"context"
	"testing"

	"nuhabit/backend/internal/modules/gymcredits"
	"nuhabit/backend/internal/platform/testutil"
)

// Package-targeted campaigns, the front desk sale, the refund that gives a
// code back and a late payment, against the real promo engine.
func TestGymVoucherTargetsRefundsAndLatePayments(t *testing.T) {
	member := testutil.CreateMember(t)
	staff := testutil.CreateStaff(t, testutil.StaffOptions{})
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
	pack := scalar(`INSERT INTO gym.credit_packages (name, credits, price_idr, validity_days) VALUES ('Go Target Pack', 4, 300000, 30) RETURNING id::text`)
	other := scalar(`INSERT INTO gym.credit_packages (name, credits, price_idr, validity_days) VALUES ('Go Other Pack', 4, 300000, 30) RETURNING id::text`)
	code := "PKG" + testutil.RandomHex(4)
	campaign := scalar(`INSERT INTO promo.promo_campaigns (company_id, branch_id, name, discount_type, value, scope, per_phone_limit, usage_limit, target_gym_package_ids)
		VALUES ($1, $2, 'Go Paket', 'fixed', 50000, 'gym', NULL, 2, ARRAY[$3::uuid]) RETURNING id::text`, org.CompanyID, org.BranchID, pack)
	exec(`INSERT INTO promo.promo_codes (company_id, branch_id, campaign_id, code) VALUES ($1, $2, $3, $4)`, org.CompanyID, org.BranchID, campaign, code)
	usage := func() string { return scalar(`SELECT usage_count::text FROM promo.promo_codes WHERE code = $1`, code) }

	svc := gymcredits.NewDefaultService(deps, tx).WithVouchers(newGymVouchers(deps))
	if _, err := svc.PreviewVoucher(ctx, member.CustomerID, other, code, nil); err == nil || err.Error() != "Kode voucher ini tidak berlaku untuk paket ini" {
		t.Fatalf("other package: %v", err)
	}

	// Front desk: captured with the sale; a refund gives the use back.
	sale, err := svc.SellPackage(ctx, gymcredits.FrontDeskSale{CustomerID: member.CustomerID, PackageID: pack, PaymentMethod: "card",
		CashierID: staff.UserID, VoucherCode: code})
	if err != nil || sale.TotalIdr != 250_000 {
		t.Fatalf("sale %+v %v", sale, err)
	}
	if got := scalar(`SELECT status FROM promo.promo_redemptions WHERE context_type = 'gym_purchase' AND context_id = $1`, sale.ID); got != "captured" || usage() != "1" {
		t.Fatalf("sale redemption %s usage %s", got, usage())
	}
	if _, err := svc.RefundPurchaseTx(ctx, sale.ID, "salah paket", staff.UserID, false); err != nil {
		t.Fatal(err)
	}
	if usage() != "0" {
		t.Fatalf("usage after refund %s", usage())
	}

	// Late payment: an expired purchase paid later takes the code again.
	pending := func() string {
		t.Helper()
		return scalar(`INSERT INTO gym.credit_purchases (customer_id, package_id, credits, price_idr, discount_idr, total_idr, channel, payment_method, status)
			VALUES ($1, $2, 4, 300000, 50000, 250000, 'member_portal', 'qris', 'expired') RETURNING id::text`, member.CustomerID, pack)
	}
	vouchers := newGymVouchers(deps)
	check := gymcredits.VoucherCheck{Code: code, Subtotal: 300_000, CustomerID: member.CustomerID, Phone: member.Phone, PackageID: pack}
	hold := func(purchaseID string) {
		t.Helper()
		if q, err := vouchers.Hold(ctx, tx, check, purchaseID); err != nil || !q.OK {
			t.Fatalf("hold %+v %v", q, err)
		}
		if released, err := vouchers.Release(ctx, tx, purchaseID); err != nil || !released {
			t.Fatalf("release %v %v", released, err)
		}
	}
	first, second, third := pending(), pending(), pending()
	hold(first)
	hold(second)
	hold(third)
	for _, id := range []string{first, second} {
		if r, err := vouchers.Recapture(ctx, tx, id); err != nil || r != gymcredits.RecaptureCaptured {
			t.Fatalf("recapture %s: %q %v", id, r, err)
		}
	}
	// The campaign allows 2 uses: the third keeps its discount without one.
	if r, err := vouchers.Recapture(ctx, tx, third); err != nil || r != gymcredits.RecaptureQuotaUsed {
		t.Fatalf("third recapture %q %v", r, err)
	}
	if r, err := vouchers.Recapture(ctx, tx, first); err != nil || r != gymcredits.RecaptureNone || usage() != "2" {
		t.Fatalf("repeat recapture %q %v usage %s", r, err, usage())
	}

	// A campaign that ended, or was switched off, before the late payment
	// keeps the discount without a use, even with quota left.
	exec(`UPDATE promo.promo_campaigns SET usage_limit = NULL WHERE id = $1`, campaign)
	ended := pending()
	hold(ended)
	exec(`UPDATE promo.promo_campaigns SET valid_until = current_date - 1 WHERE id = $1`, campaign)
	if r, err := vouchers.Recapture(ctx, tx, ended); err != nil || r != gymcredits.RecaptureCampaignClosed {
		t.Fatalf("ended campaign recapture %q %v", r, err)
	}
	exec(`UPDATE promo.promo_campaigns SET valid_until = NULL, is_active = false WHERE id = $1`, campaign)
	if r, err := vouchers.Recapture(ctx, tx, ended); err != nil || r != gymcredits.RecaptureCampaignClosed || usage() != "2" {
		t.Fatalf("inactive campaign recapture %q %v usage %s", r, err, usage())
	}
	exec(`UPDATE promo.promo_campaigns SET is_active = true WHERE id = $1`, campaign)
	if r, err := vouchers.Recapture(ctx, tx, ended); err != nil || r != gymcredits.RecaptureCaptured || usage() != "3" {
		t.Fatalf("reopened campaign recapture %q %v usage %s", r, err, usage())
	}
}
