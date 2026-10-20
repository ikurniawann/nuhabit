package gymcoaching

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/gymcoaching/domain"
	"nuhabit/backend/internal/platform/httpx"
)

// Window is a weekly availability row; times are "HH:MM" in WIB.
type Window struct {
	ID        string `json:"id,omitempty"`
	Weekday   int    `json:"weekday"`
	StartTime string `json:"start_time"`
	EndTime   string `json:"end_time"`
}

// ExceptionRow is a dated change to a coach's week. Off without times is
// the whole day.
type ExceptionRow struct {
	ID        string  `json:"id"`
	Date      string  `json:"date"`
	Kind      string  `json:"kind"`
	StartTime *string `json:"start_time"`
	EndTime   *string `json:"end_time"`
	Note      string  `json:"note"`
}

// Availability is a coach's weekly windows and the exceptions from today on.
type Availability struct {
	CoachID    string         `json:"coach_id"`
	Weekly     []Window       `json:"weekly"`
	Exceptions []ExceptionRow `json:"exceptions"`
}

// checkSpan rejects "HH:MM" times that are unreadable or out of order.
func checkSpan(start, end string) error {
	from, ok1 := domain.ParseClock(start)
	to, ok2 := domain.ParseClock(end)
	if !ok1 || !ok2 {
		return httpx.BadRequest("Jam tidak valid")
	}
	if p := domain.SpanProblem(domain.Span{Start: from, End: to}); p != "" {
		return httpx.BadRequest(p)
	}
	return nil
}

func (s *Service) requireCoach(ctx context.Context, q Q, coachID string) error {
	var active bool
	err := q.QueryRow(ctx, `SELECT status = 'active' FROM gym.coaches WHERE id = $1`, coachID).Scan(&active)
	if isNoRows(err) || (err == nil && !active) {
		return httpx.NotFound("Coach tidak ditemukan")
	}
	return err
}

// Availability reads a coach's week and upcoming exceptions.
func (s *Service) Availability(ctx context.Context, coachID string) (*Availability, error) {
	if err := s.requireCoach(ctx, s.db, coachID); err != nil {
		return nil, err
	}
	out := &Availability{CoachID: coachID}
	rows, err := s.db.Query(ctx, `SELECT id::text, weekday, to_char(start_time, 'HH24:MI'), to_char(end_time, 'HH24:MI')
       FROM gym.coach_availability WHERE coach_id = $1 ORDER BY weekday, start_time`, coachID)
	if err != nil {
		return nil, err
	}
	if out.Weekly, err = pgx.CollectRows(rows, pgx.RowToStructByPos[Window]); err != nil {
		return nil, err
	}
	rows, err = s.db.Query(ctx, `SELECT id::text, date::text, kind, to_char(start_time, 'HH24:MI'), to_char(end_time, 'HH24:MI'), note
       FROM gym.coach_availability_exceptions WHERE coach_id = $1 AND date >= $2::date ORDER BY date, start_time NULLS FIRST`,
		coachID, s.todayWib())
	if err != nil {
		return nil, err
	}
	out.Exceptions, err = pgx.CollectRows(rows, pgx.RowToStructByPos[ExceptionRow])
	return out, err
}

// SetWeekly replaces a coach's weekly windows. Overlapping windows of one
// day are allowed and merge when slots are computed.
func (s *Service) SetWeekly(ctx context.Context, coachID string, windows []Window) error {
	for _, w := range windows {
		if w.Weekday < 1 || w.Weekday > 7 {
			return httpx.BadRequest("Hari tidak valid")
		}
		if err := checkSpan(w.StartTime, w.EndTime); err != nil {
			return err
		}
	}
	return s.inTx(ctx, func(q Q) error {
		if err := s.requireCoach(ctx, q, coachID); err != nil {
			return err
		}
		if _, err := q.Exec(ctx, `DELETE FROM gym.coach_availability WHERE coach_id = $1`, coachID); err != nil {
			return err
		}
		for _, w := range windows {
			if _, err := q.Exec(ctx, `INSERT INTO gym.coach_availability (coach_id, weekday, start_time, end_time)
              VALUES ($1, $2, $3::time, $4::time)`, coachID, w.Weekday, w.StartTime, w.EndTime); err != nil {
				return err
			}
		}
		return nil
	})
}

// NewException is an exception to add; StartTime and EndTime are both set
// or, for a whole day off, both empty.
type NewException struct {
	Date      string
	Kind      domain.ExceptionKind
	StartTime string
	EndTime   string
	Note      string
}

// AddException records a day off, partial time off or extra hours.
func (s *Service) AddException(ctx context.Context, coachID, actorID string, in NewException) (string, error) {
	if _, err := time.Parse(time.DateOnly, in.Date); err != nil {
		return "", httpx.BadRequest("Tanggal tidak valid")
	}
	if in.Date < s.todayWib() {
		return "", httpx.BadRequest("Tanggal sudah lewat")
	}
	var start, end *string
	switch {
	case in.StartTime == "" && in.EndTime == "" && in.Kind == domain.Off:
	case in.Kind == domain.Off || in.Kind == domain.Extra:
		if err := checkSpan(in.StartTime, in.EndTime); err != nil {
			return "", err
		}
		start, end = &in.StartTime, &in.EndTime
	default:
		return "", httpx.BadRequest("Jenis pengecualian tidak valid")
	}
	var id string
	err := s.inTx(ctx, func(q Q) error {
		if err := s.requireCoach(ctx, q, coachID); err != nil {
			return err
		}
		return q.QueryRow(ctx, `INSERT INTO gym.coach_availability_exceptions (coach_id, date, kind, start_time, end_time, note, created_by)
          VALUES ($1, $2::date, $3, $4::time, $5::time, $6, $7) RETURNING id::text`,
			coachID, in.Date, in.Kind, start, end, in.Note, actorID).Scan(&id)
	})
	return id, err
}

// ExceptionCoach is the coach an exception belongs to, "" when it does not exist.
func (s *Service) ExceptionCoach(ctx context.Context, id string) (string, error) {
	var coachID string
	err := s.db.QueryRow(ctx, `SELECT coach_id::text FROM gym.coach_availability_exceptions WHERE id = $1`, id).Scan(&coachID)
	if isNoRows(err) {
		return "", nil
	}
	return coachID, err
}

func (s *Service) DeleteException(ctx context.Context, id string) error {
	_, err := s.db.Exec(ctx, `DELETE FROM gym.coach_availability_exceptions WHERE id = $1`, id)
	return err
}

// coachWeek loads a coach's weekly windows and the exceptions dated in [from, to].
func coachWeek(ctx context.Context, q Q, coachID, from, to string) ([]domain.WeeklyWindow, []domain.Exception, error) {
	rows, err := q.Query(ctx, `SELECT weekday, to_char(start_time, 'HH24:MI'), to_char(end_time, 'HH24:MI')
       FROM gym.coach_availability WHERE coach_id = $1`, coachID)
	if err != nil {
		return nil, nil, err
	}
	weekly, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (domain.WeeklyWindow, error) {
		var w domain.WeeklyWindow
		var start, end string
		if err := r.Scan(&w.Weekday, &start, &end); err != nil {
			return w, err
		}
		w.Start, _ = domain.ParseClock(start)
		w.End, _ = domain.ParseClock(end)
		return w, nil
	})
	if err != nil {
		return nil, nil, err
	}
	rows, err = q.Query(ctx, `SELECT date::text, kind, to_char(start_time, 'HH24:MI'), to_char(end_time, 'HH24:MI')
       FROM gym.coach_availability_exceptions WHERE coach_id = $1 AND date BETWEEN $2::date AND $3::date`, coachID, from, to)
	if err != nil {
		return nil, nil, err
	}
	exceptions, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (domain.Exception, error) {
		var e domain.Exception
		var start, end *string
		if err := r.Scan(&e.Date, &e.Kind, &start, &end); err != nil {
			return e, err
		}
		if start != nil && end != nil {
			from, _ := domain.ParseClock(*start)
			to, _ := domain.ParseClock(*end)
			e.Span = &domain.Span{Start: from, End: to}
		}
		return e, nil
	})
	return weekly, exceptions, err
}

// coachBusy lists the group sessions and open PT appointments of the coach
// overlapping [from, to).
func coachBusy(ctx context.Context, q Q, coachID string, from, to time.Time) ([]domain.Interval, error) {
	rows, err := q.Query(ctx, `SELECT starts_at, ends_at FROM gym.class_sessions
       WHERE coach_id = $1 AND status <> 'cancelled' AND starts_at < $3 AND ends_at > $2
     UNION ALL
     SELECT starts_at, ends_at FROM gym.pt_appointments
       WHERE coach_id = $1 AND status IN ('requested', 'confirmed') AND starts_at < $3 AND ends_at > $2`, coachID, from, to)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[domain.Interval])
}

// Slot is a free start a member may request.
type Slot struct {
	StartsAt httpx.JSTime `json:"starts_at"`
	EndsAt   httpx.JSTime `json:"ends_at"`
}

// MaxSlotDays is the longest range one slots request covers.
const MaxSlotDays = 14

// Slots lists the free starts of a classTypeID session with the coach on
// the WIB dates from fromDate for days days: inside the coach's
// availability, clear of the coach's classes and PT, and no earlier than
// earliest.
func (s *Service) Slots(ctx context.Context, coachID, classTypeID, fromDate string, days int, earliest time.Time) ([]Slot, error) {
	first, err := time.ParseInLocation(time.DateOnly, fromDate, domain.WIB)
	if err != nil {
		return nil, httpx.BadRequest("Tanggal tidak valid")
	}
	days = min(max(days, 1), MaxSlotDays)
	ct, err := s.personalType(ctx, s.db, classTypeID)
	if err != nil {
		return nil, err
	}
	if err := s.requireCoach(ctx, s.db, coachID); err != nil {
		return nil, err
	}
	last := first.AddDate(0, 0, days-1)
	weekly, exceptions, err := coachWeek(ctx, s.db, coachID, fromDate, last.Format(time.DateOnly))
	if err != nil {
		return nil, err
	}
	busy, err := coachBusy(ctx, s.db, coachID, first, last.AddDate(0, 0, 1))
	if err != nil {
		return nil, err
	}
	duration := time.Duration(ct.DurationMin) * time.Minute
	out := []Slot{}
	for d := first; !d.After(last); d = d.AddDate(0, 0, 1) {
		windows := domain.DayWindows(d.Format(time.DateOnly), weekly, exceptions)
		for _, start := range domain.FreeSlots(windows, busy, duration, domain.SlotStep, earliest) {
			out = append(out, Slot{StartsAt: httpx.JSTime(start), EndsAt: httpx.JSTime(start.Add(duration))})
		}
	}
	return out, nil
}

// fitsAvailability reports whether [start, end) lies in the coach's
// availability on the WIB date of start.
func fitsAvailability(ctx context.Context, q Q, coachID string, start, end time.Time) (bool, error) {
	date := start.In(domain.WIB).Format(time.DateOnly)
	weekly, exceptions, err := coachWeek(ctx, q, coachID, date, date)
	if err != nil {
		return false, err
	}
	return domain.Fits(domain.DayWindows(date, weekly, exceptions), start, end), nil
}
