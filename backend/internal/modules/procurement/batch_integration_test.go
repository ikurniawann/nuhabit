package procurement_test

import "testing"

// A GRN that rejects part of two lines gets one draft credit with a line per
// rejected item, and closing the PO empties and cancels that credit.
func TestRejectCreditItemsAndCancelOnClose(t *testing.T) {
	e := newEnv(t)
	f := e.fixtures()
	staff := e.staff(itemsAll)
	_, _, wh := e.warehouse()

	poID := e.id(`INSERT INTO purchasing.purchase_orders (nomor_po, supplier_id, status, ppn_persen) VALUES ('GT-PO-'||$1, $2, 'sent', 0) RETURNING id::text`, suffix(), f.Supplier)
	first := e.id(`INSERT INTO purchasing.purchase_order_items (purchase_order_id, raw_material_id, qty_ordered, satuan_id, harga_satuan)
		VALUES ($1, $2, 10, $3, 1000) RETURNING id::text`, poID, f.Material, f.BigUnit)
	second := e.id(`INSERT INTO purchasing.purchase_order_items (purchase_order_id, raw_material_id, qty_ordered, satuan_id, harga_satuan)
		VALUES ($1, $2, 20, $3, 250.5) RETURNING id::text`, poID, f.Material, f.BigUnit)
	r := e.do(&staff, "POST", "/api/purchasing/delivery", map[string]any{"po_id": poID, "supplier_id": f.Supplier, "tanggal_kirim": "2026-10-04", "no_surat_jalan": "SJ-B", "tanggal_estimasi_tiba": "2026-10-05"})
	e.expect(r, 201, "")
	deliveryID := r.data()["id"].(string)

	line := func(poItem string, received, rejected float64, note string) map[string]any {
		return map[string]any{"purchase_order_item_id": poItem, "raw_material_id": f.Material, "satuan_id": f.BigUnit,
			"qty_diterima": received, "qty_ditolak": rejected, "qty_accepted": received, "qty_rejected": 0, "catatan": note}
	}
	r = e.do(&staff, "POST", "/api/purchasing/grn", map[string]any{"delivery_id": deliveryID, "warehouse_id": wh,
		"items": []any{line(first, 8, 2, "penyok"), line(second, 15, 1.5, "basah")}})
	e.expect(r, 201, "")
	grnID := r.data()["id"].(string)

	if e.scalar(`SELECT qty_received::float8 FROM purchasing.purchase_order_items WHERE id = $1`, first) != float64(8) ||
		e.scalar(`SELECT qty_received::float8 FROM purchasing.purchase_order_items WHERE id = $1`, second) != float64(15) {
		t.Fatal("qty_received not recalculated per PO line")
	}
	// The session user has no hris.staff row: created_by references users.
	creditID := e.id(`SELECT id::text FROM purchasing.vendor_credits WHERE grn_id = $1 AND source_type = 'receive_reject' AND status = 'draft' AND created_by = $2`, grnID, staff.UserID)
	if e.scalar(`SELECT total_amount::float8 FROM purchasing.vendor_credits WHERE id = $1`, creditID) != 2375.75 {
		t.Fatal("credit total")
	}
	got := e.scalar(`SELECT string_agg(ci.qty::float8 || '/' || ci.unit_price::float8 || '/' || ci.line_amount::float8 || '/' || COALESCE(ci.notes, '-'), ' ' ORDER BY ci.qty)
		FROM purchasing.vendor_credit_items ci JOIN purchasing.grn_items gi ON gi.id = ci.grn_item_id
		WHERE ci.vendor_credit_id = $1 AND gi.grn_id = $2 AND ci.raw_material_id = $3`, creditID, grnID, f.Material)
	if got != "1.5/250.5/375.75/basah 2/1000/2000/penyok" {
		t.Fatalf("credit items = %v", got)
	}

	e.expect(e.do(&staff, "POST", "/api/purchasing/po/"+poID+"/close", map[string]any{"reason": "sisa tidak dikirim"}), 200, "")
	if e.scalar(`SELECT count(*)::int FROM purchasing.vendor_credit_items WHERE vendor_credit_id = $1`, creditID) != int32(0) ||
		e.scalar(`SELECT status || '/' || total_amount::float8 FROM purchasing.vendor_credits WHERE id = $1`, creditID) != "cancelled/0" {
		t.Fatal("draft reject credit not cancelled on close")
	}
}

// Two return lines on one GRN item and a third on another item: every line
// is stored, and approval adds the summed quantity to each GRN item once.
func TestReturnLinesSharingGrnItem(t *testing.T) {
	e := newEnv(t)
	f := e.fixtures()
	staff := e.staff(itemsAll)
	_, branch, wh := e.warehouse()
	grnID, itemID := e.postedGrn(f, wh)
	other := e.id(`INSERT INTO purchasing.grn_items (grn_id, raw_material_id, qty_diterima, qty_qc_posted, qty_returned, warehouse_id)
		VALUES ($1, $2, 5, 5, 1, $3) RETURNING id::text`, grnID, f.Material, wh)
	e.exec(`INSERT INTO inventory.inventory (raw_material_id, qty_available, unit_cost, warehouse_id, branch_id) VALUES ($1, 10, 100, $2, $3)`, f.Material, wh, branch)

	line := func(item string, qty float64, batch string) map[string]any {
		return map[string]any{"grn_item_id": item, "raw_material_id": f.Material, "qty_returned": qty, "unit_cost": 100,
			"batch_number": batch, "expiry_date": "2027-01-31", "condition_notes": "rusak " + batch}
	}
	r := e.do(&staff, "POST", "/api/purchasing/returns", map[string]any{"grn_id": grnID, "supplier_id": f.Supplier, "return_date": "2026-10-04",
		"reason_type": "damaged", "items": []any{line(itemID, 1.25, "B1"), line(itemID, 2.5, "B2"), line(other, 0.5, "B3")}})
	e.expect(r, 200, "")
	retID := e.id(`SELECT id::text FROM purchasing.purchase_returns WHERE grn_id = $1`, grnID)
	got := e.scalar(`SELECT string_agg(qty_returned::float8 || '/' || subtotal::float8 || '/' || batch_number || '/' || expiry_date || '/' || condition_notes || '/' || qc_status,
		' ' ORDER BY batch_number) FROM purchasing.purchase_return_items WHERE return_id = $1 AND raw_material_id = $2 AND product_id IS NULL`, retID, f.Material)
	if got != "1.25/125/B1/2027-01-31/rusak B1/rejected 2.5/250/B2/2027-01-31/rusak B2/rejected 0.5/50/B3/2027-01-31/rusak B3/rejected" {
		t.Fatalf("return items = %v", got)
	}

	e.expect(e.do(&staff, "PATCH", "/api/purchasing/returns/"+retID+"/approve", nil), 200, "")
	if e.scalar(`SELECT qty_returned::float8 FROM purchasing.grn_items WHERE id = $1`, itemID) != 3.75 ||
		e.scalar(`SELECT qty_returned::float8 FROM purchasing.grn_items WHERE id = $1`, other) != 1.5 {
		t.Fatal("qty_returned not summed per GRN item")
	}
}

// Rejecting a return stamps approved_by with the session user, who has no
// hris.staff row: the column references users.
func TestRejectReturnStampsUser(t *testing.T) {
	e := newEnv(t)
	f := e.fixtures()
	staff := e.staff(itemsAll)
	_, branch, wh := e.warehouse()
	grnID, itemID := e.postedGrn(f, wh)
	e.exec(`INSERT INTO inventory.inventory (raw_material_id, qty_available, unit_cost, warehouse_id, branch_id) VALUES ($1, 10, 100, $2, $3)`, f.Material, wh, branch)
	r := e.do(&staff, "POST", "/api/purchasing/returns", map[string]any{"grn_id": grnID, "supplier_id": f.Supplier, "return_date": "2026-10-04",
		"reason_type": "damaged", "items": []any{map[string]any{"grn_item_id": itemID, "raw_material_id": f.Material, "qty_returned": 1, "unit_cost": 100}}})
	e.expect(r, 200, "")
	retID := e.id(`SELECT id::text FROM purchasing.purchase_returns WHERE grn_id = $1`, grnID)
	e.expect(e.do(&staff, "PATCH", "/api/purchasing/returns/"+retID+"/reject", map[string]any{"rejection_reason": "salah barang"}), 200, "")
	if e.scalar(`SELECT approved_by::text FROM purchasing.purchase_returns WHERE id = $1`, retID) != staff.UserID {
		t.Fatal("approved_by is not the rejecting user")
	}
}
