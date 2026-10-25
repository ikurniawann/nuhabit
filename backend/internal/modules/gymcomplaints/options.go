package gymcomplaints

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/platform/httpx"
)

// Ref is an id and a name for a picker.
type Ref struct {
	ID   string  `json:"id"`
	Name string  `json:"name"`
	Hint *string `json:"hint,omitempty"`
}

// Options feed the ticket forms: categories, owners (staff who can update
// tickets), staff linked to coaches (head coach candidates), coaches and
// branches.
type Options struct {
	Categories []Category `json:"categories"`
	Staff      []Ref      `json:"staff"`
	CoachUsers []Ref      `json:"coach_users"`
	Coaches    []Ref      `json:"coaches"`
	Branches   []Ref      `json:"branches"`
}

func refs(ctx context.Context, q Q, sql string, args ...any) ([]Ref, error) {
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (Ref, error) {
		var x Ref
		return x, r.Scan(&x.ID, &x.Name, &x.Hint)
	})
}

func (s *Service) Options(ctx context.Context) (Options, error) {
	var out Options
	var err error
	if out.Categories, err = s.Categories(ctx, false); err != nil {
		return out, err
	}
	// Owners hold update on gym.complaints through iam.user_roles, or through
	// the role named by users.role when they have no user_roles rows.
	if out.Staff, err = refs(ctx, s.db, `SELECT u.id::text, u.full_name, u.email FROM configuration.users u
	  WHERE u.status = 'active' AND EXISTS (
	    SELECT 1 FROM iam.role_menu_permissions rmp
	      JOIN iam.menus m ON m.id = rmp.menu_id AND m.code = 'gym.complaints' AND m.deleted_at IS NULL
	     WHERE rmp.is_active AND rmp.granted_actions ? 'update'
	       AND rmp.role_id IN (
	         SELECT ur.role_id FROM iam.user_roles ur WHERE ur.user_id = u.id
	         UNION ALL
	         SELECT r.id FROM iam.roles r WHERE r.code = u.role AND r.deleted_at IS NULL
	           AND NOT EXISTS (SELECT 1 FROM iam.user_roles ur2 WHERE ur2.user_id = u.id)))
	  ORDER BY u.full_name LIMIT 300`); err != nil {
		return out, err
	}
	if out.CoachUsers, err = refs(ctx, s.db, `SELECT DISTINCT u.id::text, u.full_name, co.name FROM gym.coaches co
	  JOIN configuration.users u ON u.id = co.user_id AND u.status = 'active'
	  WHERE co.status = 'active' ORDER BY 2`); err != nil {
		return out, err
	}
	if out.Coaches, err = refs(ctx, s.db, `SELECT co.id::text, co.name, br.name FROM gym.coaches co
	  LEFT JOIN configuration.branches br ON br.id = co.branch_id
	  WHERE co.status = 'active' ORDER BY co.name`); err != nil {
		return out, err
	}
	out.Branches, err = refs(ctx, s.db, `SELECT id::text, name, timezone FROM configuration.branches
	  WHERE COALESCE(is_active, true) ORDER BY name`)
	return out, err
}

// MemberClass is a class of the member around now, to link a desk ticket to.
type MemberClass = RecentClass

// MemberClasses lists a member's booked classes from 30 days back to 7
// days ahead, for the desk form.
func (s *Service) MemberClasses(ctx context.Context, customerID string) ([]MemberClass, error) {
	now := s.now()
	rows, err := s.db.Query(ctx, `SELECT s.id::text, ct.name, s.starts_at, COALESCE(br.timezone, 'Asia/Jakarta'), s.coach_id::text, co.name
	  FROM gym.bookings b
	  JOIN gym.class_sessions s ON s.id = b.session_id
	  JOIN gym.class_types ct ON ct.id = s.class_type_id
	  LEFT JOIN gym.coaches co ON co.id = s.coach_id
	  LEFT JOIN configuration.branches br ON br.id = s.branch_id
	 WHERE b.customer_id = $1 AND s.starts_at BETWEEN $2 AND $3
	 ORDER BY s.starts_at DESC LIMIT 40`, customerID, now.AddDate(0, 0, -30), now.AddDate(0, 0, 7))
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (MemberClass, error) {
		var c MemberClass
		var at time.Time
		err := r.Scan(&c.SessionID, &c.Name, &at, &c.Timezone, &c.CoachID, &c.CoachName)
		c.StartsAt = httpx.JSTime(at)
		return c, err
	})
}
