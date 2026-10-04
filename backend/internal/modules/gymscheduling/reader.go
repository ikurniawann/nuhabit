package gymscheduling

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/platform/database"
)

// Reader is the read API other modules consume (through ports that
// internal/app adapts). It runs on the caller's Querier.
type Reader struct{ q database.Querier }

// NewReader reads gym-scheduling tables on q (the pool or an open tx).
func NewReader(q database.Querier) *Reader { return &Reader{q: q} }

// CatalogEntry is a coach or class type as a picker lists it.
type CatalogEntry struct {
	ID     string
	Name   string
	Status string
}

// CompletedClass is a completed class with its coach and booking statuses.
type CompletedClass struct {
	ID              string
	CoachID         *string
	ClassTypeID     string
	ClassTypeName   string
	StartsAt        time.Time
	Capacity        int
	Status          string
	BookingStatuses []string
}

// CompletedClasses lists completed classes with a coach that start in
// [start, end), one coach only when coachID is set (incentive-server.ts).
func (r *Reader) CompletedClasses(ctx context.Context, start, end time.Time, coachID *string) ([]CompletedClass, error) {
	rows, err := r.q.Query(ctx,
		`SELECT cs.id, cs.coach_id, cs.class_type_id, ct.name AS class_type_name,
		        cs.starts_at, cs.capacity, cs.status,
		        COALESCE(array_agg(b.status) FILTER (WHERE b.id IS NOT NULL), '{}') AS booking_statuses
		   FROM gym.class_sessions cs
		   JOIN gym.class_types ct ON ct.id = cs.class_type_id
		   LEFT JOIN gym.bookings b ON b.session_id = cs.id
		  WHERE cs.status = 'completed' AND cs.coach_id IS NOT NULL
		    AND cs.starts_at >= $1 AND cs.starts_at < $2
		    AND ($3::uuid IS NULL OR cs.coach_id = $3)
		  GROUP BY cs.id, ct.name`, start, end, coachID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[CompletedClass])
}

// Coaches lists coaches ordered by name, only coachID when it is set.
func (r *Reader) Coaches(ctx context.Context, coachID *string) ([]CatalogEntry, error) {
	rows, err := r.q.Query(ctx, `SELECT id, name, status FROM gym.coaches WHERE ($1::uuid IS NULL OR id = $1) ORDER BY name`, coachID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[CatalogEntry])
}

// ClassTypes lists class types ordered by name.
func (r *Reader) ClassTypes(ctx context.Context) ([]CatalogEntry, error) {
	rows, err := r.q.Query(ctx, `SELECT id, name, status FROM gym.class_types ORDER BY name`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[CatalogEntry])
}

// AttendedClassTimes returns the start of every class the member checked in
// to or completed since the given time (races-server.ts).
func (r *Reader) AttendedClassTimes(ctx context.Context, customerID string, since time.Time) ([]time.Time, error) {
	rows, err := r.q.Query(ctx,
		`SELECT cs.starts_at FROM gym.bookings b JOIN gym.class_sessions cs ON cs.id = b.session_id
		  WHERE b.customer_id = $1 AND b.status IN ('checked_in', 'completed') AND cs.starts_at >= $2`, customerID, since)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[time.Time])
}
