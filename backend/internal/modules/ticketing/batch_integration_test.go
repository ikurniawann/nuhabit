package ticketing

import "testing"

// Redeeming a booking with a plain guest, a paid bundle member and a free
// bundle member writes one visit band per guest with its own bundle columns,
// marks every band in use and debits only the guests with a price.
func TestRedeemWritesBandsAndDebitsPerGuest(t *testing.T) {
	f := newFixture(t)
	product, variant := f.ticket("Kolam", 50000, 50000)
	id := f.booking("BK-QRSTUV", "terbayar", product, variant)
	item := f.scalar(`SELECT id::text FROM ticketing.ticket_booking_items WHERE booking_id = $1`, id)
	f.exec(`UPDATE ticketing.ticket_booking_guests SET bundle_product_id = $2, bundle_unit_no = 1, allocated_price = 30000.50, member_label = 'Paket — Dewasa'
		WHERE booking_id = $1 AND position = 2`, id, product)
	f.exec(`INSERT INTO ticketing.ticket_booking_guests (company_id, branch_id, booking_id, booking_item_id, variant_id, guest_name, position,
		bundle_product_id, bundle_unit_no, allocated_price, member_label) VALUES ($1, $2, $3, $4, $5, 'Bayi', 3, $6, 2, 0, 'Paket — Bayi')`,
		f.venue.CompanyID, f.venue.BranchID, id, item, variant, product)
	f.exec(`UPDATE ticketing.ticket_bookings SET total = 80000.50 WHERE id = $1`, id)

	guests := f.ok(f.call("GET", "/api/ticketing/bookings/lookup?code=BK-QRSTUV", nil)).data()["guests"].([]any)
	var bands []any
	for i, uid := range []string{"FFFF0001", "FFFF0002", "FFFF0003"} {
		f.band(uid, "")
		bands = append(bands, map[string]any{"nfc_uid": uid, "guest_id": guests[i].(map[string]any)["id"]})
	}
	// A fourth band stays out of the redeem and must keep its status.
	f.band("FFFF0004", "")
	visitID := f.ok(f.call("POST", "/api/ticketing/bookings/"+id+"/redeem", map[string]any{"bands": bands})).data()["visit_id"].(string)

	eq(t, f.scalar(`SELECT string_agg(concat_ws('/', b.nfc_uid, vb.guest_name, vb.variant_id = $2::uuid, COALESCE(vb.bundle_product_id::text, '-') = $3,
			COALESCE(vb.bundle_unit_no::text, '-'), COALESCE(vb.allocated_price::text, '-'), COALESCE(vb.member_label, '-'), vb.status), ' | ' ORDER BY b.nfc_uid)
		FROM ticketing.ticket_visit_bands vb JOIN ticketing.ticket_bands b ON b.id = vb.band_id WHERE vb.visit_id = $1`, visitID, variant, product),
		"FFFF0001/Dewi/t/f/-/-/-/aktif | FFFF0002/Group Dewi - 2/t/t/1/30000.50/Paket — Dewasa/aktif | FFFF0003/Bayi/t/t/2/0.00/Paket — Bayi/aktif")
	eq(t, f.scalar(`SELECT string_agg(nfc_uid || ':' || status, ',' ORDER BY nfc_uid) FROM ticketing.ticket_bands WHERE branch_id = $1`, f.venue.BranchID),
		"FFFF0001:dipakai,FFFF0002:dipakai,FFFF0003:dipakai,FFFF0004:tersedia")
	today := f.scalar(`SELECT visit_date::text FROM ticketing.ticket_bookings WHERE id = $1`, id)
	eq(t, f.scalar(`SELECT string_agg(concat_ws('/', b.nfc_uid, c.charge_type, c.direction, c.amount::text, c.description,
			c.price_context->>'booking_guest_id' = $2, c.price_context->>'bundle_product_id', c.created_by IS NOT NULL), ' | ' ORDER BY b.nfc_uid)
		FROM ticketing.ticket_visit_charges c JOIN ticketing.ticket_bands b ON b.id = c.band_id WHERE c.visit_id = $1`,
		visitID, guests[0].(map[string]any)["id"]),
		"FFFF0001/tiket/debit/50000.00/Tiket Kolam — Umum (regular, "+today+") — booking BK-QRSTUV, a.n. Dewi/t/t"+
			" | FFFF0002/tiket/debit/30000.50/Tiket Paket — Dewasa (regular, "+today+") — booking BK-QRSTUV, a.n. Group Dewi - 2/f/"+product+"/t")
}

// Marking dates skips duplicates in the request and dates an existing range
// already covers; split payments on a settlement become one credit each.
func TestDateMarksSkipCoveredAndSplitPayments(t *testing.T) {
	f := newFixture(t)
	product, variant := f.ticket("Kolam", 50000, 50000)
	f.ok(f.call("POST", "/api/ticketing/products/"+product+"/dates", map[string]any{"date_kind": "high-season", "label": "Libur", "start_date": "2031-03-02", "end_date": "2031-03-04"}))
	f.ok(f.call("POST", "/api/ticketing/products/"+product+"/dates/bulk", map[string]any{"date_kind": "blok-online", "add": []any{"2031-03-03"}}))
	f.ok(f.call("POST", "/api/ticketing/products/"+product+"/dates/bulk", map[string]any{
		"date_kind": "high-season", "add": []any{"2031-03-05", "2031-03-01", "2031-03-03", "2031-03-05", "2031-03-04"}}))
	eq(t, f.scalar(`SELECT string_agg(concat_ws('/', date_kind, label, start_date, end_date, created_by IS NOT NULL), ' | ' ORDER BY date_kind, start_date)
		FROM ticketing.ticket_product_dates WHERE ticket_product_id = $1`, product),
		"blok-online/2031-03-03/2031-03-03/2031-03-03/t | high-season/2031-03-01/2031-03-01/2031-03-01/t"+
			" | high-season/Libur/2031-03-02/2031-03-04/t | high-season/2031-03-05/2031-03-05/2031-03-05/t")

	f.band("ABAB0001", "")
	visitID := f.visit(map[string]any{"contact_name": "Patungan", "payment_mode": "postpaid", "bands": []any{map[string]any{"nfc_uid": "ABAB0001", "variant_id": variant}}})
	f.tap("ABAB0001")
	f.ok(f.call("POST", "/api/ticketing/visits/"+visitID+"/settle", map[string]any{
		"payments": []any{map[string]any{"method": "cash", "amount": 20000.5}, map[string]any{"method": "qris", "amount": 29999.5}}}))
	eq(t, f.scalar(`SELECT string_agg(concat_ws('/', payment_method, amount::text, description, COALESCE(band_id::text, '-')), ' | ' ORDER BY payment_method)
		FROM ticketing.ticket_visit_charges WHERE visit_id = $1 AND charge_type = 'pembayaran'`, visitID),
		"cash/20000.50/Pembayaran settlement (cash)/- | qris/29999.50/Pembayaran settlement (qris)/-")
}
