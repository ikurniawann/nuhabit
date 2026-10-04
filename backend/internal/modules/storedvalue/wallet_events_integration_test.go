package storedvalue

import (
	"context"
	"testing"
	"time"

	"nuhabit/backend/internal/contracts/integrations"
	"nuhabit/backend/internal/platform/outbox"
	"nuhabit/backend/internal/platform/testutil"
)

// A verified Xendit callback credits the pending top-up once: the second
// delivery (a Xendit retry) finds it completed and changes nothing.
func TestQrisTopupSubscriber(t *testing.T) {
	member := testutil.CreateMember(t)
	deps := testutil.Deps(t, func() time.Time { return fixedNow })
	ctx, tx := context.Background(), testutil.Tx(t)
	newModule(deps, Ports{Directory: &fakeDir{}, Loyalty: fakeLoyalty{}}, tx)
	bus := deps.Events
	if err := bus.Register(ctx, tx); err != nil {
		t.Fatal(err)
	}
	var topupID string
	if err := tx.QueryRow(ctx, `INSERT INTO pos.pos_wallet_transactions (customer_id, type, amount, ark_coins, balance_before,
		balance_after, status, payment_method, reference_id, xendit_transaction_id)
		VALUES ($1, 'topup', 50000, 0, 0, 0, 'pending', 'qris', $2, $3) RETURNING id::text`,
		member.CustomerID, "topup_"+testutil.RandomHex(4), "qr_"+testutil.RandomHex(4)).Scan(&topupID); err != nil {
		t.Fatal(err)
	}
	paid := integrations.XenditQrPaid{Action: integrations.ActionCreditTopup, TargetID: topupID, PaymentID: "pay_1",
		Amount: 50000, XenditPaymentID: "pay_1", Notes: "Top-up QRIS"}
	deliver := func() {
		t.Helper()
		if err := outbox.Publish(ctx, tx, integrations.TopicXenditQrPaid, topupID, paid); err != nil {
			t.Fatal(err)
		}
		if n, err := bus.Dispatch(ctx, tx); err != nil || n == 0 {
			t.Fatalf("dispatch = %d %v", n, err)
		}
	}
	state := func() (status string, balance, ledger float64, paymentID string) {
		t.Helper()
		if err := tx.QueryRow(ctx, `SELECT t.status, COALESCE(c.ark_coin_balance, 0)::float8, t.balance_after::float8,
			t.metadata->>'xendit_payment_id'
			FROM pos.pos_wallet_transactions t JOIN pos.pos_customers c ON c.id = t.customer_id WHERE t.id = $1`, topupID).
			Scan(&status, &balance, &ledger, &paymentID); err != nil {
			t.Fatal(err)
		}
		return
	}

	deliver()
	if status, balance, ledger, paymentID := state(); status != "completed" || balance != 50000 || ledger != 50000 || paymentID != "pay_1" {
		t.Fatalf("credited = %s %v %v %s", status, balance, ledger, paymentID)
	}
	deliver()
	if status, balance, _, _ := state(); status != "completed" || balance != 50000 {
		t.Fatalf("redelivery credited again: %s %v", status, balance)
	}

	// Other actions belong to pos-sales.
	paid.Action = integrations.ActionCompleteOrder
	deliver()
	if _, balance, _, _ := state(); balance != 50000 {
		t.Fatalf("complete_order touched the wallet: %v", balance)
	}
}
