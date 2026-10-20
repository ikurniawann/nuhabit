package engagement

import (
	"context"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/contracts/gym"
	"nuhabit/backend/internal/contracts/storedvalue"
	"nuhabit/backend/internal/modules/crm/engagement/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/outbox"
)

// Subscriber names are contracts: renaming one drops pending deliveries.
const (
	subscriberWalletNotice = "crm.member-notification-from-wallet"
	subscriberGymNotice    = "crm.member-delivery-from-gym"
)

// Subscribe registers the engagement outbox subscribers: the delivery of
// gym notifications, and the member inbox row and web push the wallet sweep
// asks for (notifyMember in
// lib/crm/engagement/server.ts).
func Subscribe(bus *outbox.Bus, d module.Deps, p Ports) {
	if bus == nil {
		return
	}
	h := newHandler(d.DB, d, p)
	bus.Subscribe(storedvalue.TopicMemberNotified, subscriberWalletNotice, walletSubscriber{h: h}.handle)
	bus.Subscribe(gym.TopicMemberNotified, subscriberGymNotice, gymSubscriber{h: h, channels: p.Gym}.handle)
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

// inAppOnly are gym notifications about the member's own action. They stay
// in the inbox and on push; WhatsApp and email carry the rest.
var inAppOnly = map[string]bool{
	"gym_booking_confirmed": true,
	"gym_booking_waitlist":  true,
	"gym_checked_in":        true,
}

type gymSubscriber struct {
	h        *handler
	channels GymChannels
}

// handle delivers a gym notification the publisher already stored in the
// inbox: web push, then WhatsApp and email. Each is claimed once per event
// and member before it is sent, as the wallet push is, so a redelivery never
// sends twice. A failed send is logged by the sender and never retried.
func (g gymSubscriber) handle(ctx context.Context, _ pgx.Tx, e outbox.Event) error {
	var in gym.MemberNotified
	if err := e.Decode(&in); err != nil {
		return err
	}
	first, err := claimPush(ctx, g.h.db, e.ID, in.CustomerID)
	if err != nil {
		return err
	}
	if first && g.h.push != nil {
		g.h.push.SendMember(in.CustomerID, domain.PushMessage{Type: in.Type, Title: in.Title, Body: in.Body})
	}
	if g.channels == nil || inAppOnly[in.Type] {
		return nil
	}
	first, err = claimPush(ctx, g.h.db, e.ID, "channels:"+in.CustomerID)
	if err != nil {
		return err
	}
	if first {
		g.channels.Send(in.CustomerID, in.Title, in.Body)
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
