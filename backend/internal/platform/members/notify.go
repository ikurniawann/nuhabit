package members

import (
	"context"
	"time"

	"nuhabit/backend/internal/contracts/gym"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/outbox"
)

// Notice is one entry of a member's inbox (crm.member_notifications).
type Notice struct {
	Type  string
	Title string
	Body  string
}

// Notify stores n in the member's inbox and publishes gym.member.notified
// in the same transaction. The CRM subscriber sends the web push, WhatsApp
// and email after commit, so a delivery failure never fails the caller's
// write.
func Notify(ctx context.Context, q database.Querier, customerID string, n Notice) error {
	return NotifyAfter(ctx, q, customerID, n, time.Time{})
}

// NotifyAfter is Notify with the push, WhatsApp and email held until at
// (quiet hours); the inbox row is written now. A zero at sends after commit.
func NotifyAfter(ctx context.Context, q database.Querier, customerID string, n Notice, at time.Time) error {
	if _, err := q.Exec(ctx,
		`INSERT INTO crm.member_notifications (customer_id, type, title, body) VALUES ($1, $2, $3, $4)`,
		customerID, n.Type, n.Title, n.Body); err != nil {
		return err
	}
	return outbox.PublishAt(ctx, q, gym.TopicMemberNotified, customerID, gym.MemberNotified{
		CustomerID: customerID, Type: n.Type, Title: n.Title, Body: n.Body,
	}, at)
}
