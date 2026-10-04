// Package xp is the CRM loyalty XP engine (lib/crm/loyalty-ledger.ts,
// loyalty-tier-sync.ts, loyalty-pos-earn.ts, loyalty-awards.ts and
// loyalty-corrections.ts): an idempotent crm_xp_ledger, member profiles
// enrolled on demand, pos_customers.total_xp as the canonical XP and the tier
// derived from it.
//
// Every method runs on the caller's database.DB (pool or transaction). The
// award entry points that the TS made best-effort (a failure never failed
// the sale) run inside a savepoint, so a failure leaves the caller's
// transaction usable.
package xp

import (
	"context"
	"log/slog"
	"math"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/crm/internal/kit"
	"nuhabit/backend/internal/modules/crm/xp/domain"
	"nuhabit/backend/internal/platform/database"
)

// PosReads are the POS-owned reads the engine needs. internal/app adapts
// them; they run on the caller's Querier.
type PosReads interface {
	// LoyaltySettings is the active pos_loyalty_settings row, normalized
	// (defaults when there is none).
	LoyaltySettings(ctx context.Context, q database.Querier) (domain.PosSettings, error)
	// ProductXP is pos_products.xp_points per product id.
	ProductXP(ctx context.Context, q database.Querier, ids []string) (map[string]float64, error)
	// ProductBonusXP is pos_products.bonus_xp per product id.
	ProductBonusXP(ctx context.Context, q database.Querier, ids []string) (map[string]float64, error)
	// OrderNumber is pos_orders.order_number ("" when unknown).
	OrderNumber(ctx context.Context, q database.Querier, orderID string) string
}

// Engine posts and corrects XP.
type Engine struct {
	Pos PosReads
	Log *slog.Logger
	Now func() time.Time
}

// Result mirrors CrmXpAwardResult.
type Result struct {
	Status    string   `json:"status"` // posted | skipped | duplicate | error
	XPAwarded float64  `json:"xpAwarded"`
	Reason    string   `json:"reason,omitempty"`
	LedgerIDs []string `json:"ledgerIds,omitempty"`
}

// Event is one earn posting (PostXpEventInput).
type Event struct {
	CustomerID     string
	SourceType     string
	SourceID       *string
	OutletID       *string
	CompanyID      *string
	BranchID       *string
	XPAmount       float64
	RuleID         *string
	ReferenceTable string
	ReferenceID    string
	IdempotencyKey string
	Description    string
	Metadata       map[string]any
	// NoTierMultiplier posts the nominal amount (applyTierMultiplier: false).
	NoTierMultiplier bool
	// SourceChannel defaults to "pos".
	SourceChannel string
}

// Profile is the part of crm_member_profiles the engine reads.
type Profile struct {
	ID             string
	LifetimeXP     float64
	TierMultiplier float64 // the tier's xp_multiplier (0 when unknown)
}

func (e *Engine) now() time.Time {
	if e.Now != nil {
		return e.Now()
	}
	return time.Now()
}

func (e *Engine) log() *slog.Logger {
	if e.Log != nil {
		return e.Log
	}
	return slog.Default()
}

func strp(s string) *string { return &s }

// PostEvent writes one idempotent earn row and bumps the profile mirror. It
// does not touch pos_customers (callers run SyncAfterEarn).
func (e *Engine) PostEvent(ctx context.Context, q database.DB, in Event) (Result, error) {
	if in.XPAmount <= 0 {
		return Result{Status: "skipped", Reason: "zero_xp"}, nil
	}
	var existing string
	err := q.QueryRow(ctx, `SELECT id::text FROM crm.crm_xp_ledger WHERE idempotency_key = $1 LIMIT 1`, in.IdempotencyKey).Scan(&existing)
	switch {
	case err == nil:
		return Result{Status: "duplicate", LedgerIDs: []string{existing}}, nil
	case !database.IsNoRows(err) && !kit.IsMissingCrmSchema(err):
		return Result{}, err
	}

	member, err := e.EnsureProfile(ctx, q, in.CustomerID)
	if err != nil {
		return Result{}, err
	}
	if member == nil {
		return Result{Status: "skipped", Reason: "member_profile_unavailable"}, nil
	}
	multiplier := 1.0
	if !in.NoTierMultiplier {
		tierMult := member.TierMultiplier
		if tierMult == 0 {
			tierMult = 1
		}
		if in.RuleID != nil {
			var enabled *bool
			err := q.QueryRow(ctx, `SELECT tier_multiplier_enabled FROM crm.crm_xp_rules WHERE id = $1`, *in.RuleID).Scan(&enabled)
			if err != nil && !database.IsNoRows(err) {
				return Result{}, err
			}
			if enabled != nil && *enabled {
				multiplier = tierMult
			}
		} else {
			multiplier = tierMult
		}
	}
	delta := math.Max(0, math.Floor(in.XPAmount*multiplier))
	if delta <= 0 {
		return Result{Status: "skipped", Reason: "zero_xp"}, nil
	}
	before := member.LifetimeXP
	after := before + delta
	channel := in.SourceChannel
	if channel == "" {
		channel = "pos"
	}
	meta := in.Metadata
	if meta == nil {
		meta = map[string]any{}
	}
	metaJSON, _ := kit.MarshalNoEscape(meta)
	var ledgerID string
	err = q.QueryRow(ctx, `INSERT INTO crm.crm_xp_ledger
		(member_id, customer_id, direction, source_channel, source_type, source_id, outlet_id, company_id, branch_id,
		 xp_delta, balance_before, balance_after, lifetime_before, lifetime_after, rule_id, reference_table,
		 reference_id, idempotency_key, description, metadata)
		VALUES ($1, $2, 'earn', $3, $4, $5, $6, $7, $8, $9, $10, $11, $10, $11, $12, $13, $14, $15, $16, $17::jsonb)
		RETURNING id::text`,
		member.ID, in.CustomerID, channel, in.SourceType, in.SourceID, in.OutletID, in.CompanyID, in.BranchID,
		int64(delta), int64(before), int64(after), in.RuleID, in.ReferenceTable, in.ReferenceID,
		in.IdempotencyKey, in.Description, string(metaJSON)).Scan(&ledgerID)
	if err != nil {
		if database.IsUniqueViolation(err) {
			return Result{Status: "duplicate"}, nil
		}
		return Result{}, err
	}
	_, err = q.Exec(ctx, `UPDATE crm.crm_member_profiles SET lifetime_xp = $2::int, loyalty_score = $2::int, last_activity_at = $3 WHERE id = $1`,
		member.ID, int64(after), e.now())
	if err != nil {
		return Result{}, err
	}
	return Result{Status: "posted", XPAwarded: delta, LedgerIDs: []string{ledgerID}}, nil
}

var nonDigit = regexp.MustCompile(`\D`)

// EnsureProfile returns the member's CRM profile, enrolling the customer on
// the tier matching pos_customers.membership_tier (else regular) when
// missing. nil when the customer or both tiers do not exist.
func (e *Engine) EnsureProfile(ctx context.Context, q database.DB, customerID string) (*Profile, error) {
	load := func() (*Profile, error) {
		var p Profile
		var mult *float64
		err := q.QueryRow(ctx, `SELECT p.id::text, p.lifetime_xp::float8, t.xp_multiplier::float8
			FROM crm.crm_member_profiles p LEFT JOIN crm.crm_membership_tiers t ON t.id = p.tier_id
			WHERE p.customer_id = $1`, customerID).Scan(&p.ID, &p.LifetimeXP, &mult)
		if database.IsNoRows(err) {
			return nil, nil
		}
		if err != nil {
			return nil, err
		}
		if mult != nil {
			p.TierMultiplier = *mult
		}
		return &p, nil
	}
	p, err := load()
	if err != nil || p != nil {
		return p, err
	}

	var phone, tierCode *string
	var totalXP *float64
	err = q.QueryRow(ctx, `SELECT phone, membership_tier, total_xp::float8 FROM pos.pos_customers WHERE id = $1`, customerID).
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
	err = q.QueryRow(ctx, `SELECT id::text FROM crm.crm_membership_tiers
		WHERE code = ANY($1::text[]) AND is_active ORDER BY (code = $2) DESC LIMIT 1`, []string{code, "regular"}, code).Scan(&tierID)
	if database.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	xp := int64(0)
	if totalXP != nil {
		xp = int64(*totalXP)
	}
	cols := `customer_id, tier_id, lifetime_xp, loyalty_score, status, metadata, last_activity_at`
	vals := `$1, $2, $3::int, $3::int, 'active', '{"enrolled_by":"pos_checkout"}'::jsonb, $4`
	args := []any{customerID, tierID, xp, e.now()}
	if phone != nil && *phone != "" {
		digits := nonDigit.ReplaceAllString(*phone, "")
		if len(digits) > 10 {
			digits = digits[len(digits)-10:]
		}
		cols += `, member_code`
		vals += `, $5`
		args = append(args, "ARK-"+digits)
	}
	err = database.WithTx(ctx, q, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `INSERT INTO crm.crm_member_profiles (`+cols+`) VALUES (`+vals+`)`, args...)
		return err
	})
	if err != nil && !database.IsUniqueViolation(err) {
		return nil, err
	}
	return load()
}

// SyncAfterEarn mirrors syncAfterEarn: add the XP to pos_customers.total_xp,
// then re-evaluate the tier.
func (e *Engine) SyncAfterEarn(ctx context.Context, q database.DB, customerID string, xp float64) error {
	var total *float64
	err := q.QueryRow(ctx, `SELECT total_xp::float8 FROM pos.pos_customers WHERE id = $1`, customerID).Scan(&total)
	if err == nil {
		cur := 0.0
		if total != nil {
			cur = *total
		}
		if _, err := q.Exec(ctx, `UPDATE pos.pos_customers SET total_xp = $2, updated_at = $3 WHERE id = $1`,
			customerID, int64(cur+xp), e.now()); err != nil {
			return err
		}
	} else if !database.IsNoRows(err) {
		return err
	}
	return e.SyncTier(ctx, q, customerID)
}

// SyncTier mirrors syncTierAfterEarn: the tier follows pos_customers.total_xp
// (the profile mirror when the customer row is missing); it may go down.
func (e *Engine) SyncTier(ctx context.Context, q database.DB, customerID string) error {
	var profileID, tierID string
	var lifetime float64
	err := q.QueryRow(ctx, `SELECT id::text, tier_id::text, lifetime_xp::float8 FROM crm.crm_member_profiles WHERE customer_id = $1`, customerID).
		Scan(&profileID, &tierID, &lifetime)
	if database.IsNoRows(err) {
		return nil
	}
	if err != nil {
		return err
	}
	rows, err := q.Query(ctx, `SELECT id::text, code, rank, min_lifetime_xp::float8 FROM crm.crm_membership_tiers WHERE is_active = true ORDER BY rank DESC`)
	if err != nil {
		return err
	}
	tiers, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (domain.Tier, error) {
		var t domain.Tier
		err := r.Scan(&t.ID, &t.Code, &t.Rank, &t.MinLifetimeXP)
		return t, err
	})
	if err != nil || len(tiers) == 0 {
		return err
	}
	var total *float64
	err = q.QueryRow(ctx, `SELECT total_xp::float8 FROM pos.pos_customers WHERE id = $1`, customerID).Scan(&total)
	switch {
	case err == nil:
		lifetime = 0
		if total != nil {
			lifetime = *total
		}
	case !database.IsNoRows(err):
		return err
	}
	next := domain.PickTierForXP(tiers, lifetime)
	if next == nil || next.ID == tierID {
		return nil
	}
	if _, err := q.Exec(ctx, `UPDATE crm.crm_member_profiles SET tier_id = $2 WHERE id = $1`, profileID, next.ID); err != nil {
		return err
	}
	_, err = q.Exec(ctx, `UPDATE pos.pos_customers SET membership_tier = $2, updated_at = $3 WHERE id = $1`, customerID, next.Code, e.now())
	return err
}

// SyncOrderStats mirrors syncPosCustomerOrderStats: total_spent, visits and
// last visit for every paid order whatever the method. Failures are logged,
// never returned (the TS caught them).
func (e *Engine) SyncOrderStats(ctx context.Context, db database.DB, customerID string, amount float64) {
	err := database.WithTx(ctx, db, func(tx pgx.Tx) error {
		now := e.now()
		_, err := tx.Exec(ctx, `UPDATE pos.pos_customers
			SET total_spent = COALESCE(total_spent, 0) + $2::numeric, visit_count = COALESCE(visit_count, 0) + 1,
			    last_visit = $3, updated_at = $3
			WHERE id = $1`, customerID, amount, now)
		return err
	})
	if err != nil {
		e.log().Error("CRM customer stats sync failed", "error", err)
	}
}

// ReverseOrderStats undoes SyncOrderStats for voided paid orders (the void
// route's stats reversal): total_spent and visit_count drop, floored at 0.
func (e *Engine) ReverseOrderStats(ctx context.Context, q database.DB, customerID string, amount float64, visitDelta int) error {
	_, err := q.Exec(ctx, `UPDATE pos.pos_customers
		SET total_spent = GREATEST(0, COALESCE(total_spent, 0) - $2::numeric),
		    visit_count = GREATEST(0, COALESCE(visit_count, 0) - $3::int), updated_at = $4
		WHERE id = $1`, customerID, amount, visitDelta, e.now())
	return err
}

// FlatAward is a nominal award without tier multiplier (FlatXpInput).
type FlatAward struct {
	CustomerID     string
	XPAmount       float64
	CompanyID      *string
	BranchID       *string
	SourceType     string
	SourceID       string
	ReferenceTable string
	IdempotencyKey string
	Description    string
	SourceChannel  string
}

// AwardFlat mirrors awardFlatXp: post, then mirror into pos_customers and
// re-evaluate the tier when it posted. Errors propagate like the TS.
func (e *Engine) AwardFlat(ctx context.Context, q database.DB, in FlatAward) (Result, error) {
	res, err := e.PostEvent(ctx, q, Event{
		SourceChannel: in.SourceChannel, CustomerID: in.CustomerID, SourceType: in.SourceType,
		SourceID: strp(in.SourceID), CompanyID: in.CompanyID, BranchID: in.BranchID,
		XPAmount: math.Max(0, math.Floor(in.XPAmount)), ReferenceTable: in.ReferenceTable,
		ReferenceID: in.SourceID, IdempotencyKey: in.IdempotencyKey, Description: in.Description,
		NoTierMultiplier: true,
	})
	if err != nil {
		return res, err
	}
	if res.Status == "posted" {
		if err := e.SyncAfterEarn(ctx, q, in.CustomerID, res.XPAwarded); err != nil {
			return res, err
		}
	}
	return res, nil
}

// AwardFreeXP mirrors awardMemberFreeXp (profile completion, once ever).
func (e *Engine) AwardFreeXP(ctx context.Context, q database.DB, customerID string, xp float64, v kit.Venue) (Result, error) {
	return e.AwardFlat(ctx, q, FlatAward{
		CustomerID: customerID, XPAmount: xp, CompanyID: v.CompanyID, BranchID: v.BranchID,
		SourceType: "profile_completion", SourceID: customerID, ReferenceTable: "pos_customers",
		IdempotencyKey: "portal:profile-complete:" + customerID, Description: "Free XP profil lengkap (portal member)",
	})
}

// AwardChallengeXP mirrors awardChallengeXp.
func (e *Engine) AwardChallengeXP(ctx context.Context, q database.DB, customerID, challengeID, title string, xp float64, v kit.Venue) (Result, error) {
	return e.AwardFlat(ctx, q, FlatAward{
		CustomerID: customerID, XPAmount: xp, CompanyID: v.CompanyID, BranchID: v.BranchID,
		SourceType: "challenge", SourceID: challengeID, ReferenceTable: "challenges",
		IdempotencyKey: "challenge:" + challengeID + ":" + customerID, Description: "Hadiah challenge: " + title,
	})
}

// AwardBadgeBonusXP mirrors awardBadgeBonusXp.
func (e *Engine) AwardBadgeBonusXP(ctx context.Context, q database.DB, customerID, badgeID, badgeName string, xp float64, v kit.Venue) (Result, error) {
	return e.AwardFlat(ctx, q, FlatAward{
		CustomerID: customerID, XPAmount: xp, CompanyID: v.CompanyID, BranchID: v.BranchID,
		SourceType: "badge_bonus", SourceID: badgeID, ReferenceTable: "crm_badges",
		IdempotencyKey: "badge:" + badgeID + ":" + customerID, Description: "Bonus badge: " + badgeName,
	})
}

// AwardPartnerEventXP mirrors awardPartnerEventXp.
func (e *Engine) AwardPartnerEventXP(ctx context.Context, q database.DB, customerID, eventID, sourceChannel, description string, xp float64, v kit.Venue) (Result, error) {
	return e.AwardFlat(ctx, q, FlatAward{
		CustomerID: customerID, XPAmount: xp, CompanyID: v.CompanyID, BranchID: v.BranchID,
		SourceChannel: sourceChannel, SourceType: "partner_event", SourceID: eventID,
		ReferenceTable: "crm_external_events", IdempotencyKey: "partner-event:" + eventID, Description: description,
	})
}
