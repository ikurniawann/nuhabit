package app

import (
	"context"
	"testing"

	"nuhabit/backend/internal/contracts/possales"
	"nuhabit/backend/internal/modules/crm"
	"nuhabit/backend/internal/modules/crm/loyalty"
	"nuhabit/backend/internal/modules/possales/adapters"
	"nuhabit/backend/internal/modules/possales/ports"
	"nuhabit/backend/internal/platform/outbox"
	"nuhabit/backend/internal/platform/testutil"
)

// pos-sales awards XP in the sale transaction (the cashier receipt shows it)
// and still publishes pos.sale.completed; CRM's subscriber re-runs the same
// engine with the same idempotency keys, so dispatching the event must add
// no ledger rows. Stats come only from the event.
func TestPosSaleXPAwardIsIdempotentWithCRMSubscriber(t *testing.T) {
	deps := testutil.Deps(t, nil)
	// The member must exist before the transaction: its cleanup runs after
	// the rollback, so it never waits on the transaction's row locks.
	member := testutil.CreateMember(t)
	tx := testutil.Tx(t)
	ctx := context.Background()
	var productID, orderID string
	if err := tx.QueryRow(ctx, `INSERT INTO pos.pos_products (sku, name, base_price, bonus_xp) VALUES ($1, 'Bonus', 10000, 15) RETURNING id::text`,
		"SKU-XP-"+testutil.RandomHex(4)).Scan(&productID); err != nil {
		t.Fatal(err)
	}
	orderID = "6f1e2d3c-4b5a-4c6d-8e7f-" + testutil.RandomHex(6)
	loyaltyPort := possalesLoyalty{crmLoyaltyForPos: newCrmLoyaltyForPos(deps), KolComp: adapters.KolComp{}}
	qty, total := 1.0, 10000.0
	award, err := loyaltyPort.AwardOrderXP(ctx, tx, ports.OrderXP{
		OrderID: orderID, CustomerID: member.CustomerID, TotalAmount: total, PaymentMethod: "cash",
		Items: []ports.XPItem{{ProductID: productID, Quantity: &qty, TotalAmount: &total}},
	})
	if err != nil || award.Status != "posted" || award.XPAwarded != 15 {
		t.Fatalf("award %+v err %v", award, err)
	}
	ledger := func() int {
		var n int
		if err := tx.QueryRow(ctx, `SELECT count(*) FROM crm.crm_xp_ledger WHERE reference_id::text = $1`, orderID).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	before := ledger()

	bus := outbox.NewBus(deps.DB, deps.Log)
	loyalty.Subscribe(bus, crm.NewEngine(deps, crmPosReads{}))
	if err := bus.Register(ctx, tx); err != nil {
		t.Fatal(err)
	}
	cust := member.CustomerID
	if err := outbox.Publish(ctx, tx, possales.TopicSaleCompleted, orderID, possales.SaleCompleted{
		OrderID: orderID, CustomerID: &cust, TotalAmount: total, PaymentMethod: "cash", StatsAmount: &total,
		Items: []possales.SaleItem{{ProductID: productID, Quantity: 1, TotalAmount: &total}},
	}); err != nil {
		t.Fatal(err)
	}
	for {
		n, err := bus.Dispatch(ctx, tx)
		if err != nil {
			t.Fatal(err)
		}
		if n == 0 {
			break
		}
	}
	if after := ledger(); after != before {
		t.Fatalf("ledger rows %d → %d after dispatch", before, after)
	}
	var spent float64
	var visits int
	if err := tx.QueryRow(ctx, `SELECT COALESCE(total_spent, 0)::float8, COALESCE(visit_count, 0) FROM pos.pos_customers WHERE id = $1`, member.CustomerID).Scan(&spent, &visits); err != nil {
		t.Fatal(err)
	}
	if spent != 10000 || visits != 1 {
		t.Fatalf("stats spent %v visits %d (want once)", spent, visits)
	}
}
