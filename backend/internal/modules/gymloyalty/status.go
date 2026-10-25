package gymloyalty

import (
	"context"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/gymloyalty/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/localtime"
	"nuhabit/backend/internal/platform/members"
)

// Member status: managers suspend a member until a date or ban them, with
// a reason. Every change is kept in gym.member_status_events and the audit
// log, and the member is told in the app.

// StatusEvent is one status change.
type StatusEvent struct {
	FromStatus     domain.Status `json:"from_status"`
	ToStatus       domain.Status `json:"to_status"`
	Reason         *string       `json:"reason"`
	SuspendedUntil *time.Time    `json:"suspended_until"`
	ChangedBy      *string       `json:"changed_by_name"`
	CreatedAt      time.Time     `json:"created_at"`
}

func statusEvents(ctx context.Context, q database.Querier, customerID string, limit int) ([]StatusEvent, error) {
	rows, err := q.Query(ctx, `SELECT e.from_status, e.to_status, e.reason, e.suspended_until, u.full_name, e.created_at
		FROM gym.member_status_events e LEFT JOIN configuration.users u ON u.id = e.changed_by
		WHERE e.customer_id = $1 ORDER BY e.created_at DESC, e.id LIMIT $2`, customerID, limit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (StatusEvent, error) {
		var e StatusEvent
		err := r.Scan(&e.FromStatus, &e.ToStatus, &e.Reason, &e.SuspendedUntil, &e.ChangedBy, &e.CreatedAt)
		return e, err
	})
}

// StatusInput is the manager's form.
type StatusInput struct {
	Status         domain.Status `json:"status"`
	Reason         string        `json:"reason"`
	SuspendedUntil *time.Time    `json:"suspended_until"`
}

var statusNotice = map[domain.Status]func(domain.Standing) members.Notice{
	domain.StatusActive: func(domain.Standing) members.Notice {
		return members.Notice{Type: "gym_member_status", Title: "Status akun aktif kembali",
			Body: "Perks tier, XP dan leaderboard kembali berlaku."}
	},
	domain.StatusSuspended: func(s domain.Standing) members.Notice {
		return members.Notice{Type: "gym_member_status", Title: "Akun ditangguhkan",
			Body: "Sampai " + localtime.FormatLongDate(*s.SuspendedUntil, memberZone) +
				", perks tier, XP dan leaderboard dibekukan. Booking kelas tetap bisa. Alasan: " + *s.Reason}
	},
	domain.StatusBanned: func(s domain.Standing) members.Notice {
		return members.Notice{Type: "gym_member_status", Title: "Akun diblokir",
			Body: "Akunmu tidak bisa booking kelas atau masuk gate. Hubungi front desk. Alasan: " + *s.Reason}
	},
}

// SetStatus changes a member's status.
func (s *Service) SetStatus(ctx context.Context, customerID string, in StatusInput, actor Actor) (domain.Standing, error) {
	change := domain.StatusChange{Status: in.Status, Reason: in.Reason, SuspendedUntil: in.SuspendedUntil}
	now := s.now()
	if msg := change.Validate(now); msg != "" {
		return domain.Standing{}, httpx.BadRequest(msg)
	}
	next := change.Normalized()
	err := s.inTx(ctx, func(q database.DB) error {
		// Locking the customer row serializes two managers changing one member.
		tag, err := q.Exec(ctx, `SELECT 1 FROM pos.pos_customers WHERE id = $1 FOR UPDATE`, customerID)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return errMemberNotFound
		}
		before, err := loadStanding(ctx, q, customerID)
		if err != nil {
			return err
		}
		if _, err := q.Exec(ctx, `INSERT INTO gym.member_status (customer_id, status, reason, suspended_until, changed_by, changed_at)
			VALUES ($1, $2, $3, $4, $5, $6)
			ON CONFLICT (customer_id) DO UPDATE SET status = EXCLUDED.status, reason = EXCLUDED.reason,
			  suspended_until = EXCLUDED.suspended_until, changed_by = EXCLUDED.changed_by, changed_at = EXCLUDED.changed_at`,
			customerID, next.Status, next.Reason, next.SuspendedUntil, actor.ID, now); err != nil {
			return err
		}
		if _, err := q.Exec(ctx, `INSERT INTO gym.member_status_events (customer_id, from_status, to_status, reason, suspended_until, changed_by, created_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7)`,
			customerID, before.Effective(now), next.Status, next.Reason, next.SuspendedUntil, actor.ID, now); err != nil {
			return err
		}
		if err := actor.audit(ctx, q, "update", "gym_member_status", customerID, before, next, next.Reason); err != nil {
			return err
		}
		return members.Notify(ctx, q, customerID, statusNotice[next.Status](next))
	})
	return next, err
}

// MemberLoyaltyView is the loyalty block of the member 360: membership
// tier, XP progress and status with its history.
type MemberLoyaltyView struct {
	Membership    MembershipView  `json:"membership"`
	XP            *XPStanding     `json:"xp"`
	Standing      domain.Standing `json:"standing"`
	StatusHistory []StatusEvent   `json:"status_history"`
}

// MemberLoyalty evaluates the member's tier and reads the rest.
func (s *Service) MemberLoyalty(ctx context.Context, customerID string) (MemberLoyaltyView, error) {
	membership, err := s.Membership(ctx, customerID)
	if err != nil {
		return MemberLoyaltyView{}, err
	}
	view := MemberLoyaltyView{Membership: membership}
	if s.XP != nil {
		xp, err := s.XP.Standing(ctx, s.db, customerID)
		if err != nil {
			return view, err
		}
		view.XP = &xp
	}
	if view.Standing, err = loadStanding(ctx, s.db, customerID); err != nil {
		return view, err
	}
	view.Standing.Status = view.Standing.Effective(s.now())
	view.StatusHistory, err = statusEvents(ctx, s.db, customerID, 10)
	return view, err
}

// StatusRow is a member in the status list.
type StatusRow struct {
	CustomerID     string        `json:"customer_id"`
	Name           *string       `json:"name"`
	Phone          string        `json:"phone"`
	Status         domain.Status `json:"status"`
	Reason         *string       `json:"reason"`
	SuspendedUntil *time.Time    `json:"suspended_until"`
	ChangedAt      *time.Time    `json:"changed_at"`
	TierName       *string       `json:"tier_name"`
	Spend12m       float64       `json:"spend_12m_idr"`
}

// StatusList finds members by name or phone, or lists the suspended and
// banned ones when term is empty.
func (s *Service) StatusList(ctx context.Context, term string) ([]StatusRow, error) {
	term = strings.TrimSpace(term)
	where := `st.status IN ('suspended', 'banned') AND (st.status = 'banned' OR st.suspended_until > now())`
	args := []any{}
	if term != "" {
		where = `(c.name ILIKE $1 OR regexp_replace(c.phone, '\D', '', 'g') LIKE $1)`
		args = append(args, "%"+strings.TrimPrefix(term, "0")+"%")
	}
	rows, err := s.db.Query(ctx, `SELECT c.id::text, c.name, c.phone, COALESCE(st.status, 'active'), st.reason, st.suspended_until,
		st.changed_at, t.name, COALESCE(m.spend_12m, 0)::float8
		FROM pos.pos_customers c
		LEFT JOIN gym.member_status st ON st.customer_id = c.id
		LEFT JOIN gym.member_memberships m ON m.customer_id = c.id
		LEFT JOIN gym.membership_tiers t ON t.id = m.tier_id AND t.is_active
		WHERE `+where+` ORDER BY c.name NULLS LAST LIMIT 30`, args...)
	if err != nil {
		return nil, err
	}
	now := s.now()
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (StatusRow, error) {
		var row StatusRow
		err := r.Scan(&row.CustomerID, &row.Name, &row.Phone, &row.Status, &row.Reason, &row.SuspendedUntil,
			&row.ChangedAt, &row.TierName, &row.Spend12m)
		row.Status = domain.Standing{Status: row.Status, SuspendedUntil: row.SuspendedUntil}.Effective(now)
		return row, err
	})
}
