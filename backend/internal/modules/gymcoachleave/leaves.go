package gymcoachleave

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/gymcoachleave/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/localtime"
)

// Coach is the gym coach linked to an account.
type Coach struct {
	ID       string  `json:"id"`
	Name     string  `json:"name"`
	BranchID *string `json:"branch_id"`
	UserID   *string `json:"-"`
}

// coachJoin picks the oldest active coach of an employee's account.
const coachJoin = `JOIN LATERAL (
     SELECT c.id, c.name, c.branch_id, c.user_id FROM gym.coaches c
      WHERE c.user_id = e.user_id AND c.status = 'active'
      ORDER BY c.created_at LIMIT 1) c ON true`

// coachForEmployee is the active coach of an employee, nil when none.
func coachForEmployee(ctx context.Context, q database.Querier, employeeID string) (*Coach, error) {
	var c Coach
	err := q.QueryRow(ctx, `SELECT c.id::text, c.name, c.branch_id::text, c.user_id::text
	   FROM hris.employees e `+coachJoin+` WHERE e.id = $1`, employeeID).Scan(&c.ID, &c.Name, &c.BranchID, &c.UserID)
	if database.IsNoRows(err) {
		return nil, nil
	}
	return &c, err
}

// CoachForUser is the active coach linked to a staff account, nil when none.
func (s *Service) CoachForUser(ctx context.Context, userID string) (*Coach, error) {
	var c Coach
	err := s.db.QueryRow(ctx, `SELECT id::text, name, branch_id::text, user_id::text FROM gym.coaches
	   WHERE user_id = $1 AND status = 'active' ORDER BY created_at LIMIT 1`, userID).Scan(&c.ID, &c.Name, &c.BranchID, &c.UserID)
	if database.IsNoRows(err) {
		return nil, nil
	}
	return &c, err
}

// Leave is a coach's leave request (hris.leaves) with its coach.
type Leave struct {
	ID                 string    `json:"id"`
	Status             string    `json:"status"`
	LeaveType          string    `json:"leave_type"`
	StartDate          string    `json:"start_date"`
	EndDate            string    `json:"end_date"`
	TotalDays          float64   `json:"total_days"`
	Reason             string    `json:"reason"`
	ShortNotice        bool      `json:"is_short_notice"`
	NoticeDays         *int      `json:"notice_days"`
	ExceptionRequested bool      `json:"blackout_exception_requested"`
	OverrideReason     *string   `json:"blackout_override_reason"`
	RejectionReason    *string   `json:"rejection_reason"`
	CreatedAt          time.Time `json:"created_at"`
	EmployeeID         string    `json:"employee_id"`
	EmployeeName       string    `json:"employee_name"`
	RequesterUserID    *string   `json:"-"`
	Coach              Coach     `json:"coach"`
}

const leaveSelect = `SELECT l.id::text, l.status::text, l.leave_type::text, l.start_date::text, l.end_date::text,
       l.total_days::float8, l.reason, l.is_short_notice, l.notice_days, l.blackout_exception_requested,
       l.blackout_override_reason, l.rejection_reason, l.created_at,
       e.id::text, e.full_name, e.user_id::text, c.id::text, c.name, c.branch_id::text
  FROM hris.leaves l
  JOIN hris.employees e ON e.id = l.employee_id
  ` + coachJoin

func scanLeave(row pgx.CollectableRow) (*Leave, error) {
	var l Leave
	err := row.Scan(&l.ID, &l.Status, &l.LeaveType, &l.StartDate, &l.EndDate, &l.TotalDays, &l.Reason, &l.ShortNotice,
		&l.NoticeDays, &l.ExceptionRequested, &l.OverrideReason, &l.RejectionReason, &l.CreatedAt,
		&l.EmployeeID, &l.EmployeeName, &l.RequesterUserID, &l.Coach.ID, &l.Coach.Name, &l.Coach.BranchID)
	return &l, err
}

// loadLeave is a coach's leave, nil when the leave is unknown or its
// employee coaches no class.
func loadLeave(ctx context.Context, q database.Querier, id string) (*Leave, error) {
	rows, err := q.Query(ctx, leaveSelect+` WHERE l.id = $1`, id)
	if err != nil {
		return nil, err
	}
	list, err := pgx.CollectRows(rows, scanLeave)
	if err != nil || len(list) == 0 {
		return nil, err
	}
	return list[0], nil
}

func listLeaves(ctx context.Context, q database.Querier, where string, args ...any) ([]*Leave, error) {
	rows, err := q.Query(ctx, leaveSelect+` WHERE `+where, args...)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, scanLeave)
}

// span is a leave's dates as instants in the coach's branch zone: [from, to).
func span(ctx context.Context, q database.Querier, branchID *string, start, end string) (time.Time, time.Time, *time.Location, error) {
	zone, err := localtime.BranchZone(ctx, q, branchID)
	if err != nil {
		return time.Time{}, time.Time{}, nil, err
	}
	from, err := localtime.ParseDay(start, zone)
	if err != nil {
		return time.Time{}, time.Time{}, nil, err
	}
	to, err := localtime.ParseDay(end, zone)
	if err != nil {
		return time.Time{}, time.Time{}, nil, err
	}
	return from, to.AddDate(0, 0, 1), zone, nil
}

// Affected is a class or PT session the coach teaches during a leave.
type Affected struct {
	Kind      string    `json:"kind"` // class or pt
	ID        string    `json:"id"`
	StartsAt  time.Time `json:"starts_at"`
	EndsAt    time.Time `json:"ends_at"`
	ClassName string    `json:"class_name"`
	Booked    int       `json:"booked"`
	Timezone  string    `json:"timezone"`
}

// affectedSessions are the coach's open classes and PT sessions in [from, to).
func affectedSessions(ctx context.Context, q database.Querier, coachID string, from, to time.Time) ([]Affected, error) {
	rows, err := q.Query(ctx, `
	SELECT 'class', s.id::text, s.starts_at, s.ends_at, t.name,
	       (SELECT count(*) FROM gym.bookings b WHERE b.session_id = s.id AND b.status IN ('confirmed', 'checked_in', 'waitlist'))::int,
	       COALESCE(br.timezone, 'Asia/Jakarta')
	  FROM gym.class_sessions s
	  JOIN gym.class_types t ON t.id = s.class_type_id
	  LEFT JOIN configuration.branches br ON br.id = s.branch_id
	 WHERE s.coach_id = $1 AND s.status IN ('draft', 'published', 'full') AND s.starts_at < $3 AND s.ends_at > $2
	UNION ALL
	SELECT 'pt', a.id::text, a.starts_at, a.ends_at, t.name,
	       (SELECT count(*) FROM gym.pt_participants p WHERE p.appointment_id = a.id AND p.status IN ('requested', 'confirmed'))::int,
	       COALESCE(br.timezone, 'Asia/Jakarta')
	  FROM gym.pt_appointments a
	  JOIN gym.class_types t ON t.id = a.class_type_id
	  LEFT JOIN configuration.branches br ON br.id = a.branch_id
	 WHERE a.coach_id = $1 AND a.status IN ('requested', 'confirmed') AND a.starts_at < $3 AND a.ends_at > $2
	 ORDER BY 3`, coachID, from, to)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Affected, error) {
		var a Affected
		err := r.Scan(&a.Kind, &a.ID, &a.StartsAt, &a.EndsAt, &a.ClassName, &a.Booked, &a.Timezone)
		return a, err
	})
}

// blackoutsFor are the blackouts of a branch (and every branch) overlapping [start, end].
func blackoutsFor(ctx context.Context, q database.Querier, branchID *string, start, end string) ([]domain.Blackout, error) {
	rows, err := q.Query(ctx, `SELECT id::text, branch_id::text, date_from::text, date_to::text, reason
	   FROM gym.coach_leave_blackouts
	  WHERE date_from <= $3::date AND date_to >= $2::date AND (branch_id IS NULL OR branch_id = $1)
	  ORDER BY date_from`, branchID, start, end)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (domain.Blackout, error) {
		var b domain.Blackout
		err := r.Scan(&b.ID, &b.BranchID, &b.DateFrom, &b.DateTo, &b.Reason)
		return b, err
	})
}

// ── Approvers ───────────────────────────────────────────────────────────────

// approvers resolves who decides the leave of requesterUserID today.
func (s *Service) approvers(ctx context.Context, q database.Querier, requesterUserID *string) (domain.Approvers, error) {
	today := localtime.DayKey(s.now(), localtime.Jakarta)
	onLeave := `EXISTS (SELECT 1 FROM hris.leaves l JOIN hris.employees e ON e.id = l.employee_id
	     WHERE e.user_id = u.id AND l.status = 'approved' AND $1::date BETWEEN l.start_date AND l.end_date)`
	rows, err := q.Query(ctx, `SELECT u.id::text, u.full_name, `+onLeave+`
	   FROM configuration.users u
	  WHERE u.status = 'active' AND EXISTS (SELECT 1 FROM iam.user_roles ur JOIN iam.roles r ON r.id = ur.role_id
	        WHERE ur.user_id = u.id AND r.code = 'gym_program_director' AND r.deleted_at IS NULL)
	  ORDER BY u.full_name`, today)
	if err != nil {
		return domain.Approvers{}, err
	}
	directors, err := pgx.CollectRows(rows, scanApprover)
	if err != nil {
		return domain.Approvers{}, err
	}
	rows, err = q.Query(ctx, `SELECT u.id::text, u.full_name, `+onLeave+`
	   FROM gym.coach_leave_settings st JOIN configuration.users u ON u.id = st.backup_approver_user_id
	  WHERE st.id AND u.status = 'active'`, today)
	if err != nil {
		return domain.Approvers{}, err
	}
	backups, err := pgx.CollectRows(rows, scanApprover)
	if err != nil {
		return domain.Approvers{}, err
	}
	var backup *domain.Approver
	if len(backups) > 0 {
		backup = &backups[0]
	}
	requester := ""
	if requesterUserID != nil {
		requester = *requesterUserID
	}
	return domain.ResolveApprovers(directors, backup, requester), nil
}

func scanApprover(r pgx.CollectableRow) (domain.Approver, error) {
	var a domain.Approver
	err := r.Scan(&a.UserID, &a.Name, &a.OnLeave)
	return a, err
}

// isSuperAdmin: the account's role or one of its IAM roles is super_admin.
func isSuperAdmin(ctx context.Context, q database.Querier, userID string) (bool, error) {
	var yes bool
	err := q.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM configuration.users WHERE id = $1 AND role = 'super_admin')
	    OR EXISTS (SELECT 1 FROM iam.user_roles ur JOIN iam.roles r ON r.id = ur.role_id
	                WHERE ur.user_id = $1 AND r.code = 'super_admin')`, userID).Scan(&yes)
	return yes, err
}

// canDecide reports whether userID may decide the leave, with the reason when not.
func (s *Service) canDecide(ctx context.Context, q database.Querier, l *Leave, userID string) (bool, string, error) {
	if l.RequesterUserID != nil && *l.RequesterUserID == userID {
		return false, "Anda tidak bisa memutus cuti Anda sendiri", nil
	}
	resolved, err := s.approvers(ctx, q, l.RequesterUserID)
	if err != nil {
		return false, "", err
	}
	super, err := isSuperAdmin(ctx, q, userID)
	if err != nil {
		return false, "", err
	}
	if domain.CanDecide(userID, super, resolved, derefOr(l.RequesterUserID, "")) {
		return true, "", nil
	}
	return false, "Cuti coach diputus Program Director atau approver cadangan", nil
}

func derefOr(p *string, def string) string {
	if p == nil {
		return def
	}
	return *p
}
