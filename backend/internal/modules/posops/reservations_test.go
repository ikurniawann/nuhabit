package posops_test

import (
	"testing"
)

func TestReservations(t *testing.T) {
	h := newHarness(t, nil)
	h.anon("GET", "/api/pos/reservations", nil, 401)
	t1, t2 := h.table("GT-R1"), h.table("GT-R2")
	customer := h.customer()
	h.exec(`DELETE FROM pos.pos_reservations WHERE reservation_date = '2031-01-02'`)

	r := h.call("POST", "/api/pos/reservations", map[string]any{"customer_name": "x", "time_slot": "19:30"}, 400)
	jsonEq(t, r.body, `{"success":false,"error":"Date, time slot, and party size are required"}`)
	r = h.call("POST", "/api/pos/reservations", map[string]any{"reservation_date": "2031-01-02", "time_slot": "19:30", "pax_count": 2, "customer_name": "  "}, 400)
	jsonEq(t, r.body, `{"success":false,"error":"Customer name is required"}`)
	r = h.call("POST", "/api/pos/reservations", "null", 500)
	jsonEq(t, r.body, `{"success":false,"error":"Cannot destructure property 'table_id' of 'body' as it is null."}`)

	r = h.call("POST", "/api/pos/reservations", map[string]any{
		"table_id": t1, "customer_id": customer, "customer_name": " Budi ", "customer_phone": " 0812 ",
		"reservation_date": "2031-01-02", "time_slot": "19:30", "pax_count": "4", "deposit_amount": "50000", "notes": "",
	}, 201)
	first := data(r)
	id1 := first["id"].(string)
	if first["time_slot"] != "19:30:00" || first["reservation_date"] != "2031-01-02T00:00:00.000Z" ||
		first["pax_count"] != float64(4) || first["deposit_amount"] != "50000.00" || first["duration_minutes"] != float64(120) ||
		first["status"] != "pending" || first["notes"] != nil || first["customer_phone"] != "0812" ||
		first["customer_name"] != "Budi" || first["queue_number"] != float64(1) {
		t.Fatalf("created = %s", r.raw)
	}
	jsonEq(t, first["table"], `{"table_number":"GT-R1"}`)
	jsonEq(t, first["customer"], `{"name":"Go POS Test","phone":"`+obj(first["customer"])["phone"].(string)+`"}`)
	keysInOrder(t, r.raw, "id", "table_id", "reservation_date", "queue_number", "table", "customer")

	r = h.call("POST", "/api/pos/reservations", map[string]any{
		"table_id": t1, "customer_name": "Ani", "reservation_date": "2031-01-02", "time_slot": "19:30:00", "pax_count": 2,
	}, 409)
	jsonEq(t, r.body, `{"success":false,"error":"Table is already reserved for this time slot"}`)

	r = h.call("POST", "/api/pos/reservations", map[string]any{
		"table_id": t2, "customer_name": "Ani", "reservation_date": "2031-01-02", "time_slot": "18:00", "pax_count": 3,
	}, 201)
	id2 := data(r)["id"].(string)
	if data(r)["queue_number"] != float64(2) || data(r)["customer"] != nil {
		t.Fatalf("second = %s", r.raw)
	}

	r = h.call("GET", "/api/pos/reservations?date=2031-01-02&status=all&table_id=undefined", nil, 200)
	rows := list(r.body["data"])
	if len(rows) != 2 || obj(rows[0])["id"] != id2 || obj(rows[0])["reservation_date"] != "2031-01-02" {
		t.Fatalf("list = %s", r.raw)
	}
	r = h.call("GET", "/api/pos/reservations?table_id="+t1, nil, 200)
	if len(list(r.body["data"])) != 1 {
		t.Fatalf("by table = %s", r.raw)
	}
	r = h.call("GET", "/api/pos/reservations?date=nope", nil, 500)
	jsonEq(t, r.body, `{"success":false,"error":"invalid input syntax for type date: \"nope\""}`)

	// Status updates stamp their time and move the table.
	r = h.call("PATCH", "/api/pos/reservations/"+id1, map[string]any{"status": "seated", "notes": "jendela"}, 200)
	if data(r)["seated_at"] == nil || data(r)["notes"] != "jendela" {
		t.Fatalf("seated = %s", r.raw)
	}
	var status string
	h.scalar(&status, `SELECT status::text FROM pos.pos_tables WHERE id = $1`, t1)
	if status != "occupied" {
		t.Fatalf("table status = %s", status)
	}
	r = h.call("PATCH", "/api/pos/reservations/"+id1, map[string]any{"status": "cancelled"}, 200)
	h.scalar(&status, `SELECT status::text FROM pos.pos_tables WHERE id = $1`, t1)
	if data(r)["cancelled_at"] == nil || status != "available" {
		t.Fatalf("cancelled = %s, table %s", r.raw, status)
	}
	r = h.call("PATCH", "/api/pos/reservations/"+id1, map[string]any{}, 500)
	jsonEq(t, r.body, `{"success":false,"error":"syntax error at or near \"WHERE\""}`)
	r = h.call("PATCH", "/api/pos/reservations/00000000-0000-4000-8000-000000000000", map[string]any{"status": "x"}, 500)
	jsonEq(t, r.body, `{"success":false,"error":"No rows found"}`)

	// Seating opens an empty dine-in bill carrying the party size.
	r = h.call("POST", "/api/pos/reservations/"+id1+"/seat", nil, 400)
	jsonEq(t, r.body, `{"success":false,"error":"Only pending or confirmed reservations can be seated"}`)
	r = h.call("POST", "/api/pos/reservations/00000000-0000-4000-8000-000000000000/seat", nil, 404)
	jsonEq(t, r.body, `{"success":false,"error":"Reservation not found"}`)

	r = h.call("POST", "/api/pos/reservations/"+id2+"/seat", map[string]any{}, 200)
	seated := data(r)
	order := obj(seated["order"])
	if seated["message"] != "Guest seated" || obj(seated["reservation"])["status"] != "seated" ||
		order["table_id"] != t2 || order["guest_count"] != float64(3) || order["notes"] != "Reservation · Ani · 18:00:00" ||
		order["status"] != "pending" || order["payment_status"] != "unpaid" || order["total_amount"] != "0.00" ||
		order["cashier_id"] != h.staff.UserID || order["order_type"] != "dine_in" {
		t.Fatalf("seat = %s", r.raw)
	}
	keysInOrder(t, r.raw, "success", "data", "reservation", "order", "message")
	h.scalar(&status, `SELECT status::text FROM pos.pos_tables WHERE id = $1`, t2)
	if status != "occupied" {
		t.Fatalf("seated table = %s", status)
	}

	id3 := h.id(`INSERT INTO pos.pos_reservations (table_id, customer_name, reservation_date, time_slot, pax_count, status)
		VALUES ($1, 'Cici', '2031-01-02', '20:00', 2, 'confirmed') RETURNING id::text`, t2)
	r = h.call("POST", "/api/pos/reservations/"+id3+"/seat", nil, 409)
	jsonEq(t, r.body, `{"success":false,"error":"Table is occupied"}`)
	h.exec(`UPDATE pos.pos_tables SET is_active = false WHERE id = $1`, t1)
	r = h.call("POST", "/api/pos/reservations/"+id3+"/seat", map[string]any{"table_id": t1}, 400)
	jsonEq(t, r.body, `{"success":false,"error":"Table is inactive"}`)
	r = h.call("POST", "/api/pos/reservations/"+id3+"/seat", "null", 500)
	jsonEq(t, r.body, `{"success":false,"error":"Cannot read properties of null (reading 'table_id')"}`)
}
