package memberportal

import (
	"context"
	"encoding/json"
	"log/slog"
	"math"
	"regexp"
	"strings"

	"nuhabit/backend/internal/modules/memberportal/domain"
	"nuhabit/backend/internal/platform/database"
)

// sqlLoyalty ports the CRM XP writer used by the portal (lib/crm/
// loyalty-ledger.ts, loyalty-tier-sync.ts, loyalty-awards.ts and the top-up
// part of loyalty-pos-earn.ts): an idempotent earn row in crm_xp_ledger, the
// member profile enrolled on demand, then pos_customers.total_xp and the
// tier brought in line. Like the TS it runs on the pool, outside any
// caller transaction.
type sqlLoyalty struct {
	db  database.Querier
	log *slog.Logger
}

type xpEvent struct {
	customerID     string
	sourceType     string
	sourceID       string
	companyID      *string
	branchID       *string
	xpAmount       float64
	referenceTable string
	referenceID    string
	idempotencyKey string
	description    string
	metadata       map[string]any
	tierMultiplier bool
}

type crmProfile struct {
	id             string
	lifetimeXP     float64
	tierMultiplier *float64
}

// AwardFlatXP posts a nominal amount (no tier multiplier) and syncs the
// customer and tier when it posted.
func (l *sqlLoyalty) AwardFlatXP(ctx context.Context, a XPAward) (XPResult, error) {
	res, err := l.postXPEvent(ctx, xpEvent{
		customerID: a.CustomerID, sourceType: a.SourceType, sourceID: a.SourceID,
		companyID: a.CompanyID, branchID: a.BranchID, xpAmount: math.Max(0, math.Floor(a.XPAmount)),
		referenceTable: a.ReferenceTable, referenceID: a.SourceID, idempotencyKey: a.IdempotencyKey,
		description: a.Description, metadata: map[string]any{},
	})
	if err != nil {
		return XPResult{}, err
	}
	if res.Status == "posted" {
		if err := l.syncAfterEarn(ctx, a.CustomerID, res.XPAwarded); err != nil {
			return XPResult{}, err
		}
	}
	return res, nil
}

// AwardTopupXP mirrors awardCrmXpForTopup: XP per pos_loyalty_settings with
// the tier multiplier. Failures never fail the top-up: they come back as
// status "error" (or "skipped" when the CRM schema is missing).
func (l *sqlLoyalty) AwardTopupXP(ctx context.Context, customerID string, amountIdr float64, transactionID string) (XPResult, error) {
	if customerID == "" {
		return XPResult{Status: "skipped"}, nil
	}
	res, err := func() (XPResult, error) {
		venue := (&store{q: l.db}).DefaultVenue(ctx)
		settings, err := loadLoyaltySettings(ctx, l.db)
		if err != nil {
			return XPResult{}, err
		}
		xp := domain.CalculateTopupXP(amountIdr, settings)
		if xp <= 0 {
			return XPResult{Status: "skipped"}, nil
		}
		posted, err := l.postXPEvent(ctx, xpEvent{
			customerID: customerID, sourceType: "topup", sourceID: transactionID,
			companyID: venue.CompanyID, branchID: venue.BranchID, xpAmount: xp,
			referenceTable: "pos_wallet_transactions", referenceID: transactionID,
			idempotencyKey: "pos:topup:" + transactionID,
			description:    "XP topup ARK — " + domain.FormatRupiah(amountIdr),
			metadata: map[string]any{
				"amount": amountIdr, "source": "pos_loyalty_settings", "topup_xp_mode": settings.TopupXPMode,
			},
			tierMultiplier: true,
		})
		if err != nil {
			return XPResult{}, err
		}
		if posted.XPAwarded > 0 {
			if err := l.syncAfterEarn(ctx, customerID, posted.XPAwarded); err != nil {
				return XPResult{}, err
			}
		}
		return posted, nil
	}()
	if err != nil {
		if isMissingSchema(err) {
			return XPResult{Status: "skipped"}, nil
		}
		l.log.Error("CRM XP topup award failed", "error", err.Error())
		return XPResult{Status: "error"}, nil
	}
	return res, nil
}

func isMissingSchema(err error) bool {
	code := database.PgCode(err)
	return code == "42P01" || code == "42703"
}

// postXPEvent writes one idempotent earn row and bumps the profile mirror.
func (l *sqlLoyalty) postXPEvent(ctx context.Context, in xpEvent) (XPResult, error) {
	if in.xpAmount <= 0 {
		return XPResult{Status: "skipped"}, nil
	}
	var existing string
	err := l.db.QueryRow(ctx, `SELECT id FROM crm.crm_xp_ledger WHERE idempotency_key = $1 LIMIT 1`, in.idempotencyKey).Scan(&existing)
	if err == nil {
		return XPResult{Status: "duplicate"}, nil
	}
	if !database.IsNoRows(err) && !isMissingSchema(err) {
		return XPResult{}, err
	}

	member, err := l.ensureMemberProfile(ctx, in.customerID)
	if err != nil {
		return XPResult{}, err
	}
	if member == nil {
		return XPResult{Status: "skipped"}, nil
	}
	multiplier := 1.0
	if in.tierMultiplier && member.tierMultiplier != nil && *member.tierMultiplier != 0 {
		multiplier = *member.tierMultiplier
	}
	delta := math.Max(0, math.Floor(in.xpAmount*multiplier))
	if delta <= 0 {
		return XPResult{Status: "skipped"}, nil
	}
	before := member.lifetimeXP
	after := before + delta
	meta, _ := json.Marshal(in.metadata)
	_, err = l.db.Exec(ctx,
		`INSERT INTO crm.crm_xp_ledger
		   (member_id, customer_id, direction, source_channel, source_type, source_id, outlet_id,
		    company_id, branch_id, xp_delta, balance_before, balance_after, lifetime_before, lifetime_after,
		    rule_id, reference_table, reference_id, idempotency_key, description, metadata)
		 VALUES ($1, $2, 'earn', 'pos', $3, $4, NULL, $5, $6, $7, $8, $9, $10, $11, NULL, $12, $13, $14, $15, $16::jsonb)`,
		member.id, in.customerID, in.sourceType, in.sourceID, in.companyID, in.branchID,
		int64(delta), int64(before), int64(after), int64(before), int64(after), in.referenceTable, in.referenceID,
		in.idempotencyKey, in.description, string(meta))
	if err != nil {
		if database.IsUniqueViolation(err) {
			return XPResult{Status: "duplicate"}, nil
		}
		return XPResult{}, err
	}
	_, err = l.db.Exec(ctx,
		`UPDATE crm.crm_member_profiles
		    SET lifetime_xp = $2, loyalty_score = $3, last_activity_at = now()
		  WHERE id = $1`, member.id, int64(after), int64(after))
	if err != nil {
		return XPResult{}, err
	}
	return XPResult{Status: "posted", XPAwarded: delta}, nil
}

var nonDigitRe = regexp.MustCompile(`\D`)

// ensureMemberProfile returns the CRM profile, enrolling the customer on
// the tier matching membership_tier (else regular) when missing.
func (l *sqlLoyalty) ensureMemberProfile(ctx context.Context, customerID string) (*crmProfile, error) {
	load := func() (*crmProfile, error) {
		var p crmProfile
		err := l.db.QueryRow(ctx,
			`SELECT p.id, p.lifetime_xp::float, t.xp_multiplier::float
			   FROM crm.crm_member_profiles p
			   LEFT JOIN crm.crm_membership_tiers t ON t.id = p.tier_id
			  WHERE p.customer_id = $1`, customerID).Scan(&p.id, &p.lifetimeXP, &p.tierMultiplier)
		if database.IsNoRows(err) {
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
		return &p, nil
	}
	p, err := load()
	if err != nil || p != nil {
		return p, err
	}

	var phone, tierCode *string
	var totalXP *float64
	err = l.db.QueryRow(ctx,
		`SELECT phone, membership_tier, total_xp::float FROM pos.pos_customers WHERE id = $1`, customerID).
		Scan(&phone, &tierCode, &totalXP)
	if database.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	code := "regular"
	if tierCode != nil && *tierCode != "" {
		code = strings.ToLower(*tierCode)
	}
	var tierID string
	err = l.db.QueryRow(ctx,
		`SELECT id FROM crm.crm_membership_tiers
		  WHERE code = ANY($1) AND is_active
		  ORDER BY (code = $2) DESC LIMIT 1`, []string{code, "regular"}, code).Scan(&tierID)
	if database.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var memberCode *string
	if phone != nil && *phone != "" {
		digits := nonDigitRe.ReplaceAllString(*phone, "")
		if len(digits) > 10 {
			digits = digits[len(digits)-10:]
		}
		c := "ARK-" + digits
		memberCode = &c
	}
	xp := int64(deref(totalXP))
	_, err = l.db.Exec(ctx,
		`INSERT INTO crm.crm_member_profiles
		   (customer_id, tier_id, lifetime_xp, loyalty_score, status, metadata, last_activity_at, member_code)
		 VALUES ($1, $2, $3, $5, 'active', '{"enrolled_by":"pos_checkout"}'::jsonb, now(), COALESCE($4, 'ARK-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))))`,
		customerID, tierID, xp, memberCode, xp)
	if err != nil && !database.IsUniqueViolation(err) {
		return nil, err
	}
	return load()
}

// syncAfterEarn mirrors the earned XP into pos_customers.total_xp, then
// moves the profile and customer to the tier the canonical XP reaches.
func (l *sqlLoyalty) syncAfterEarn(ctx context.Context, customerID string, xp float64) error {
	_, err := l.db.Exec(ctx,
		`UPDATE pos.pos_customers SET total_xp = COALESCE(total_xp, 0) + $2, updated_at = now() WHERE id = $1`,
		customerID, int64(xp))
	if err != nil {
		return err
	}
	var profileID, tierID string
	var lifetime float64
	err = l.db.QueryRow(ctx,
		`SELECT id, tier_id, lifetime_xp::float FROM crm.crm_member_profiles WHERE customer_id = $1`, customerID).
		Scan(&profileID, &tierID, &lifetime)
	if err != nil {
		return nil // no profile: nothing to sync, like the TS
	}
	var totalXP *float64
	if err := l.db.QueryRow(ctx, `SELECT total_xp::float FROM pos.pos_customers WHERE id = $1`, customerID).Scan(&totalXP); err == nil {
		lifetime = deref(totalXP)
	}
	var nextID, nextCode string
	err = l.db.QueryRow(ctx,
		`SELECT id, code FROM crm.crm_membership_tiers
		  WHERE is_active AND $1 >= min_lifetime_xp
		  ORDER BY rank DESC LIMIT 1`, lifetime).Scan(&nextID, &nextCode)
	if err != nil || nextID == tierID {
		return nil
	}
	if _, err := l.db.Exec(ctx, `UPDATE crm.crm_member_profiles SET tier_id = $2 WHERE id = $1`, profileID, nextID); err != nil {
		return err
	}
	_, err = l.db.Exec(ctx,
		`UPDATE pos.pos_customers SET membership_tier = $2, updated_at = now() WHERE id = $1`, customerID, nextCode)
	return err
}

// loadLoyaltySettings reads and normalizes the active pos_loyalty_settings.
func loadLoyaltySettings(ctx context.Context, db database.Querier) (domain.LoyaltySettings, error) {
	s := domain.DefaultLoyaltySettings()
	var arkRate, minAmount, xpValue, xpStep *float64
	var presets json.RawMessage
	var xpEnabled *bool
	var mode *string
	err := db.QueryRow(ctx,
		`SELECT ark_rate::float, topup_min_amount::float, topup_presets, topup_xp_enabled, topup_xp_mode,
		        topup_xp_value::float, topup_xp_amount_step::float
		   FROM pos.pos_loyalty_settings WHERE is_active = true ORDER BY updated_at DESC LIMIT 1`).
		Scan(&arkRate, &minAmount, &presets, &xpEnabled, &mode, &xpValue, &xpStep)
	if database.IsNoRows(err) || isMissingSchema(err) {
		return s, nil
	}
	if err != nil {
		return s, err
	}
	if arkRate != nil {
		s.ArkRate = math.Max(1, *arkRate)
	}
	if minAmount != nil {
		s.TopupMinAmount = math.Max(0, *minAmount)
	}
	s.TopupPresets = domain.NormalizeTopupPresets(presets)
	if xpEnabled != nil {
		s.TopupXPEnabled = *xpEnabled
	}
	s.TopupXPMode = "per_amount"
	if mode != nil && strings.ToLower(*mode) == "fixed" {
		s.TopupXPMode = "fixed"
	}
	if xpValue != nil {
		s.TopupXPValue = math.Max(0, *xpValue)
	}
	if xpStep != nil {
		s.TopupXPAmountStep = math.Max(1, *xpStep)
	}
	return s, nil
}
