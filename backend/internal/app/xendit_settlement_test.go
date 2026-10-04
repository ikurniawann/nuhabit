package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"nuhabit/backend/internal/modules/integrations"
	"nuhabit/backend/internal/modules/integrations/webhooks"
	"nuhabit/backend/internal/modules/possales"
	"nuhabit/backend/internal/modules/storedvalue"
	"nuhabit/backend/internal/platform/testutil"
)

// A signed Xendit QRIS callback posted to the integrations webhook is
// queued, and the dispatcher settles it in the owning module: stored-value
// credits the top-up, pos-sales completes the central checkout and settles
// the open-bill order. Xendit retries change nothing.
func TestXenditQrisSettlementEndToEnd(t *testing.T) {
	cashier := testutil.CreateStaff(t, testutil.StaffOptions{})
	member := testutil.CreateMember(t)
	deps := testutil.Deps(t, nil)
	tx := testutil.Tx(t)
	f := integrationsFixture{t, context.Background(), tx}
	// The webhook runs on the test transaction; the subscribers get it from
	// the dispatcher, so their modules are built as cmd/api builds them.
	webhook := webhooks.NewHandler(tx, integrationsWebhookPorts(deps), deps.Now, deps.Log, os.Getenv, "https://api.telegram.org")
	mux := testutil.Mux(integrations.New(webhook))
	registry[storedvalue.Name](deps)
	registry[possales.Name](deps)
	bus := deps.Events
	if err := bus.Register(f.ctx, tx); err != nil {
		t.Fatal(err)
	}

	hex := testutil.RandomHex(4)
	token := "cb-" + hex
	f.exec(`INSERT INTO configuration.payment_gateways (provider, display_name, is_active, environment, secret_key, webhook_secret)
		VALUES ('xendit', 'Xendit', true, 'sandbox', 'sk', $1)
		ON CONFLICT (provider) DO UPDATE SET is_active = true, secret_key = 'sk', webhook_secret = EXCLUDED.webhook_secret`, token)

	topupRef, orderRef, checkoutRef := "topup_"+hex, "pos-ord-"+hex, "pos-chk-"+hex
	balanceBefore := f.scalar(`SELECT COALESCE(ark_coin_balance, 0)::float8::text FROM pos.pos_customers WHERE id = $1`, member.CustomerID)
	topup := f.scalar(`INSERT INTO pos.pos_wallet_transactions (customer_id, type, amount, ark_coins, balance_before, balance_after,
		status, payment_method, reference_id, xendit_transaction_id) VALUES ($1, 'topup', 50000, 0, 0, 0, 'pending', 'qris', $2, $3)
		RETURNING id::text`, member.CustomerID, topupRef, "qr_t"+hex)
	order := f.scalar(`INSERT INTO pos.pos_orders (order_number, cashier_id, customer_id, total_amount, payment_status, xendit_external_id)
		VALUES ($1, $2, $3, 75000, 'unpaid', $4) RETURNING id::text`, "T-"+hex, cashier.UserID, member.CustomerID, orderRef)

	holding := f.scalar(`INSERT INTO configuration.holdings (name, code) VALUES ('H', $1) RETURNING id::text`, "H"+hex)
	company := f.scalar(`INSERT INTO configuration.companies (holding_id, name, code) VALUES ($1, 'Co', $2) RETURNING id::text`, holding, "C"+hex)
	branch := f.scalar(`INSERT INTO configuration.branches (company_id, name, code) VALUES ($1, 'Br', $2) RETURNING id::text`, company, "B"+hex)
	stall := func(n string) string {
		return f.scalar(`INSERT INTO configuration.warehouses (branch_id, name, code, is_active) VALUES ($1, $2, $3, true) RETURNING id::text`,
			branch, "Stall "+n, "ST"+n+hex)
	}
	product := func(n string) string {
		return f.scalar(`INSERT INTO pos.pos_products (sku, name, base_price) VALUES ($1, $2, 60000) RETURNING id::text`, "SKU"+n+hex, "Menu "+n)
	}
	stallA, stallB, kopi, roti := stall("A"), stall("B"), product("A"), product("B")
	snapshot, _ := json.Marshal(map[string]any{
		"items": []any{
			map[string]any{"product_id": kopi, "product_name": "Menu A", "quantity": 1, "unit_price": 60000},
			map[string]any{"product_id": roti, "product_name": "Menu B", "quantity": 1, "unit_price": 60000},
		},
		"warehouseByProduct": map[string]string{kopi: stallA, roti: stallB},
		"orderType":          "dine_in", "guestCount": 1, "sessionUserId": cashier.UserID,
	})
	checkout := f.scalar(`INSERT INTO pos.pos_checkouts (checkout_number, cashier_id, company_id, branch_id, payment_status, payment_method,
		subtotal, total_amount, amount_paid, xendit_external_id, cart_snapshot)
		VALUES ($1, $2, $3, $4, 'unpaid', 'qris', 120000, 120000, 0, $5, $6) RETURNING id::text`,
		"CO-"+hex, cashier.UserID, company, branch, checkoutRef, string(snapshot))

	callback := func(qrID, ref string, amount int) string {
		t.Helper()
		body := fmt.Sprintf(`{"event":"qr.payment","data":{"id":"qrpy_%s","qr_id":"%s","reference_id":"%s","status":"SUCCEEDED","amount":%d}}`,
			qrID, qrID, ref, amount)
		req := httptest.NewRequest("POST", "/api/payments/xendit/webhook", strings.NewReader(body))
		req.Header.Set("x-callback-token", token)
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, req)
		return rec.Body.String()
	}
	dispatch := func() {
		t.Helper()
		for {
			n, err := bus.Dispatch(f.ctx, tx)
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
		return f.scalar(`SELECT concat_ws(' | ',
			(SELECT status || '/' || (c.ark_coin_balance - $4::float8)::float8 FROM pos.pos_wallet_transactions w
			   JOIN pos.pos_customers c ON c.id = w.customer_id WHERE w.id = $1),
			(SELECT payment_status || '/' || payment_method FROM pos.pos_orders WHERE id = $2),
			(SELECT payment_status || '/' || (SELECT count(*) FROM pos.pos_orders o WHERE o.checkout_id = k.id AND o.payment_status = 'paid')
			   FROM pos.pos_checkouts k WHERE k.id = $3))`, topup, order, checkout, balanceBefore)
	}

	for _, c := range []struct {
		qr, ref string
		amount  int
		want    string
	}{
		{"qr_t" + hex, topupRef, 50000, `{"success":true,"queued":true,"data":{"topup_id":"` + topup + `"}}`},
		{"qr_o" + hex, orderRef, 75000, `{"success":true,"queued":true,"data":{"order_id":"` + order + `"}}`},
		{"qr_c" + hex, checkoutRef, 120000, `{"success":true,"queued":true,"data":{"checkout_id":"` + checkout + `"}}`},
	} {
		if got := callback(c.qr, c.ref, c.amount); got != c.want {
			t.Fatalf("callback %s = %s", c.ref, got)
		}
	}
	dispatch()
	const settled = "completed/50000 | paid/qris | paid/2"
	if got := state(); got != settled {
		t.Fatalf("settled = %s", got)
	}

	// Xendit retries: the top-up and order are queued again and skipped,
	// the checkout now has children so the webhook does not queue it.
	callback("qr_t"+hex, topupRef, 50000)
	callback("qr_o"+hex, orderRef, 75000)
	if got := callback("qr_c"+hex, checkoutRef, 120000); !strings.Contains(got, `"reason":"checkout_children_exist"`) {
		t.Fatalf("checkout retry = %s", got)
	}
	dispatch()
	if got := state(); got != settled {
		t.Fatalf("after retries = %s", got)
	}
}
