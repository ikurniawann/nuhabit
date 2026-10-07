package promo

import (
	"io"
	"log/slog"
	"testing"

	"nuhabit/backend/internal/contracts/ticketing"
	"nuhabit/backend/internal/platform/outbox"
)

func TestBookingEventsReleasePromo(t *testing.T) {
	e := setup(t)
	id := e.campaign(map[string]any{"scope": "semua"})
	codeID := dataID(t, e.call("POST", "/api/promo/campaigns/"+id+"/codes", map[string]any{"mode": "single", "code": "tiket"}, 200))
	e.exec(`UPDATE promo.promo_codes SET usage_count = 2 WHERE id = $1`, codeID)
	var cancelled, expired string
	for _, dst := range []*string{&cancelled, &expired} {
		e.scalar(`INSERT INTO promo.promo_redemptions (company_id, branch_id, code_id, campaign_id, campaign_name, discount_type, value,
			context_type, context_id, discount_amount, status) VALUES ($1,$2,$3,$4,'Kampanye','percent',10,'ticket_booking',gen_random_uuid(),5000,'held')
			RETURNING context_id::text`, []any{dst}, e.company, e.branch, codeID, id)
	}

	bus := outbox.NewBus(nil, slog.New(slog.NewTextHandler(io.Discard, nil)))
	Subscribe(bus, e.svc)
	if err := bus.Register(e.ctx, e.tx); err != nil {
		t.Fatal(err)
	}
	publish := func(topic, booking string) {
		if err := outbox.Publish(e.ctx, e.tx, topic, booking, ticketing.BookingReleased{
			BookingID: booking, BookingCode: "BK-1", CompanyID: e.company, BranchID: e.branch,
			PromoContextType: ticketing.PromoContextTicketBooking}); err != nil {
			t.Fatal(err)
		}
	}
	publish(ticketing.TopicBookingCancelled, cancelled)
	publish(ticketing.TopicBookingExpired, expired)
	publish(ticketing.TopicBookingCancelled, cancelled) // redelivered fact: no second release
	if n, err := bus.Dispatch(e.ctx, e.tx); err != nil || n != 3 {
		t.Fatalf("Dispatch = %d, %v", n, err)
	}
	var usage, released int
	e.scalar(`SELECT usage_count FROM promo.promo_codes WHERE id = $1`, []any{&usage}, codeID)
	e.scalar(`SELECT count(*) FROM promo.promo_redemptions WHERE code_id = $1 AND status = 'released'`, []any{&released}, codeID)
	if usage != 0 || released != 2 {
		t.Fatalf("usage %d released %d", usage, released)
	}
}
