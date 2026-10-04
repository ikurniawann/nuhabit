package sales

import (
	"strings"
	"testing"

	"nuhabit/backend/internal/modules/possales/ports"
	"nuhabit/backend/internal/platform/testutil"
)

func (e *env) paidOrder(extra map[string]any) map[string]any {
	e.t.Helper()
	return e.call(true, "POST", "/api/pos/orders", e.cashOrder(extra), 201)["data"].(map[string]any)
}

func TestKitchenStatusBumps(t *testing.T) {
	e := setup(t)
	order := e.openBillOrder()
	path := "/api/pos/orders/" + order["id"].(string) + "/status"
	if out := e.call(true, "PATCH", path, map[string]any{"status": "bogus"}, 400); errorOf(out) != "Invalid status" {
		t.Fatalf("%v", out)
	}
	out := e.call(true, "PATCH", path, map[string]any{"status": "ready"}, 200)["data"].(map[string]any)
	if out["status"] != "ready" || out["kitchen_status"] != "ready" || len(out["item_ids"].([]any)) != 1 || out["station"] != nil {
		t.Fatalf("bump %v", out)
	}
	if out := e.call(true, "PATCH", path, map[string]any{"status": "served", "item_ids": []any{"nope"}}, 400); errorOf(out) != "Item tidak ditemukan / sudah selesai di station ini" {
		t.Fatalf("%v", out)
	}
	if out := e.call(true, "PATCH", "/api/pos/orders/00000000-0000-4000-8000-000000000000/status", map[string]any{"status": "ready"}, 404); errorOf(out) != "Order not found" {
		t.Fatalf("%v", out)
	}
	cancelled := e.call(true, "PATCH", path, map[string]any{"status": "cancelled"}, 200)["data"].(map[string]any)
	if cancelled["status"] != "cancelled" || cancelled["kitchen_status"] != "cancelled" {
		t.Fatalf("cancel %v", cancelled)
	}
}

func TestVoidPaidOrder(t *testing.T) {
	e := setup(t)
	order := e.paidOrder(map[string]any{"customer_id": e.fx.customer})
	path := "/api/pos/orders/" + order["id"].(string) + "/void"
	if out := e.call(true, "POST", path, map[string]any{"reason": "salah"}, 400); errorOf(out) != "Reason and supervisor PIN required" {
		t.Fatalf("%v", out)
	}
	spv := e.spv
	e.f.directory.supervisors = []ports.Supervisor{} // the real lookup is the Directory adapter's
	if out := e.call(true, "POST", path, map[string]any{"reason": "salah", "supervisor_pin": "4321"}, 403); errorOf(out) != "PIN supervisor tidak valid" {
		t.Fatalf("%v", out)
	}
	name := "Spv Dua"
	var hash string
	e.scalar(&hash, `SELECT pos_pin FROM configuration.users WHERE id = $1`, spv.UserID)
	e.f.directory.supervisors = []ports.Supervisor{{ID: spv.UserID, FullName: &name, PosPin: hash}}
	out := e.call(true, "POST", path, map[string]any{"reason": " salah input ", "supervisor_pin": "4321"}, 200)["data"].(map[string]any)
	if out["message"] != "Order voided successfully" || len(out["voided_order_ids"].([]any)) != 1 {
		t.Fatalf("void %v", out)
	}
	var status, payment, reason, by string
	e.scalar(&status, `SELECT status::text FROM pos.pos_orders WHERE id = $1`, order["id"])
	e.scalar(&payment, `SELECT payment_status::text FROM pos.pos_orders WHERE id = $1`, order["id"])
	e.scalar(&reason, `SELECT void_reason FROM pos.pos_orders WHERE id = $1`, order["id"])
	e.scalar(&by, `SELECT voided_by::text FROM pos.pos_orders WHERE id = $1`, order["id"])
	if status != "voided" || payment != "refunded" || reason != "salah input" || by != spv.UserID {
		t.Fatalf("stamp %s %s %q %s", status, payment, reason, by)
	}
	var stats string
	e.scalar(&stats, `SELECT (payload->>'stats_amount') || '/' || (payload->>'reverse_xp') FROM platform.outbox_events WHERE topic = 'pos.orders.voided' AND key = $1`, order["id"])
	if stats != "48000/true" {
		t.Fatalf("event %s", stats)
	}
	if out := e.call(true, "POST", path, map[string]any{"reason": "lagi", "supervisor_pin": "4321"}, 400); errorOf(out) != "Order already voided" {
		t.Fatalf("%v", out)
	}
}

func TestMergeAndTransfer(t *testing.T) {
	e := setup(t)
	src, dst := e.openBillOrder(), e.openBillOrder()
	if out := e.call(true, "POST", "/api/pos/orders/"+src["id"].(string)+"/merge", map[string]any{}, 400); errorOf(out) != "Target order required" {
		t.Fatalf("%v", out)
	}
	out := e.call(true, "POST", "/api/pos/orders/"+src["id"].(string)+"/merge", map[string]any{"target_order_id": dst["id"]}, 200)
	if out["data"].(map[string]any)["message"] != "Orders merged successfully" {
		t.Fatalf("%v", out)
	}
	var total float64
	var status string
	e.scalar(&total, `SELECT total_amount::float8 FROM pos.pos_orders WHERE id = $1`, dst["id"])
	e.scalar(&status, `SELECT status::text FROM pos.pos_orders WHERE id = $1`, src["id"])
	if total != 80000 || status != "merged" {
		t.Fatalf("merge total %v status %s", total, status)
	}

	tableID := e.id(`INSERT INTO pos.pos_tables (table_number, capacity, is_active) VALUES ($1, 4, true) RETURNING id::text`, "TX"+testutil.RandomHex(2))
	var itemID string
	e.scalar(&itemID, `SELECT id::text FROM pos.pos_order_items WHERE order_id = $1 LIMIT 1`, dst["id"])
	moved := e.call(true, "POST", "/api/pos/orders/"+dst["id"].(string)+"/transfer-items", map[string]any{
		"target_table_id": tableID, "items": []any{map[string]any{"order_item_id": itemID, "qty": 1}},
	}, 200)["data"].(map[string]any)
	if moved["created_target"] != true || moved["message"] != "Items transferred successfully" {
		t.Fatalf("transfer %v", moved)
	}
	var left, newTotal float64
	e.scalar(&left, `SELECT total_amount::float8 FROM pos.pos_orders WHERE id = $1`, dst["id"])
	e.scalar(&newTotal, `SELECT total_amount::float8 FROM pos.pos_orders WHERE id = $1`, moved["target_order_id"])
	if left != 60000 || newTotal != 20000 {
		t.Fatalf("transfer totals %v %v", left, newTotal)
	}
	if out := e.call(true, "POST", "/api/pos/orders/"+dst["id"].(string)+"/transfer-items", map[string]any{"target_table_id": tableID}, 400); errorOf(out) != "items are required" {
		t.Fatalf("%v", out)
	}
}

func TestSplitBillFlow(t *testing.T) {
	e := setup(t)
	order := e.openBillOrder()
	base := "/api/pos/orders/" + order["id"].(string) + "/splits"
	if out := e.call(true, "POST", base, map[string]any{"splits": []any{map[string]any{"total_amount": 40000}}}, 400); errorOf(out) != "Minimal 2 split diperlukan" {
		t.Fatalf("%v", out)
	}
	if out := e.call(true, "POST", base, map[string]any{"splits": []any{map[string]any{"total_amount": 1}, map[string]any{"total_amount": 1}}}, 400); errorOf(out) != "Total split 2 tidak sama dengan total order 40000" {
		t.Fatalf("%v", out)
	}
	created := e.call(true, "POST", base, map[string]any{"splits": []any{
		map[string]any{"label": "Andi", "total_amount": 25000, "items": []any{map[string]any{"order_item_index": 0, "quantity": 1}}},
		map[string]any{"total_amount": 15000},
	}}, 200)["data"].(map[string]any)
	splits := created["splits"].([]any)
	if created["split_count"] != float64(2) || splits[1].(map[string]any)["label"] != "Split 2" {
		t.Fatalf("splits %v", created)
	}
	first := splits[0].(map[string]any)["id"].(string)
	second := splits[1].(map[string]any)["id"].(string)
	if out := e.call(true, "POST", base+"/"+first+"/pay", map[string]any{"payment_method": "cash", "amount_paid": 10}, 400); errorOf(out) != "Nominal bayar kurang dari total split 25000" {
		t.Fatalf("%v", out)
	}
	paid := e.call(true, "POST", base+"/"+first+"/pay", map[string]any{"payment_method": "cash", "amount_paid": 30000}, 200)["data"].(map[string]any)
	if paid["change"] != float64(5000) || paid["payment_status"] != "partial" || paid["paid_splits"] != float64(1) || paid["total_splits"] != float64(2) {
		t.Fatalf("pay %v", paid)
	}
	if out := e.call(true, "POST", base+"/"+first+"/pay", map[string]any{"payment_method": "cash", "amount_paid": 30000}, 400); errorOf(out) != "Split already paid" {
		t.Fatalf("%v", out)
	}
	if out := e.call(true, "PATCH", base+"/"+first, nil, 400); errorOf(out) != "Cannot cancel paid split" {
		t.Fatalf("cancel paid %v", out)
	}
	if out := e.call(true, "PATCH", base+"/00000000-0000-4000-8000-000000000000", nil, 400); errorOf(out) != "Split not found" {
		t.Fatalf("cancel unknown %v", out)
	}
	if out := e.raw("PATCH", base+"/"+second, nil, 200); out != `{"success":true,"data":{"success":true,"split_id":"`+second+`"}}` {
		t.Fatalf("cancel %s", out)
	}
	if out := e.call(true, "PATCH", base+"/"+second, nil, 400); errorOf(out) != "Split already cancelled" {
		t.Fatalf("cancel twice %v", out)
	}
	var notes string
	e.scalar(&notes, `SELECT notes FROM pos.pos_order_status_history
		WHERE order_id = $1 AND changed_by = $2 AND from_status = to_status`, order["id"], e.staff.UserID)
	if notes != "Split Split 2 cancelled" {
		t.Fatalf("history %q", notes)
	}
	list := e.call(true, "GET", base, nil, 200)["data"].(map[string]any)
	listed := list["splits"].([]any)
	if list["paid_count"] != float64(1) || listed[1].(map[string]any)["status"] != "cancelled" {
		t.Fatalf("list %v", list)
	}
}

// POST /api/pos/orders with splits runs pos_create_split_order_transaction:
// one unpaid order, its lines, the splits and their item mapping.
func TestCreateSplitOrder(t *testing.T) {
	e := setup(t)
	body := e.cashOrder(map[string]any{
		"order_type": "dine_in", "table_id": "T9", "guest_count": 3, "notes": "pisah", "subtotal": 48000,
		"splits": []any{
			map[string]any{"total_amount": 1}, map[string]any{"total_amount": 1},
		},
	})
	if out := e.call(true, "POST", "/api/pos/orders", body, 400); errorOf(out) != "Total split 2 tidak sama dengan total order 48000" {
		t.Fatalf("mismatch %v", out)
	}
	body["splits"] = []any{
		map[string]any{"label": "Andi", "subtotal": 20000, "total_amount": 20000,
			"items": []any{map[string]any{"order_item_index": 0, "quantity": 1, "unit_price": 20000}}},
		map[string]any{"total_amount": 28000, "customer_id": e.fx.customer,
			"items": []any{map[string]any{"order_item_index": 0, "quantity": 1}, map[string]any{"order_item_index": 1, "quantity": 1}}},
	}
	order := e.call(true, "POST", "/api/pos/orders", body, 201)["data"].(map[string]any)
	if order["status"] != "pending" || order["payment_status"] != "unpaid" || order["order_type"] != "dine_in" ||
		order["table_id"] != "T9" || order["guest_count"] != float64(3) || order["total_amount"] != "48000.00" ||
		order["queue_number"] == nil {
		t.Fatalf("order %v", order)
	}
	items := order["items"].([]any)
	splits := order["splits"].([]any)
	if len(items) != 2 || len(splits) != 2 {
		t.Fatalf("items %v splits %v", items, splits)
	}
	for _, raw := range items {
		it := raw.(map[string]any)
		if it["product_sku"] == "" || it["station"] == nil || it["kitchen_status"] != "pending" {
			t.Fatalf("item %v", it)
		}
	}
	var mapped float64
	e.scalar(&mapped, `SELECT COALESCE(sum(si.total_amount), 0)::float8 FROM pos.pos_order_split_items si
		JOIN pos.pos_order_splits s ON s.id = si.split_id WHERE s.order_id = $1`, order["id"])
	if mapped != 48000 {
		t.Fatalf("split items total %v", mapped)
	}
	var labels string
	e.scalar(&labels, `SELECT string_agg(label || ':' || COALESCE(customer_id::text, '-'), ',' ORDER BY split_index)
		FROM pos.pos_order_splits WHERE order_id = $1`, order["id"])
	if labels != "Andi:-,Split 2:"+e.fx.customer {
		t.Fatalf("labels %q", labels)
	}
	var history int
	e.scalar(&history, `SELECT count(*)::int FROM pos.pos_order_status_history
		WHERE order_id = $1 AND to_status = 'pending' AND changed_by = $2 AND notes = 'Split bill order created: 2 bill(s)'`,
		order["id"], order["cashier_id"])
	if history != 1 {
		t.Fatalf("history rows %d", history)
	}
}

func TestSimpleOrderRoutes(t *testing.T) {
	e := setup(t)
	order := e.openBillOrder()
	id := order["id"].(string)
	pre := e.call(true, "POST", "/api/pos/orders/"+id+"/pre-settle", nil, 200)
	if pre["message"] != "Pre settlement marked" || pre["data"].(map[string]any)["pre_settled_at"] == nil {
		t.Fatalf("pre-settle %v", pre)
	}
	moved := e.call(true, "PATCH", "/api/pos/orders/"+id+"/table", map[string]any{"table_id": "T7", "order_type": "takeaway"}, 200)["data"].(map[string]any)
	if moved["new_table_id"] != "T7" || moved["new_order_type"] != "takeaway" {
		t.Fatalf("table %v", moved)
	}
	if out := e.call(true, "POST", "/api/pos/orders/"+id+"/accept", nil, 409); errorOf(out) != "Bukan pesanan self-order" {
		t.Fatalf("%v", out)
	}
	if out := e.call(true, "POST", "/api/pos/orders/bad/accept", nil, 400); errorOf(out) != "Order tidak valid" {
		t.Fatalf("%v", out)
	}
	e.exec(`UPDATE pos.pos_orders SET special_requests = 'Self-service table order T1; payment=cashier' WHERE id = $1`, id)
	acc := e.call(true, "POST", "/api/pos/orders/"+id+"/accept", nil, 200)["data"].(map[string]any)
	if acc["status"] != "confirmed" || acc["payment_status"] != "unpaid" {
		t.Fatalf("accept %v", acc)
	}
}

func TestSendReceiptWa(t *testing.T) {
	e := setup(t)
	open := e.openBillOrder()
	if out := e.call(true, "POST", "/api/pos/orders/"+open["id"].(string)+"/send-wa", map[string]any{"phone": "0812345678"}, 400); errorOf(out) != "Struk hanya bisa dikirim untuk order yang sudah lunas" {
		t.Fatalf("%v", out)
	}
	order := e.paidOrder(nil)
	path := "/api/pos/orders/" + order["id"].(string) + "/send-wa"
	if out := e.call(true, "POST", path, map[string]any{"phone": "12"}, 400); errorOf(out) != "Nomor WA tidak valid — periksa kembali" {
		t.Fatalf("%v", out)
	}
	out := e.call(true, "POST", path, map[string]any{"phone": "0812-3456-7890"}, 200)
	if out["data"].(map[string]any)["phone"] != "6281234567890" || len(e.f.notifier.texts) != 1 {
		t.Fatalf("send %v", out)
	}
	msg := e.f.notifier.texts[0]
	if !strings.Contains(msg, "2x Kopi — Rp 40.000") || !strings.Contains(msg, "*Total: Rp 48.000*") || !strings.Contains(msg, "Kembalian: Rp 2.000") || !strings.Contains(msg, "Pembayaran: Tunai") {
		t.Fatalf("message %s", msg)
	}
}

func TestQrisCreateAndStatus(t *testing.T) {
	e := setup(t)
	if out := e.call(true, "POST", "/api/pos/qris", map[string]any{}, 400); errorOf(out) != "Nominal tidak valid" {
		t.Fatalf("%v", out)
	}
	order := e.openBillOrder()
	if out := e.call(true, "POST", "/api/pos/qris", map[string]any{"order_id": order["id"], "amount": 1000}, 409); !strings.HasPrefix(errorOf(out), "Total di layar (Rp1.000) tidak sama") {
		t.Fatalf("%v", out)
	}
	qr := e.call(true, "POST", "/api/pos/qris", map[string]any{"order_id": order["id"]}, 200)["data"].(map[string]any)
	if qr["qr_id"] != "qr_1" || qr["reference_id"] != "pos-ord-"+order["id"].(string) || qr["amount"] != float64(40000) || qr["order_id"] != order["id"] {
		t.Fatalf("qr %v", qr)
	}
	// Reused on the second call.
	again := e.call(true, "POST", "/api/pos/qris", map[string]any{"order_id": order["id"]}, 200)["data"].(map[string]any)
	if again["qr_id"] != "qr_1" || len(e.h.p.Xendit.(*fakeXendit).created) != 1 {
		t.Fatalf("reuse %v", again)
	}
	st := e.call(true, "GET", "/api/pos/qris/qr_1/status", nil, 200)["data"].(map[string]any)
	if st["paid"] != false || st["status"] != "ACTIVE" {
		t.Fatalf("status %v", st)
	}
	e.h.p.Xendit.(*fakeXendit).payments = []map[string]any{{"status": "SUCCEEDED"}}
	st = e.call(true, "GET", "/api/pos/qris/qr_1/status", nil, 200)["data"].(map[string]any)
	if st["paid"] != true || st["status"] != "SUCCEEDED" {
		t.Fatalf("status %v", st)
	}
}

func TestSupervisorsAdmin(t *testing.T) {
	e := setup(t)
	target := e.other
	out := e.call(true, "POST", "/api/pos/supervisors", map[string]any{"action": "promote", "user_id": target.UserID}, 200)
	if out["data"].(map[string]any)["message"] != "User dijadikan supervisor POS — set PIN-nya sekarang" {
		t.Fatalf("%v", out)
	}
	if out := e.call(true, "POST", "/api/pos/supervisors", map[string]any{"action": "set_pin", "user_id": target.UserID, "pin": "12"}, 400); errorOf(out) != "PIN harus 4-6 digit angka" {
		t.Fatalf("%v", out)
	}
	e.call(true, "POST", "/api/pos/supervisors", map[string]any{"action": "set_pin", "user_id": target.UserID, "pin": "2468"}, 200)
	var hash string
	e.scalar(&hash, `SELECT pos_pin FROM configuration.users WHERE id = $1`, target.UserID)
	if ok, _ := verifyPosPin(e.ctx, e.tx, "2468", hash); !ok {
		t.Fatalf("hash %s", hash)
	}
	list := e.call(true, "GET", "/api/pos/supervisors", nil, 200)["data"].(map[string]any)["supervisors"].([]any)
	found := false
	for _, s := range list {
		m := s.(map[string]any)
		found = found || (m["id"] == target.UserID && m["has_pin"] == true && m["legacy_pin"] == false)
	}
	if !found {
		t.Fatalf("list %v", list)
	}
	if out := e.call(true, "POST", "/api/pos/supervisors", map[string]any{"action": "nope", "user_id": target.UserID}, 400); errorOf(out) != "Payload tidak valid" {
		t.Fatalf("%v", out)
	}
	e.call(true, "POST", "/api/pos/supervisors", map[string]any{"action": "demote", "user_id": target.UserID}, 200)
}

func TestMemberBillQueueSubscriber(t *testing.T) {
	e := setup(t)
	order := e.openBillOrder()
	e.exec(`UPDATE pos.pos_orders SET queue_number = NULL WHERE id = $1`, order["id"])
	bus := e.deps.Events
	if err := bus.Register(e.ctx, e.tx); err != nil {
		t.Fatal(err)
	}
	if err := publish(e.ctx, e.tx, "pos.sale.completed", order["id"].(string), map[string]any{"order_id": order["id"], "payment_method": "member_bill"}); err != nil {
		t.Fatal(err)
	}
	for {
		n, err := bus.Dispatch(e.ctx, e.tx)
		if err != nil {
			t.Fatal(err)
		}
		if n == 0 {
			break
		}
	}
	var queue *string
	e.scalar(&queue, `SELECT queue_number FROM pos.pos_orders WHERE id = $1`, order["id"])
	if queue == nil || *queue == "" {
		t.Fatal("queue number not assigned")
	}
}
