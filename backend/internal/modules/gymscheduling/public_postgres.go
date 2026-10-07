package gymscheduling

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
)

// Public timetable reads for the website (no session, no member).

// PublicBranch is a branch as the public site addresses it.
type PublicBranch struct {
	ID   string `json:"-"`
	Slug string `json:"slug"`
	Name string `json:"name"`
}

// PublicSession is one row of the public timetable.
type PublicSession struct {
	ID              string          `json:"id"`
	StartsAt        jsTime          `json:"starts_at"`
	EndsAt          jsTime          `json:"ends_at"`
	DurationMin     int             `json:"duration_min"`
	ClassType       PublicClassType `json:"class_type"`
	CoachName       *string         `json:"coach_name"`
	Capacity        int             `json:"capacity"`
	SeatsLeft       int             `json:"seats_left"`
	WaitlistOpen    bool            `json:"waitlist_open"`
	bookingClosesAt time.Time
}

type PublicClassType struct {
	Name  string `json:"name"`
	Color string `json:"color"`
}

func (Postgres) PublicBranch(ctx context.Context, q Q, slug string) (*PublicBranch, error) {
	var b PublicBranch
	err := q.QueryRow(ctx, `SELECT id::text, COALESCE(slug, lower(code)), name FROM configuration.branches
      WHERE is_active AND (lower(slug) = lower($1) OR (slug IS NULL AND lower(code) = lower($1)))
      ORDER BY created_at LIMIT 1`, slug).Scan(&b.ID, &b.Slug, &b.Name)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &b, err
}

// PublicWeekSessions: published and full sessions of the branch (sessions
// without a branch belong to every branch, as the staff list treats them).
func (Postgres) PublicWeekSessions(ctx context.Context, q Q, branchID string, from, to time.Time) ([]PublicSession, error) {
	rows, err := q.Query(ctx, `SELECT s.id::text, s.starts_at, s.ends_at,
            round(extract(epoch FROM s.ends_at - s.starts_at) / 60)::int AS duration_min,
            t.name, t.color, c.name AS coach_name, s.capacity,
            GREATEST(s.capacity - (SELECT count(*) FROM gym.bookings b WHERE b.session_id = s.id AND b.`+seatsHeldWhere+`), 0)::int AS seats_left,
            s.booking_closes_at
       FROM gym.class_sessions s
       JOIN gym.class_types t ON t.id = s.class_type_id
       LEFT JOIN gym.coaches c ON c.id = s.coach_id
      WHERE (s.branch_id IS NULL OR s.branch_id = $1)
        AND s.starts_at >= $2 AND s.starts_at < $3
        AND s.status IN ('published', 'full')
      ORDER BY s.starts_at, t.name`, branchID, from, to)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (PublicSession, error) {
		var s PublicSession
		var startsAt, endsAt time.Time
		err := r.Scan(&s.ID, &startsAt, &endsAt, &s.DurationMin, &s.ClassType.Name, &s.ClassType.Color, &s.CoachName,
			&s.Capacity, &s.SeatsLeft, &s.bookingClosesAt)
		s.StartsAt, s.EndsAt = jsTime(startsAt), jsTime(endsAt)
		return s, err
	})
}
