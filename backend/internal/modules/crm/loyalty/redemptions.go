package loyalty

import (
	"context"
	"fmt"
	"math"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/crm/internal/kit"
	"nuhabit/backend/internal/modules/crm/loyalty/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

// isMissingRedemptionSchema mirrors the Fase F schema check (42P01/42703).
func isMissingRedemptionSchema(err error) bool { return kit.IsMissingCrmSchema(err) }

// redemptionLimit mirrors redemptionLimit: 1-200, default 100. The value is
// passed as JS String(Number(raw)) so a fractional limit fails in PostgreSQL
// (22P02) as it does from node-postgres.
func redemptionLimit(raw string, present bool) string {
	n, err := strconv.ParseFloat(strings.TrimSpace(raw), 64)
	if strings.TrimSpace(raw) == "" {
		n, err = 0, nil
	}
	if !present || err != nil || math.IsNaN(n) || math.IsInf(n, 0) || n <= 0 {
		return "100"
	}
	return strconv.FormatFloat(math.Min(n, 200), 'f', -1, 64)
}

func (h *handler) listRedemptions(w http.ResponseWriter, r *http.Request) error {
	if _, err := h.guard.Require(r, kit.GateReader); err != nil {
		return err
	}
	q := r.URL.Query()
	var filters []string
	var args []any
	add := func(clause, v string) {
		args = append(args, v)
		filters = append(filters, fmt.Sprintf(clause, len(args)))
	}
	if s := q.Get("status"); s != "" && s != "all" {
		add("r.status = $%d", s)
	}
	if s := q.Get("customer_id"); s != "" {
		add("r.customer_id = $%d::text::uuid", s)
	}
	if s := q.Get("member_id"); s != "" {
		add("r.member_id = $%d::text::uuid", s)
	}
	limit, present := q["limit"]
	raw := ""
	if present {
		raw = limit[0]
	}
	args = append(args, redemptionLimit(raw, present))
	where := ""
	if len(filters) > 0 {
		where = "WHERE " + strings.Join(filters, " AND ")
	}
	rows, err := kit.Query(r.Context(), h.db, `SELECT r.id, r.redemption_number, r.status, r.channel,
            r.min_xp_at_redeem::int AS min_xp_at_redeem,
            r.total_xp_at_redeem::int AS total_xp_at_redeem,
            r.requested_at, r.approved_at, r.fulfilled_at, r.cancelled_at, r.notes,
            r.customer_id, r.voucher_code,
            c.name AS customer_name, c.phone AS customer_phone,
            c.total_xp::float AS customer_total_xp,
            w.id AS reward_id, w.code AS reward_code, w.name AS reward_name,
            w.reward_type,
            json_build_object(
              'id', w.id, 'code', w.code, 'name', w.name,
              'reward_type', w.reward_type, 'min_xp', w.min_xp
            ) AS reward
       FROM crm.crm_redemptions r
       JOIN crm.crm_rewards w ON w.id = r.reward_id
       LEFT JOIN pos.pos_customers c ON c.id = r.customer_id
      `+where+`
      ORDER BY r.requested_at DESC
      LIMIT $`+strconv.Itoa(len(args))+`::text::bigint`, args...)
	if err != nil {
		if isMissingRedemptionSchema(err) {
			return kit.WithMeta(w, []any{}, false)
		}
		return err
	}
	return kit.WithMeta(w, rows, true)
}

// rewardRow is REWARD_SELECT in rewards-server.ts.
type rewardRow struct {
	id, rewardType, quotaPeriod                           string
	minXP, stockRedeemed                                  float64
	requiredTierRank, stockTotal, maxRedemptionsPerMember *float64
	startsAt, endsAt                                      *time.Time
	isActive                                              bool
}

type memberContext struct {
	customerID      string
	memberProfileID *string
	totalXP         float64
	tierRank        *float64
}

func loadRewardForUpdate(ctx context.Context, tx pgx.Tx, id string) (*rewardRow, error) {
	var rw rewardRow
	var rank, stock, maxPer *int32
	var minXP, redeemed int32
	err := tx.QueryRow(ctx, `SELECT r.id::text, r.reward_type, r.quota_period, r.min_xp::int, r.stock_redeemed::int,
		t.rank::int, r.stock_total::int, r.max_redemptions_per_member::int, r.starts_at, r.ends_at, r.is_active
		FROM crm.crm_rewards r LEFT JOIN crm.crm_membership_tiers t ON t.id = r.required_tier_id
		WHERE r.id = $1 FOR UPDATE OF r`, id).
		Scan(&rw.id, &rw.rewardType, &rw.quotaPeriod, &minXP, &redeemed, &rank, &stock, &maxPer, &rw.startsAt, &rw.endsAt, &rw.isActive)
	if database.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	rw.minXP, rw.stockRedeemed = float64(minXP), float64(redeemed)
	rw.requiredTierRank, rw.stockTotal, rw.maxRedemptionsPerMember = f64(rank), f64(stock), f64(maxPer)
	return &rw, nil
}

func f64(v *int32) *float64 {
	if v == nil {
		return nil
	}
	x := float64(*v)
	return &x
}

func loadMemberContext(ctx context.Context, tx pgx.Tx, customerID string) (*memberContext, error) {
	var m memberContext
	var total *float64
	var rank *int32
	err := tx.QueryRow(ctx, `SELECT c.id::text, c.total_xp::float AS total_xp, p.id::text, t.rank::int
       FROM pos.pos_customers c
       LEFT JOIN crm.crm_member_profiles p ON p.customer_id = c.id
       LEFT JOIN LATERAL (
         SELECT rank FROM crm.crm_membership_tiers
          WHERE is_active AND min_lifetime_xp <= COALESCE(c.total_xp, 0)
          ORDER BY rank DESC LIMIT 1
       ) t ON true
      WHERE c.id = $1`, customerID).Scan(&m.customerID, &total, &m.memberProfileID, &rank)
	if database.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if total != nil {
		m.totalXP = *total
	}
	m.tierRank = f64(rank)
	return &m, nil
}

func countRedeemedInWindow(ctx context.Context, tx pgx.Tx, customerID, rewardID, period string, now time.Time) (float64, error) {
	sql := `SELECT COUNT(*)::int FROM crm.crm_redemptions
		WHERE customer_id = $1 AND reward_id = $2 AND status = ANY($3::text[])`
	args := []any{customerID, rewardID, domain.ActiveRedemptionStatuses}
	if start := domain.QuotaWindowStart(period, now); start != nil {
		sql += ` AND requested_at >= $4`
		args = append(args, *start)
	}
	var n int32
	err := tx.QueryRow(ctx, sql, args...).Scan(&n)
	return float64(n), err
}

type redemptionOutcome struct {
	status int
	msg    string
	row    *kit.Row
}

func (o redemptionOutcome) write(w http.ResponseWriter) error {
	if o.row == nil {
		return httpx.Status(o.status, o.msg)
	}
	return kit.OK(w, o.row)
}

func (h *handler) claimRedemption(w http.ResponseWriter, r *http.Request) error {
	user, err := h.guard.Require(r, kit.GateOperator)
	if err != nil {
		return err
	}
	f, err := kit.Form(r)
	if err != nil {
		return err
	}
	customerID := f.UUID("customer_id", required)
	rewardID := f.UUID("reward_id", required)
	notes := f.Str("notes", nullOpt, validate.StrOpts{Trim: true, Max: 500})
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	out, err := h.createRedemption(r.Context(), *customerID, *rewardID, user.ID, notes)
	if err != nil {
		if isMissingRedemptionSchema(err) {
			return httpx.Conflict("Migrasi CRM Fase F belum diterapkan")
		}
		return err
	}
	return out.write(w)
}

// createRedemption mirrors createRedemption with channel "admin": the
// reward row is locked, eligibility re-checked inside the transaction, and
// the claim is fulfilled at once. XP is never deducted.
func (h *handler) createRedemption(ctx context.Context, customerID, rewardID, actorID string, notes *string) (redemptionOutcome, error) {
	var out redemptionOutcome
	now := h.now()
	err := database.WithTx(ctx, h.db, func(tx pgx.Tx) error {
		reward, err := loadRewardForUpdate(ctx, tx, rewardID)
		if err != nil {
			return err
		}
		if reward == nil {
			out = redemptionOutcome{status: 404, msg: "Reward tidak ditemukan"}
			return nil
		}
		member, err := loadMemberContext(ctx, tx, customerID)
		if err != nil {
			return err
		}
		if member == nil {
			out = redemptionOutcome{status: 404, msg: "Member tidak ditemukan"}
			return nil
		}
		used, err := countRedeemedInWindow(ctx, tx, member.customerID, reward.id, reward.quotaPeriod, now)
		if err != nil {
			return err
		}
		elig := domain.EvaluateRewardEligibility(domain.RewardInput{
			IsActive: reward.isActive, RewardType: reward.rewardType, MinXP: reward.minXP,
			RequiredTierRank: reward.requiredTierRank, StockTotal: reward.stockTotal, StockRedeemed: reward.stockRedeemed,
			MaxRedemptionsPerMember: reward.maxRedemptionsPerMember, StartsAt: reward.startsAt, EndsAt: reward.endsAt,
		}, domain.MemberInput{TotalXP: member.totalXP, TierRank: member.tierRank, RedeemedInWindow: used}, now)
		if !elig.Eligible {
			msg := "Member belum memenuhi syarat redeem"
			if elig.Reason != nil {
				msg = *elig.Reason
			}
			out = redemptionOutcome{status: 409, msg: msg}
			return nil
		}
		row, err := kit.QueryOne(ctx, tx, `INSERT INTO crm.crm_redemptions
			(member_id, customer_id, reward_id, min_xp_at_redeem, total_xp_at_redeem,
			 status, channel, requested_by_user_id, processed_by_user_id, fulfilled_at, notes)
			VALUES ($1, $2, $3, $4, $5, 'fulfilled', 'admin', $6, $6, $7, $8)
			RETURNING id, redemption_number, status, channel, requested_at, fulfilled_at`,
			member.memberProfileID, member.customerID, reward.id, int64(reward.minXP), int64(kit.JSRound(member.totalXP)),
			actorID, now, notes)
		if err != nil {
			return err
		}
		if reward.stockTotal != nil {
			if _, err := tx.Exec(ctx, `UPDATE crm.crm_rewards SET stock_redeemed = stock_redeemed + 1, updated_at = now() WHERE id = $1`, reward.id); err != nil {
				return err
			}
		}
		out = redemptionOutcome{row: row}
		return nil
	})
	return out, err
}

var transitions = map[string]struct {
	from   []string
	status string
	column string
}{
	"approve": {[]string{"pending"}, "approved", "approved_at"},
	"fulfill": {[]string{"pending", "approved"}, "fulfilled", "fulfilled_at"},
	"cancel":  {[]string{"pending", "approved"}, "cancelled", "cancelled_at"},
}

func (h *handler) updateRedemption(w http.ResponseWriter, r *http.Request) error {
	user, err := h.guard.Require(r, kit.GateOperator)
	if err != nil {
		return err
	}
	f, err := kit.Form(r)
	if err != nil {
		return err
	}
	id := f.UUID("id", required)
	action := f.Enum("action", required, []string{"approve", "fulfill", "cancel"})
	notes := f.Str("notes", nullOpt, validate.StrOpts{Trim: true, Max: 500})
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	tr := transitions[*action]
	var out redemptionOutcome
	now := h.now()
	err = database.WithTx(r.Context(), h.db, func(tx pgx.Tx) error {
		var status, rewardID string
		err := tx.QueryRow(r.Context(), `SELECT status, reward_id::text FROM crm.crm_redemptions WHERE id = $1 FOR UPDATE`, *id).
			Scan(&status, &rewardID)
		if database.IsNoRows(err) {
			out = redemptionOutcome{status: 404, msg: "Redemption tidak ditemukan"}
			return nil
		}
		if err != nil {
			return err
		}
		if !slices.Contains(tr.from, status) {
			out = redemptionOutcome{status: 409, msg: fmt.Sprintf(`Redemption berstatus "%s" tidak bisa di-%s`, status, *action)}
			return nil
		}
		row, err := kit.QueryOne(r.Context(), tx, `UPDATE crm.crm_redemptions
			SET status = $2, `+tr.column+` = $3,
			    processed_by_user_id = COALESCE($4, processed_by_user_id),
			    notes = COALESCE($5, notes), updated_at = now()
			WHERE id = $1
			RETURNING id, redemption_number, status, channel, requested_at, approved_at, fulfilled_at, cancelled_at`,
			*id, tr.status, now, user.ID, notes)
		if err != nil {
			return err
		}
		if *action == "cancel" {
			if _, err := tx.Exec(r.Context(), `UPDATE crm.crm_rewards SET stock_redeemed = GREATEST(0, stock_redeemed - 1), updated_at = now()
				WHERE id = $1 AND stock_total IS NOT NULL`, rewardID); err != nil {
				return err
			}
		}
		out = redemptionOutcome{row: row}
		return nil
	})
	if err != nil {
		return err
	}
	return out.write(w)
}
