package promo

import (
	"context"

	"nuhabit/backend/internal/modules/storedvalue/promo/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/validate"
)

// Promo code lifecycle for checkouts (promo-server.ts): a read-only
// preview, then HOLD (claimed inside the caller's transaction under an
// advisory lock per campaign) → CAPTURE (final) → RELEASE (quota back).
// The lock is per campaign because the campaign limit spans many codes.

// VenueScope is the company + branch a code belongs to.
type VenueScope struct {
	CompanyID string
	BranchID  string
}

// LineInput is one cart line from the caller; categories are reloaded from
// the catalog.
type LineInput struct {
	ProductID string
	Amount    float64
}

// Context types of promo_redemptions.context_type.
const (
	ContextTicketBooking = "ticket_booking"
	ContextPosOrder      = "pos_order"
)

// PromoRejectedError is PromoRejectedError: the code does not apply
// (HTTP 422 with Error() as the message).
type PromoRejectedError struct{ Reason domain.RejectReason }

// StatusCode is the HTTP status the TS attaches.
func (e *PromoRejectedError) StatusCode() int { return 422 }

func (e *PromoRejectedError) Error() string { return domain.RejectMessages[e.Reason] }

// codeRowFull is a promo_codes row joined with its campaign.
type codeRowFull struct {
	CodeID            string
	Code              string
	CodeUsageLimit    *int
	CodeUsageCount    int
	CodeIsActive      bool
	CampaignID        string
	CampaignName      string
	DiscountType      string
	Value             float64
	MaxDiscount       *float64
	MinPurchase       float64
	ValidFrom         *string
	ValidUntil        *string
	UsageLimit        *int
	PerPhoneLimit     *int
	Scope             string
	CampaignIsActive  bool
	TargetProductIDs  []string
	TargetCategoryIDs []string
	Eligibility       string
	NewMemberDays     *int
}

func (r codeRowFull) rule() domain.CampaignRule {
	return domain.CampaignRule{
		DiscountType: r.DiscountType, Value: r.Value, MaxDiscount: r.MaxDiscount, MinPurchase: r.MinPurchase,
		ValidFrom: r.ValidFrom, ValidUntil: r.ValidUntil, UsageLimit: r.UsageLimit, PerPhoneLimit: r.PerPhoneLimit,
		Scope: r.Scope, IsActive: r.CampaignIsActive, TargetProductIDs: r.TargetProductIDs,
		TargetCategoryIDs: r.TargetCategoryIDs, Eligibility: r.Eligibility, NewMemberDays: r.NewMemberDays,
	}
}

func (r codeRowFull) state() domain.CodeState {
	return domain.CodeState{IsActive: r.CodeIsActive, UsageLimit: r.CodeUsageLimit, UsageCount: r.CodeUsageCount}
}

// findCode looks a code up in the venue, case-insensitively; nil when
// unknown.
func findCode(ctx context.Context, q database.Querier, scope VenueScope, code string) (*codeRowFull, error) {
	rows, err := q.Query(ctx, `
		SELECT k.id, k.code, k.usage_limit, k.usage_count, k.is_active,
		       c.id, c.name, c.discount_type,
		       c.value::float8, c.max_discount::float8, c.min_purchase::float8,
		       c.valid_from::text, c.valid_until::text,
		       c.usage_limit, c.per_phone_limit, c.scope, c.is_active,
		       c.target_product_ids::text[], c.target_category_ids::text[],
		       c.eligibility, c.new_member_days
		FROM promo.promo_codes k
		JOIN promo.promo_campaigns c ON c.id = k.campaign_id
		WHERE k.branch_id = $1 AND k.company_id = $2 AND upper(k.code) = upper($3)
		LIMIT 1`, scope.BranchID, scope.CompanyID, validate.JSTrim(code))
	found, err := collect[codeRowFull](rows, err)
	if err != nil || len(found) == 0 {
		return nil, err
	}
	return &found[0], nil
}

// usageContext loads what EvaluatePromo needs besides the rows: live
// counts (under the lock on the write path), the targeted lines with
// their catalog categories, and the member history when the campaign
// limits eligibility.
func (s *Service) usageContext(ctx context.Context, q database.Querier, row *codeRowFull, channel string, subtotal float64,
	phone *string, lines []LineInput, customerID *string) (domain.UsageContext, error) {
	u := domain.UsageContext{Today: s.TodayJakarta(), Channel: channel, Subtotal: subtotal}
	if err := q.QueryRow(ctx, `
		SELECT
		  COUNT(*) FILTER (WHERE status <> 'released'),
		  COUNT(*) FILTER (WHERE status <> 'released' AND phone = $2)
		FROM promo.promo_redemptions
		WHERE campaign_id = $1`, row.CampaignID, phone).Scan(&u.CampaignUsedCount, &u.PhoneUsedCount); err != nil {
		return u, err
	}
	if lines != nil && domain.HasTargets(row.rule()) {
		var ids []string
		seen := map[string]bool{}
		for _, l := range lines {
			if l.ProductID != "" && !seen[l.ProductID] {
				seen[l.ProductID] = true
				ids = append(ids, l.ProductID)
			}
		}
		categoryOf := map[string]*string{}
		if len(ids) > 0 {
			var err error
			if categoryOf, err = s.ports.Catalog.ProductCategories(ctx, q, ids); err != nil {
				return u, err
			}
		}
		u.Lines = make([]domain.Line, len(lines))
		for i, l := range lines {
			u.Lines[i] = domain.Line{ProductID: l.ProductID, CategoryID: categoryOf[l.ProductID], Amount: l.Amount}
		}
	}
	if customerID != nil && *customerID != "" && row.Eligibility != domain.EligibilityAll {
		member, err := s.ports.Members.PromoContext(ctx, q, *customerID)
		if err != nil {
			return u, err
		}
		u.Member = member
	}
	return u, nil
}

// PreviewInput is a code to validate without claiming it.
type PreviewInput struct {
	Scope    VenueScope
	Code     string
	Channel  string // ticketing_online | ticketing_loket | pos
	Subtotal float64
	Phone    *string
	// Lines nil = not sent (a targeted campaign then rejects).
	Lines      []LineInput
	CustomerID *string
}

// PromoPreview is the TS PromoPreview union: OK with Discount,
// CampaignName and DiscountType, or a Reason with its Message.
type PromoPreview struct {
	OK           bool
	Discount     float64
	CampaignName string
	DiscountType string
	Reason       domain.RejectReason
	Message      string
}

func rejectedPreview(r domain.RejectReason) PromoPreview {
	return PromoPreview{Reason: r, Message: domain.RejectMessages[r]}
}

// PreviewPromoCode is previewPromoCode: a read-only check for the wizard
// and the cashier, without lock or claim (indicative; HoldPromoRedemption
// decides). An unknown code gets the "nonaktif" message so codes cannot be
// enumerated. The TS runs it on the pool; pass the pool or a transaction.
func (s *Service) PreviewPromoCode(ctx context.Context, q database.Querier, in PreviewInput) (PromoPreview, error) {
	row, err := findCode(ctx, q, in.Scope, in.Code)
	if err != nil {
		return PromoPreview{}, err
	}
	if row == nil {
		return rejectedPreview(domain.RejectInactive), nil
	}
	u, err := s.usageContext(ctx, q, row, in.Channel, in.Subtotal, in.Phone, in.Lines, in.CustomerID)
	if err != nil {
		return PromoPreview{}, err
	}
	res := domain.EvaluatePromo(row.rule(), row.state(), u)
	if !res.OK {
		return rejectedPreview(res.Reason), nil
	}
	return PromoPreview{OK: true, Discount: res.Discount, CampaignName: row.CampaignName, DiscountType: row.DiscountType}, nil
}

// HoldInput claims a code for one checkout context.
type HoldInput struct {
	Scope       VenueScope
	Code        string
	Channel     string
	ContextType string // ContextTicketBooking | ContextPosOrder
	ContextID   string
	Subtotal    float64
	Phone       *string
	CustomerID  *string
	Lines       []LineInput
}

// PromoHold is a held redemption.
type PromoHold struct {
	RedemptionID string
	CodeID       string
	CampaignName string
	Discount     float64
}

// HoldPromoRedemption is holdPromoRedemption, inside the caller's
// transaction: pg_advisory_xact_lock(hashtext('promo'),
// hashtext(campaign_id)), reload code and campaign under the lock, count
// live uses, evaluate, then usage_count + 1 and a `held` redemption. A
// rejection is a *PromoRejectedError. The partial unique index on
// (context_type, context_id) backs one code per transaction (a second hold
// fails with 23505).
func (s *Service) HoldPromoRedemption(ctx context.Context, q database.Querier, in HoldInput) (PromoHold, error) {
	// The first lookup only finds the campaign to lock.
	initial, err := findCode(ctx, q, in.Scope, in.Code)
	if err != nil {
		return PromoHold{}, err
	}
	if initial == nil {
		return PromoHold{}, &PromoRejectedError{Reason: domain.RejectInactive}
	}
	if _, err := q.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext('promo'), hashtext($1::text))`, initial.CampaignID); err != nil {
		return PromoHold{}, err
	}
	// Reload under the lock: usage_count and status may have moved.
	row, err := findCode(ctx, q, in.Scope, in.Code)
	if err != nil {
		return PromoHold{}, err
	}
	if row == nil {
		return PromoHold{}, &PromoRejectedError{Reason: domain.RejectInactive}
	}
	u, err := s.usageContext(ctx, q, row, in.Channel, in.Subtotal, in.Phone, in.Lines, in.CustomerID)
	if err != nil {
		return PromoHold{}, err
	}
	res := domain.EvaluatePromo(row.rule(), row.state(), u)
	if !res.OK {
		return PromoHold{}, &PromoRejectedError{Reason: res.Reason}
	}
	if _, err := q.Exec(ctx, `UPDATE promo.promo_codes
		SET usage_count = usage_count + 1, updated_at = now()
		WHERE id = $1`, row.CodeID); err != nil {
		return PromoHold{}, err
	}
	hold := PromoHold{CodeID: row.CodeID, CampaignName: row.CampaignName, Discount: res.Discount}
	err = q.QueryRow(ctx, `
		INSERT INTO promo.promo_redemptions
		  (company_id, branch_id, code_id, campaign_id, campaign_name,
		   discount_type, value, context_type, context_id, phone, customer_id,
		   discount_amount, status)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'held')
		RETURNING id`,
		in.Scope.CompanyID, in.Scope.BranchID, row.CodeID, row.CampaignID, row.CampaignName,
		row.DiscountType, row.Value, in.ContextType, in.ContextID, in.Phone, nullIfEmptyPtr(in.CustomerID),
		res.Discount,
	).Scan(&hold.RedemptionID)
	return hold, err
}

// CapturePromoRedemption marks the context's held redemption final (for
// example on a PAID webhook). Idempotent: only `held` rows change; true
// when one did.
func (s *Service) CapturePromoRedemption(ctx context.Context, q database.Querier, contextType, contextID string) (bool, error) {
	tag, err := q.Exec(ctx, `UPDATE promo.promo_redemptions
		SET status = 'captured', updated_at = now()
		WHERE context_type = $1 AND context_id = $2 AND status = 'held'`, contextType, contextID)
	return tag.RowsAffected() > 0, err
}

// ReleasePromoRedemption releases the context's redemptions (expired,
// cancelled, void) and gives each code its use back, never below zero.
// Idempotent: released rows are left alone; true when one was released.
func (s *Service) ReleasePromoRedemption(ctx context.Context, q database.Querier, contextType, contextID string) (bool, error) {
	rows, err := q.Query(ctx, `UPDATE promo.promo_redemptions
		SET status = 'released', updated_at = now()
		WHERE context_type = $1 AND context_id = $2 AND status <> 'released'
		RETURNING code_id`, contextType, contextID)
	codeIDs, err := collectStrings(rows, err)
	if err != nil {
		return false, err
	}
	for _, id := range codeIDs {
		if _, err := q.Exec(ctx, `UPDATE promo.promo_codes
			SET usage_count = GREATEST(usage_count - 1, 0), updated_at = now()
			WHERE id = $1`, id); err != nil {
			return false, err
		}
	}
	return len(codeIDs) > 0, nil
}
