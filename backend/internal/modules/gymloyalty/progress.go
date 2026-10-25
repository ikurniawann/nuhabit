package gymloyalty

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/gymloyalty/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/localtime"
)

// Progress XP: attending a class or PT session, the off-peak bonus, the
// weekly and 4-week streaks, and buying a package (more for an early
// renewal). Every award has an idempotency key, so the job and the outbox
// may run it again. A frozen member (suspended or banned) earns nothing.

// attendedSQL lists attended sessions starting in [$1, $2): class bookings
// checked in or completed, and PT participants checked in at the gate or in
// a completed session.
const attendedSQL = `
	SELECT 'class' AS kind, b.id::text AS id, b.customer_id, s.branch_id, s.starts_at, ct.name AS class_name
	  FROM gym.bookings b
	  JOIN gym.class_sessions s ON s.id = b.session_id
	  JOIN gym.class_types ct ON ct.id = s.class_type_id
	 WHERE b.status IN ('checked_in', 'completed') AND s.starts_at >= $1 AND s.starts_at < $2
	UNION ALL
	SELECT 'pt', p.id::text, p.customer_id, a.branch_id, a.starts_at, ct.name
	  FROM gym.pt_participants p
	  JOIN gym.pt_appointments a ON a.id = p.appointment_id
	  JOIN gym.class_types ct ON ct.id = a.class_type_id
	 WHERE (p.checked_in_at IS NOT NULL OR p.status = 'completed') AND p.status <> 'cancelled'
	   AND a.starts_at >= $1 AND a.starts_at < $2`

type attendance struct {
	Kind, ID, CustomerID string
	BranchID             *string
	StartsAt             time.Time
	ClassName            string
}

func attendedBetween(ctx context.Context, q database.Querier, from, to time.Time) ([]attendance, error) {
	rows, err := q.Query(ctx, `SELECT kind, id, customer_id::text, branch_id::text, starts_at, class_name FROM (`+attendedSQL+`) a
		ORDER BY starts_at, id`, from, to)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (attendance, error) {
		var a attendance
		err := r.Scan(&a.Kind, &a.ID, &a.CustomerID, &a.BranchID, &a.StartsAt, &a.ClassName)
		return a, err
	})
}

// attendanceLookback is how far back the job looks for check-ins it has
// not rewarded yet.
const attendanceLookback = 3 * 24 * time.Hour

// SweepAttendance awards attendance XP, the off-peak bonus and streaks for
// the sessions attended in the last three days. The job runs it every ten
// minutes.
func (s *Service) SweepAttendance(ctx context.Context, now time.Time) error {
	settings, err := loadSettings(ctx, s.db)
	if err != nil {
		return err
	}
	list, err := attendedBetween(ctx, s.db, now.Add(-attendanceLookback), now.Add(time.Minute))
	if err != nil {
		return err
	}
	offpeak, err := offPeakHours(ctx, s.db)
	if err != nil {
		return err
	}
	windows := map[string]BranchOffPeak{}
	for _, b := range offpeak {
		windows[b.BranchID] = b
	}
	var errs []error
	for _, a := range list {
		if err := s.inTx(ctx, func(q database.DB) error { return s.awardAttendance(ctx, q, a, settings, windows, now) }); err != nil {
			errs = append(errs, fmt.Errorf("attendance XP %s %s: %w", a.Kind, a.ID, err))
		}
	}
	if err := s.awardStreaks(ctx, settings, now); err != nil {
		errs = append(errs, err)
	}
	return errors.Join(errs...)
}

func (s *Service) frozen(ctx context.Context, q database.Querier, customerID string, now time.Time) (bool, error) {
	standing, err := loadStanding(ctx, q, customerID)
	return standing.Frozen(now), err
}

func (s *Service) awardAttendance(ctx context.Context, q database.DB, a attendance, settings domain.Settings, windows map[string]BranchOffPeak, now time.Time) error {
	if frozen, err := s.frozen(ctx, q, a.CustomerID, now); err != nil || frozen {
		return err
	}
	zone := memberZone
	var window *domain.OffPeak
	if a.BranchID != nil {
		if b, ok := windows[*a.BranchID]; ok {
			zone, window = localtime.Zone(b.Timezone), b.Window
		}
	}
	when := localtime.Format(a.StartsAt, zone)
	award := XPAward{CustomerID: a.CustomerID, BranchID: a.BranchID, SourceID: a.ID}
	if a.Kind == "pt" {
		award.XP, award.SourceType, award.ReferenceTable = settings.XPPTAttended, "pt_attended", "gym.pt_participants"
		award.IdempotencyKey, award.Description = "gym:attend-pt:"+a.ID, "Hadir PT "+a.ClassName+" · "+when
	} else {
		award.XP, award.SourceType, award.ReferenceTable = settings.XPClassAttended, "class_attended", "gym.bookings"
		award.IdempotencyKey, award.Description = "gym:attend:"+a.ID, "Hadir "+a.ClassName+" · "+when
	}
	if err := s.award(ctx, q, award); err != nil {
		return err
	}
	if a.Kind != "class" || window == nil || !window.Contains(a.StartsAt, zone) {
		return nil
	}
	award.XP, award.SourceType = settings.XPOffPeakBonus, "offpeak_attended"
	award.IdempotencyKey, award.Description = "gym:offpeak:"+a.ID, "Bonus jam sepi · "+a.ClassName+" "+when
	return s.award(ctx, q, award)
}

func (s *Service) award(ctx context.Context, q database.DB, a XPAward) error {
	if a.XP <= 0 || s.XP == nil {
		return nil
	}
	_, err := s.XP.Award(ctx, q, a)
	return err
}

// streakHistory is how far back a streak is counted.
const streakHistory = 53 * 7 * 24 * time.Hour

// awardStreaks gives the weekly streak to members who reached the weekly
// minimum this ISO week (Jakarta), and the 4-week bonus on every fourth week
// in a row. Both are keyed by member and week.
func (s *Service) awardStreaks(ctx context.Context, settings domain.Settings, now time.Time) error {
	if settings.XPWeeklyStreak <= 0 && settings.XPStreak4W <= 0 {
		return nil
	}
	week := localtime.WeekStart(now, memberZone)
	rows, err := s.db.Query(ctx, `SELECT customer_id::text, array_agg(starts_at) FROM (`+attendedSQL+`) a
		WHERE customer_id IN (SELECT customer_id FROM (`+attendedSQL+`) w WHERE starts_at >= $3)
		GROUP BY customer_id HAVING count(*) FILTER (WHERE starts_at >= $3) >= $4`,
		week.Add(-streakHistory), now.Add(time.Minute), week, settings.WeeklyStreakMinSessions)
	if err != nil {
		return err
	}
	type member struct {
		id    string
		times []time.Time
	}
	list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (member, error) {
		var m member
		err := r.Scan(&m.id, &m.times)
		return m, err
	})
	if err != nil {
		return err
	}
	weekKey := localtime.DayKey(week, memberZone)
	label := localtime.FormatDate(week, memberZone)
	var errs []error
	for _, m := range list {
		weeks := domain.StreakWeeks(m.times, week, memberZone, settings.WeeklyStreakMinSessions)
		err := s.inTx(ctx, func(q database.DB) error {
			if frozen, err := s.frozen(ctx, q, m.id, now); err != nil || frozen {
				return err
			}
			base := XPAward{CustomerID: m.id, SourceID: m.id + ":" + weekKey, ReferenceTable: "gym.weekly_streak"}
			weekly := base
			weekly.XP, weekly.SourceType, weekly.IdempotencyKey = settings.XPWeeklyStreak, "weekly_streak", "gym:streak:"+m.id+":"+weekKey
			weekly.Description = "Streak mingguan · minggu " + label + " (minimal " + strconv.Itoa(settings.WeeklyStreakMinSessions) + " sesi)"
			if err := s.award(ctx, q, weekly); err != nil || !domain.FourWeekStreak(weeks) {
				return err
			}
			four := base
			four.XP, four.SourceType, four.IdempotencyKey = settings.XPStreak4W, "streak_4w", "gym:streak4:"+m.id+":"+weekKey
			four.Description = "Streak " + strconv.Itoa(weeks) + " minggu berturut-turut"
			return s.award(ctx, q, four)
		})
		if err != nil {
			errs = append(errs, fmt.Errorf("streak XP %s: %w", m.id, err))
		}
	}
	return errors.Join(errs...)
}

// AwardPurchase gives the package purchase XP and, when the member bought
// while a previous package still ran, the early renewal bonus. The outbox
// subscriber calls it on the purchase's sale journal.
func (s *Service) AwardPurchase(ctx context.Context, q database.DB, purchaseID string) error {
	var customerID, packageName string
	var branchID *string
	var total float64
	var paidAt *time.Time
	var renewal domain.Renewal
	err := q.QueryRow(ctx, `SELECT p.customer_id::text, p.branch_id::text, p.total_idr::float8, p.paid_at, pk.name,
		(SELECT max(mp.ends_at) FROM gym.member_passes mp
		  WHERE mp.customer_id = p.customer_id AND mp.purchase_id IS DISTINCT FROM p.id
		    AND mp.status IN ('active', 'frozen') AND mp.created_at < p.paid_at),
		(SELECT COALESCE(SUM(l.amount), 0)::int FROM gym.credit_ledger l JOIN gym.credit_lots o ON o.id = l.lot_id
		  WHERE o.customer_id = p.customer_id AND o.purchase_id IS NOT NULL AND o.purchase_id <> p.id
		    AND o.expires_at > p.paid_at AND l.created_at < p.paid_at)
		FROM gym.credit_purchases p JOIN gym.credit_packages pk ON pk.id = p.package_id
		WHERE p.id = $1 AND p.status = 'paid'`, purchaseID).
		Scan(&customerID, &branchID, &total, &paidAt, &packageName, &renewal.PassRunsUntil, &renewal.CreditsLeft)
	if database.IsNoRows(err) || paidAt == nil {
		return nil
	}
	if err != nil {
		return err
	}
	settings, err := loadSettings(ctx, q)
	if err != nil {
		return err
	}
	if frozen, err := s.frozen(ctx, q, customerID, s.now()); err != nil || frozen {
		return err
	}
	base := XPAward{CustomerID: customerID, BranchID: branchID, SourceID: purchaseID, ReferenceTable: "gym.credit_purchases"}
	buy := base
	buy.XP, buy.SourceType, buy.IdempotencyKey = domain.PurchaseXP(total, settings), "package_purchase", "gym:purchase:"+purchaseID
	buy.Description = "Beli paket " + packageName
	if err := s.award(ctx, q, buy); err != nil {
		return err
	}
	renewal.PaidAt = *paidAt
	if !renewal.Early() {
		return nil
	}
	early := base
	early.XP, early.SourceType, early.IdempotencyKey = settings.XPEarlyRenewal, "early_renewal", "gym:early-renewal:"+purchaseID
	early.Description = "Perpanjang sebelum paket habis · " + packageName
	return s.award(ctx, q, early)
}

// ProgressView is the member app progress screen.
type ProgressView struct {
	Status        domain.Status   `json:"status"`
	Frozen        bool            `json:"frozen"`
	XP            XPStanding      `json:"xp"`
	StreakWeeks   int             `json:"streak_weeks"`
	WeekSessions  int             `json:"week_sessions"`
	MonthSessions int             `json:"month_sessions"`
	Rules         domain.Settings `json:"rules"`
	History       []XPEntry       `json:"history"`
}

// Progress is the member's XP, streak and attendance this week and month.
func (s *Service) Progress(ctx context.Context, customerID string) (ProgressView, error) {
	if err := requireMember(ctx, s.db, customerID); err != nil {
		return ProgressView{}, err
	}
	now := s.now()
	settings, err := loadSettings(ctx, s.db)
	if err != nil {
		return ProgressView{}, err
	}
	standing, err := loadStanding(ctx, s.db, customerID)
	if err != nil {
		return ProgressView{}, err
	}
	view := ProgressView{Status: standing.Effective(now), Frozen: standing.Frozen(now), Rules: settings}
	if s.XP != nil {
		if view.XP, err = s.XP.Standing(ctx, s.db, customerID); err != nil {
			return view, err
		}
		if view.History, err = s.XP.History(ctx, s.db, customerID, 20); err != nil {
			return view, err
		}
	}
	week := localtime.WeekStart(now, memberZone)
	month := monthStart(now, memberZone)
	rows, err := s.db.Query(ctx, `SELECT starts_at FROM (`+attendedSQL+`) a WHERE customer_id = $3`,
		week.Add(-streakHistory), now.Add(time.Minute), customerID)
	if err != nil {
		return view, err
	}
	times, err := pgx.CollectRows(rows, pgx.RowTo[time.Time])
	if err != nil {
		return view, err
	}
	for _, t := range times {
		if !t.Before(week) {
			view.WeekSessions++
		}
		if !t.Before(month) {
			view.MonthSessions++
		}
	}
	view.StreakWeeks = domain.StreakWeeks(times, week, memberZone, settings.WeeklyStreakMinSessions)
	if view.StreakWeeks == 0 && view.WeekSessions < settings.WeeklyStreakMinSessions {
		// This week is still open: the run that ended last week still counts.
		view.StreakWeeks = domain.StreakWeeks(times, week.AddDate(0, 0, -7), memberZone, settings.WeeklyStreakMinSessions)
	}
	return view, nil
}

// monthStart is the first day of t's month, 00:00 in loc.
func monthStart(t time.Time, loc *time.Location) time.Time {
	l := t.In(loc)
	return time.Date(l.Year(), l.Month(), 1, 0, 0, 0, 0, loc)
}
