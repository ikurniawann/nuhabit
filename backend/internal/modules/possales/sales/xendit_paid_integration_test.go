package sales

import (
	"testing"

	"nuhabit/backend/internal/contracts/integrations"
	"nuhabit/backend/internal/platform/outbox"
)

// A verified Xendit callback completes the QRIS checkout once, publishing
// the cashier completion's sale events; a redelivery finds the children
// and changes nothing.
func TestQrisCheckoutSubscriber(t *testing.T) {
	e := setup(t)
	out := e.callAll("POST", "/api/pos/checkouts", e.mixedCart(map[string]any{
		"payment_status": "unpaid", "payment_method": "qris", "amount_paid": 0, "payment_method_code": "qris", "payment_method_name": "QRIS",
	}), 201)
	id := out["data"].(map[string]any)["checkout_id"].(string)
	bus := e.deps.Events
	if err := bus.Register(e.ctx, e.tx); err != nil {
		t.Fatal(err)
	}
	deliver := func(action string) {
		t.Helper()
		if err := outbox.Publish(e.ctx, e.tx, integrations.TopicXenditQrPaid, id, integrations.XenditQrPaid{Action: action, TargetID: id}); err != nil {
			t.Fatal(err)
		}
		for {
			n, err := bus.Dispatch(e.ctx, e.tx)
			if err != nil {
				t.Fatal(err)
			}
			if n == 0 {
				return
			}
		}
	}
	state := func() string {
		t.Helper()
		var s string
		e.scalar(&s, `SELECT concat_ws('/', c.payment_status, c.payment_method,
			(SELECT count(*) FROM pos.pos_orders o WHERE o.checkout_id = c.id AND o.payment_status = 'paid' AND o.payment_method = 'qris'),
			(SELECT count(*) FROM platform.outbox_events ev JOIN pos.pos_orders o ON ev.key = o.id::text
			  WHERE o.checkout_id = c.id AND ev.topic IN ('pos.sale.completed', 'pos.sale.settled')))
			FROM pos.pos_checkouts c WHERE c.id = $1`, id)
		return s
	}

	deliver(integrations.ActionCreditTopup)
	if got := state(); got != "unpaid/qris/0/0" {
		t.Fatalf("a top-up event touched the checkout: %s", got)
	}
	deliver(integrations.ActionCompleteCheckout)
	if got := state(); got != "paid/qris/2/4" {
		t.Fatalf("completed = %s", got)
	}
	deliver(integrations.ActionCompleteCheckout)
	if got := state(); got != "paid/qris/2/4" {
		t.Fatalf("redelivery = %s", got)
	}
}
