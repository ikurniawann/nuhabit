package procurement_test

import (
	"math"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestPurchasingDashboard(t *testing.T) {
	e := newEnv(t)
	f := e.fixtures()
	staff := e.staff(itemsAll)
	po := func(status string, total float64, createdAt, expected, source string) string {
		return e.id(`INSERT INTO purchasing.purchase_orders (nomor_po, supplier_id, status, total, tanggal_po, tanggal_dibutuhkan,
			tanggal_kirim_estimasi, created_at, source_type)
			VALUES ('GT-DSH-'||$1, $2, $3, $4, '1999-11-01', '1999-11-02', NULLIF($5, '')::date, $6, NULLIF($7, '')) RETURNING id::text`,
			suffix(), f.Supplier, status, total, expected, createdAt, source)
	}
	sent := po("sent", 300000, "2000-01-10T03:00:00Z", "1990-01-01", "low_stock")
	po("draft", 100000, "2000-01-20T03:00:00Z", "", "")
	po("draft", 200000, "1999-12-15T03:00:00Z", "", "")

	e.expect(e.do(nil, "GET", "/api/purchasing/dashboard", nil), 401, "Authentication required")
	e.expect(e.do(&staff, "GET", "/api/purchasing/dashboard?start_date=bukan-tanggal", nil), 500, "Terjadi kesalahan server")

	r := e.do(&staff, "GET", "/api/purchasing/dashboard?start_date=2000-01-01&end_date=2000-01-31", nil)
	e.expect(r, 200, "")
	if !strings.HasPrefix(r.Raw, `{"kpis":{"totalPOCount":2,"totalPOCountChange":100,"totalPOValue":400000,"totalPOValueChange":100,"lowStockCount":`) ||
		!strings.Contains(r.Raw, `],"hppTrends":[],"supplierPerformance":[`) {
		t.Fatalf("dashboard = %s", r.Raw)
	}
	kpis := r.Body["kpis"].(map[string]any)
	if kpis["lowStockCount"] != e.scalar(`SELECT count(*)::float8 FROM v_raw_materials_stock WHERE status_stok IN ('MENIPIS', 'HABIS')`) ||
		kpis["pendingApprovalCount"] != e.scalar(`SELECT count(*)::float8 FROM v_purchase_orders WHERE status = 'pending_approval'`) {
		t.Fatalf("kpis = %v", kpis)
	}

	action := r.Body["actionPOs"].([]any)[0].(map[string]any)
	overdue := math.Floor(float64(time.Since(time.Date(1990, 1, 1, 0, 0, 0, 0, time.FixedZone("WIB", 7*3600))).Milliseconds()) / 86400000)
	if action["id"] != sent || action["supplier_name"] == "Unknown" || action["order_date"] != "1999-10-31T17:00:00.000Z" ||
		action["expected_date"] != "1989-12-31T17:00:00.000Z" || action["status"] != "sent" || math.Abs(action["days_overdue"].(float64)-overdue) > 1 {
		t.Fatalf("actionPOs[0] = %v", action)
	}
	// Out of stock is critical, low stock a warning.
	sawMaterial := false
	for _, a := range r.Body["stockAlerts"].([]any) {
		alert := a.(map[string]any)
		qty, _ := strconv.ParseFloat(alert["qty_on_hand"].(string), 64)
		want := "warning"
		if qty <= 0 {
			want = "critical"
		}
		sawMaterial = sawMaterial || alert["id"] == f.Material
		if alert["alert_level"] != want {
			t.Fatalf("stock alert = %v", a)
		}
	}
	if !sawMaterial {
		t.Fatalf("stockAlerts miss the empty material: %v", r.Body["stockAlerts"])
	}
	if !strings.Contains(r.Raw, `"monthlyTrends":[{"month":"Des","manual":200000},{"month":"Jan","low_stock":300000,"manual":100000}`) {
		t.Fatalf("monthlyTrends = %v", r.Body["monthlyTrends"])
	}
	supplier := r.Body["supplierPerformance"].([]any)[0].(map[string]any)
	if supplier["on_time_rate"] != float64(85) || supplier["qc_pass_rate"] != float64(95) || supplier["avg_lead_time_days"] != float64(3) {
		t.Fatalf("supplierPerformance = %v", supplier)
	}
}
