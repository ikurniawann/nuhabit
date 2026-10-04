package engagement

import (
	"context"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/contracts/storedvalue"
	"nuhabit/backend/internal/modules/crm/engagement/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/outbox"
)

// subscriberWalletNotice is a contract: renaming it drops pending deliveries.
const subscriberWalletNotice = "crm.member-notification-from-wallet"

// Subscribe registers the engagement outbox subscribers: the member inbox
// row and web push the wallet sweep asks for (notifyMember in
// lib/crm/engagement/server.ts).
func Subscribe(bus *outbox.Bus, d module.Deps, p Ports) {
	if bus == nil {
		return
	}
	w := walletSubscriber{h: newHandler(d.DB, d, p)}
	bus.Subscribe(storedvalue.TopicMemberNotified, subscriberWalletNotice, w.handle)
}

type walletSubscriber struct{ h *handler }

// handle writes the inbox row on the delivery's transaction, so it lands
// exactly once. The push is best effort and sent at most once per event and
// member across replicas: the claim commits on the pool before the send, so
// a redelivery after a failed commit finds it.
func (w walletSubscriber) handle(ctx context.Context, tx pgx.Tx, e outbox.Event) error {
	var in storedvalue.MemberNotified
	if err := e.Decode(&in); err != nil {
		return err
	}
	var n notifications
	if err := n.notify(ctx, tx, in.CustomerID, domain.PushMessage{Type: in.Type, Title: in.Title, Body: in.Body}); err != nil {
		return err
	}
	first, err := claimPush(ctx, w.h.db, e.ID, in.CustomerID)
	if err != nil {
		return err
	}
	if first {
		w.h.send(n)
	}
	return nil
}

// claimPush records that event eventID pushes recipient; false when a
// delivery already did. Claims past the outbox retention are dropped.
func claimPush(ctx context.Context, q database.Querier, eventID int64, recipient string) (bool, error) {
	tag, err := q.Exec(ctx, `
WITH expired AS (DELETE FROM crm.member_push_claims WHERE claimed_at < now() - interval '7 days')
INSERT INTO crm.member_push_claims (event_id, recipient) VALUES ($1, $2)
ON CONFLICT DO NOTHING`, eventID, recipient)
	return tag.RowsAffected() == 1, err
}
