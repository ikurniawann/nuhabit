package procurement_test

import (
	"context"
	"regexp"
	"testing"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/app"
	"nuhabit/backend/internal/modules/procurement"
	"nuhabit/backend/internal/platform/outbox"
	"nuhabit/backend/internal/platform/testutil"
)

// generalPo creates a draft general-goods PO through the API.
func (e *env) generalPo(staff *testutil.Staff, f fixtures, supply string, extra map[string]any) map[string]any {
	e.t.Helper()
	body := map[string]any{
		"module_type": "general", "vendor_id": f.Vendor, "tanggal_po": "2026-10-04",
		"items": []any{map[string]any{"supply_item_id": supply, "qty_ordered": 4, "harga_satuan": 2500, "notes": "rak"}},
	}
	for k, v := range extra {
		body[k] = v
	}
	r := e.do(staff, "POST", "/api/purchasing/po", body)
	e.expect(r, 201, "")
	return r.data()
}

func (e *env) supplyItem() string {
	return e.id(`INSERT INTO item.supply_items (kode, nama, stockable) VALUES ('GTSI'||$1, 'Rak '||$1, true) RETURNING id::text`, suffix())
}

func TestPurchaseOrderCreateAndTotals(t *testing.T) {
	e := newEnv(t)
	f := e.fixtures()
	staff := e.staff(itemsAll)
	supply := e.supplyItem()

	e.expect(e.do(&staff, "POST", "/api/purchasing/po", map[string]any{"module_type": "general", "vendor_id": f.Vendor, "tanggal_po": "2026-10-04", "items": []any{}}), 400, "Minimal 1 item PO")
	e.expect(e.do(&staff, "POST", "/api/purchasing/po", map[string]any{"supplier_id": f.Supplier, "tanggal_po": "04-10-2026", "items": []any{}}), 400, "Format tanggal: YYYY-MM-DD")
	e.expect(e.do(&staff, "POST", "/api/purchasing/po", map[string]any{"module_type": "product", "tanggal_po": "2026-10-04"}), 400, "Invalid input: expected string, received undefined")
	raw := map[string]any{"supplier_id": f.Supplier, "tanggal_po": "2026-10-04", "items": []any{map[string]any{"raw_material_id": f.Material, "qty_ordered": 1, "harga_satuan": 1}}}
	e.expect(e.do(&staff, "POST", "/api/purchasing/po", raw), 400, "Purchase order must be created from an approved purchase request")

	po := e.generalPo(&staff, f, supply, map[string]any{"diskon_persen": 10, "ppn_persen": 0})
	if !regexp.MustCompile(`^PO-\d{6}-\d{4}$`).MatchString(po["nomor_po"].(string)) {
		t.Fatalf("nomor_po = %v", po["nomor_po"])
	}
	// 4 × 2500 = 10000, 10% discount, PPN 0% stays 0.
	if po["subtotal"] != "10000.00" || po["diskon_nominal"] != "1000.00" || po["ppn_nominal"] != "0.00" || po["total"] != "9000.00" ||
		po["vendor_id"] != f.Vendor || po["supplier_id"] != nil || po["module_type"] != "general" || po["source_type"] != "manual" {
		t.Fatalf("po = %v", po)
	}
	poID := po["id"].(string)

	// Default PPN is 11%.
	po2 := e.generalPo(&staff, f, supply, nil)
	if po2["ppn_persen"] != "11.00" || po2["ppn_nominal"] != "1100.00" || po2["total"] != "11100.00" {
		t.Fatalf("po2 = %v", po2)
	}

	// Edit the draft: PPN 0 recomputes the totals from the lines.
	r := e.do(&staff, "PUT", "/api/purchasing/po/"+po2["id"].(string), map[string]any{"ppn_persen": 0, "catatan": "ganti"})
	e.expect(r, 200, "")
	if r.Body["message"] != "PO berhasil diupdate" || r.data()["total"] != "10000.00" || r.data()["ppn_nominal"] != "0.00" || r.data()["catatan"] != "ganti" {
		t.Fatalf("update = %s", r.Raw)
	}
	e.expect(e.do(&staff, "PUT", "/api/purchasing/po/"+poID, map[string]any{"ppn_persen": 120}), 400, "Validation failed")

	// List and detail.
	r = e.do(&staff, "GET", "/api/purchasing/po?module_type=general&search="+po["nomor_po"].(string), nil)
	e.expect(r, 200, "")
	if r.Body["success"] != true || len(r.list()) != 1 || r.Body["pagination"].(map[string]any)["total_pages"] != float64(1) {
		t.Fatalf("list = %s", r.Raw)
	}
	row := r.list()[0].(map[string]any)
	if _, ok := row["pr_number"]; !ok || row["active_delivery_id"] != nil || row["vendor_name"] == nil {
		t.Fatalf("row = %v", row)
	}
	r = e.do(&staff, "GET", "/api/purchasing/po/"+poID, nil)
	e.expect(r, 200, "")
	d := r.data()
	// Unreceived quantity counts as a reject credit (computePoShortageAmount),
	// so a PO with nothing received owes nothing yet.
	if d["gross_payable_amount"] != float64(9000) || d["reject_credit_amount"] != float64(10000) || d["payable_amount"] != float64(0) ||
		d["payment_status"] != "paid" || d["payment_progress_pct"] != float64(100) || d["fulfillment_progress_pct"] != float64(0) {
		t.Fatalf("detail = %v", d)
	}
	item := d["items"].([]any)[0].(map[string]any)
	if item["supply_item"].(map[string]any)["id"] != supply || item["raw_material"] != nil {
		t.Fatalf("detail item = %v", item)
	}
	e.expect(e.do(&staff, "GET", "/api/purchasing/po/11111111-1111-4111-8111-111111111111", nil), 404, "PO tidak ditemukan")
	e.expect(e.do(&staff, "GET", "/api/purchasing/po/nope", nil), 400, "Format data tidak valid")

	// Items endpoints.
	r = e.do(&staff, "GET", "/api/purchasing/po/"+poID+"/items", nil)
	e.expect(r, 200, "")
	if it := r.list()[0].(map[string]any); it["pos_sku"] != nil || it["satuan"] != nil {
		t.Fatalf("items = %s", r.Raw)
	} else if _, ok := it["pos_sku"]; !ok {
		t.Fatalf("pos_sku missing: %s", r.Raw)
	}
	r = e.do(&staff, "GET", "/api/purchasing/po-items?po_id="+poID, nil)
	e.expect(r, 200, "")
	if r.Body["message"] != "PO items retrieved" {
		t.Fatalf("po-items = %s", r.Raw)
	}
	if _, ok := r.list()[0].(map[string]any)["pos_sku"]; ok {
		t.Fatal("po-items must not embed pos_sku")
	}
	e.expect(e.do(&staff, "GET", "/api/purchasing/po-items", nil), 400, "po_id parameter required")
	itemID := item["id"].(string)
	e.expect(e.do(&staff, "PUT", "/api/purchasing/po/items/"+itemID, map[string]any{"qty_ordered": 0}), 400, "Validation failed")
	e.expect(e.do(&staff, "PUT", "/api/purchasing/po/items/"+itemID, map[string]any{"qty_ordered": 2}), 404, "Item tidak ditemukan")
	e.expect(e.do(&staff, "DELETE", "/api/purchasing/po/items/"+itemID, nil), 404, "Item tidak ditemukan")

	r = e.do(&staff, "POST", "/api/purchasing/po/"+poID+"/items", map[string]any{"raw_material_id": f.Material, "qty_ordered": 1, "harga_satuan": 10})
	e.expect(r, 201, "")
	if r.data()["diskon_item"] != "0.00" || r.data()["subtotal"] != "10.00" {
		t.Fatalf("add item = %s", r.Raw)
	}
	e.expect(e.do(&staff, "POST", "/api/purchasing/po/"+poID+"/items", map[string]any{"raw_material_id": f.Material, "qty_ordered": 1, "harga_satuan": 10}),
		400, "Bahan ini sudah ada di PO. Silakan update item yang ada.")

	// Gone endpoints.
	r = e.do(&staff, "POST", "/api/purchasing/po/"+poID+"/payments", map[string]any{})
	e.expect(r, 410, "")
	if r.Body["redirect"] != "/dashboard/accounting/accounts-payable/payments" {
		t.Fatalf("payments = %s", r.Raw)
	}
	r = e.do(&staff, "POST", "/api/purchasing/po/"+poID+"/receive", nil)
	e.expect(r, 410, "Penerimaan PO langsung sudah dinonaktifkan. Gunakan flow Delivery/GRN untuk menerima barang.")
	if r.Body["next_step"] != "/dashboard/purchasing/grn/insert?po_id="+poID {
		t.Fatalf("receive = %s", r.Raw)
	}
}

func TestPurchaseOrderLifecycle(t *testing.T) {
	e := newEnv(t)
	f := e.fixtures()
	staff := e.staff(itemsAll)
	noApproval := e.staff(map[string][]string{"items": {"read"}})
	supply := e.supplyItem()
	po := e.generalPo(&staff, f, supply, nil)
	poID := po["id"].(string)

	e.expect(e.do(&noApproval, "POST", "/api/purchasing/po/"+poID+"/approve", nil), 403, "Insufficient permissions")
	e.expect(e.do(&staff, "POST", "/api/purchasing/po/"+poID+"/send", map[string]any{"sent_via": "EMAIL"}), 400, "PO harus diapprove terlebih dahulu sebelum dikirim")
	r := e.do(&staff, "POST", "/api/purchasing/po/"+poID+"/approve", nil)
	e.expect(r, 200, "")
	if r.Body["message"] != "PO berhasil diapprove" || r.data()["status"] != "approved" || r.data()["approved_at"] == nil {
		t.Fatalf("approve = %s", r.Raw)
	}
	if e.scalar(`SELECT count(*)::int FROM audit.audit_log WHERE entity_id = $1 AND action = 'po.approve' AND after->>'status' = 'approved'`, poID) != int32(1) {
		t.Fatal("approve audit missing")
	}
	e.expect(e.do(&staff, "PUT", "/api/purchasing/po/"+poID, map[string]any{"catatan": "x"}), 400, "PO hanya bisa diedit saat status draft")
	e.expect(e.do(&staff, "POST", "/api/purchasing/po/"+poID+"/send", map[string]any{"sent_via": "FAX"}), 400, "Validation failed")
	r = e.do(&staff, "POST", "/api/purchasing/po/"+poID+"/send", map[string]any{"sent_via": "WHATSAPP"})
	e.expect(r, 200, "")
	if r.Body["message"] != "PO berhasil dikirim ke supplier via WHATSAPP" || r.data()["status"] != "sent" {
		t.Fatalf("send = %s", r.Raw)
	}
	e.expect(e.do(&staff, "POST", "/api/purchasing/po/"+poID+"/close", map[string]any{"reason": "  "}), 400, "Alasan penutupan wajib diisi")
	e.expect(e.do(&staff, "POST", "/api/purchasing/po/"+poID+"/close", map[string]any{"reason": "vendor tutup"}), 400,
		"Invalid state transition: sent → closed. Allowed: partially_received, received, cancelled")

	e.expect(e.do(&staff, "POST", "/api/purchasing/po/"+poID+"/cancel", map[string]any{}), 400, "Validation failed")
	r = e.do(&staff, "POST", "/api/purchasing/po/"+poID+"/cancel", map[string]any{"reason": "salah vendor"})
	e.expect(r, 200, "")
	if r.data()["status"] != "cancelled" || r.data()["cancellation_reason"] != "salah vendor" || r.data()["is_active"] != false {
		t.Fatalf("cancel = %s", r.Raw)
	}
	if e.scalar(`SELECT reason FROM audit.audit_log WHERE entity_id = $1 AND action = 'po.cancel'`, poID) != "salah vendor" {
		t.Fatal("cancel audit missing")
	}
	e.expect(e.do(&staff, "POST", "/api/purchasing/po/"+poID+"/cancel", map[string]any{"reason": "lagi"}), 400, "PO sudah dibatalkan sebelumnya")

	// DELETE voids a draft.
	draft := e.generalPo(&staff, f, supply, nil)
	r = e.do(&staff, "DELETE", "/api/purchasing/po/"+draft["id"].(string), nil)
	e.expect(r, 200, "")
	if r.Body["message"] != "PO berhasil dibatalkan" {
		t.Fatalf("void = %s", r.Raw)
	}
	e.expect(e.do(&staff, "DELETE", "/api/purchasing/po/11111111-1111-4111-8111-111111111111", nil), 404, "PO tidak ditemukan")
}

func TestSentRawMaterialPoPublishesOnOrder(t *testing.T) {
	e := newEnv(t)
	f := e.fixtures()
	staff := e.staff(itemsAll)
	bus := outbox.NewBus(nil, nil)
	var got []map[string]any
	bus.Subscribe("procurement.purchase_order.on_order_changed", "procurement-test.on-order", func(_ context.Context, _ pgx.Tx, ev outbox.Event) error {
		var p map[string]any
		_ = ev.Decode(&p)
		got = append(got, p)
		return nil
	})
	if err := bus.Register(e.ctx, e.tx); err != nil {
		t.Fatal(err)
	}
	poID := e.id(`INSERT INTO purchasing.purchase_orders (nomor_po, supplier_id, status) VALUES ('GT-PO-'||$1, $2, 'approved') RETURNING id::text`, suffix(), f.Supplier)
	e.exec(`INSERT INTO purchasing.purchase_order_items (purchase_order_id, raw_material_id, qty_ordered, satuan_id, harga_satuan) VALUES ($1, $2, 5, $3, 100)`, poID, f.Material, f.BigUnit)
	e.expect(e.do(&staff, "POST", "/api/purchasing/po/"+poID+"/send", map[string]any{"sent_via": "EMAIL"}), 200, "")
	e.expect(e.do(&staff, "DELETE", "/api/purchasing/po/"+poID, nil), 200, "")
	if _, err := bus.Dispatch(e.ctx, e.tx); err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[0]["direction"] != float64(1) || got[1]["direction"] != float64(-1) {
		t.Fatalf("events = %v", got)
	}
	line := got[0]["lines"].([]any)[0].(map[string]any)
	if line["raw_material_id"] != f.Material || line["open_qty"] != float64(5) || line["satuan_id"] != f.BigUnit {
		t.Fatalf("line = %v", line)
	}
}

func TestPurchaseOrderPaymentTerms(t *testing.T) {
	e := newEnv(t)
	f := e.fixtures()
	staff := e.staff(itemsAll)
	po := e.generalPo(&staff, f, e.supplyItem(), map[string]any{"ppn_persen": 0})
	poID := po["id"].(string)
	base := "/api/purchasing/po/" + poID + "/payment-terms"
	e.expect(e.do(&staff, "POST", base, map[string]any{"due_date": "2026-11-01", "amount": 1}), 400,
		"Payment term amount cannot exceed remaining schedulable amount (0)")
	e.exec(`UPDATE purchasing.purchase_order_items SET qty_received = qty_ordered WHERE purchase_order_id = $1`, poID)

	e.expect(e.do(&staff, "POST", base, map[string]any{"due_date": "2026-11-01", "amount": 20000}), 400,
		"Payment term amount cannot exceed remaining schedulable amount (10000)")
	r := e.do(&staff, "POST", base, map[string]any{"due_date": "2026-11-01", "amount": 4000})
	e.expect(r, 201, "")
	if r.Body["message"] != "Payment term added successfully" || r.data()["term_no"] != float64(1) || r.data()["description"] != "Termin" ||
		r.data()["vendor_id"] != f.Vendor || r.data()["status"] != "unpaid" {
		t.Fatalf("term = %s", r.Raw)
	}
	termID := r.data()["id"].(string)
	// The full payable on term 1 reads "Paid in Full" (normalizeTermDescription).
	r = e.do(&staff, "POST", base, map[string]any{"due_date": "2026-12-01", "amount": 6000, "description": "  "})
	e.expect(r, 201, "")
	if r.data()["term_no"] != float64(2) || r.data()["description"] != "Installment 2" {
		t.Fatalf("term 2 = %s", r.Raw)
	}
	r = e.do(&staff, "GET", base, nil)
	e.expect(r, 200, "")
	if terms := r.data()["terms"].([]any); len(terms) != 2 || r.data()["payments"] == nil {
		t.Fatalf("terms = %s", r.Raw)
	}
	r = e.do(&staff, "DELETE", base+"/"+termID, nil)
	e.expect(r, 200, "")
	if r.Body["message"] != "Termin pembayaran berhasil dihapus" {
		t.Fatalf("cancel term = %s", r.Raw)
	}
	e.expect(e.do(&staff, "DELETE", base+"/"+termID, nil), 400, "Termin pembayaran sudah tidak aktif")
	e.expect(e.do(&staff, "DELETE", base+"/11111111-1111-4111-8111-111111111111", nil), 404, "Termin pembayaran tidak ditemukan")
	e.expect(e.do(&staff, "POST", "/api/purchasing/po/11111111-1111-4111-8111-111111111111/payment-terms", map[string]any{"due_date": "2026-11-01", "amount": 1}),
		404, "Purchase order not found")
}

func TestPurchaseOrderFormData(t *testing.T) {
	e := newEnv(t)
	f := e.fixtures()
	staff := e.staff(itemsAll)
	r := e.do(&staff, "GET", "/api/purchasing/po/form-data", nil)
	e.expect(r, 200, "")
	if r.Body["success"] != true || r.data()["suppliers"] == nil || r.data()["materials"] == nil {
		t.Fatalf("form-data = %s", r.Raw)
	}
	found := false
	for _, s := range r.data()["suppliers"].([]any) {
		found = found || s.(map[string]any)["id"] == f.Supplier
	}
	if !found {
		t.Fatal("supplier missing")
	}
	r = e.do(&staff, "GET", "/api/purchasing/po/form-data?module_type=product", nil)
	e.expect(r, 200, "")
	if _, ok := r.data()["vendors"]; !ok {
		t.Fatalf("product form-data = %s", r.Raw)
	}
}

func TestResolvePaymentTerm(t *testing.T) {
	e := newEnv(t)
	f := e.fixtures()
	staff := e.staff(itemsAll)
	po := e.generalPo(&staff, f, e.supplyItem(), map[string]any{"ppn_persen": 0})
	poID := po["id"].(string)
	e.exec(`UPDATE purchasing.purchase_order_items SET qty_received = qty_ordered WHERE purchase_order_id = $1`, poID)
	deps := testutil.Deps(t, nil)
	svc := procurement.NewService(e.tx, app.ProcurementPorts(procurement.Location(""), deps.Now), nil, nil, nil)
	if _, err := svc.ResolvePaymentTerm(e.ctx, e.tx, poID, 20000, "2026-11-01"); err == nil || err.Error() != "Payment amount cannot exceed outstanding balance (10000)" {
		t.Fatalf("over outstanding: %v", err)
	}
	term, err := svc.ResolvePaymentTerm(e.ctx, e.tx, poID, 4000, "2026-11-01")
	if err != nil || term.VendorID == nil || *term.VendorID != f.Vendor || term.Outstanding != 10000 {
		t.Fatalf("term = %+v %v", term, err)
	}
	if e.scalar(`SELECT description||'|'||amount::text FROM purchasing.purchase_order_payment_terms WHERE id = $1`, term.TermID) != "Installment 1|4000.00" {
		t.Fatal("new term")
	}
	again, err := svc.ResolvePaymentTerm(e.ctx, e.tx, poID, 3000, "2026-11-01")
	if err != nil || again.TermID != term.TermID {
		t.Fatalf("reuse = %+v %v", again, err)
	}
	if missing, err := svc.ResolvePaymentTerm(e.ctx, e.tx, "11111111-1111-4111-8111-111111111111", 1, "2026-11-01"); err != nil || missing != nil {
		t.Fatalf("missing = %+v %v", missing, err)
	}
}
