package tableorder

import (
	"context"
	"testing"

	"nuhabit/backend/internal/contracts/integrations"
	"nuhabit/backend/internal/platform/outbox"
	"nuhabit/backend/internal/platform/testutil"
)

// A verified Xendit callback settles the open-bill order once: paid by
// QRIS with a queue number, one journal, stats and XP event; a redelivery
// finds it paid and publishes nothing more.
func TestQrisOrderSubscriber(t *testing.T) {
	cashier := testutil.CreateStaff(t, testutil.StaffOptions{})
	member := testutil.CreateMember(t)
	deps := testutil.Deps(t, nil)
	ctx, tx := context.Background(), testutil.Tx(t)
	newHandler(deps, Ports{}, tx)
	bus := deps.Events
	if err := bus.Register(ctx, tx); err != nil {
		t.Fatal(err)
	}
	var orderID string
	if err := tx.QueryRow(ctx, `INSERT INTO pos.pos_orders (order_number, cashier_id, customer_id, total_amount, payment_status)
		VALUES ($1, $2, $3, 75000, 'unpaid') RETURNING id::text`, "T-"+testutil.RandomHex(4), cashier.UserID, member.CustomerID).Scan(&orderID); err != nil {
		t.Fatal(err)
	}
	deliver := func() {
		t.Helper()
		paid := integrations.XenditQrPaid{Action: integrations.ActionCompleteOrder, TargetID: orderID, Amount: 75000}
		if err := outbox.Publish(ctx, tx, integrations.TopicXenditQrPaid, orderID, paid); err != nil {
			t.Fatal(err)
		}
		if n, err := bus.Dispatch(ctx, tx); err != nil || n == 0 {
			t.Fatalf("dispatch = %d %v", n, err)
		}
	}
	check := func() {
		t.Helper()
		var state string
		if err := tx.QueryRow(ctx, `SELECT concat_ws('/', payment_status, payment_method, amount_paid::float8, queue_number IS NOT NULL,
			(SELECT string_agg(topic, ',' ORDER BY topic) FROM platform.outbox_events WHERE key = $1::text AND topic LIKE 'pos.%'))
			FROM pos.pos_orders WHERE id = $1::uuid`, orderID).Scan(&state); err != nil {
			t.Fatal(err)
		}
		if state != "paid/qris/75000/t/pos.customer_order.recorded,pos.sale.completed,pos.sale.settled" {
			t.Fatalf("order = %s", state)
		}
	}
	deliver()
	check()
	deliver()
	check()
}
