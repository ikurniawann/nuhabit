package app

import (
	"context"
	"testing"

	"nuhabit/backend/internal/platform/testutil"
)

// Campaign vouchers go through stored-value's promo service on the caller's
// transaction: a code is issued once per branch and visible inside the tx.
func TestCrmPromoIssuesVouchersInCallerTx(t *testing.T) {
	deps := testutil.Deps(t, nil)
	tx := testutil.Tx(t)
	ctx := context.Background()
	var company, branch, campaign string
	if err := tx.QueryRow(ctx, `SELECT company_id::text, id::text FROM configuration.branches WHERE company_id IS NOT NULL LIMIT 1`).Scan(&company, &branch); err != nil {
		t.Fatal(err)
	}
	if err := tx.QueryRow(ctx, `INSERT INTO promo.promo_campaigns (company_id, branch_id, name, discount_type, value)
		VALUES ($1, $2, 'Go voucher', 'fixed', 10000) RETURNING id::text`, company, branch).Scan(&campaign); err != nil {
		t.Fatal(err)
	}
	p := crmMarketingPorts(deps).Promo
	code := "GOV-" + testutil.RandomHex(4)
	for i, want := range []bool{true, false} {
		if ok, err := p.IssueCode(ctx, tx, company, branch, campaign, code); err != nil || ok != want {
			t.Fatalf("issue %d: %v %v", i, ok, err)
		}
	}
	var limit int
	if err := tx.QueryRow(ctx, `SELECT usage_limit FROM promo.promo_codes WHERE campaign_id = $1 AND code = $2`, campaign, code).Scan(&limit); err != nil || limit != 1 {
		t.Fatalf("code row %d %v", limit, err)
	}
	if conv, err := p.BatchConversion(ctx, tx, []string{code}); err != nil || conv.Count != 0 || conv.Value != 0 {
		t.Fatalf("conversion %+v %v", conv, err)
	}
}
