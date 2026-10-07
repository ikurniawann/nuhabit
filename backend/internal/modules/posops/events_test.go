package posops_test

import (
	"testing"

	"nuhabit/backend/internal/contracts/possales"
	"nuhabit/backend/internal/platform/outbox"
)

func TestTableStatusSubscriber(t *testing.T) {
	h := newHarness(t, nil)
	bus := h.deps.Events
	if err := bus.Register(h.ctx, h.tx); err != nil {
		t.Fatal(err)
	}
	table := h.table("GT-EV-1")
	status := func() string {
		var s string
		h.scalar(&s, `SELECT status::text FROM pos.pos_tables WHERE id = $1`, table)
		return s
	}
	publish := func(p possales.TableStatusChanged) {
		t.Helper()
		if err := outbox.Publish(h.ctx, h.tx, possales.TopicTableStatusChanged, p.TableID, p); err != nil {
			t.Fatal(err)
		}
		if _, err := bus.Dispatch(h.ctx, h.tx); err != nil {
			t.Fatal(err)
		}
	}

	publish(possales.TableStatusChanged{TableID: table, Status: "occupied"})
	if status() != "occupied" {
		t.Fatalf("status = %s", status())
	}
	publish(possales.TableStatusChanged{TableID: table, Status: "occupied"}) // idempotent
	if status() != "occupied" {
		t.Fatalf("status after replay = %s", status())
	}

	// "available" only when no other active order sits on the table.
	keep := h.order(nil, "pending", "unpaid", "", nil, 1, table)
	publish(possales.TableStatusChanged{TableID: table, Status: "available", IfNoOtherActiveOrder: true})
	if status() != "occupied" {
		t.Fatalf("freed with an active order: %s", status())
	}
	publish(possales.TableStatusChanged{TableID: table, Status: "available", IfNoOtherActiveOrder: true, ExceptOrderID: keep})
	if status() != "available" {
		t.Fatalf("status = %s", status())
	}

	// A bad table id is dropped, not retried, and leaves the transaction usable.
	publish(possales.TableStatusChanged{TableID: "nope", Status: "occupied"})
	var pending int
	h.scalar(&pending, `SELECT count(*) FROM platform.outbox_deliveries d JOIN platform.outbox_events e ON e.id = d.event_id
		WHERE e.topic = $1 AND d.subscriber = 'pos-ops.table-status' AND d.delivered_at IS NULL`, possales.TopicTableStatusChanged)
	if pending != 0 || status() != "available" {
		t.Fatalf("pending deliveries = %d, status = %s", pending, status())
	}
}
