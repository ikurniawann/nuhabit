package promo

import (
	"context"

	"nuhabit/backend/internal/platform/database"
)

// Campaign vouchers: the codes a CRM marketing campaign issues and the
// conversions its report reads (lib/crm/campaigns-server.ts and
// campaigns-admin-server.ts). They run on the caller's Querier, so a
// campaign start issues its vouchers in the transaction that queues its
// recipients.

// IssueVoucher inserts a single-use code; false when the code already
// exists in the branch.
func (s *Service) IssueVoucher(ctx context.Context, q database.Querier, companyID, branchID, campaignID, code string) (bool, error) {
	tag, err := q.Exec(ctx, `INSERT INTO promo.promo_codes
       (company_id, branch_id, campaign_id, code, usage_limit)
     VALUES ($1, $2, $3, $4, 1)
     ON CONFLICT (branch_id, code) DO NOTHING`, companyID, branchID, campaignID, code)
	return tag.RowsAffected() > 0, err
}

// VoucherConversion counts the distinct redeemed codes among codes and
// their discount total (released redemptions excluded).
func (s *Service) VoucherConversion(ctx context.Context, q database.Querier, codes []string) (count, value float64, err error) {
	err = q.QueryRow(ctx, `SELECT COUNT(DISTINCT r.code_id)::float8, COALESCE(SUM(r.discount_amount), 0)::float8
     FROM promo.promo_redemptions r
     JOIN promo.promo_codes k ON k.id = r.code_id
     WHERE r.status <> 'released' AND k.code = ANY($1)`, codes).Scan(&count, &value)
	return count, value, err
}

// PhoneConversion counts the redemptions of a campaign by the given phones.
func (s *Service) PhoneConversion(ctx context.Context, q database.Querier, campaignID string, phones []string) (count, value float64, err error) {
	err = q.QueryRow(ctx, `SELECT COUNT(*)::float8, COALESCE(SUM(r.discount_amount), 0)::float8
     FROM promo.promo_redemptions r
     WHERE r.campaign_id = $1 AND r.status <> 'released' AND r.phone = ANY($2)`, campaignID, phones).Scan(&count, &value)
	return count, value, err
}
