package engagement

import (
	"context"
	"sync"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/contracts/storedvalue"
	"nuhabit/backend/internal/modules/crm/engagement/domain"
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
	w := walletSubscriber{h: newHandler(d.DB, d, p), pushed: &pushedEvents{seen: map[int64]bool{}}}
	bus.Subscribe(storedvalue.TopicMemberNotified, subscriberWalletNotice, w.handle)
}

// pushedEvents remembers which outbox events already sent their push, so a
// delivery retried in this process (its inbox row rolled back with the
// failed attempt) does not push the member twice. Bounded; a retry on
// another replica may still push again (at-least-once).
type pushedEvents struct {
	mu    sync.Mutex
	seen  map[int64]bool
	order []int64
}

const maxPushedEvents = 4096

// first reports whether id is new and records it.
func (p *pushedEvents) first(id int64) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.seen[id] {
		return false
	}
	p.seen[id] = true
	p.order = append(p.order, id)
	if len(p.order) > maxPushedEvents {
		delete(p.seen, p.order[0])
		p.order = p.order[1:]
	}
	return true
}

type walletSubscriber struct {
	h      *handler
	pushed *pushedEvents
}

// handle writes the inbox row on the delivery's transaction, so it lands
// exactly once. The push is best effort, sent once per event id per process.
func (w walletSubscriber) handle(ctx context.Context, tx pgx.Tx, e outbox.Event) error {
	var in storedvalue.MemberNotified
	if err := e.Decode(&in); err != nil {
		return err
	}
	var n notifications
	if err := n.notify(ctx, tx, in.CustomerID, domain.PushMessage{Type: in.Type, Title: in.Title, Body: in.Body}); err != nil {
		return err
	}
	if w.pushed.first(e.ID) {
		w.h.send(n)
	}
	return nil
}
