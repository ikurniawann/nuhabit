package procurement_test

import "testing"

// postedGrn is a GRN whose QC posted 5 units of the material into wh.
func (e *env) postedGrn(f fixtures, wh string) (grnID, itemID string) {
	poID := e.id(`INSERT INTO purchasing.purchase_orders (nomor_po, supplier_id, status) VALUES ('GT-PO-'||$1, $2, 'received') RETURNING id::text`, suffix(), f.Supplier)
	grnID = e.id(`INSERT INTO purchasing.grn (nomor_grn, purchase_order_id, supplier_id, status) VALUES ('GT-GRN-'||$1, $2, $3, 'received') RETURNING id::text`, suffix(), poID, f.Supplier)
	itemID = e.id(`INSERT INTO purchasing.grn_items (grn_id, raw_material_id, qty_diterima, qty_qc_posted, warehouse_id) VALUES ($1, $2, 5, 5, $3) RETURNING id::text`, grnID, f.Material, wh)
	e.exec(`INSERT INTO purchasing.grn_qc_inspections (grn_id, status, inventory_posted) VALUES ($1, 'approved', true)`, grnID)
	return
}

func TestPurchaseReturnLifecycle(t *testing.T) {
	e := newEnv(t)
	f := e.fixtures()
	staff := e.staff(itemsAll)
	_, branch, wh := e.warehouse()
	grnID, itemID := e.postedGrn(f, wh)
	e.exec(`INSERT INTO inventory.inventory (raw_material_id, qty_available, unit_cost, warehouse_id, branch_id) VALUES ($1, 3, 100, $2, $3)`, f.Material, wh, branch)
	ev := e.listen("procurement.purchase_return.approved")

	e.expect(e.do(&staff, "POST", "/api/purchasing/returns", map[string]any{"grn_id": grnID}), 400, "Required fields are incomplete")
	line := map[string]any{"grn_item_id": itemID, "raw_material_id": f.Material, "qty_returned": 6, "unit_cost": 100}
	body := map[string]any{"grn_id": grnID, "supplier_id": f.Supplier, "return_date": "2026-10-04", "reason_type": "damaged", "items": []any{line}}
	e.expect(e.do(&staff, "POST", "/api/purchasing/returns", body), 400, "Return quantity for "+e.scalar(`SELECT nama FROM item.raw_materials WHERE id = $1`, f.Material).(string)+" exceeds available stock (5)")
	line["qty_returned"] = 4
	r := e.do(&staff, "POST", "/api/purchasing/returns", body)
	e.expect(r, 200, "")
	if r.Body["data"] != nil || r.Body["message"] != "Purchase return created and pending approval" {
		t.Fatalf("create = %s", r.Raw)
	}
	retID := e.id(`SELECT id::text FROM purchasing.purchase_returns WHERE grn_id = $1`, grnID)

	r = e.do(&staff, "GET", "/api/purchasing/returns", nil)
	e.expect(r, 200, "")
	found := false
	for _, row := range r.list() {
		if m := row.(map[string]any); m["id"] == retID {
			found = true
			if m["grn_number"] == nil || m["grn"].(map[string]any)["grn_number"] != m["grn_number"] || m["supplier"] == nil {
				t.Fatalf("list row = %v", m)
			}
		}
	}
	if !found || r.Body["pagination"].(map[string]any)["total_pages"] == nil {
		t.Fatalf("list = %s", r.Raw)
	}
	e.expect(e.do(&staff, "GET", "/api/purchasing/returns?search=GT-GRN", nil), 400, "Format data tidak valid")

	r = e.do(&staff, "GET", "/api/purchasing/returns/"+retID, nil)
	e.expect(r, 200, "")
	item := r.data()["items"].([]any)[0].(map[string]any)
	if item["grn_item"].(map[string]any)["warehouse"].(map[string]any)["name"] == nil || item["raw_material"].(map[string]any)["kode"] == nil || item["product"] != nil {
		t.Fatalf("detail = %s", r.Raw)
	}
	r = e.do(&staff, "GET", "/api/purchasing/returns/grn-options", nil)
	e.expect(r, 200, "")

	line["qty_returned"] = 3
	r = e.do(&staff, "PATCH", "/api/purchasing/returns/"+retID, map[string]any{"return_date": "2026-10-05", "reason_type": "expired", "items": []any{line}})
	e.expect(r, 200, "")
	if r.data()["total_amount"] != "300.00" || r.data()["reason_type"] != "expired" || r.Body["message"] != "Purchase return updated successfully" {
		t.Fatalf("update = %s", r.Raw)
	}

	r = e.do(&staff, "PATCH", "/api/purchasing/returns/"+retID+"/approve", nil)
	e.expect(r, 200, "")
	if r.data()["status"] != "approved" {
		t.Fatalf("approve = %s", r.Raw)
	}
	if e.scalar(`SELECT qty_returned::float8 FROM purchasing.grn_items WHERE id = $1`, itemID) != float64(3) ||
		e.scalar(`SELECT qty_available::float8 FROM inventory.inventory WHERE raw_material_id = $1`, f.Material) != float64(0) {
		t.Fatal("stock or GRN not updated")
	}
	ev.dispatch(e)
	if got := ev.got["procurement.purchase_return.approved"]; len(got) != 1 || got[0]["total_amount"] != float64(300) || got[0]["return_date"] != "2026-10-05" {
		t.Fatalf("events = %v", ev.got)
	}
	e.expect(e.do(&staff, "PATCH", "/api/purchasing/returns/"+retID+"/approve", nil), 400, "Only pending returns can be approved")
	e.expect(e.do(&staff, "PATCH", "/api/purchasing/returns/"+retID+"/reject", map[string]any{}), 400, "Alasan penolakan wajib diisi")
	e.expect(e.do(&staff, "PATCH", "/api/purchasing/returns/"+retID+"/reject", map[string]any{"rejection_reason": "x"}), 400, "Return tidak dalam status pending approval")
	e.expect(e.do(&staff, "POST", "/api/purchasing/returns/"+retID+"/revise", nil), 409, "Hanya retur yang ditolak yang bisa direvisi")

	// Insufficient stock fails the approval and leaves the return pending.
	line["qty_returned"] = 2
	e.expect(e.do(&staff, "POST", "/api/purchasing/returns", body), 200, "")
	second := e.id(`SELECT id::text FROM purchasing.purchase_returns WHERE grn_id = $1 AND status = 'pending_approval'`, grnID)
	e.expect(e.do(&staff, "PATCH", "/api/purchasing/returns/"+second+"/approve", nil), 500, "Terjadi kesalahan server")

	// Rejected returns get a draft revision (approved_by references staff).
	e.exec(`UPDATE purchasing.purchase_returns SET status = 'rejected', rejection_reason = 'salah' WHERE id = $1`, second)
	r = e.do(&staff, "POST", "/api/purchasing/returns/"+second+"/revise", nil)
	e.expect(r, 201, "")
	if n := r.data()["return_number"].(string); r.data()["revision_no"] != float64(1) || r.Body["message"] != "Revisi "+n+" dibuat sebagai draft" {
		t.Fatalf("revise = %s", r.Raw)
	}
	e.expect(e.do(&staff, "POST", "/api/purchasing/returns/"+second+"/revise", nil), 409, "Retur ini sudah pernah direvisi")

	r = e.do(&staff, "GET", "/api/purchasing/return", nil)
	e.expect(r, 410, "API legacy /api/purchasing/return sudah tidak dipakai. Gunakan /api/purchasing/returns untuk purchase return workflow.")
	e.expect(e.do(&staff, "DELETE", "/api/purchasing/return/x", nil), 410, "API legacy /api/purchasing/return/:id sudah tidak dipakai. Gunakan /api/purchasing/returns/:id.")
}
