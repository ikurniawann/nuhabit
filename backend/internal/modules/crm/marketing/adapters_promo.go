package marketing

import (
	"context"

	"nuhabit/backend/internal/platform/database"
)

// PromoSQL is the stopgap Promo adapter on promo.promo_codes and
// promo.promo_redemptions, with the SQL of lib/crm/campaigns-server.ts and
// campaigns-admin-server.ts.
// Stopgap adapter: moves to stored-value (promo).
type PromoSQL struct{}

var _ Promo = PromoSQL{}

// IssueCode inserts a single-use code; false on a (branch, code) collision.
func (PromoSQL) IssueCode(ctx context.Context, q database.Querier, companyID, branchID, promoCampaignID, code string) (bool, error) {
	tag, err := q.Exec(ctx, `INSERT INTO promo.promo_codes
       (company_id, branch_id, campaign_id, code, usage_limit)
     VALUES ($1, $2, $3, $4, 1)
     ON CONFLICT (branch_id, code) DO NOTHING`, companyID, branchID, promoCampaignID, code)
	return tag.RowsAffected() > 0, err
}

// BatchConversion counts distinct redeemed codes among codes and their
// discount total (released redemptions excluded).
func (PromoSQL) BatchConversion(ctx context.Context, q database.Querier, codes []string) (Conversion, error) {
	var c Conversion
	err := q.QueryRow(ctx, `SELECT COUNT(DISTINCT r.code_id)::float8, COALESCE(SUM(r.discount_amount), 0)::float8
     FROM promo.promo_redemptions r
     JOIN promo.promo_codes k ON k.id = r.code_id
     WHERE r.status <> 'released' AND k.code = ANY($1)`, codes).Scan(&c.Count, &c.Value)
	return c, err
}

// PublicConversion counts redemptions of a promo campaign by phones.
func (PromoSQL) PublicConversion(ctx context.Context, q database.Querier, promoCampaignID string, phones []string) (Conversion, error) {
	var c Conversion
	err := q.QueryRow(ctx, `SELECT COUNT(*)::float8, COALESCE(SUM(r.discount_amount), 0)::float8
     FROM promo.promo_redemptions r
     WHERE r.campaign_id = $1 AND r.status <> 'released' AND r.phone = ANY($2)`, promoCampaignID, phones).Scan(&c.Count, &c.Value)
	return c, err
}
