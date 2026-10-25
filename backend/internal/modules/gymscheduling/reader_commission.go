package gymscheduling

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
)

// CoachBranchActivity is what one coach taught at one branch in a period:
// completed classes and PT sessions, and the members who came.
type CoachBranchActivity struct {
	CoachID       string
	BranchID      string
	ClassSessions int
	PtSessions    int
	Attendees     int
}

// CoachActivity counts, per coach and branch, the completed classes and PT
// sessions that started in [start, end). The session's coach is the one who
// taught it. Attendees are bookings checked in or completed and PT
// participants who completed.
func (r *Reader) CoachActivity(ctx context.Context, start, end time.Time) ([]CoachBranchActivity, error) {
	rows, err := r.q.Query(ctx, `
SELECT coach_id::text, branch_id::text, sum(classes)::int, sum(pt)::int, sum(attendees)::int
  FROM (
    SELECT cs.coach_id, cs.branch_id, 1 AS classes, 0 AS pt,
           (SELECT count(*) FROM gym.bookings b
             WHERE b.session_id = cs.id AND b.status IN ('checked_in', 'completed')) AS attendees
      FROM gym.class_sessions cs
     WHERE cs.status = 'completed' AND cs.coach_id IS NOT NULL AND cs.branch_id IS NOT NULL
       AND cs.starts_at >= $1 AND cs.starts_at < $2
    UNION ALL
    SELECT a.coach_id, a.branch_id, 0, 1,
           (SELECT count(*) FROM gym.pt_participants p WHERE p.appointment_id = a.id AND p.status = 'completed')
      FROM gym.pt_appointments a
     WHERE a.status = 'completed' AND a.branch_id IS NOT NULL
       AND a.starts_at >= $1 AND a.starts_at < $2
  ) x
 GROUP BY coach_id, branch_id`, start, end)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[CoachBranchActivity])
}
