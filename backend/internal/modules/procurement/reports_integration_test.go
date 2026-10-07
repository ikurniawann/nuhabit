package procurement_test

import (
	"strings"
	"testing"
)

func TestPurchasingReports(t *testing.T) {
	e := newEnv(t)
	f := e.fixtures()
	staff := e.staff(itemsAll)
	poID := e.id(`INSERT INTO purchasing.purchase_orders (nomor_po, supplier_id, status, total, tanggal_po, tanggal_dibutuhkan)
		VALUES ('GT-RPT-'||$1, $2, 'received', 1234567, '2026-01-10', '2026-01-15') RETURNING id::text`, suffix(), f.Supplier)
	e.exec(`INSERT INTO purchasing.purchase_order_items (purchase_order_id, raw_material_id, qty_ordered, qty_received, harga_satuan, satuan_id)
		VALUES ($1, $2, 2, 2, 617283.5, $3)`, poID, f.Material, f.BigUnit)
	e.exec(`INSERT INTO purchasing.deliveries (purchase_order_id, supplier_id, status, tanggal_aktual_tiba, tanggal_estimasi_tiba)
		VALUES ($1, $2, 'delivered', '2026-01-14', '2026-01-13')`, poID, f.Supplier)
	q := "?vendor_id=" + f.Supplier + "&date_from=2026-01-01&date_to=2026-01-31"

	e.expect(e.do(&staff, "GET", "/api/purchasing/reports/po-summary?export=pdf", nil), 400, "Invalid query params")
	r := e.do(&staff, "GET", "/api/purchasing/reports/po-summary"+q, nil)
	e.expect(r, 200, "")
	row := r.data()["summary"].([]any)[0].(map[string]any)
	if row["total_amount"] != float64(1234567) || row["total_amount_formatted"] != "1.234.567" || row["status"] != "received" || row["item_count"] != float64(1) || row["tanggal_diterima"] != nil {
		t.Fatalf("po-summary = %s", r.Raw)
	}
	r = e.do(&staff, "GET", "/api/purchasing/reports/po-summary"+q+"&export=csv", nil)
	if r.Status != 200 || !strings.HasPrefix(r.Raw, "PO Number,Vendor,") || !strings.Contains(r.Raw, "Sat Jan 10 2026 00:00:00 GMT+0700 (Western Indonesia Time)") {
		t.Fatalf("po-summary csv = %d %s", r.Status, r.Raw)
	}
	r = e.do(&staff, "GET", "/api/purchasing/reports/po-detail"+q, nil)
	e.expect(r, 200, "")
	d := r.data()["summary"].([]any)[0].(map[string]any)
	item := d["items"].([]any)[0].(map[string]any)
	if d["item_count"] != float64(1) || item["harga_satuan"] != 617283.5 || item["satuan"] == "" || r.data()["grand_total_formatted"] != "1.234.567" {
		t.Fatalf("po-detail = %s", r.Raw)
	}
	r = e.do(&staff, "GET", "/api/purchasing/reports/po-detail"+q+"&export=csv", nil)
	if r.Status != 200 || !strings.HasPrefix(r.Raw, `"No PO","Tanggal"`) {
		t.Fatalf("po-detail csv = %s", r.Raw)
	}
	r = e.do(&staff, "GET", "/api/purchasing/reports/po-detail?vendor_id=11111111-1111-4111-8111-111111111111&export=csv", nil)
	e.expect(r, 200, "")
	if r.data()["grand_total_formatted"] != "0" {
		t.Fatalf("empty po-detail = %s", r.Raw)
	}

	r = e.do(&staff, "GET", "/api/purchasing/reports/supplier-performance?supplier_id="+f.Supplier, nil)
	e.expect(r, 200, "")
	s := r.data()["suppliers"].([]any)[0].(map[string]any)
	// Arrived a day after the delivery estimate: late; lead time 4 days.
	if s["late_count"] != float64(1) || s["on_time_rate"] != float64(0) || s["avg_lead_time_days"] != float64(4) || s["rank"] != float64(1) ||
		s["quality_score"] != float64(100) || s["rating"] != float64(2.5) {
		t.Fatalf("supplier performance = %s", r.Raw)
	}
	r = e.do(&staff, "GET", "/api/purchasing/reports/supplier-performance?supplier_id=11111111-1111-4111-8111-111111111111&date_from=2026-01-01", nil)
	e.expect(r, 200, "")
	if sum := r.data()["summary"].(map[string]any); sum["total_suppliers"] != float64(0) || sum["period"].(map[string]any)["from"] != "2026-01-01" {
		t.Fatalf("empty supplier performance = %s", r.Raw)
	}
	r = e.do(&staff, "GET", "/api/purchasing/reports/supplier-performance?supplier_id="+f.Supplier+"&export=csv", nil)
	if r.Status != 200 || !strings.Contains(r.Raw, "\n1,") {
		t.Fatalf("supplier csv = %s", r.Raw)
	}
}

func TestProductionInHouseReport(t *testing.T) {
	e := newEnv(t)
	staff := e.staff(itemsAll)
	_, _, wh := e.warehouse()
	r := e.do(&staff, "GET", "/api/purchasing/reports/production-in-house?date_from=2099-01-01", nil)
	e.expect(r, 200, "")
	if r.data()["summary"].(map[string]any)["total_orders"] != float64(0) {
		t.Fatalf("report = %s", r.Raw)
	}
	r = e.do(&staff, "GET", "/api/purchasing/reports/production-in-house?export=csv&warehouse_id="+wh, nil)
	e.expect(r, 200, "")
	if r.Body["success"] != true || len(r.data()["orders"].([]any)) != 0 {
		t.Fatalf("empty warehouse = %s", r.Raw)
	}
	r = e.do(&staff, "GET", "/api/purchasing/reports/production-in-house?export=csv&date_from=2099-01-01", nil)
	if r.Status != 200 || !strings.HasPrefix(r.Raw, `"No Produksi"`) {
		t.Fatalf("csv = %s", r.Raw)
	}
	e.expect(e.do(&staff, "GET", "/api/purchasing/reports/production-in-house?output_type=X", nil), 400, "Invalid query params")
}
