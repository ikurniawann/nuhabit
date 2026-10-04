// Package engagement ports the CRM engagement dashboard routes (challenges,
// events and bookings, member announcements, the QR check-in log) and the
// member review moderation routes. The member-facing flows live in
// memberportal; this package shares their SQL semantics, not their code.
package engagement

import (
	"context"
	"time"

	"nuhabit/backend/internal/modules/crm/engagement/domain"
	"nuhabit/backend/internal/modules/crm/internal/kit"
	"nuhabit/backend/internal/modules/crm/xp"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/module"
)

// OrderSummary is the POS order a member review points at.
type OrderSummary struct {
	Number *string
	Total  *float64
}

// OrderReads are the POS paid-order reads this area needs.
type OrderReads interface {
	// ChallengeValues returns, per customer, the challenge metric over paid
	// orders created in [from, to]: distinct WIB days for "visits", the
	// summed total for "spend". Customers without orders are absent.
	ChallengeValues(ctx context.Context, q database.Querier, metric string, from, to time.Time, customerIDs []string) (map[string]float64, error)
	// OrderSummaries returns the order number and total per order id.
	OrderSummaries(ctx context.Context, q database.Querier, orderIDs []string) (map[string]OrderSummary, error)
}

// Pusher delivers member web push. Both calls return at once and deliver
// in the background, best effort, like the TS `void send...Push(...)`.
type Pusher interface {
	SendMember(customerID string, msg domain.PushMessage)
	SendAnnouncement(announcementID string, msg domain.PushMessage)
}

// Ports are the capabilities of other bounded contexts this area uses;
// internal/app/adapters_crm_engagement.go provides them.
type Ports struct {
	Orders OrderReads
	Push   Pusher
}

type handler struct {
	db     database.DB
	guard  kit.Guard
	orders OrderReads
	push   Pusher
	now    func() time.Time
}

// Routes mounts the area's routes.
func Routes(d module.Deps, _ *xp.Engine, p Ports) []module.Route {
	return newHandler(d.DB, d, p).routes()
}

func newHandler(db database.DB, d module.Deps, p Ports) *handler {
	now := d.Now
	if now == nil {
		now = time.Now
	}
	return &handler{db: db, guard: kit.Guard{Auth: d.Auth, DB: db}, orders: p.Orders, push: p.Push, now: now}
}

func (h *handler) routes() []module.Route {
	r := func(pattern string, fn httpx.HandlerFunc) module.Route {
		return module.Route{Pattern: pattern, Handler: httpx.Handle(fn)}
	}
	return []module.Route{
		r("GET /api/crm/engagement/announcements", h.listAnnouncements),
		r("POST /api/crm/engagement/announcements", h.sendAnnouncement),
		r("GET /api/crm/engagement/challenges", h.getChallenges),
		r("POST /api/crm/engagement/challenges", h.saveChallenge),
		r("GET /api/crm/engagement/checkins", h.checkinLog),
		r("GET /api/crm/engagement/events", h.listEvents),
		r("POST /api/crm/engagement/events", h.saveEvent),
		r("DELETE /api/crm/engagement/events", h.cancelEvent),
		r("GET /api/crm/engagement/events/bookings", h.listBookings),
		r("POST /api/crm/engagement/events/bookings", h.changeBooking),
		r("GET /api/crm/member-reviews", h.listReviews),
		r("PATCH /api/crm/member-reviews/{id}", h.updateReview),
	}
}

// notifications collects the member inbox rows a transaction wrote so their
// pushes go out only after it commits (afterCommit in the TS).
type notifications []queuedPush

type queuedPush struct {
	customerID string
	msg        domain.PushMessage
}

// notify mirrors notifyMember: one crm.member_notifications row now, the
// push after commit.
func (n *notifications) notify(ctx context.Context, q database.Querier, customerID string, msg domain.PushMessage) error {
	_, err := q.Exec(ctx, `INSERT INTO crm.member_notifications (customer_id, type, title, body) VALUES ($1, $2, $3, $4)`,
		customerID, msg.Type, msg.Title, msg.Body)
	if err == nil {
		*n = append(*n, queuedPush{customerID, msg})
	}
	return err
}

// send pushes the collected notifications; call it after the commit.
func (h *handler) send(n notifications) {
	if h.push == nil {
		return
	}
	for _, it := range n {
		h.push.SendMember(it.customerID, it.msg)
	}
}
