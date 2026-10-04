package gymscheduling

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/gymscheduling/domain"
	"nuhabit/backend/internal/platform/database"
)

// Postgres implements Repository over the scheduling tables (gym.class_types,
// gym.coaches, gym.class_sessions, gym.bookings, gym.access_logs). SQL is
// ported from frontend/src/lib/gym/{catalog-server,booking-store,
// session-queries,booking-actions-server,gym-checkin-server,session-admin-server}.ts
// and the member-portal gym routes.
//
// Read models join pos.pos_customers, configuration.users and
// configuration.branches for display names, exactly as the TS queries do.
type Postgres struct{}

var _ Repository = Postgres{}

type Q = database.Querier

func queryRows(ctx context.Context, q Q, sql string, args ...any) ([]*Row, error) {
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	return collectRows(rows)
}

func queryRow(ctx context.Context, q Q, sql string, args ...any) (*Row, error) {
	rows, err := queryRows(ctx, q, sql, args...)
	if err != nil || len(rows) == 0 {
		return nil, err
	}
	return rows[0], nil
}

// returningID runs an INSERT/UPDATE ... RETURNING id; "" when no row came back.
func returningID(ctx context.Context, q Q, sql string, args ...any) (string, error) {
	var id string
	err := q.QueryRow(ctx, sql, args...).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return id, err
}

// ── Class types ─────────────────────────────────────────────────────────────

func (Postgres) ListClassTypes(ctx context.Context, q Q) ([]*Row, error) {
	return queryRows(ctx, q, `SELECT t.*,
            (SELECT count(*)::int FROM gym.class_sessions s
              WHERE s.class_type_id = t.id AND s.starts_at > now() AND s.status IN ('draft', 'published', 'full'))
              AS upcoming_sessions
       FROM gym.class_types t
      ORDER BY t.status, t.name`)
}

func (Postgres) InsertClassType(ctx context.Context, q Q, in ClassTypeInput) (string, error) {
	return returningID(ctx, q, `INSERT INTO gym.class_types (name, description, default_duration_min, default_credit_cost, default_capacity, color, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT DO NOTHING RETURNING id`,
		in.Name, in.Description, in.DefaultDurationMin, in.DefaultCreditCost, in.DefaultCapacity, in.Color, in.Status)
}

func (Postgres) UpdateClassType(ctx context.Context, q Q, id string, in ClassTypePatch) (string, error) {
	return returningID(ctx, q, `UPDATE gym.class_types SET
          name = COALESCE($2, name), description = COALESCE($3, description),
          default_duration_min = COALESCE($4, default_duration_min),
          default_credit_cost = COALESCE($5, default_credit_cost),
          default_capacity = COALESCE($6, default_capacity),
          color = COALESCE($7, color), status = COALESCE($8, status), updated_at = now()
        WHERE id = $1 RETURNING id`,
		id, in.Name, in.Description, in.DefaultDurationMin, in.DefaultCreditCost, in.DefaultCapacity, in.Color, in.Status)
}

func (Postgres) ArchiveClassType(ctx context.Context, q Q, id string) (bool, error) {
	tag, err := q.Exec(ctx, `UPDATE gym.class_types SET status = 'archived', updated_at = now() WHERE id = $1`, id)
	return tag.RowsAffected() > 0, err
}

func (Postgres) ClassTypeDefaults(ctx context.Context, q Q, id string) (*ClassTypeDefaults, error) {
	var d ClassTypeDefaults
	err := q.QueryRow(ctx,
		`SELECT default_duration_min, default_capacity, default_credit_cost, status FROM gym.class_types WHERE id = $1`, id).
		Scan(&d.DurationMin, &d.Capacity, &d.CreditCost, &d.Status)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &d, err
}

func (Postgres) ActiveClassTypes(ctx context.Context, q Q) ([]*Row, error) {
	return queryRows(ctx, q, `SELECT id, name, color FROM gym.class_types WHERE status = 'active' ORDER BY name`)
}

// ── Coaches ─────────────────────────────────────────────────────────────────

func (Postgres) ListCoaches(ctx context.Context, q Q) ([]*Row, error) {
	return queryRows(ctx, q, `SELECT c.*, b.name AS branch_name,
            (SELECT count(*)::int FROM gym.class_sessions s
              WHERE s.coach_id = c.id AND s.starts_at > now() AND s.starts_at < now() + interval '14 days'
                AND s.status IN ('published', 'full')) AS upcoming_sessions,
            (SELECT count(*)::int FROM gym.class_sessions s
              WHERE s.coach_id = c.id AND s.status = 'completed') AS completed_sessions
       FROM gym.coaches c
       LEFT JOIN configuration.branches b ON b.id = c.branch_id
      ORDER BY c.status, c.name`)
}

func (Postgres) InsertCoach(ctx context.Context, q Q, in CoachInput) (string, error) {
	return returningID(ctx, q, `INSERT INTO gym.coaches (name, bio, specialization, photo_url, user_id, branch_id, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT DO NOTHING RETURNING id`,
		in.Name, in.Bio, in.Specialization, in.PhotoURL, in.UserID, in.BranchID, in.Status)
}

func (Postgres) UpdateCoach(ctx context.Context, q Q, id string, in CoachPatch) (string, error) {
	return returningID(ctx, q, `UPDATE gym.coaches SET
        name = COALESCE($2, name), bio = COALESCE($3, bio), specialization = COALESCE($4, specialization),
        photo_url = CASE WHEN $8 THEN $5 ELSE photo_url END,
        branch_id = CASE WHEN $9 THEN $6::uuid ELSE branch_id END,
        status = COALESCE($7, status), updated_at = now()
      WHERE id = $1 RETURNING id`,
		id, in.Name, in.Bio, in.Specialization, in.PhotoURL, in.BranchID, in.Status, in.PhotoURLSent, in.BranchIDSent)
}

func (Postgres) MemberCoaches(ctx context.Context, q Q) ([]*Row, error) {
	return queryRows(ctx, q, `SELECT c.id, c.name, c.bio, c.specialization, c.photo_url,
            (SELECT count(*)::int FROM gym.class_sessions s
              WHERE s.coach_id = c.id AND s.status IN ('published', 'full')
                AND s.starts_at > now() AND s.starts_at < now() + interval '7 days') AS upcoming_sessions
       FROM gym.coaches c
      WHERE c.status = 'active'
      ORDER BY c.name`)
}

func (Postgres) ActiveCoach(ctx context.Context, q Q, id string) (*Row, error) {
	return queryRow(ctx, q,
		`SELECT id, name, bio, specialization, photo_url FROM gym.coaches WHERE id = $1 AND status = 'active'`, id)
}

func (Postgres) ClassDetails(ctx context.Context, q Q, classTypeID string, coachID *string) (*Row, error) {
	return queryRow(ctx, q, `SELECT t.description, c.specialization AS coach_specialization, c.bio AS coach_bio, c.photo_url AS coach_photo_url
         FROM gym.class_types t LEFT JOIN gym.coaches c ON c.id = $2
        WHERE t.id = $1`, classTypeID, coachID)
}

// ── Member app catalog ──────────────────────────────────────────────────────

func (Postgres) Catalog(ctx context.Context, q Q) (branches, classTypes, coaches []*Row, err error) {
	if branches, err = queryRows(ctx, q,
		`SELECT id, name FROM configuration.branches WHERE is_active = true ORDER BY name`); err != nil {
		return
	}
	if classTypes, err = queryRows(ctx, q, `SELECT id, name, description, default_duration_min, default_credit_cost
         FROM gym.class_types WHERE status = 'active' ORDER BY name`); err != nil {
		return
	}
	coaches, err = queryRows(ctx, q, `SELECT id, branch_id FROM gym.coaches WHERE status = 'active'`)
	return
}

// ── Sessions ────────────────────────────────────────────────────────────────

const sessionSelect = `
  SELECT s.id, s.class_type_id, t.name AS class_type_name, t.color, s.coach_id, c.name AS coach_name,
         s.branch_id, s.area, s.starts_at, s.ends_at, s.capacity, s.credit_cost,
         s.booking_opens_at, s.booking_closes_at, s.status, s.notes
    FROM gym.class_sessions s
    JOIN gym.class_types t ON t.id = s.class_type_id
    LEFT JOIN gym.coaches c ON c.id = s.coach_id`

// seatsHeldWhere: a seat is held by confirmed, checked-in and completed bookings.
const seatsHeldWhere = `status IN ('confirmed', 'checked_in', 'completed')`

func (Postgres) ListSessions(ctx context.Context, q Q, f SessionFilter) ([]*Row, error) {
	var statuses []string
	for _, s := range f.Statuses {
		statuses = append(statuses, string(s))
	}
	return queryRows(ctx, q, `SELECT x.*,
            COALESCE(k.confirmed, 0)::int AS confirmed_count,
            COALESCE(k.waitlist, 0)::int AS waitlist_count,
            COALESCE(k.checked_in, 0)::int AS checked_in_count,
            GREATEST(x.capacity - COALESCE(k.confirmed, 0), 0)::int AS seats_left,
            CASE WHEN mine.id IS NULL THEN NULL ELSE json_build_object(
              'id', mine.id, 'status', mine.status, 'waitlist_position', mine.waitlist_position,
              'promotion_offered_at', mine.promotion_offered_at) END AS my_booking
       FROM (`+sessionSelect+`
              WHERE ($1::timestamptz IS NULL OR s.starts_at >= $1)
                AND ($2::timestamptz IS NULL OR s.starts_at < $2)
                AND ($3::uuid IS NULL OR s.class_type_id = $3)
                AND ($4::uuid IS NULL OR s.coach_id = $4)
                AND ($5::uuid IS NULL OR s.branch_id IS NULL OR s.branch_id = $5)
                AND ($6::text[] IS NULL OR s.status = ANY ($6))
                AND ($8::uuid IS NULL OR s.id = $8)
              ORDER BY s.starts_at
              LIMIT 500) x
       LEFT JOIN LATERAL (
         SELECT count(*) FILTER (WHERE b.`+seatsHeldWhere+`) AS confirmed,
                count(*) FILTER (WHERE b.status = 'waitlist') AS waitlist,
                count(*) FILTER (WHERE b.status IN ('checked_in', 'completed')) AS checked_in
           FROM gym.bookings b WHERE b.session_id = x.id
       ) k ON true
       LEFT JOIN LATERAL (
         SELECT b.id, b.status, b.waitlist_position, b.promotion_offered_at FROM gym.bookings b
          WHERE b.session_id = x.id AND b.customer_id = $7 AND b.status <> 'cancelled'
          ORDER BY b.created_at DESC LIMIT 1
       ) mine ON $7::uuid IS NOT NULL
      ORDER BY x.starts_at`,
		f.From, f.To, f.ClassTypeID, f.CoachID, f.BranchID, statuses, f.CustomerID, f.ID)
}

func (Postgres) LockSession(ctx context.Context, q Q, id string) (*SessionRow, error) {
	var s SessionRow
	err := q.QueryRow(ctx, sessionSelect+` WHERE s.id = $1 FOR UPDATE OF s`, id).Scan(
		&s.ID, &s.ClassTypeID, &s.ClassTypeName, &s.Color, &s.CoachID, &s.CoachName,
		&s.BranchID, &s.Area, &s.StartsAt, &s.EndsAt, &s.Capacity, &s.CreditCost,
		&s.BookingOpensAt, &s.BookingClosesAt, &s.Status, &s.Notes)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &s, err
}

func (Postgres) InsertSession(ctx context.Context, q Q, n NewSession) (string, error) {
	return returningID(ctx, q, `INSERT INTO gym.class_sessions (class_type_id, coach_id, branch_id, area, starts_at, ends_at, capacity, credit_cost,
                                     booking_opens_at, booking_closes_at, status, notes, created_by)
     VALUES ($1, $2, $3, $4, $5, $5::timestamptz + make_interval(mins => $6), $7, $8, $9, $10, $11, $12, $13)
     RETURNING id`,
		n.ClassTypeID, n.CoachID, n.BranchID, n.Area, n.StartsAt, n.DurationMin, n.Capacity, n.CreditCost,
		n.BookingOpensAt, n.BookingClosesAt, n.Status, n.Notes, n.CreatedBy)
}

func (Postgres) UpdateSession(ctx context.Context, q Q, id string, u SessionUpdate) error {
	_, err := q.Exec(ctx, `UPDATE gym.class_sessions
        SET coach_id = $2, area = $3, starts_at = $4, ends_at = $4::timestamptz + make_interval(mins => $5),
            capacity = $6, notes = $7, booking_opens_at = $8, booking_closes_at = $9, updated_at = now()
      WHERE id = $1`,
		id, u.CoachID, u.Area, u.StartsAt, u.DurationMin, u.Capacity, u.Notes, u.BookingOpensAt, u.BookingClosesAt)
	return err
}

func (Postgres) SetSessionStatus(ctx context.Context, q Q, id string, status domain.SessionStatus) error {
	_, err := q.Exec(ctx, `UPDATE gym.class_sessions SET status = $2, updated_at = now() WHERE id = $1`, id, status)
	return err
}

func (Postgres) SessionHasBookings(ctx context.Context, q Q, id string) (bool, error) {
	var exists bool
	err := q.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM gym.bookings WHERE session_id = $1)`, id).Scan(&exists)
	return exists, err
}

func (Postgres) DeleteSession(ctx context.Context, q Q, id string) error {
	_, err := q.Exec(ctx, `DELETE FROM gym.class_sessions WHERE id = $1`, id)
	return err
}

func (Postgres) SessionsInWeek(ctx context.Context, q Q, weekStart time.Time) ([]WeekSession, error) {
	rows, err := q.Query(ctx, `SELECT class_type_id, coach_id, branch_id, area, starts_at, ends_at, capacity, credit_cost, notes
       FROM gym.class_sessions
      WHERE starts_at >= $1 AND starts_at < $1::timestamptz + interval '7 days' AND status <> 'cancelled'
      ORDER BY starts_at`, weekStart)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (WeekSession, error) {
		var w WeekSession
		err := r.Scan(&w.ClassTypeID, &w.CoachID, &w.BranchID, &w.Area, &w.StartsAt, &w.EndsAt, &w.Capacity, &w.CreditCost, &w.Notes)
		return w, err
	})
}

func (Postgres) InsertSessionIfFree(ctx context.Context, q Q, n NewSession, endsAt time.Time) (bool, error) {
	tag, err := q.Exec(ctx, `INSERT INTO gym.class_sessions (class_type_id, coach_id, branch_id, area, starts_at, ends_at, capacity, credit_cost,
                                       booking_opens_at, booking_closes_at, status, notes, created_by)
       SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
        WHERE NOT EXISTS (SELECT 1 FROM gym.class_sessions WHERE class_type_id = $1 AND starts_at = $5
                            AND status <> 'cancelled')`,
		n.ClassTypeID, n.CoachID, n.BranchID, n.Area, n.StartsAt, endsAt, n.Capacity, n.CreditCost,
		n.BookingOpensAt, n.BookingClosesAt, n.Status, n.Notes, n.CreatedBy)
	return tag.RowsAffected() > 0, err
}

// ── Bookings ────────────────────────────────────────────────────────────────

func (Postgres) SeatsHeld(ctx context.Context, q Q, sessionID string) (int, error) {
	var n int
	err := q.QueryRow(ctx, `SELECT count(*)::int AS n FROM gym.bookings WHERE session_id = $1 AND `+seatsHeldWhere, sessionID).Scan(&n)
	return n, err
}

func (Postgres) BookingStats(ctx context.Context, q Q, sessionID, customerID string) (BookingStats, error) {
	var s BookingStats
	err := q.QueryRow(ctx, `SELECT count(*) FILTER (WHERE `+seatsHeldWhere+`)::int AS confirmed,
            COALESCE(max(waitlist_position) FILTER (WHERE status = 'waitlist'), 0)::int AS last_waitlist,
            COALESCE(bool_or(customer_id = $2 AND status IN ('confirmed', 'waitlist', 'checked_in')), false) AS mine
       FROM gym.bookings WHERE session_id = $1`, sessionID, customerID).
		Scan(&s.Confirmed, &s.LastWaitlist, &s.Mine)
	return s, err
}

func (Postgres) InsertBooking(ctx context.Context, q Q, sessionID, customerID string, status domain.BookingStatus, position *int, source string) (string, error) {
	return returningID(ctx, q, `INSERT INTO gym.bookings (session_id, customer_id, status, waitlist_position, source)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`, sessionID, customerID, status, position, source)
}

func (Postgres) BookingRef(ctx context.Context, q Q, id string) (sessionID, customerID string, err error) {
	err = q.QueryRow(ctx, `SELECT session_id, customer_id FROM gym.bookings WHERE id = $1`, id).Scan(&sessionID, &customerID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", "", nil
	}
	return sessionID, customerID, err
}

const bookingColumns = `id, session_id, customer_id, status, waitlist_position, promotion_offered_at, created_at`

func scanBooking(r pgx.CollectableRow) (BookingRow, error) {
	var b BookingRow
	err := r.Scan(&b.ID, &b.SessionID, &b.CustomerID, &b.Status, &b.WaitlistPosition, &b.PromotionOfferedAt, &b.CreatedAt)
	return b, err
}

func (Postgres) LockBooking(ctx context.Context, q Q, id string) (*BookingRow, error) {
	rows, err := q.Query(ctx, `SELECT `+bookingColumns+` FROM gym.bookings WHERE id = $1 FOR UPDATE`, id)
	if err != nil {
		return nil, err
	}
	b, err := pgx.CollectExactlyOneRow(rows, scanBooking)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &b, err
}

func (Postgres) LockWaitlist(ctx context.Context, q Q, sessionID string) ([]BookingRow, error) {
	rows, err := q.Query(ctx, `SELECT `+bookingColumns+`
       FROM gym.bookings WHERE session_id = $1 AND status = 'waitlist' FOR UPDATE`, sessionID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, scanBooking)
}

func (Postgres) LockOpenBookings(ctx context.Context, q Q, sessionID string) ([]BookingRow, error) {
	rows, err := q.Query(ctx, `SELECT `+bookingColumns+`
       FROM gym.bookings WHERE session_id = $1 AND status IN ('confirmed', 'waitlist', 'checked_in') FOR UPDATE`, sessionID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, scanBooking)
}

func (Postgres) CancelBooking(ctx context.Context, q Q, id string, late bool, at time.Time) error {
	_, err := q.Exec(ctx, `UPDATE gym.bookings
        SET status = 'cancelled', waitlist_position = NULL, promotion_offered_at = NULL,
            late_cancel = $2, cancelled_at = $3, updated_at = now()
      WHERE id = $1`, id, late, at)
	return err
}

func (Postgres) ConfirmFromWaitlist(ctx context.Context, q Q, id string) error {
	_, err := q.Exec(ctx, `UPDATE gym.bookings SET status = 'confirmed', waitlist_position = NULL, promotion_offered_at = NULL,
            updated_at = now() WHERE id = $1`, id)
	return err
}

func (Postgres) AutoPromote(ctx context.Context, q Q, id string) error {
	_, err := q.Exec(ctx,
		`UPDATE gym.bookings SET status = 'confirmed', waitlist_position = NULL, updated_at = now() WHERE id = $1`, id)
	return err
}

func (Postgres) OfferPromotion(ctx context.Context, q Q, id string, at time.Time) error {
	_, err := q.Exec(ctx, `UPDATE gym.bookings SET promotion_offered_at = $2, updated_at = now() WHERE id = $1`, id, at)
	return err
}

func (Postgres) MarkNoShow(ctx context.Context, q Q, id string) error {
	_, err := q.Exec(ctx, `UPDATE gym.bookings SET status = 'no_show', updated_at = now() WHERE id = $1`, id)
	return err
}

func (Postgres) MarkCheckedIn(ctx context.Context, q Q, id string, at time.Time) error {
	_, err := q.Exec(ctx,
		`UPDATE gym.bookings SET status = 'checked_in', checked_in_at = $2, updated_at = now() WHERE id = $1`, id, at)
	return err
}

func (Postgres) CloseBooking(ctx context.Context, q Q, id string, status domain.BookingStatus) error {
	_, err := q.Exec(ctx, `UPDATE gym.bookings SET status = $2, waitlist_position = NULL, updated_at = now(),
              cancelled_at = CASE WHEN $2 = 'cancelled' THEN now() ELSE cancelled_at END
        WHERE id = $1`, id, string(status))
	return err
}

func collectStrings(rows pgx.Rows, err error) ([]string, error) {
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

func (Postgres) ActiveBookingCustomers(ctx context.Context, q Q, sessionID string) ([]string, error) {
	return collectStrings(q.Query(ctx,
		`SELECT customer_id FROM gym.bookings WHERE session_id = $1 AND status IN ('confirmed', 'waitlist')`, sessionID))
}

func (Postgres) CancelSessionBookings(ctx context.Context, q Q, sessionID string) ([]string, error) {
	return collectStrings(q.Query(ctx, `UPDATE gym.bookings SET status = 'cancelled', waitlist_position = NULL, promotion_offered_at = NULL,
            cancelled_at = now(), updated_at = now()
      WHERE session_id = $1 AND status IN ('confirmed', 'waitlist') RETURNING customer_id`, sessionID))
}

func (Postgres) Roster(ctx context.Context, q Q, sessionID string) ([]*Row, error) {
	return queryRows(ctx, q, `SELECT b.id, b.customer_id, c.name, c.phone, b.status, b.waitlist_position, b.source, b.late_cancel,
            b.promotion_offered_at, b.checked_in_at, b.cancelled_at, b.created_at
       FROM gym.bookings b JOIN pos.pos_customers c ON c.id = b.customer_id
      WHERE b.session_id = $1
      ORDER BY CASE b.status WHEN 'checked_in' THEN 0 WHEN 'confirmed' THEN 1 WHEN 'completed' THEN 2
                             WHEN 'waitlist' THEN 3 WHEN 'no_show' THEN 4 ELSE 5 END,
               b.waitlist_position NULLS FIRST, b.created_at`, sessionID)
}

func (Postgres) ListBookings(ctx context.Context, q Q, f BookingListFilter) ([]*Row, error) {
	return queryRows(ctx, q, `SELECT b.id, b.status, b.waitlist_position, b.source, b.late_cancel, b.promotion_offered_at,
            b.checked_in_at, b.cancelled_at, b.created_at,
            c.id AS customer_id, c.name AS member_name, c.phone AS member_phone,
            s.id AS session_id, s.starts_at, s.credit_cost, t.name AS class_type_name, co.name AS coach_name
       FROM gym.bookings b
       JOIN gym.class_sessions s ON s.id = b.session_id
       JOIN gym.class_types t ON t.id = s.class_type_id
       LEFT JOIN gym.coaches co ON co.id = s.coach_id
       JOIN pos.pos_customers c ON c.id = b.customer_id
      WHERE s.starts_at >= $1 AND s.starts_at < $2
        AND ($3::text IS NULL OR b.status = $3)
        AND ($4::text IS NULL OR c.name ILIKE '%' || $4 || '%' OR c.phone ILIKE '%' || $4 || '%')
        AND ($5::uuid IS NULL OR b.session_id = $5)
      ORDER BY s.starts_at, b.created_at
      LIMIT 500`, f.From, f.To, f.Status, f.Q, f.SessionID)
}

func (Postgres) MemberBookings(ctx context.Context, q Q, customerID string, past bool) ([]*Row, error) {
	where, order := `s.ends_at >= now() AND b.status IN ('confirmed', 'waitlist', 'checked_in')`, "ASC"
	if past {
		where, order = `(s.ends_at < now() OR b.status IN ('cancelled', 'completed', 'no_show'))`, "DESC"
	}
	return queryRows(ctx, q, `SELECT b.id, b.status, b.waitlist_position, b.late_cancel, b.promotion_offered_at, b.checked_in_at,
            b.cancelled_at, b.created_at,
            s.id AS session_id, s.branch_id, s.starts_at, s.ends_at, s.area, s.credit_cost, s.status AS session_status,
            t.name AS class_type_name, t.color, co.name AS coach_name
       FROM gym.bookings b
       JOIN gym.class_sessions s ON s.id = b.session_id
       JOIN gym.class_types t ON t.id = s.class_type_id
       LEFT JOIN gym.coaches co ON co.id = s.coach_id
      WHERE b.customer_id = $1
        AND `+where+`
      ORDER BY s.starts_at `+order+`
      LIMIT 50`, customerID)
}

// ── Gate ────────────────────────────────────────────────────────────────────

func (Postgres) LastAllowedEntry(ctx context.Context, q Q, customerID string) (*time.Time, error) {
	var at *time.Time
	err := q.QueryRow(ctx,
		`SELECT max(created_at) AS at FROM gym.access_logs WHERE customer_id = $1 AND decision = 'allowed'`, customerID).Scan(&at)
	return at, err
}

func (Postgres) LockCheckInCandidate(ctx context.Context, q Q, customerID string, branchID *string, now time.Time) (*Candidate, error) {
	var c Candidate
	err := q.QueryRow(ctx, `SELECT b.id, b.session_id, s.class_type_id, s.credit_cost, s.starts_at, t.name AS class_name
       FROM gym.bookings b
       JOIN gym.class_sessions s ON s.id = b.session_id
       JOIN gym.class_types t ON t.id = s.class_type_id
      WHERE b.customer_id = $1 AND b.status = 'confirmed'
        AND s.status IN ('published', 'full')
        AND ($2::uuid IS NULL OR s.branch_id IS NULL OR s.branch_id = $2)
        AND s.starts_at <= $3::timestamptz + make_interval(mins => $4)
        AND s.ends_at >= $3::timestamptz - make_interval(mins => $5)
      ORDER BY s.starts_at
      LIMIT 1
      FOR UPDATE OF b`, customerID, branchID, now, domain.CheckInEarlyMin, domain.CheckInLateMin).
		Scan(&c.ID, &c.SessionID, &c.ClassTypeID, &c.CreditCost, &c.StartsAt, &c.ClassName)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &c, err
}

func (Postgres) LogAccess(ctx context.Context, q Q, e AccessEntry) error {
	_, err := q.Exec(ctx, `INSERT INTO gym.access_logs (customer_id, booking_id, branch_id, decision, reason, entry_kind, credit_delta, source, scanned_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
		e.CustomerID, e.BookingID, e.BranchID, e.Decision, e.Reason, e.EntryKind, -e.CreditsDeducted, e.Source, e.ScannedBy)
	return err
}

func (Postgres) AccessLog(ctx context.Context, q Q) ([]*Row, *Row, error) {
	log, err := queryRows(ctx, q, `SELECT l.id, l.decision, l.reason, l.entry_kind, l.credit_delta, l.source, l.created_at,
              c.name AS member_name, c.phone AS member_phone, t.name AS class_type_name, s.starts_at,
              u.full_name AS staff_name
         FROM gym.access_logs l
         LEFT JOIN pos.pos_customers c ON c.id = l.customer_id
         LEFT JOIN gym.bookings b ON b.id = l.booking_id
         LEFT JOIN gym.class_sessions s ON s.id = b.session_id
         LEFT JOIN gym.class_types t ON t.id = s.class_type_id
         LEFT JOIN configuration.users u ON u.id = l.scanned_by
        ORDER BY l.created_at DESC LIMIT 100`)
	if err != nil {
		return nil, nil, err
	}
	today, err := queryRow(ctx, q, `SELECT count(*) FILTER (WHERE decision = 'allowed' AND entry_kind = 'booking')::int AS checked_in,
              count(*) FILTER (WHERE decision = 'denied')::int AS denied,
              COALESCE(-sum(credit_delta), 0)::int AS credits
         FROM gym.access_logs
        WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Jakarta') AT TIME ZONE 'Asia/Jakarta'`)
	return log, today, err
}
