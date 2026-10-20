package gymscheduling

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/gymscheduling/domain"
	"nuhabit/backend/internal/platform/localtime"
)

// ScheduleRepository is the persistence for weekly templates, overlap
// checks, refunds on a cancelled session and closing past sessions.
type ScheduleRepository interface {
	// LockSchedule serializes timetable writes (create, move, copy, generate)
	// for the rest of the transaction, so two overlap checks never race.
	LockSchedule(ctx context.Context, q Q) error
	// ScheduleNeighbours lists live sessions overlapping s in time that share
	// its coach or its area, and open personal training appointments of its
	// coach; domain.FindScheduleConflict picks the clash.
	ScheduleNeighbours(ctx context.Context, q Q, s domain.Slot) ([]domain.Slot, error)
	// SessionHasActiveBookings: any booking that is not cancelled.
	SessionHasActiveBookings(ctx context.Context, q Q, id string) (bool, error)
	// CoachName returns nil when the coach does not exist.
	CoachName(ctx context.Context, q Q, id string) (*string, error)
	// CoachZone is the zone of the coach's branch; Jakarta without one.
	CoachZone(ctx context.Context, q Q, id string) (*time.Location, error)
	// SessionCharges lists credits already taken for the session's bookings
	// (check-in, late cancel, no-show) that were not reversed.
	SessionCharges(ctx context.Context, q Q, sessionID string) ([]SessionCharge, error)
	ClearPassStrikes(ctx context.Context, q Q, sessionID string) error
	// EndedOpenSessions lists published or full sessions that ended before cutoff.
	EndedOpenSessions(ctx context.Context, q Q, cutoff time.Time) ([]string, error)

	ListTemplates(ctx context.Context, q Q) ([]*Row, error)
	Branches(ctx context.Context, q Q) ([]*Row, error)
	// BranchName is nil when the branch does not exist.
	BranchName(ctx context.Context, q Q, id string) (*string, error)
	// GetTemplate returns nil when the template does not exist.
	GetTemplate(ctx context.Context, q Q, id string) (*SessionTemplate, error)
	InsertTemplate(ctx context.Context, q Q, t SessionTemplate) (string, error)
	UpdateTemplate(ctx context.Context, q Q, t SessionTemplate) error
	DeleteTemplate(ctx context.Context, q Q, id string) (bool, error)
	// ActiveTemplates lists active templates still valid on or after fromDate.
	ActiveTemplates(ctx context.Context, q Q, fromDate string) ([]SessionTemplate, error)
	// GeneratedDates lists the occurrence dates already generated for the template.
	GeneratedDates(ctx context.Context, q Q, templateID string) (map[string]bool, error)
	RecordOccurrence(ctx context.Context, q Q, templateID, date, sessionID string) error
}

// SessionCharge is one ledger deduction for a booking of the session.
type SessionCharge struct {
	BookingID, CustomerID string
	// Key is the idempotency key of the deduction, e.g. "gym:checkin:<booking>".
	Key    string
	Amount int
}

// SessionTemplate is a weekly slot that generates sessions.
type SessionTemplate struct {
	ID            string
	ClassTypeID   string
	ClassTypeName string // read only
	CoachID       *string
	BranchID      *string
	Area          *string
	Weekday       int
	StartTime     string // HH:MM in the branch zone
	DurationMin   int
	Capacity      int
	CreditCost    int
	ValidFrom     string // YYYY-MM-DD
	ValidUntil    *string
	Active        bool
	CreatedBy     *string
	Zone          *time.Location // read only: the branch zone
}

func (t SessionTemplate) weeklySlot() domain.WeeklySlot {
	until := ""
	if t.ValidUntil != nil {
		until = *t.ValidUntil
	}
	return domain.WeeklySlot{Weekday: t.Weekday, StartTime: t.StartTime, DurationMin: t.DurationMin,
		ValidFrom: t.ValidFrom, ValidUntil: until, Zone: t.Zone}
}

func (Postgres) LockSchedule(ctx context.Context, q Q) error {
	_, err := q.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext('gym:schedule'))`)
	return err
}

func (Postgres) ScheduleNeighbours(ctx context.Context, q Q, s domain.Slot) ([]domain.Slot, error) {
	rows, err := q.Query(ctx, `SELECT s.id, t.name, s.coach_id, c.name, s.branch_id, s.area, s.starts_at, s.ends_at,
            `+sessionZone+`
       FROM gym.class_sessions s
       JOIN gym.class_types t ON t.id = s.class_type_id
       LEFT JOIN gym.coaches c ON c.id = s.coach_id
       LEFT JOIN configuration.branches br ON br.id = s.branch_id
      WHERE s.status <> 'cancelled' AND s.starts_at < $3 AND s.ends_at > $2
        AND ($1::uuid IS NULL OR s.id <> $1)
        AND (s.coach_id = $4
             OR (NULLIF(btrim($6), '') IS NOT NULL AND lower(btrim(s.area)) = lower(btrim($6))
                 AND s.branch_id IS NOT DISTINCT FROM $5::uuid))
     UNION ALL
     -- Open personal training appointments hold their coach too (gym-coaching).
     SELECT a.id, t.name, a.coach_id, c.name, a.branch_id, NULL, a.starts_at, a.ends_at, `+sessionZone+`
       FROM gym.pt_appointments a
       JOIN gym.class_types t ON t.id = a.class_type_id
       JOIN gym.coaches c ON c.id = a.coach_id
       LEFT JOIN configuration.branches br ON br.id = a.branch_id
      WHERE a.status IN ('requested', 'confirmed') AND a.starts_at < $3 AND a.ends_at > $2
        AND ($1::uuid IS NULL OR a.id <> $1) AND a.coach_id = $4
      ORDER BY 7
      LIMIT 20`, nullIfEmpty(s.ID), s.StartsAt, s.EndsAt, s.CoachID, s.BranchID, s.Area)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (domain.Slot, error) {
		var o domain.Slot
		var zone string
		err := r.Scan(&o.ID, &o.ClassName, &o.CoachID, &o.CoachName, &o.BranchID, &o.Area, &o.StartsAt, &o.EndsAt, &zone)
		o.Zone = localtime.Zone(zone)
		return o, err
	})
}

func nullIfEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

func (Postgres) SessionHasActiveBookings(ctx context.Context, q Q, id string) (bool, error) {
	var exists bool
	err := q.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM gym.bookings WHERE session_id = $1 AND status <> 'cancelled')`, id).Scan(&exists)
	return exists, err
}

func (Postgres) CoachName(ctx context.Context, q Q, id string) (*string, error) {
	var name string
	err := q.QueryRow(ctx, `SELECT name FROM gym.coaches WHERE id = $1`, id).Scan(&name)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &name, err
}

func (Postgres) CoachZone(ctx context.Context, q Q, id string) (*time.Location, error) {
	var branchID *string
	err := q.QueryRow(ctx, `SELECT branch_id::text FROM gym.coaches WHERE id = $1`, id).Scan(&branchID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	return localtime.BranchZone(ctx, q, branchID)
}

func (Postgres) SessionCharges(ctx context.Context, q Q, sessionID string) ([]SessionCharge, error) {
	rows, err := q.Query(ctx, `SELECT b.id, b.customer_id, l.idempotency_key, -l.amount
       FROM gym.bookings b
       JOIN gym.credit_ledger l
         ON l.source_type IN ('class_booking', 'late_cancel', 'no_show') AND l.source_id = b.id
        AND l.idempotency_key ~ ('^gym:(checkin|late_cancel|no_show):' || b.id || '(:[0-9]+)?(#[0-9]+)?$')
      WHERE b.session_id = $1 AND l.amount < 0
        AND NOT EXISTS (SELECT 1 FROM gym.credit_ledger r WHERE r.reverses_entry_id = l.id)
        -- a staff correction already refunded this charge
        AND NOT EXISTS (SELECT 1 FROM gym.credit_ledger r
                         WHERE r.idempotency_key = 'gym:correction:' || regexp_replace(l.idempotency_key, '#[0-9]+$', ''))
      ORDER BY b.created_at, l.created_at`, sessionID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (SessionCharge, error) {
		var c SessionCharge
		err := r.Scan(&c.BookingID, &c.CustomerID, &c.Key, &c.Amount)
		return c, err
	})
}

func (Postgres) ClearPassStrikes(ctx context.Context, q Q, sessionID string) error {
	_, err := q.Exec(ctx, `UPDATE gym.bookings SET pass_strike = false, updated_at = now()
      WHERE session_id = $1 AND pass_strike`, sessionID)
	return err
}

func (Postgres) EndedOpenSessions(ctx context.Context, q Q, cutoff time.Time) ([]string, error) {
	return collectStrings(q.Query(ctx, `SELECT id::text FROM gym.class_sessions
      WHERE status IN ('published', 'full') AND ends_at < $1
      ORDER BY ends_at`, cutoff))
}

// ── Templates ───────────────────────────────────────────────────────────────

func (Postgres) ListTemplates(ctx context.Context, q Q) ([]*Row, error) {
	return queryRows(ctx, q, `SELECT st.id, st.class_type_id, t.name AS class_type_name, t.color, st.coach_id, c.name AS coach_name,
            st.branch_id, b.name AS branch_name, COALESCE(b.timezone, 'Asia/Jakarta') AS timezone,
            st.area, st.weekday::int AS weekday,
            to_char(st.start_time, 'HH24:MI') AS start_time, st.duration_min, st.capacity, st.credit_cost,
            st.valid_from::text AS valid_from, st.valid_until::text AS valid_until, st.active,
            (SELECT count(*)::int FROM gym.class_sessions s
              WHERE s.template_id = st.id AND s.starts_at > now() AND s.status IN ('draft', 'published', 'full'))
              AS upcoming_sessions,
            (SELECT max(o.occurrence_date)::text FROM gym.session_template_occurrences o WHERE o.template_id = st.id)
              AS generated_until
       FROM gym.session_templates st
       JOIN gym.class_types t ON t.id = st.class_type_id
       LEFT JOIN gym.coaches c ON c.id = st.coach_id
       LEFT JOIN configuration.branches b ON b.id = st.branch_id
      ORDER BY st.active DESC, st.weekday, st.start_time, t.name`)
}

func (Postgres) BranchName(ctx context.Context, q Q, id string) (*string, error) {
	var name *string
	err := q.QueryRow(ctx, `SELECT name FROM configuration.branches WHERE id = $1`, id).Scan(&name)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return name, err
}

func (Postgres) Branches(ctx context.Context, q Q) ([]*Row, error) {
	return queryRows(ctx, q, `SELECT id, name, timezone FROM configuration.branches WHERE is_active = true ORDER BY name`)
}

const templateColumns = `id, class_type_id, (SELECT name FROM gym.class_types WHERE id = class_type_id),
       coach_id, branch_id, area, weekday, to_char(start_time, 'HH24:MI'),
       duration_min, capacity, credit_cost, valid_from::text, valid_until::text, active, created_by,
       COALESCE((SELECT timezone FROM configuration.branches WHERE id = branch_id), 'Asia/Jakarta')`

func scanTemplate(r pgx.CollectableRow) (SessionTemplate, error) {
	var t SessionTemplate
	var zone string
	err := r.Scan(&t.ID, &t.ClassTypeID, &t.ClassTypeName, &t.CoachID, &t.BranchID, &t.Area, &t.Weekday, &t.StartTime,
		&t.DurationMin, &t.Capacity, &t.CreditCost, &t.ValidFrom, &t.ValidUntil, &t.Active, &t.CreatedBy, &zone)
	t.Zone = localtime.Zone(zone)
	return t, err
}

func (Postgres) GetTemplate(ctx context.Context, q Q, id string) (*SessionTemplate, error) {
	rows, err := q.Query(ctx, `SELECT `+templateColumns+` FROM gym.session_templates WHERE id = $1`, id)
	if err != nil {
		return nil, err
	}
	t, err := pgx.CollectExactlyOneRow(rows, scanTemplate)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &t, err
}

func (Postgres) InsertTemplate(ctx context.Context, q Q, t SessionTemplate) (string, error) {
	return returningID(ctx, q, `INSERT INTO gym.session_templates (class_type_id, coach_id, branch_id, area, weekday, start_time,
            duration_min, capacity, credit_cost, valid_from, valid_until, active, created_by)
     VALUES ($1, $2, $3, $4, $5, $6::time, $7, $8, $9, $10::date, $11::date, $12, $13)
     RETURNING id`,
		t.ClassTypeID, t.CoachID, t.BranchID, t.Area, t.Weekday, t.StartTime,
		t.DurationMin, t.Capacity, t.CreditCost, t.ValidFrom, t.ValidUntil, t.Active, t.CreatedBy)
}

func (Postgres) UpdateTemplate(ctx context.Context, q Q, t SessionTemplate) error {
	_, err := q.Exec(ctx, `UPDATE gym.session_templates
        SET class_type_id = $2, coach_id = $3, branch_id = $4, area = $5, weekday = $6, start_time = $7::time,
            duration_min = $8, capacity = $9, credit_cost = $10, valid_from = $11::date, valid_until = $12::date,
            active = $13, updated_at = now()
      WHERE id = $1`,
		t.ID, t.ClassTypeID, t.CoachID, t.BranchID, t.Area, t.Weekday, t.StartTime,
		t.DurationMin, t.Capacity, t.CreditCost, t.ValidFrom, t.ValidUntil, t.Active)
	return err
}

func (Postgres) DeleteTemplate(ctx context.Context, q Q, id string) (bool, error) {
	tag, err := q.Exec(ctx, `DELETE FROM gym.session_templates WHERE id = $1`, id)
	return tag.RowsAffected() > 0, err
}

func (Postgres) ActiveTemplates(ctx context.Context, q Q, fromDate string) ([]SessionTemplate, error) {
	rows, err := q.Query(ctx, `SELECT `+templateColumns+` FROM gym.session_templates
      WHERE active AND (valid_until IS NULL OR valid_until >= $1::date)
      ORDER BY weekday, start_time, id`, fromDate)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, scanTemplate)
}

func (Postgres) GeneratedDates(ctx context.Context, q Q, templateID string) (map[string]bool, error) {
	dates, err := collectStrings(q.Query(ctx,
		`SELECT occurrence_date::text FROM gym.session_template_occurrences WHERE template_id = $1`, templateID))
	if err != nil {
		return nil, err
	}
	out := make(map[string]bool, len(dates))
	for _, d := range dates {
		out[d] = true
	}
	return out, nil
}

func (Postgres) RecordOccurrence(ctx context.Context, q Q, templateID, date, sessionID string) error {
	_, err := q.Exec(ctx, `INSERT INTO gym.session_template_occurrences (template_id, occurrence_date, session_id)
     VALUES ($1, $2::date, $3) ON CONFLICT DO NOTHING`, templateID, date, sessionID)
	return err
}
