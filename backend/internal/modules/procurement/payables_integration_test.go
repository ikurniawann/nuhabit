package procurement_test

import "testing"

func TestVendorPaymentsAndCredits(t *testing.T) {
	e := newEnv(t)
	f := e.fixtures()
	staff := e.staff(itemsAll)

	// PO A (fully received, 10000 payable) and PO B of the same supplier
	// holding an approved credit of 3000.
	poA := e.id(`INSERT INTO purchasing.purchase_orders (nomor_po, supplier_id, status, total, ppn_persen) VALUES ('GT-PA-'||$1, $2, 'received', 10000, 0) RETURNING id::text`, suffix(), f.Supplier)
	e.exec(`INSERT INTO purchasing.purchase_order_items (purchase_order_id, raw_material_id, qty_ordered, qty_received, harga_satuan) VALUES ($1, $2, 10, 10, 1000)`, poA, f.Material)
	poB := e.id(`INSERT INTO purchasing.purchase_orders (nomor_po, supplier_id, status, total) VALUES ('GT-PB-'||$1, $2, 'received', 0) RETURNING id::text`, suffix(), f.Supplier)
	grnB := e.id(`INSERT INTO purchasing.grn (nomor_grn, purchase_order_id, supplier_id, status) VALUES ('GT-GRN-'||$1, $2, $3, 'received') RETURNING id::text`, suffix(), poB, f.Supplier)
	credit := e.id(`INSERT INTO purchasing.vendor_credits (credit_number, grn_id, purchase_order_id, supplier_id, source_type, status, total_amount)
		VALUES ('GT-VC-'||$1, $2, $3, $4, 'qc_reject', 'approved', 3000) RETURNING id::text`, suffix(), grnB, poB, f.Supplier)

	r := e.do(&staff, "GET", "/api/purchasing/vendor-payments?search=GT-PA", nil)
	e.expect(r, 200, "")
	var row map[string]any
	for _, it := range r.list() {
		if it.(map[string]any)["purchase_order_id"] == poA {
			row = it.(map[string]any)
		}
	}
	if row == nil || row["outstanding_amount"] != float64(10000) || row["payment_status"] != "unpaid" || row["can_pay"] != true {
		t.Fatalf("vendor payments = %s", r.Raw)
	}

	e.expect(e.do(&staff, "GET", "/api/purchasing/vendor-credits/apply?purchase_order_id=x", nil), 400, "purchase_order_id wajib")
	e.expect(e.do(&staff, "GET", "/api/purchasing/vendor-credits/apply?purchase_order_id=11111111-1111-4111-8111-111111111111", nil), 404, "PO tidak ditemukan")
	r = e.do(&staff, "GET", "/api/purchasing/vendor-credits/apply?purchase_order_id="+poA, nil)
	e.expect(r, 200, "")
	if len(r.list()) != 1 || r.list()[0].(map[string]any)["remaining"] != float64(3000) || r.Body["meta"].(map[string]any)["outstanding"] != float64(10000) {
		t.Fatalf("credits = %s", r.Raw)
	}
	e.expect(e.do(&staff, "POST", "/api/purchasing/vendor-credits/apply", map[string]any{"purchase_order_id": poA, "amount": 0}), 400, "Validation failed")
	e.expect(e.do(&staff, "POST", "/api/purchasing/vendor-credits/apply", map[string]any{"purchase_order_id": poA, "amount": 20000}), 400, "Jumlah melebihi sisa tagihan PO (10000)")
	r = e.do(&staff, "POST", "/api/purchasing/vendor-credits/apply", map[string]any{"purchase_order_id": poA, "amount": 5000, "dry_run": true})
	e.expect(r, 200, "")
	if r.Body["message"] != "Kredit yang bisa dipakai: 3000" || r.data()["remaining"] != float64(2000) {
		t.Fatalf("dry run = %s", r.Raw)
	}
	r = e.do(&staff, "POST", "/api/purchasing/vendor-credits/apply", map[string]any{"purchase_order_id": poA, "amount": 2000})
	e.expect(r, 200, "")
	if r.Body["message"] != "Kredit vendor 2000 dipakai untuk PO ini" || e.scalar(`SELECT applied_amount::float8 FROM purchasing.vendor_credits WHERE id = $1`, credit) != float64(2000) {
		t.Fatalf("apply = %s", r.Raw)
	}
	if e.scalar(`SELECT count(*)::int FROM audit.audit_log WHERE entity_id = $1 AND action = 'vendor_credit.apply'`, poA) != int32(1) {
		t.Fatal("apply audit")
	}

	e.expect(e.do(&staff, "PATCH", "/api/purchasing/vendor-credits/"+credit+"/approve", map[string]any{"expiry_date": "bad"}), 400, "Format tanggal kedaluwarsa YYYY-MM-DD")
	e.expect(e.do(&staff, "PATCH", "/api/purchasing/vendor-credits/"+credit+"/approve", nil), 400,
		"Kredit tolak penerimaan/QC tidak disetujui dari GRN. Kekurangan ditagihkan lewat sisa qty PO; tutup PO bila supplier tidak mengganti.")
	e.expect(e.do(&staff, "PATCH", "/api/purchasing/vendor-credits/11111111-1111-4111-8111-111111111111/approve", nil), 404, "Vendor credit not found")

	r = e.do(&staff, "GET", "/api/purchasing/docs/spec", nil)
	e.expect(r, 200, "")
	if r.Body["openapi"] != "3.0.3" || r.Body["paths"].(map[string]any)["/api/purchasing/po"] == nil {
		t.Fatalf("spec = %s", r.Raw[:100])
	}
}
