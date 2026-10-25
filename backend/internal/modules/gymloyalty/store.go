package gymloyalty

import (
	"context"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/gymloyalty/domain"
	"nuhabit/backend/internal/platform/database"
)

// SQL of the gym-loyalty tables plus the spending and attendance reads it
// makes on the gym, POS and shop tables (read only).

var tierFields = []string{"id::text", "name", "color", "min_spend_idr::float8", "discount_percent::float8",
	"early_booking_days", "cancel_window_hours", "waitlist_priority", "perks"}

// tierColumns lists the tier columns, qualified with alias when set.
func tierColumns(alias string) string {
	cols := make([]string, len(tierFields))
	for i, f := range tierFields {
		if alias != "" {
			f = alias + "." + f
		}
		cols[i] = f
	}
	return strings.Join(cols, ", ")
}

func scanTier(row pgx.Row) (domain.Tier, error) {
	var t domain.Tier
	err := row.Scan(&t.ID, &t.Name, &t.Color, &t.MinSpend, &t.DiscountPercent,
		&t.EarlyBookingDays, &t.CancelWindowHours, &t.WaitlistPriority, &t.Perks)
	return t, err
}

// activeTiers is the ladder, lowest threshold first.
func activeTiers(ctx context.Context, q database.Querier) ([]domain.Tier, error) {
	rows, err := q.Query(ctx, `SELECT `+tierColumns("")+` FROM gym.membership_tiers WHERE is_active ORDER BY min_spend_idr`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (domain.Tier, error) { return scanTier(r) })
}

func tierByID(ctx context.Context, q database.Querier, id string) (*domain.Tier, error) {
	t, err := scanTier(q.QueryRow(ctx, `SELECT `+tierColumns("")+` FROM gym.membership_tiers WHERE id = $1 AND is_active`, id))
	if database.IsNoRows(err) {
		return nil, nil
	}
	return &t, err
}

func tierCounts(ctx context.Context, q database.Querier) (map[string]int, error) {
	rows, err := q.Query(ctx, `SELECT tier_id::text, count(*)::int FROM gym.member_memberships WHERE tier_id IS NOT NULL GROUP BY tier_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]int{}
	for rows.Next() {
		var id string
		var n int
		if err := rows.Scan(&id, &n); err != nil {
			return nil, err
		}
		out[id] = n
	}
	return out, rows.Err()
}

// tierWrite is a validated tier from the editor.
type tierWrite struct {
	Name              string
	Color             *string
	MinSpend          float64
	DiscountPercent   float64
	EarlyBookingDays  int
	CancelWindowHours *int
	WaitlistPriority  bool
	Perks             []string
}

func insertTier(ctx context.Context, q database.Querier, t tierWrite, actor string) (string, error) {
	var id string
	err := q.QueryRow(ctx, `INSERT INTO gym.membership_tiers
		(name, color, min_spend_idr, discount_percent, early_booking_days, cancel_window_hours, waitlist_priority, perks, created_by, updated_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9) RETURNING id::text`,
		t.Name, t.Color, t.MinSpend, t.DiscountPercent, t.EarlyBookingDays, t.CancelWindowHours, t.WaitlistPriority, t.Perks, actor).Scan(&id)
	return id, err
}

func updateTier(ctx context.Context, q database.Querier, id string, t tierWrite, actor string) error {
	_, err := q.Exec(ctx, `UPDATE gym.membership_tiers SET name = $2, color = $3, min_spend_idr = $4, discount_percent = $5,
		early_booking_days = $6, cancel_window_hours = $7, waitlist_priority = $8, perks = $9, updated_by = $10, updated_at = now()
		WHERE id = $1 AND is_active`,
		id, t.Name, t.Color, t.MinSpend, t.DiscountPercent, t.EarlyBookingDays, t.CancelWindowHours, t.WaitlistPriority, t.Perks, actor)
	return err
}

// retireTier takes the tier off the ladder; history keeps its name.
func retireTier(ctx context.Context, q database.Querier, id, actor string) error {
	_, err := q.Exec(ctx, `UPDATE gym.membership_tiers SET is_active = false, updated_by = $2, updated_at = now()
		WHERE id = $1 AND is_active`, id, actor)
	return err
}

func loadSettings(ctx context.Context, q database.Querier) (domain.Settings, error) {
	var s domain.Settings
	err := q.QueryRow(ctx, `SELECT tier_hold_months, xp_class_attended, xp_pt_attended, xp_offpeak_bonus, xp_weekly_streak,
		weekly_streak_min_sessions, xp_streak_4w, xp_purchase_per_step, purchase_step_idr, xp_early_renewal
		FROM gym.loyalty_settings WHERE id`).Scan(&s.TierHoldMonths, &s.XPClassAttended, &s.XPPTAttended, &s.XPOffPeakBonus,
		&s.XPWeeklyStreak, &s.WeeklyStreakMinSessions, &s.XPStreak4W, &s.XPPurchasePerStep, &s.PurchaseStepIdr, &s.XPEarlyRenewal)
	return s, err
}

func saveSettings(ctx context.Context, q database.Querier, s domain.Settings, actor string) error {
	_, err := q.Exec(ctx, `INSERT INTO gym.loyalty_settings (id, tier_hold_months, xp_class_attended, xp_pt_attended, xp_offpeak_bonus,
		xp_weekly_streak, weekly_streak_min_sessions, xp_streak_4w, xp_purchase_per_step, purchase_step_idr, xp_early_renewal, updated_by, updated_at)
		VALUES (true, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
		ON CONFLICT (id) DO UPDATE SET tier_hold_months = EXCLUDED.tier_hold_months, xp_class_attended = EXCLUDED.xp_class_attended,
		  xp_pt_attended = EXCLUDED.xp_pt_attended, xp_offpeak_bonus = EXCLUDED.xp_offpeak_bonus, xp_weekly_streak = EXCLUDED.xp_weekly_streak,
		  weekly_streak_min_sessions = EXCLUDED.weekly_streak_min_sessions, xp_streak_4w = EXCLUDED.xp_streak_4w,
		  xp_purchase_per_step = EXCLUDED.xp_purchase_per_step, purchase_step_idr = EXCLUDED.purchase_step_idr,
		  xp_early_renewal = EXCLUDED.xp_early_renewal, updated_by = EXCLUDED.updated_by, updated_at = now()`,
		s.TierHoldMonths, s.XPClassAttended, s.XPPTAttended, s.XPOffPeakBonus, s.XPWeeklyStreak, s.WeeklyStreakMinSessions,
		s.XPStreak4W, s.XPPurchasePerStep, s.PurchaseStepIdr, s.XPEarlyRenewal, actor)
	return err
}

// BranchOffPeak is one branch with its off-peak window (nil when none).
type BranchOffPeak struct {
	BranchID string          `json:"branch_id"`
	Name     string          `json:"branch_name"`
	Timezone string          `json:"timezone"`
	Window   *domain.OffPeak `json:"offpeak"`
}

func offPeakHours(ctx context.Context, q database.Querier) ([]BranchOffPeak, error) {
	rows, err := q.Query(ctx, `SELECT b.id::text, b.name, COALESCE(b.timezone, 'Asia/Jakarta'), o.starts_min, o.ends_min
		FROM configuration.branches b LEFT JOIN gym.loyalty_offpeak_hours o ON o.branch_id = b.id
		WHERE b.is_active ORDER BY b.name`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (BranchOffPeak, error) {
		var b BranchOffPeak
		var start, end *int
		err := r.Scan(&b.BranchID, &b.Name, &b.Timezone, &start, &end)
		if start != nil && end != nil {
			b.Window = &domain.OffPeak{Start: *start, End: *end}
		}
		return b, err
	})
}

func setOffPeak(ctx context.Context, q database.Querier, branchID string, w *domain.OffPeak) error {
	if w == nil {
		_, err := q.Exec(ctx, `DELETE FROM gym.loyalty_offpeak_hours WHERE branch_id = $1`, branchID)
		return err
	}
	_, err := q.Exec(ctx, `INSERT INTO gym.loyalty_offpeak_hours (branch_id, starts_min, ends_min) VALUES ($1, $2, $3)
		ON CONFLICT (branch_id) DO UPDATE SET starts_min = EXCLUDED.starts_min, ends_min = EXCLUDED.ends_min, updated_at = now()`,
		branchID, w.Start, w.End)
	return err
}

// Spend is a member's spending in the window [From, To], net of refunds.
type Spend struct {
	Total float64    `json:"total_idr"`
	Gym   float64    `json:"gym_idr"`
	POS   float64    `json:"pos_idr"`
	Shop  float64    `json:"shop_idr"`
	From  domain.Day `json:"from"`
	To    domain.Day `json:"to"`
}

// spendQuery sums, per member and in [$2, $3): paid gym purchases less
// their refunds, paid POS orders that were not voided, cancelled or merged
// away, and paid shop orders not cancelled or refunded.
const spendQuery = `SELECT
	(SELECT COALESCE(SUM(GREATEST(CASE WHEN status = 'refunded' THEN total_idr - COALESCE(refunded_idr, total_idr) ELSE total_idr END, 0)), 0)::float8
	   FROM gym.credit_purchases
	  WHERE customer_id = $1 AND status IN ('paid', 'refunded') AND paid_at >= $2 AND paid_at < $3),
	(SELECT COALESCE(SUM(total_amount), 0)::float8 FROM pos.pos_orders
	  WHERE customer_id = $1 AND payment_status = 'paid' AND voided_at IS NULL
	    AND status NOT IN ('cancelled', 'voided', 'merged') AND created_at >= $2 AND created_at < $3),
	(SELECT COALESCE(SUM(total), 0)::float8 FROM shop.orders
	  WHERE customer_id = $1 AND paid_at >= $2 AND paid_at < $3 AND status NOT IN ('pending', 'cancelled', 'refund'))`

func memberSpend(ctx context.Context, q database.Querier, customerID string, today domain.Day) (Spend, error) {
	from, to := domain.SpendWindow(today)
	start, end := windowBounds(from, to)
	s := Spend{From: from, To: to}
	err := q.QueryRow(ctx, spendQuery, customerID, start, end).Scan(&s.Gym, &s.POS, &s.Shop)
	s.Total = s.Gym + s.POS + s.Shop
	return s, err
}

// windowBounds turns the window's days into instants in the member zone.
func windowBounds(from, to domain.Day) (time.Time, time.Time) {
	start, _ := time.ParseInLocation(time.DateOnly, string(from), memberZone)
	end, _ := time.ParseInLocation(time.DateOnly, string(to.AddDays(1)), memberZone)
	return start, end
}

// spendingMembers are the members to evaluate: those holding a tier row
// and those who spent anything in the window.
func spendingMembers(ctx context.Context, q database.Querier, today domain.Day) ([]string, error) {
	start, end := windowBounds(domain.SpendWindow(today))
	rows, err := q.Query(ctx, `SELECT customer_id::text FROM gym.member_memberships WHERE evaluated_on < $3::date
		UNION SELECT customer_id::text FROM gym.credit_purchases WHERE paid_at >= $1 AND paid_at < $2
		UNION SELECT customer_id::text FROM pos.pos_orders
		       WHERE customer_id IS NOT NULL AND payment_status = 'paid' AND created_at >= $1 AND created_at < $2
		UNION SELECT customer_id::text FROM shop.orders WHERE customer_id IS NOT NULL AND paid_at >= $1 AND paid_at < $2
		EXCEPT SELECT customer_id::text FROM gym.member_memberships WHERE evaluated_on >= $3::date`, start, end, string(today))
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

// storedMembership is gym.member_memberships, the row locked when lock.
type storedMembership struct {
	State       domain.State
	Spend       float64
	EvaluatedOn domain.Day
}

func loadMembership(ctx context.Context, q database.Querier, customerID string, lock bool) (storedMembership, error) {
	sql := `SELECT tier_id::text, valid_until::text, spend_12m::float8, evaluated_on::text FROM gym.member_memberships WHERE customer_id = $1`
	if lock {
		sql += ` FOR UPDATE`
	}
	var m storedMembership
	var until *string
	var on string
	err := q.QueryRow(ctx, sql, customerID).Scan(&m.State.TierID, &until, &m.Spend, &on)
	if database.IsNoRows(err) {
		return m, nil
	}
	if until != nil {
		d := domain.Day(*until)
		m.State.ValidUntil = &d
	}
	m.EvaluatedOn = domain.Day(on)
	return m, err
}

func saveMembership(ctx context.Context, q database.Querier, customerID string, ev domain.Evaluation, spend float64, today domain.Day) error {
	var tierID *string
	if ev.Tier != nil {
		tierID = &ev.Tier.ID
	}
	_, err := q.Exec(ctx, `INSERT INTO gym.member_memberships (customer_id, tier_id, valid_until, spend_12m, evaluated_on)
		VALUES ($1, $2, $3::date, $4, $5::date)
		ON CONFLICT (customer_id) DO UPDATE SET tier_id = EXCLUDED.tier_id, valid_until = EXCLUDED.valid_until,
		  spend_12m = EXCLUDED.spend_12m, evaluated_on = EXCLUDED.evaluated_on, updated_at = now()`,
		customerID, tierID, ev.ValidUntil, spend, string(today))
	return err
}

func insertTierChange(ctx context.Context, q database.Querier, customerID string, c *domain.Change, spend float64, at time.Time) error {
	id := func(t *domain.Tier) *string {
		if t == nil {
			return nil
		}
		return &t.ID
	}
	name := func(t *domain.Tier) *string {
		if t == nil {
			return nil
		}
		return &t.Name
	}
	_, err := q.Exec(ctx, `INSERT INTO gym.membership_tier_changes
		(customer_id, from_tier_id, to_tier_id, from_tier_name, to_tier_name, direction, spend_12m, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
		customerID, id(c.From), id(c.To), name(c.From), name(c.To), c.Direction, spend, at)
	return err
}

// TierChange is one row of a member's tier history.
type TierChange struct {
	Direction string    `json:"direction"`
	FromTier  *string   `json:"from_tier_name"`
	ToTier    *string   `json:"to_tier_name"`
	Spend     float64   `json:"spend_12m_idr"`
	CreatedAt time.Time `json:"created_at"`
}

func tierHistory(ctx context.Context, q database.Querier, customerID string, limit int) ([]TierChange, error) {
	rows, err := q.Query(ctx, `SELECT direction, from_tier_name, to_tier_name, spend_12m::float8, created_at
		FROM gym.membership_tier_changes WHERE customer_id = $1 ORDER BY created_at DESC, id LIMIT $2`, customerID, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (TierChange, error) {
		var c TierChange
		err := r.Scan(&c.Direction, &c.FromTier, &c.ToTier, &c.Spend, &c.CreatedAt)
		return c, err
	})
}

// storedTier is the tier a member holds now, read without evaluating.
func storedTier(ctx context.Context, q database.Querier, customerID string) (*domain.Tier, error) {
	t, err := scanTier(q.QueryRow(ctx, `SELECT `+tierColumns("t")+` FROM gym.member_memberships m
		JOIN gym.membership_tiers t ON t.id = m.tier_id AND t.is_active WHERE m.customer_id = $1`, customerID))
	if database.IsNoRows(err) {
		return nil, nil
	}
	return &t, err
}

func loadStanding(ctx context.Context, q database.Querier, customerID string) (domain.Standing, error) {
	var s domain.Standing
	err := q.QueryRow(ctx, `SELECT status, reason, suspended_until FROM gym.member_status WHERE customer_id = $1`, customerID).
		Scan(&s.Status, &s.Reason, &s.SuspendedUntil)
	if database.IsNoRows(err) {
		return domain.Standing{Status: domain.StatusActive}, nil
	}
	return s, err
}
