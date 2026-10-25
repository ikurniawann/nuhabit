package gymcoachleave

import (
	"context"
	"slices"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/gymcoachleave/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/localtime"
)

// QueueLeave is a pending coach leave in the Program Director's queue.
type QueueLeave struct {
	*Leave
	Covers    []*Cover          `json:"covers"`
	Blockers  int               `json:"blockers"`
	Blackouts []domain.Blackout `json:"blackouts"`
	Approvers domain.Approvers  `json:"approvers"`
	CanDecide bool              `json:"can_decide"`
	Reason    string            `json:"cannot_decide_reason,omitempty"`
}

// Queue lists the pending coach leaves (of one branch when branchID is
// set), short notice first, then by start date. It refreshes the covers
// first: requests past their deadline reopen and new sessions get a cover.
func (s *Service) Queue(ctx context.Context, actorID, branchID string) ([]QueueLeave, error) {
	var out []QueueLeave
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		if err := expireRequests(ctx, tx, s.now()); err != nil {
			return err
		}
		leaves, err := listLeaves(ctx, tx, `l.status = 'pending' AND ($1 = '' OR c.branch_id::text = $1)
		    ORDER BY l.is_short_notice DESC, l.start_date, l.created_at`, branchID)
		if err != nil {
			return err
		}
		settings, err := loadSettings(ctx, tx)
		if err != nil {
			return err
		}
		out = make([]QueueLeave, 0, len(leaves))
		for _, l := range leaves {
			if err := syncCovers(ctx, tx, l); err != nil {
				return err
			}
			q := QueueLeave{Leave: l}
			if q.Covers, err = leaveCovers(ctx, tx, l.ID); err != nil {
				return err
			}
			for _, c := range q.Covers {
				if c.Status.Blocking() {
					q.Blockers++
				}
			}
			list, err := blackoutsFor(ctx, tx, l.Coach.BranchID, l.StartDate, l.EndDate)
			if err != nil {
				return err
			}
			q.Blackouts = domain.BlackoutConflicts(settings.NoticeRules[l.LeaveType], list, l.StartDate, l.EndDate)
			if q.Approvers, err = s.approvers(ctx, tx, l.RequesterUserID); err != nil {
				return err
			}
			if q.CanDecide, q.Reason, err = s.canDecide(ctx, tx, l, actorID); err != nil {
				return err
			}
			out = append(out, q)
		}
		return nil
	})
	return out, err
}

// MyLeave is a coach's own leave with its covers.
type MyLeave struct {
	*Leave
	Covers []*Cover `json:"covers"`
}

// Portal is the Cuti tab of Kelas Saya.
type Portal struct {
	Coach         *Coach                       `json:"coach"`
	Leaves        []MyLeave                    `json:"leaves"`
	Incoming      []*Cover                     `json:"incoming"`
	Blackouts     []domain.Blackout            `json:"blackouts"`
	NoticeRules   map[string]domain.NoticeRule `json:"notice_rules"`
	HasEmployee   bool                         `json:"has_employee"`
	ResponseHours int                          `json:"substitute_response_hours"`
}

// Portal is the coach's leaves of the last 60 days and ahead, the
// requests to cover for others, and the rules for a new request.
func (s *Service) Portal(ctx context.Context, userID string) (*Portal, error) {
	coach, err := s.CoachForUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	settings, err := loadSettings(ctx, s.db)
	if err != nil {
		return nil, err
	}
	out := &Portal{Coach: coach, Leaves: []MyLeave{}, Incoming: []*Cover{}, Blackouts: []domain.Blackout{},
		NoticeRules: settings.NoticeRules, ResponseHours: settings.SubstituteResponseHours}
	if coach == nil {
		return out, nil
	}
	if err := s.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM hris.employees WHERE user_id = $1)`, userID).Scan(&out.HasEmployee); err != nil {
		return nil, err
	}
	if err := expireRequests(ctx, s.db, s.now()); err != nil {
		return nil, err
	}
	zone, err := localtime.BranchZone(ctx, s.db, coach.BranchID)
	if err != nil {
		return nil, err
	}
	today := localtime.DayKey(s.now(), zone)
	leaves, err := listLeaves(ctx, s.db, `c.id = $1 AND l.end_date >= $2::date ORDER BY l.start_date DESC LIMIT 50`,
		coach.ID, domain.AddDays(today, -60))
	if err != nil {
		return nil, err
	}
	for _, l := range leaves {
		covers, err := leaveCovers(ctx, s.db, l.ID)
		if err != nil {
			return nil, err
		}
		out.Leaves = append(out.Leaves, MyLeave{Leave: l, Covers: covers})
	}
	if out.Incoming, err = s.IncomingRequests(ctx, coach.ID); err != nil {
		return nil, err
	}
	if out.Blackouts, err = blackoutsFor(ctx, s.db, coach.BranchID, today, domain.AddDays(today, 180)); err != nil {
		return nil, err
	}
	return out, nil
}

// Impact previews a leave from start to end before the coach submits it.
type Impact struct {
	Sessions  []Affected        `json:"sessions"`
	Classes   int               `json:"classes"`
	PT        int               `json:"pt"`
	Members   int               `json:"members"`
	Notice    *ImpactNotice     `json:"notice"`
	Blackouts []domain.Blackout `json:"blackouts"`
}

// ImpactNotice is the minimum notice verdict for the chosen leave type.
type ImpactNotice struct {
	OK            bool   `json:"ok"`
	ShortNotice   bool   `json:"short_notice"`
	NoticeDays    int    `json:"notice_days"`
	MinDays       int    `json:"min_days"`
	EarliestStart string `json:"earliest_start,omitempty"`
	Message       string `json:"message,omitempty"`
}

// maxImpactDays bounds the preview range.
const maxImpactDays = 62

// Impact lists what a leave from start to end would touch.
func (s *Service) Impact(ctx context.Context, coach *Coach, start, end, leaveType string) (*Impact, error) {
	if !domain.ValidDate(start) || !domain.ValidDate(end) || end < start {
		return nil, httpx.BadRequest("Rentang tanggal tidak valid")
	}
	if domain.DaysBetween(start, end) >= maxImpactDays {
		return nil, httpx.BadRequest("Rentang cuti paling panjang 62 hari")
	}
	from, to, zone, err := span(ctx, s.db, coach.BranchID, start, end)
	if err != nil {
		return nil, err
	}
	list, err := affectedSessions(ctx, s.db, coach.ID, from, to)
	if err != nil {
		return nil, err
	}
	out := &Impact{Sessions: list, Blackouts: []domain.Blackout{}}
	for _, a := range list {
		if a.Kind == "pt" {
			out.PT++
		} else {
			out.Classes++
		}
		out.Members += a.Booked
	}
	if leaveType == "" {
		return out, nil
	}
	settings, err := loadSettings(ctx, s.db)
	if err != nil {
		return nil, err
	}
	rule := settings.NoticeRules[leaveType]
	v := domain.EvaluateNotice(rule, start, localtime.DayKey(s.now(), zone), false)
	out.Notice = &ImpactNotice{OK: v.OK, ShortNotice: v.ShortNotice, NoticeDays: v.NoticeDays, MinDays: rule.MinDays, EarliestStart: v.EarliestStart}
	if !v.OK {
		out.Notice.Message = domain.NoticeRefusal(leaveType, rule, v.EarliestStart)
	}
	all, err := blackoutsFor(ctx, s.db, coach.BranchID, start, end)
	if err != nil {
		return nil, err
	}
	if hits := domain.BlackoutConflicts(rule, all, start, end); hits != nil {
		out.Blackouts = hits
	}
	return out, nil
}

// ── Blackouts ───────────────────────────────────────────────────────────────

// BlackoutRow is a blackout with its branch name.
type BlackoutRow struct {
	domain.Blackout
	BranchName *string `json:"branch_name"`
}

// Blackouts lists blackouts ending today (Jakarta) or later.
func (s *Service) Blackouts(ctx context.Context) ([]BlackoutRow, error) {
	rows, err := s.db.Query(ctx, `SELECT b.id::text, b.branch_id::text, b.date_from::text, b.date_to::text, b.reason, br.name
	   FROM gym.coach_leave_blackouts b LEFT JOIN configuration.branches br ON br.id = b.branch_id
	  WHERE b.date_to >= $1::date ORDER BY b.date_from`, localtime.DayKey(s.now(), localtime.Jakarta))
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (BlackoutRow, error) {
		var b BlackoutRow
		err := r.Scan(&b.ID, &b.BranchID, &b.DateFrom, &b.DateTo, &b.Reason, &b.BranchName)
		return b, err
	})
}

// AddBlackout stores a blackout range.
func (s *Service) AddBlackout(ctx context.Context, actorID string, in domain.Blackout) (string, error) {
	in.Reason = strings.TrimSpace(in.Reason)
	if msg := domain.ValidateBlackout(in.DateFrom, in.DateTo, in.Reason); msg != "" {
		return "", httpx.BadRequest(msg)
	}
	if len([]rune(in.Reason)) > 200 {
		return "", httpx.BadRequest("Alasan paling panjang 200 karakter")
	}
	var id string
	err := s.db.QueryRow(ctx, `INSERT INTO gym.coach_leave_blackouts (branch_id, date_from, date_to, reason, created_by)
	    VALUES ($1, $2, $3, $4, $5) RETURNING id::text`, in.BranchID, in.DateFrom, in.DateTo, in.Reason, actorID).Scan(&id)
	if database.PgCode(err) == "23503" {
		return "", httpx.BadRequest("Cabang tidak ditemukan")
	}
	return id, err
}

// DeleteBlackout removes a blackout.
func (s *Service) DeleteBlackout(ctx context.Context, id string) error {
	tag, err := s.db.Exec(ctx, `DELETE FROM gym.coach_leave_blackouts WHERE id = $1`, id)
	if err == nil && tag.RowsAffected() == 0 {
		return httpx.NotFound("Blackout tidak ditemukan")
	}
	return err
}

// ── Change report ───────────────────────────────────────────────────────────

// Change is a class the studio moved, handed to another coach or cancelled.
type Change struct {
	SessionID         string    `json:"session_id"`
	ClassName         string    `json:"class_name"`
	StartsAt          time.Time `json:"starts_at"`
	Status            string    `json:"status"`
	CoachName         *string   `json:"coach_name"`
	OriginalCoachName *string   `json:"original_coach_name"`
	ChangeKind        string    `json:"change_kind"`
	ChangedAt         time.Time `json:"changed_at"`
	Late              bool      `json:"change_notice_late"`
	HoursBeforeStart  float64   `json:"hours_before_start"`
	Booked            int       `json:"booked"`
	BranchName        *string   `json:"branch_name"`
	Timezone          string    `json:"timezone"`
}

// ChangeReport is the changes made in [from, to) with the late ones counted.
type ChangeReport struct {
	Changes []Change       `json:"changes"`
	Total   int            `json:"total"`
	Late    int            `json:"late"`
	ByKind  map[string]int `json:"by_kind"`
}

// Changes lists the schedule changes made in [from, to), of one branch
// when branchID is set.
func (s *Service) Changes(ctx context.Context, from, to time.Time, branchID string) (*ChangeReport, error) {
	rows, err := s.db.Query(ctx, `SELECT s.id::text, t.name, s.starts_at, s.status, c.name, oc.name, s.change_kind, s.changed_at,
	        s.change_notice_late, EXTRACT(EPOCH FROM (s.starts_at - s.changed_at)) / 3600,
	        (SELECT count(*) FROM gym.bookings b WHERE b.session_id = s.id AND b.status <> 'waitlist')::int,
	        br.name, COALESCE(br.timezone, 'Asia/Jakarta')
	   FROM gym.class_sessions s
	   JOIN gym.class_types t ON t.id = s.class_type_id
	   LEFT JOIN gym.coaches c ON c.id = s.coach_id
	   LEFT JOIN gym.coaches oc ON oc.id = s.original_coach_id
	   LEFT JOIN configuration.branches br ON br.id = s.branch_id
	  WHERE s.changed_at >= $1 AND s.changed_at < $2 AND ($3 = '' OR s.branch_id::text = $3)
	  ORDER BY s.changed_at DESC LIMIT 500`, from, to, branchID)
	if err != nil {
		return nil, err
	}
	list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Change, error) {
		var c Change
		err := r.Scan(&c.SessionID, &c.ClassName, &c.StartsAt, &c.Status, &c.CoachName, &c.OriginalCoachName, &c.ChangeKind,
			&c.ChangedAt, &c.Late, &c.HoursBeforeStart, &c.Booked, &c.BranchName, &c.Timezone)
		return c, err
	})
	if err != nil {
		return nil, err
	}
	out := &ChangeReport{Changes: list, Total: len(list), ByKind: map[string]int{}}
	for _, c := range list {
		out.ByKind[c.ChangeKind]++
		if c.Late {
			out.Late++
		}
	}
	return out, nil
}

// ── Landing ─────────────────────────────────────────────────────────────────

// coachArea are the menus of a coach's own work; an account with nothing
// else lands on Kelas Saya after login.
var coachArea = []string{"gym", "gym.my-classes", "gym.sessions", "gym.checkin", "gym.pt"}

// CoachOnly reports whether the account is a linked coach whose menus are
// all coach work or the employee area.
func CoachOnly(linked bool, menus []string) bool {
	if !linked {
		return false
	}
	for _, m := range menus {
		if m == "ess" || strings.HasPrefix(m, "ess.") || slices.Contains(coachArea, m) {
			continue
		}
		return false
	}
	return true
}
