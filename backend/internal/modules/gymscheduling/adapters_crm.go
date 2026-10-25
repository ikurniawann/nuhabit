package gymscheduling

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/gymscheduling/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/members"
)

// Adapters for data owned by the POS/CRM contexts. internal/app wires them
// until those modules expose the same operations.

// MembersSQL reads pos.pos_customers.
type MembersSQL struct{}

var _ Members = MembersSQL{}

func (MembersSQL) Get(ctx context.Context, q database.Querier, id string) (*Member, error) {
	var m Member
	err := q.QueryRow(ctx, `SELECT name, is_active, waiver_version, waiver_accepted_at FROM pos.pos_customers WHERE id = $1`, id).
		Scan(&m.Name, &m.IsActive, &m.WaiverVersion, &m.WaiverAcceptedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &m, err
}

func (MembersSQL) Search(ctx context.Context, q database.Querier, term string) ([]MemberHit, error) {
	rows, err := q.Query(ctx, `SELECT id, name, phone, is_active FROM pos.pos_customers
      WHERE name ILIKE '%' || $1 || '%' OR phone ILIKE '%' || $1 || '%'
      ORDER BY name LIMIT 10`, term)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (MemberHit, error) {
		var h MemberHit
		return h, r.Scan(&h.ID, &h.Name, &h.Phone, &h.IsActive)
	})
}

// QrTokensSQL reads and consumes crm.member_qr_tokens.
type QrTokensSQL struct{}

var _ QrTokens = QrTokensSQL{}

func (QrTokensSQL) Lock(ctx context.Context, q database.Querier, token string) (*domain.QrToken, error) {
	var t domain.QrToken
	err := q.QueryRow(ctx,
		`SELECT customer_id, expires_at, consumed_at FROM crm.member_qr_tokens WHERE token = $1 FOR UPDATE`, token).
		Scan(&t.CustomerID, &t.ExpiresAt, &t.ConsumedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	return &t, err
}

func (QrTokensSQL) Consume(ctx context.Context, q database.Querier, token string, at time.Time) error {
	_, err := q.Exec(ctx,
		`UPDATE crm.member_qr_tokens SET consumed_at = $2 WHERE token = $1 AND consumed_at IS NULL`, token, at)
	return err
}

// NotificationsSQL stores member notifications through platform/members,
// which publishes gym.member.notified in the same transaction, so a
// delivery failure never fails the booking.
type NotificationsSQL struct{}

var _ Notifier = NotificationsSQL{}

func (NotificationsSQL) NotifyMember(ctx context.Context, q database.Querier, customerID string, n Notification) error {
	return members.NotifyAfter(ctx, q, customerID, members.Notice{Type: n.Type, Title: n.Title, Body: n.Body}, n.DeliverAfter)
}
