package referral

import (
	"context"
	"encoding/json"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/memberportal/domain"
	"nuhabit/backend/internal/platform/database"
)

// SQL of the referral tables (crm.referral_*) and the reads of the gym
// purchases, customers, promo campaigns and ARK Coin wallet they settle
// against. Every function runs on the pool or an open transaction.

func loadSettings(ctx context.Context, q database.Querier) (Settings, error) {
	s := DefaultSettings
	err := q.QueryRow(ctx, `
SELECT is_active, referrer_credits, referrer_ark_idr::float8, referee_credits, referee_campaign_id::text,
       credit_validity_days, hold_days, monthly_cap
  FROM crm.referral_settings WHERE id`).
		Scan(&s.Active, &s.ReferrerCredits, &s.ReferrerArkIdr, &s.RefereeCredits, &s.RefereeCampaignID,
			&s.CreditValidityDays, &s.HoldDays, &s.MonthlyCap)
	if database.IsNoRows(err) {
		return DefaultSettings, nil
	}
	return s, err
}

func saveSettings(ctx context.Context, q database.Querier, s Settings, actorID string) error {
	_, err := q.Exec(ctx, `
INSERT INTO crm.referral_settings AS r (id, is_active, referrer_credits, referrer_ark_idr, referee_credits,
       referee_campaign_id, credit_validity_days, hold_days, monthly_cap, updated_by, updated_at)
VALUES (true, $1, $2, $3, $4, $5, $6, $7, $8, NULLIF($9, '')::uuid, now())
ON CONFLICT (id) DO UPDATE SET
  is_active = EXCLUDED.is_active, referrer_credits = EXCLUDED.referrer_credits,
  referrer_ark_idr = EXCLUDED.referrer_ark_idr, referee_credits = EXCLUDED.referee_credits,
  referee_campaign_id = EXCLUDED.referee_campaign_id, credit_validity_days = EXCLUDED.credit_validity_days,
  hold_days = EXCLUDED.hold_days, monthly_cap = EXCLUDED.monthly_cap,
  updated_by = EXCLUDED.updated_by, updated_at = now()`,
		s.Active, s.ReferrerCredits, s.ReferrerArkIdr, s.RefereeCredits, s.RefereeCampaignID,
		s.CreditValidityDays, s.HoldDays, s.MonthlyCap, actorID)
	return err
}

// Campaign is a promo campaign the referee discount can come from.
type Campaign struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	DiscountType string   `json:"discount_type"`
	Value        float64  `json:"value"`
	MaxDiscount  *float64 `json:"max_discount"`
	Scope        string   `json:"scope"`
	IsActive     bool     `json:"is_active"`
}

const campaignColumns = `id::text, name, discount_type, value::float8, max_discount::float8, scope, is_active`

func scanCampaign(row pgx.CollectableRow) (Campaign, error) {
	var c Campaign
	err := row.Scan(&c.ID, &c.Name, &c.DiscountType, &c.Value, &c.MaxDiscount, &c.Scope, &c.IsActive)
	return c, err
}

// gymCampaigns lists the campaigns that apply to gym packages.
func gymCampaigns(ctx context.Context, q database.Querier) ([]Campaign, error) {
	rows, err := q.Query(ctx, `SELECT `+campaignColumns+` FROM promo.promo_campaigns
		WHERE scope IN ('gym', 'semua') ORDER BY is_active DESC, created_at DESC LIMIT 200`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, scanCampaign)
}

func campaign(ctx context.Context, q database.Querier, id string) (*Campaign, error) {
	rows, err := q.Query(ctx, `SELECT `+campaignColumns+` FROM promo.promo_campaigns WHERE id = $1`, id)
	if err != nil {
		return nil, err
	}
	c, err := pgx.CollectOneRow(rows, scanCampaign)
	if database.IsNoRows(err) {
		return nil, nil
	}
	return &c, err
}

func codeOf(ctx context.Context, q database.Querier, customerID string) (string, error) {
	var code string
	err := q.QueryRow(ctx, `SELECT code FROM crm.referral_codes WHERE customer_id = $1`, customerID).Scan(&code)
	if database.IsNoRows(err) {
		return "", nil
	}
	return code, err
}

// insertCode stores code for the member; false when the member already has
// one or another member holds the code.
func insertCode(ctx context.Context, q database.Querier, customerID, code string) (bool, error) {
	tag, err := q.Exec(ctx, `INSERT INTO crm.referral_codes (customer_id, code) VALUES ($1, $2) ON CONFLICT DO NOTHING`, customerID, code)
	return tag.RowsAffected() == 1, err
}

// member is a customer as the program reads it.
type member struct {
	Party
	Name string
}

func scanMember(row pgx.Row) (*member, error) {
	var m member
	var phone string
	err := row.Scan(&m.CustomerID, &m.Name, &phone, &m.Email)
	if database.IsNoRows(err) {
		return nil, nil
	}
	m.PhoneDigits = domain.NormalizePhoneDigits(phone)
	return &m, err
}

const memberColumns = `c.id::text, COALESCE(c.name, ''), COALESCE(c.phone, ''), lower(COALESCE(c.email, ''))`

// owner is the active member holding code.
func owner(ctx context.Context, q database.Querier, code string) (*member, error) {
	return scanMember(q.QueryRow(ctx, `SELECT `+memberColumns+`
		FROM crm.referral_codes k JOIN pos.pos_customers c ON c.id = k.customer_id
		WHERE k.code = $1 AND c.is_active IS NOT FALSE`, code))
}

func memberByID(ctx context.Context, q database.Querier, customerID string) (*member, error) {
	return scanMember(q.QueryRow(ctx, `SELECT `+memberColumns+` FROM pos.pos_customers c WHERE c.id = $1`, customerID))
}

// deviceSeen reports whether the device belongs to the referrer or already
// signed up another referral.
func deviceSeen(ctx context.Context, q database.Querier, hash, referrerID string) (bool, error) {
	if hash == "" {
		return false, nil
	}
	var seen bool
	err := q.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM crm.referral_devices WHERE device_hash = $1 AND customer_id = $2)
		OR EXISTS (SELECT 1 FROM crm.referrals WHERE device_hash = $1)`, hash, referrerID).Scan(&seen)
	return seen, err
}

func recordDevice(ctx context.Context, q database.Querier, hash, customerID string) error {
	if hash == "" {
		return nil
	}
	_, err := q.Exec(ctx, `INSERT INTO crm.referral_devices (device_hash, customer_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, hash, customerID)
	return err
}

type newReferral struct {
	ReferrerID, RefereeID, Code, Status, Reason, DeviceHash string
}

func insertReferral(ctx context.Context, q database.Querier, r newReferral) (string, error) {
	var id string
	err := q.QueryRow(ctx, `
INSERT INTO crm.referrals (referrer_id, referee_id, code, status, reason, device_hash)
VALUES ($1, $2, $3, $4, NULLIF($5, ''), NULLIF($6, ''))
ON CONFLICT (referee_id) DO NOTHING
RETURNING id::text`, r.ReferrerID, r.RefereeID, r.Code, r.Status, r.Reason, r.DeviceHash).Scan(&id)
	if database.IsNoRows(err) {
		return "", nil
	}
	return id, err
}

// issueVoucher adds a single-use promo code to an active campaign, at the
// campaign's venue; false when the campaign is gone, off or the code clashes.
func issueVoucher(ctx context.Context, q database.Querier, campaignID, code string) (bool, error) {
	tag, err := q.Exec(ctx, `
INSERT INTO promo.promo_codes (company_id, branch_id, campaign_id, code, usage_limit)
SELECT company_id, branch_id, id, $2, 1 FROM promo.promo_campaigns WHERE id = $1 AND is_active
ON CONFLICT (branch_id, code) DO NOTHING`, campaignID, code)
	return tag.RowsAffected() == 1, err
}

func setVoucher(ctx context.Context, q database.Querier, referralID, code string) error {
	_, err := q.Exec(ctx, `UPDATE crm.referrals SET referee_voucher_code = $2, updated_at = now() WHERE id = $1`, referralID, code)
	return err
}

/* ── Settlement ─────────────────────────────────────────────────────── */

// qualify moves joined referrals whose friend has a paid gym purchase with a
// non-zero total to held, on the earliest such purchase.
func qualify(ctx context.Context, q database.Querier, holdDays int) (int64, error) {
	tag, err := q.Exec(ctx, `
UPDATE crm.referrals r
   SET status = 'held', purchase_id = p.id, qualified_at = p.paid_at,
       hold_until = p.paid_at + make_interval(days => $1), updated_at = now()
  FROM (SELECT DISTINCT ON (customer_id) id, customer_id, paid_at
          FROM gym.credit_purchases
         WHERE paid_at IS NOT NULL AND total_idr > 0
           AND customer_id IN (SELECT referee_id FROM crm.referrals WHERE status = 'joined')
         ORDER BY customer_id, paid_at, id) p
 WHERE r.status = 'joined' AND r.referee_id = p.customer_id`, holdDays)
	return tag.RowsAffected(), err
}

// voidRefunded voids held referrals whose purchase was refunded.
func voidRefunded(ctx context.Context, q database.Querier, now time.Time) (int64, error) {
	tag, err := q.Exec(ctx, `
UPDATE crm.referrals r SET status = 'void', reason = 'refunded', settled_at = $1, updated_at = now()
  FROM gym.credit_purchases p
 WHERE r.status = 'held' AND p.id = r.purchase_id AND p.status = 'refunded'`, now)
	return tag.RowsAffected(), err
}

func dueReferrals(ctx context.Context, q database.Querier, now time.Time, limit int) ([]string, error) {
	rows, err := q.Query(ctx, `SELECT id::text FROM crm.referrals WHERE status = 'held' AND hold_until <= $1
		ORDER BY hold_until, id LIMIT $2`, now, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

// heldReferral is a held referral locked for settlement, with the status
// of its purchase.
type heldReferral struct {
	ID, ReferrerID, RefereeID string
	PurchaseStatus            string
}

func lockHeld(ctx context.Context, q database.Querier, id string) (*heldReferral, error) {
	var r heldReferral
	err := q.QueryRow(ctx, `
SELECT r.id::text, r.referrer_id::text, r.referee_id::text, COALESCE(p.status, '')
  FROM crm.referrals r LEFT JOIN gym.credit_purchases p ON p.id = r.purchase_id
 WHERE r.id = $1 AND r.status = 'held'
   FOR UPDATE OF r`, id).Scan(&r.ID, &r.ReferrerID, &r.RefereeID, &r.PurchaseStatus)
	if database.IsNoRows(err) {
		return nil, nil
	}
	return &r, err
}

// lockReferrer serializes the settlements of one referrer so two cannot
// both fit under the monthly cap.
func lockReferrer(ctx context.Context, q database.Querier, referrerID string) error {
	_, err := q.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended('referral-cap:' || $1, 0))`, referrerID)
	return err
}

// rewardedIn counts the referrer's rewarded referrals settled in [from, to).
func rewardedIn(ctx context.Context, q database.Querier, referrerID string, from, to time.Time) (int, error) {
	var n int
	err := q.QueryRow(ctx, `SELECT count(*)::int FROM crm.referrals
		WHERE referrer_id = $1 AND status = 'rewarded' AND settled_at >= $2 AND settled_at < $3`, referrerID, from, to).Scan(&n)
	return n, err
}

type settlement struct {
	Status          string
	Reason          string
	ReferrerCredits int
	ReferrerArkIdr  float64
	RefereeCredits  int
}

func settle(ctx context.Context, q database.Querier, id string, s settlement, now time.Time) error {
	_, err := q.Exec(ctx, `
UPDATE crm.referrals SET status = $2, reason = NULLIF($3, ''), referrer_credits = $4, referrer_ark_idr = $5,
       referee_credits = $6, settled_at = $7, updated_at = now()
 WHERE id = $1`, id, s.Status, s.Reason, s.ReferrerCredits, s.ReferrerArkIdr, s.RefereeCredits, now)
	return err
}

// arkCoinEnabled reads the CRM switch crm_settings.ark_coin_enabled; unreadable means on.
func arkCoinEnabled(ctx context.Context, q database.Querier) bool {
	var raw json.RawMessage
	if err := q.QueryRow(ctx, `SELECT value FROM crm.crm_settings WHERE key = 'ark_coin_enabled'`).Scan(&raw); err != nil {
		return true
	}
	return domain.ParseFeatureFlag(raw, true)
}

// creditArk adds a referral bonus to the member's ARK Coin wallet: a bonus
// row (the wallet's default expiry applies) and the new balance.
func creditArk(ctx context.Context, q database.Querier, customerID string, amount float64, referralID string) error {
	var balance float64
	if err := q.QueryRow(ctx, `SELECT COALESCE(ark_coin_balance, 0)::float8 FROM pos.pos_customers WHERE id = $1 FOR UPDATE`, customerID).Scan(&balance); err != nil {
		return err
	}
	rate := 1000.0
	_ = q.QueryRow(ctx, `SELECT ark_rate::float8 FROM pos.pos_loyalty_settings WHERE is_active ORDER BY updated_at DESC LIMIT 1`).Scan(&rate)
	if rate <= 0 {
		rate = 1000
	}
	meta, err := json.Marshal(map[string]any{"source": "referral", "referral_id": referralID})
	if err != nil {
		return err
	}
	after := balance + amount
	if _, err := q.Exec(ctx, `
INSERT INTO pos.pos_wallet_transactions (customer_id, type, amount, ark_coins, balance_before, balance_after, status, notes, metadata)
VALUES ($1, 'bonus', $2, $3, $4, $5, 'completed', 'Bonus referral', $6::jsonb)`,
		customerID, amount, amount/rate, balance, after, string(meta)); err != nil {
		return err
	}
	_, err = q.Exec(ctx, `UPDATE pos.pos_customers SET ark_coin_balance = $2, updated_at = now() WHERE id = $1`, customerID, after)
	return err
}

/* ── Reads ──────────────────────────────────────────────────────────── */

// Friend is one referral as its referrer sees it.
type Friend struct {
	Name      string     `json:"name"`
	Status    string     `json:"status"`
	JoinedAt  time.Time  `json:"joined_at"`
	SettledAt *time.Time `json:"settled_at"`
}

func friends(ctx context.Context, q database.Querier, referrerID string) ([]Friend, error) {
	rows, err := q.Query(ctx, `
SELECT COALESCE(c.name, ''), r.status, r.created_at, r.settled_at
  FROM crm.referrals r JOIN pos.pos_customers c ON c.id = r.referee_id
 WHERE r.referrer_id = $1 AND r.status <> 'blocked'
 ORDER BY r.created_at DESC LIMIT 100`, referrerID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (Friend, error) {
		var f Friend
		err := row.Scan(&f.Name, &f.Status, &f.JoinedAt, &f.SettledAt)
		f.Name = ShortName(f.Name)
		return f, err
	})
}

// Stats counts a referrer's friends: signed up with the code, bought a
// first package, and rewarded.
type Stats struct {
	Invited  int `json:"invited"`
	Joined   int `json:"joined"`
	Rewarded int `json:"rewarded"`
}

func stats(ctx context.Context, q database.Querier, referrerID string) (Stats, error) {
	var s Stats
	err := q.QueryRow(ctx, `
SELECT count(*) FILTER (WHERE status <> 'blocked')::int,
       count(*) FILTER (WHERE status IN ('held', 'rewarded', 'capped'))::int,
       count(*) FILTER (WHERE status = 'rewarded')::int
  FROM crm.referrals WHERE referrer_id = $1`, referrerID).Scan(&s.Invited, &s.Joined, &s.Rewarded)
	return s, err
}

// Welcome is what a referred member got at sign-up.
type Welcome struct {
	ReferrerName string  `json:"referrer_name"`
	VoucherCode  *string `json:"voucher_code"`
	Status       string  `json:"status"`
}

func welcome(ctx context.Context, q database.Querier, refereeID string) (*Welcome, error) {
	var w Welcome
	err := q.QueryRow(ctx, `
SELECT COALESCE(c.name, ''), r.referee_voucher_code, r.status
  FROM crm.referrals r JOIN pos.pos_customers c ON c.id = r.referrer_id
 WHERE r.referee_id = $1 AND r.status <> 'blocked'`, refereeID).Scan(&w.ReferrerName, &w.VoucherCode, &w.Status)
	if database.IsNoRows(err) {
		return nil, nil
	}
	w.ReferrerName = ShortName(w.ReferrerName)
	return &w, err
}

// PersonRef is a member in the staff lists.
type PersonRef struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Phone string `json:"phone"`
}

// Row is a referral in the staff list.
type Row struct {
	ID                 string     `json:"id"`
	Status             string     `json:"status"`
	Reason             *string    `json:"reason"`
	Code               string     `json:"code"`
	Referrer           PersonRef  `json:"referrer"`
	Referee            PersonRef  `json:"referee"`
	PurchaseID         *string    `json:"purchase_id"`
	PurchaseTotalIdr   *float64   `json:"purchase_total_idr"`
	CreatedAt          time.Time  `json:"created_at"`
	QualifiedAt        *time.Time `json:"qualified_at"`
	HoldUntil          *time.Time `json:"hold_until"`
	SettledAt          *time.Time `json:"settled_at"`
	ReferrerCredits    int        `json:"referrer_credits"`
	ReferrerArkIdr     float64    `json:"referrer_ark_idr"`
	RefereeCredits     int        `json:"referee_credits"`
	RefereeVoucherCode *string    `json:"referee_voucher_code"`
}

// ListFilter narrows the staff list.
type ListFilter struct {
	Status string
	Search string
	Limit  int
	Offset int
}

func list(ctx context.Context, q database.Querier, f ListFilter) ([]Row, int, error) {
	where := `($1 = '' OR r.status = $1) AND ($2 = '' OR a.name ILIKE '%' || $2 || '%' OR b.name ILIKE '%' || $2 || '%'
		OR a.phone ILIKE '%' || $2 || '%' OR b.phone ILIKE '%' || $2 || '%' OR r.code = upper($2))`
	from := ` FROM crm.referrals r
		JOIN pos.pos_customers a ON a.id = r.referrer_id
		JOIN pos.pos_customers b ON b.id = r.referee_id
		LEFT JOIN gym.credit_purchases p ON p.id = r.purchase_id
		WHERE ` + where
	search := strings.TrimSpace(f.Search)
	var total int
	if err := q.QueryRow(ctx, `SELECT count(*)::int`+from, f.Status, search).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := q.Query(ctx, `
SELECT r.id::text, r.status, r.reason, r.code,
       a.id::text, COALESCE(a.name, ''), COALESCE(a.phone, ''), b.id::text, COALESCE(b.name, ''), COALESCE(b.phone, ''),
       r.purchase_id::text, p.total_idr::float8, r.created_at, r.qualified_at, r.hold_until, r.settled_at,
       r.referrer_credits, r.referrer_ark_idr::float8, r.referee_credits, r.referee_voucher_code`+from+`
 ORDER BY r.created_at DESC, r.id LIMIT $3 OFFSET $4`, f.Status, search, f.Limit, f.Offset)
	if err != nil {
		return nil, 0, err
	}
	out, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (Row, error) {
		var r Row
		err := row.Scan(&r.ID, &r.Status, &r.Reason, &r.Code,
			&r.Referrer.ID, &r.Referrer.Name, &r.Referrer.Phone, &r.Referee.ID, &r.Referee.Name, &r.Referee.Phone,
			&r.PurchaseID, &r.PurchaseTotalIdr, &r.CreatedAt, &r.QualifiedAt, &r.HoldUntil, &r.SettledAt,
			&r.ReferrerCredits, &r.ReferrerArkIdr, &r.RefereeCredits, &r.RefereeVoucherCode)
		return r, err
	})
	return out, total, err
}

func statusCounts(ctx context.Context, q database.Querier) (map[string]int, error) {
	out := map[string]int{}
	for _, s := range Statuses {
		out[s] = 0
	}
	rows, err := q.Query(ctx, `SELECT status, count(*)::int FROM crm.referrals GROUP BY status`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var status string
		var n int
		if err := rows.Scan(&status, &n); err != nil {
			return nil, err
		}
		out[status] = n
	}
	return out, rows.Err()
}

// Leader is a referrer's month in the leaderboard.
type Leader struct {
	PersonRef
	Invited  int     `json:"invited"`
	Joined   int     `json:"joined"`
	Rewarded int     `json:"rewarded"`
	Credits  int     `json:"credits"`
	ArkIdr   float64 `json:"ark_idr"`
}

// leaderboard ranks referrers by rewards settled in [from, to), then by
// friends who bought and signed up in it.
func leaderboard(ctx context.Context, q database.Querier, from, to time.Time, limit int) ([]Leader, error) {
	rows, err := q.Query(ctx, `
SELECT c.id::text, COALESCE(c.name, ''), COALESCE(c.phone, ''),
       count(*) FILTER (WHERE r.status <> 'blocked' AND r.created_at >= $1 AND r.created_at < $2)::int AS invited,
       count(*) FILTER (WHERE r.status IN ('held', 'rewarded', 'capped') AND r.qualified_at >= $1 AND r.qualified_at < $2)::int AS joined,
       count(*) FILTER (WHERE r.status = 'rewarded' AND r.settled_at >= $1 AND r.settled_at < $2)::int AS rewarded,
       COALESCE(sum(r.referrer_credits) FILTER (WHERE r.status = 'rewarded' AND r.settled_at >= $1 AND r.settled_at < $2), 0)::int,
       COALESCE(sum(r.referrer_ark_idr) FILTER (WHERE r.status = 'rewarded' AND r.settled_at >= $1 AND r.settled_at < $2), 0)::float8
  FROM crm.referrals r JOIN pos.pos_customers c ON c.id = r.referrer_id
 WHERE (r.created_at >= $1 AND r.created_at < $2) OR (r.qualified_at >= $1 AND r.qualified_at < $2)
    OR (r.settled_at >= $1 AND r.settled_at < $2)
 GROUP BY c.id
HAVING count(*) FILTER (WHERE r.status <> 'blocked') > 0
 ORDER BY rewarded DESC, joined DESC, invited DESC, c.name
 LIMIT $3`, from, to, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (Leader, error) {
		var l Leader
		err := row.Scan(&l.ID, &l.Name, &l.Phone, &l.Invited, &l.Joined, &l.Rewarded, &l.Credits, &l.ArkIdr)
		return l, err
	})
}
