package gymscheduling

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/gymscheduling/domain"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/httpx"
)

// Front desk lookups: the branch list with the caller's own branch, staff
// accounts a coach profile can link to, member search with today's bookings,
// and the coach a staff account is.

// branches answers the branch picker of the gym forms; current_branch_id is
// the caller's configuration.users branch, the default for desk staff.
func (h *handler) branches(w http.ResponseWriter, r *http.Request, user *auth.User) error {
	rows, err := queryRows(r.Context(), h.svc.db,
		`SELECT id, name FROM configuration.branches WHERE COALESCE(is_active, true) ORDER BY name`)
	if err != nil {
		return err
	}
	return ok(w, object("branches", rows, "current_branch_id", user.BranchID))
}

// staffUsers lists active staff accounts for the coach to user link.
func (h *handler) staffUsers(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	rows, err := queryRows(r.Context(), h.svc.db,
		`SELECT u.id, u.full_name, u.email, b.name AS branch_name
       FROM configuration.users u
       LEFT JOIN configuration.branches b ON b.id = u.branch_id
      WHERE COALESCE(u.status, 'active') <> 'inactive'
      ORDER BY u.full_name NULLS LAST
      LIMIT 500`)
	if err != nil {
		return err
	}
	return ok(w, rows)
}

// deskMembers finds members by name, phone or member code, each with the
// bookings of today (WIB) that are not cancelled and the waiver on record
// (waiver_current: accepted in the version members accept today).
func (h *handler) deskMembers(w http.ResponseWriter, r *http.Request, _ *auth.User) error {
	term := strings.TrimSpace(r.URL.Query().Get("q"))
	if len(term) < 2 {
		return ok(w, []any{})
	}
	day := h.svc.now().In(domain.WIB).Format(time.DateOnly)
	from, _ := wibMidnight(day)
	rows, err := queryRows(r.Context(), h.svc.db,
		`SELECT c.id, c.name, c.phone, c.is_active, p.member_code,
            c.waiver_version, c.waiver_accepted_at,
            (c.waiver_accepted_at IS NOT NULL AND c.waiver_version IS NOT NULL
              AND ($4 = '' OR c.waiver_version = $4)) AS waiver_current,
            COALESCE((SELECT json_agg(json_build_object(
                'id', b.id, 'status', b.status, 'session_id', s.id, 'starts_at', s.starts_at,
                'ends_at', s.ends_at, 'class_type_name', t.name, 'coach_name', co.name,
                'checked_in_at', b.checked_in_at) ORDER BY s.starts_at)
               FROM gym.bookings b
               JOIN gym.class_sessions s ON s.id = b.session_id
               JOIN gym.class_types t ON t.id = s.class_type_id
               LEFT JOIN gym.coaches co ON co.id = s.coach_id
              WHERE b.customer_id = c.id AND b.status <> 'cancelled'
                AND s.starts_at >= $2 AND s.starts_at < $3), '[]'::json) AS bookings
       FROM pos.pos_customers c
       LEFT JOIN LATERAL (SELECT member_code FROM crm.crm_member_profiles
                           WHERE customer_id = c.id ORDER BY member_code LIMIT 1) p ON true
      WHERE c.name ILIKE '%' || $1 || '%' OR c.phone ILIKE '%' || $1 || '%' OR p.member_code ILIKE '%' || $1 || '%'
      ORDER BY c.name
      LIMIT 10`, term, from, from.Add(24*time.Hour), h.svc.WaiverVersion)
	if err != nil {
		return err
	}
	return ok(w, rows)
}

// CoachForUser is the active coach profile linked to a staff account, ""
// when there is none.
func (s *Service) CoachForUser(ctx context.Context, userID string) (string, error) {
	var id string
	err := s.db.QueryRow(ctx,
		`SELECT id FROM gym.coaches WHERE user_id = $1 AND status = 'active' ORDER BY created_at LIMIT 1`, userID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return id, err
}

// RequireOwnBooking is 404 unless the booking belongs to a session coached
// by the coach linked to userID.
func (s *Service) RequireOwnBooking(ctx context.Context, bookingID, userID string) error {
	var mine bool
	err := s.db.QueryRow(ctx, `SELECT EXISTS (
        SELECT 1 FROM gym.bookings b
          JOIN gym.class_sessions s ON s.id = b.session_id
          JOIN gym.coaches co ON co.id = s.coach_id
         WHERE b.id = $1 AND co.user_id = $2 AND co.status = 'active')`, bookingID, userID).Scan(&mine)
	if err != nil {
		return err
	}
	if !mine {
		return httpx.NotFound("Booking tidak ditemukan")
	}
	return nil
}
