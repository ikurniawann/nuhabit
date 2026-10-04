package gymtraining

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"nuhabit/backend/internal/modules/gymtraining/domain"
	"nuhabit/backend/internal/platform/members"
)

// Default adapters for the read ports in service.go. They query tables owned
// by other contexts (gym-scheduling: coaches, class types, class sessions,
// bookings; POS: customers) with the SQL the TS code used. internal/app may
// replace them with calls into those modules; until then they are the
// complete list of cross-context reads this module makes.

type SchedulingSQL struct{ DB *pgxpool.Pool }

// CompletedSessionsForCoachMonth returns completed classes with a coach that
// start in [start, end), each with its booking statuses (incentive-server.ts).
func (a SchedulingSQL) CompletedSessionsForCoachMonth(ctx context.Context, start, end time.Time, coachID *string) ([]domain.StatementSession, error) {
	return collect[domain.StatementSession](ctx, a.DB,
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
}

// Coaches lists coaches (one when coachID is set) ordered by name.
func (a SchedulingSQL) Coaches(ctx context.Context, coachID *string) ([]CatalogEntry, error) {
	return collect[CatalogEntry](ctx, a.DB,
		`SELECT id, name, status FROM gym.coaches WHERE ($1::uuid IS NULL OR id = $1) ORDER BY name`, coachID)
}

// ClassTypes lists class types ordered by name.
func (a SchedulingSQL) ClassTypes(ctx context.Context) ([]CatalogEntry, error) {
	return collect[CatalogEntry](ctx, a.DB, `SELECT id, name, status FROM gym.class_types ORDER BY name`)
}

// AttendedClassTimes returns the start of every class the member attended
// (checked in or completed) since the given time (races-server.ts).
func (a SchedulingSQL) AttendedClassTimes(ctx context.Context, customerID string, since time.Time) ([]time.Time, error) {
	rows, err := a.DB.Query(ctx,
		`SELECT cs.starts_at FROM gym.bookings b JOIN gym.class_sessions cs ON cs.id = b.session_id
		  WHERE b.customer_id = $1 AND b.status IN ('checked_in', 'completed') AND cs.starts_at >= $2`, customerID, since)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[time.Time])
}

type CustomersSQL struct{ DB *pgxpool.Pool }

// Contacts returns name and phone per customer id (race-admin-server.ts).
func (a CustomersSQL) Contacts(ctx context.Context, ids []string) (map[string]Contact, error) {
	found, err := members.GetMany(ctx, a.DB, ids)
	if err != nil {
		return nil, err
	}
	out := make(map[string]Contact, len(found))
	for id, m := range found {
		out[id] = Contact{ID: id, Name: m.Name, Phone: &m.Phone}
	}
	return out, nil
}
