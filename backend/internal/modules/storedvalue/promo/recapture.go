package promo

import (
	"context"

	"nuhabit/backend/internal/platform/database"
)

// Recapture outcomes.
const (
	RecaptureNone      = ""           // the context holds no released redemption
	RecaptureCaptured  = "captured"   // the use counts again
	RecaptureQuotaUsed = "quota_used" // the code or campaign limit is reached meanwhile
)

// RecapturePromoRedemption takes a released redemption back when its
// context is paid after all (a late payment). Under the campaign lock it
// checks the code limit, the campaign limit and the per-phone limit the way
// a hold does, then captures the redemption and counts the use again.
// Dates and other campaign rules are not checked again: the buyer already
// paid the discounted price. Idempotent: a captured redemption is left alone.
func (s *Service) RecapturePromoRedemption(ctx context.Context, q database.Querier, contextType, contextID string) (string, error) {
	var id, codeID, campaignID string
	var phone *string
	err := q.QueryRow(ctx, `SELECT id, code_id, campaign_id, phone FROM promo.promo_redemptions
		WHERE context_type = $1 AND context_id = $2 AND status = 'released'
		  AND NOT EXISTS (SELECT 1 FROM promo.promo_redemptions l
		                   WHERE l.context_type = $1 AND l.context_id = $2 AND l.status <> 'released')
		ORDER BY created_at DESC LIMIT 1`, contextType, contextID).Scan(&id, &codeID, &campaignID, &phone)
	if database.IsNoRows(err) {
		return RecaptureNone, nil
	}
	if err != nil {
		return "", err
	}
	if _, err := q.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext('promo'), hashtext($1::text))`, campaignID); err != nil {
		return "", err
	}
	var free bool
	if err := q.QueryRow(ctx, `
		SELECT CASE WHEN k.usage_limit IS NOT NULL THEN k.usage_count < k.usage_limit
		            ELSE c.usage_limit IS NULL OR (SELECT count(*) FROM promo.promo_redemptions r
		                                            WHERE r.campaign_id = c.id AND r.status <> 'released') < c.usage_limit END
		   AND (c.per_phone_limit IS NULL OR (SELECT count(*) FROM promo.promo_redemptions r
		                                       WHERE r.campaign_id = c.id AND r.status <> 'released' AND r.phone = $2) < c.per_phone_limit)
		  FROM promo.promo_codes k JOIN promo.promo_campaigns c ON c.id = k.campaign_id
		 WHERE k.id = $1`, codeID, phone).Scan(&free); err != nil {
		return "", err
	}
	if !free {
		return RecaptureQuotaUsed, nil
	}
	if _, err := q.Exec(ctx, `UPDATE promo.promo_redemptions SET status = 'captured', updated_at = now() WHERE id = $1`, id); err != nil {
		return "", err
	}
	_, err = q.Exec(ctx, `UPDATE promo.promo_codes SET usage_count = usage_count + 1, updated_at = now() WHERE id = $1`, codeID)
	return RecaptureCaptured, err
}
