package gymcare

import (
	"context"
	"fmt"
	"time"

	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/localtime"
)

// Viewer is the staff caller of a care route, as the route guard matched it.
type Viewer struct {
	ID, Name string
	// Manager holds read_medical on gym.member-flags: every medical flag,
	// PAR-Q declaration and coach note.
	Manager bool
	// Staff came in through a gym.member-flags (or other desk) menu grant;
	// otherwise only a coach portal grant let the caller in.
	Staff bool
}

// assignedSQL is a condition: the staff account in the viewer parameter
// coaches the member in col in a class or PT session whose local start day
// (in the session's branch zone) is the day of the now parameter or later.
// Cancelled sessions, seats and participants do not count.
func assignedSQL(col, viewer, now string) string {
	day := func(at, branch string) string {
		return fmt.Sprintf(`(%s AT TIME ZONE COALESCE(%s.timezone, 'Asia/Jakarta'))::date`, at, branch)
	}
	return fmt.Sprintf(`EXISTS (
  SELECT 1 FROM gym.coaches vc
   WHERE vc.user_id = %[2]s AND vc.status = 'active' AND (
     EXISTS (SELECT 1 FROM gym.bookings ab
               JOIN gym.class_sessions s ON s.id = ab.session_id
               LEFT JOIN configuration.branches br ON br.id = s.branch_id
              WHERE ab.customer_id = %[1]s AND s.coach_id = vc.id
                AND s.status <> 'cancelled' AND ab.status <> 'cancelled'
                AND %[3]s >= %[4]s)
     OR EXISTS (SELECT 1 FROM gym.pt_participants ap
               JOIN gym.pt_appointments a ON a.id = ap.appointment_id
               LEFT JOIN configuration.branches br ON br.id = a.branch_id
              WHERE ap.customer_id = %[1]s AND a.coach_id = vc.id
                AND a.status <> 'cancelled' AND ap.status <> 'cancelled'
                AND %[5]s >= %[6]s)))`,
		col, viewer,
		day("s.starts_at", "br"), day(now+"::timestamptz", "br"),
		day("a.starts_at", "br"), day(now+"::timestamptz", "br"))
}

// assigned reports whether viewer coaches the member today or later.
func (s *Service) assigned(ctx context.Context, q database.Querier, viewerID, customerID string) (bool, error) {
	var ok bool
	err := q.QueryRow(ctx, `SELECT `+assignedSQL("$1::uuid", "$2::uuid", "$3"), customerID, viewerID, s.now()).Scan(&ok)
	return ok, err
}

// seesMedical: a manager, or a coach of the member today or later.
func (s *Service) seesMedical(ctx context.Context, q database.Querier, v Viewer, customerID string) (bool, error) {
	if v.Manager {
		return true, nil
	}
	return s.assigned(ctx, q, v.ID, customerID)
}

// requireCoach is the active coach profile linked to the staff account (the
// oldest when several are); it fails without one.
func requireCoach(ctx context.Context, q database.Querier, userID string) (string, error) {
	var id string
	err := q.QueryRow(ctx,
		`SELECT id::text FROM gym.coaches WHERE user_id = $1 AND status = 'active' ORDER BY created_at LIMIT 1`, userID).Scan(&id)
	if database.IsNoRows(err) {
		return "", httpx.Forbidden("Hanya coach yang bisa melakukan ini")
	}
	return id, err
}

// today is the Jakarta calendar day of now, as the date flags expire on.
func today(now time.Time) string { return localtime.DayKey(now, localtime.Jakarta) }
