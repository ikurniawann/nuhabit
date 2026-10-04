package posops_test

import (
	"regexp"
	"testing"
)

func (h *harness) table(number string) string {
	h.t.Helper()
	return h.id(`INSERT INTO pos.pos_tables (table_number, capacity) VALUES ($1, 4) RETURNING id::text`, number)
}

func TestTablesMasterAndBoard(t *testing.T) {
	h := newHarness(t, nil)
	h.anon("GET", "/api/pos/tables", nil, 401)

	r := h.call("POST", "/api/pos/tables", map[string]any{"table_number": "  gt-9 a ", "capacity": "6.7", "status": "occupied", "notes": "  "}, 200)
	created := data(r)
	if !regexp.MustCompile(`^TBL-GT9A-[0-9A-F]{8}$`).MatchString(created["qr_code"].(string)) {
		t.Fatalf("qr = %v", created["qr_code"])
	}
	id := created["id"].(string)
	created["qr_code"] = "QR"
	jsonEq(t, created, `{"id":"`+id+`","table_number":"gt-9 a","name":"gt-9 a","label":"gt-9 a","floor":null,"area":null,
		"capacity":6,"status":"available","qr_code":"QR","notes":null,"is_active":true,"pos_x":null,"pos_y":null,
		"active_order":null,"active_orders":[],"open_checkouts":[],"bill_count":0,"guest_count":0}`)
	keysInOrder(t, r.raw, "success", "message", "data")

	r = h.call("POST", "/api/pos/tables", map[string]any{"table_number": "gt-9 a"}, 409)
	jsonEq(t, r.body, `{"success":false,"error":"Table number or QR code already exists"}`)
	r = h.call("POST", "/api/pos/tables", map[string]any{"name": "x"}, 400)
	jsonEq(t, r.body, `{"success":false,"error":"Table number is required"}`)
	r = h.call("POST", "/api/pos/tables", "null", 500)
	jsonEq(t, r.body, `{"success":false,"error":"Cannot read properties of null (reading 'table_number')"}`)

	r = h.call("PATCH", "/api/pos/tables/"+id, map[string]any{"table_number": "GT9A", "name": "Teras", "status": "reserved", "qr_code": "QR-GT9A", "floor": 2}, 200)
	jsonEq(t, data(r), `{"id":"`+id+`","table_number":"GT9A","name":"Teras","label":"Teras","floor":"2","area":null,
		"capacity":4,"status":"reserved","qr_code":"QR-GT9A","notes":null,"is_active":true,"pos_x":null,"pos_y":null}`)
	h.call("PATCH", "/api/pos/tables/00000000-0000-4000-8000-000000000000", map[string]any{"table_number": "Z"}, 404)
	r = h.call("PATCH", "/api/pos/tables/bad", map[string]any{"table_number": "Z"}, 500)
	jsonEq(t, r.body, `{"success":false,"error":"Failed to update table"}`)

	r = h.call("PATCH", "/api/pos/tables/"+id+"/position", map[string]any{"pos_x": 150, "pos_y": "33.335"}, 200)
	jsonEq(t, r.body, `{"success":true,"message":"Table position saved","data":{"id":"`+id+`","pos_x":100,"pos_y":33.34}}`)
	r = h.call("PATCH", "/api/pos/tables/"+id+"/position", map[string]any{"pos_x": "a", "pos_y": 1}, 400)
	jsonEq(t, r.body, `{"success":false,"error":"pos_x and pos_y must be numbers"}`)
	r = h.call("PATCH", "/api/pos/tables/"+id+"/position", 5, 400)
	jsonEq(t, r.body, `{"success":false,"error":"Invalid position payload"}`)

	// Board: one stall order and one central checkout with two children
	// (one pre-settled) make the table "billing".
	h.exec(`UPDATE pos.pos_orders SET table_id = NULL WHERE table_id = $1`, id)
	stall := h.order(nil, "pending", "unpaid", "", nil, 10000, id)
	h.exec(`UPDATE pos.pos_orders SET guest_count = 2 WHERE id = $1`, stall)
	chk := h.id(`INSERT INTO pos.pos_checkouts (checkout_number, cashier_id, table_id, total_amount)
		VALUES ('CHK-GT-' || substr(md5(random()::text), 1, 8), $1, $2, 1) RETURNING id::text`, h.staff.UserID, id)
	c1 := h.order(nil, "preparing", "unpaid", "", nil, 5000, id)
	c2 := h.order(nil, "completed", "unpaid", "", nil, 7000, id)
	h.exec(`UPDATE pos.pos_orders SET checkout_id = $1, sold_from = 'central' WHERE id IN ($2, $3)`, chk, c1, c2)
	h.exec(`UPDATE pos.pos_orders SET pre_settled_at = '2026-10-04T10:00:00+07:00' WHERE id = $1`, c2)
	h.order(nil, "cancelled", "unpaid", "", nil, 1, id)

	r = h.call("GET", "/api/pos/tables", nil, 200)
	var board map[string]any
	for _, row := range list(r.body["data"]) {
		if obj(row)["id"] == id {
			board = obj(row)
		}
	}
	if board["status"] != "billing" || board["bill_count"] != float64(2) || board["guest_count"] != float64(4) {
		t.Fatalf("board = %v", board)
	}
	if len(list(board["active_orders"])) != 3 {
		t.Fatalf("active orders = %v", board["active_orders"])
	}
	checkouts := list(board["open_checkouts"])
	if len(checkouts) != 1 || obj(checkouts[0])["id"] != chk || obj(checkouts[0])["total_amount"] != float64(12000) {
		t.Fatalf("open checkouts = %v", checkouts)
	}
	for _, o := range list(board["active_orders"]) {
		if obj(o)["id"] == c2 && obj(o)["pre_settled_at"] != "2026-10-04T03:00:00.000Z" {
			t.Fatalf("pre_settled_at = %v", obj(o)["pre_settled_at"])
		}
	}

	r = h.call("DELETE", "/api/pos/tables/"+id, nil, 409)
	jsonEq(t, r.body, `{"success":false,"error":"Table still has an open bill — deactivate instead of deleting"}`)
	free := h.table("GT-FREE-" + id[:4])
	r = h.call("DELETE", "/api/pos/tables/"+free, nil, 200)
	jsonEq(t, r.body, `{"success":true,"message":"Table deactivated"}`)
	var active bool
	var status string
	h.scalar(&active, `SELECT is_active FROM pos.pos_tables WHERE id = $1`, free)
	h.scalar(&status, `SELECT status::text FROM pos.pos_tables WHERE id = $1`, free)
	if active || status != "maintenance" {
		t.Fatalf("deactivated = %v %s", active, status)
	}
	h.call("DELETE", "/api/pos/tables/00000000-0000-4000-8000-000000000000", nil, 404)

	r = h.call("GET", "/api/pos/tables", nil, 200)
	for _, row := range list(r.body["data"]) {
		if obj(row)["id"] == free {
			t.Fatal("inactive table listed")
		}
	}
	r = h.call("GET", "/api/pos/tables?include_inactive=true", nil, 200)
	seen := false
	for _, row := range list(r.body["data"]) {
		seen = seen || obj(row)["id"] == free
	}
	if !seen {
		t.Fatal("include_inactive misses the inactive table")
	}
}
