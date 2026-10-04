package procurement_test

import (
	"context"
	"regexp"
	"testing"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/platform/outbox"
	"nuhabit/backend/internal/platform/testutil"
)

func prBody(f fixtures, extra map[string]any) map[string]any {
	body := map[string]any{
		"department_id": f.Department,
		"priority":      "medium",
		"required_date": "2026-11-01",
		"notes":         "stok habis",
		"items": []any{map[string]any{
			"raw_material_id": f.Material, "satuan_id": f.BigUnit, "description": "Gula pasir",
			"qty": "2", "unit": "kg", "estimated_price": "15.000",
		}},
	}
	for k, v := range extra {
		body[k] = v
	}
	return body
}

func TestPurchaseRequestGuards(t *testing.T) {
	e := newEnv(t)
	none := e.staff(map[string][]string{"crm": {"read"}})
	readOnly := e.staff(map[string][]string{"items": {"read"}})
	id := "00000000-0000-0000-0000-000000000001"
	for _, c := range []struct {
		staff        *testutil.Staff
		method, path string
	}{
		{&none, "GET", "/api/purchasing/pr"},
		{&none, "GET", "/api/purchasing/pr/for-po"},
		{&none, "GET", "/api/purchasing/pr/" + id},
		{&none, "PUT", "/api/purchasing/pr/" + id},
		{&none, "POST", "/api/purchasing/pr/" + id + "/submit"},
		{&none, "POST", "/api/purchasing/pr/" + id + "/revise"},
		{&none, "POST", "/api/purchasing/pr/" + id + "/convert-to-po"},
		{&readOnly, "POST", "/api/purchasing/pr"},
		{&readOnly, "GET", "/api/purchasing/pr/form-data"},
		{&readOnly, "POST", "/api/purchasing/pr/" + id + "/approve"},
	} {
		r := e.do(c.staff, c.method, c.path, map[string]any{})
		if r.Status != 403 || r.Body["error"] != "Insufficient permissions" {
			t.Fatalf("%s %s: %d %s", c.method, c.path, r.Status, r.Raw)
		}
	}
	e.expect(e.do(nil, "GET", "/api/purchasing/pr", nil), 401, "Authentication required")
}

func TestPurchaseRequestLifecycle(t *testing.T) {
	e := newEnv(t)
	f := e.fixtures()
	staff := e.staff(itemsAll)

	// Validation: first issue message plus the issue list.
	r := e.do(&staff, "POST", "/api/purchasing/pr", map[string]any{"department_id": "11111111-1111-4111-8111-111111111111", "priority": "low", "items": []any{}})
	e.expect(r, 400, "Minimal 1 item")
	if _, ok := r.Body["details"].([]any); !ok {
		t.Fatalf("details missing: %s", r.Raw)
	}
	e.expect(e.do(&staff, "POST", "/api/purchasing/pr", map[string]any{"priority": "now", "items": []any{}}), 400, "Invalid input: expected string, received undefined")
	e.expect(e.do(&staff, "POST", "/api/purchasing/pr", "{"), 500, "Terjadi kesalahan server")

	// Unknown raw material: the FK message is mapped.
	bad := prBody(f, nil)
	bad["items"] = []any{map[string]any{"raw_material_id": "11111111-1111-4111-8111-111111111111", "description": "x", "qty": 1, "unit": "kg", "estimated_price": 1}}
	e.expect(e.do(&staff, "POST", "/api/purchasing/pr", bad), 400, "Bahan baku pada item PR tidak valid.")

	// Create a draft: locale numbers parsed, totals computed, PR-YYYYMMDD-NNNN.
	r = e.do(&staff, "POST", "/api/purchasing/pr", prBody(f, nil))
	e.expect(r, 201, "")
	pr := r.data()
	if !regexp.MustCompile(`^PR-` + today() + `-\d{4}$`).MatchString(pr["pr_number"].(string)) {
		t.Fatalf("pr_number = %v", pr["pr_number"])
	}
	if pr["status"] != "draft" || pr["total_amount"] != "30000.00" || pr["current_approval_level"] != nil || pr["requester_id"] != staff.UserID {
		t.Fatalf("pr = %v", pr)
	}
	if pr["required_date"] == nil || r.Body["success"] != nil {
		t.Fatalf("body = %s", r.Raw)
	}
	prID := pr["id"].(string)
	if n := e.scalar(`SELECT count(*)::int FROM purchasing.pr_items WHERE pr_id = $1 AND qty = 2 AND estimated_price = 15000 AND total = 30000`, prID); n != int32(1) {
		t.Fatalf("pr_items = %v", n)
	}

	// List: no success wrapper, requester and department names, camelCase totalPages.
	r = e.do(&staff, "GET", "/api/purchasing/pr?search="+pr["pr_number"].(string)+"&limit=5", nil)
	e.expect(r, 200, "")
	if len(r.list()) != 1 {
		t.Fatalf("list = %s", r.Raw)
	}
	row := r.list()[0].(map[string]any)
	if row["requester_name"] != staff.FullName || row["department_name"] == nil || len(row["items"].([]any)) != 1 {
		t.Fatalf("row = %v", row)
	}
	page := r.Body["pagination"].(map[string]any)
	if page["page"] != float64(1) || page["limit"] != float64(5) || page["total"] != float64(1) || page["totalPages"] != float64(1) {
		t.Fatalf("pagination = %v", page)
	}
	e.expect(e.do(&staff, "GET", "/api/purchasing/pr?page=abc", nil), 400, "Format data tidak valid")

	// Detail: refs, names and permissions.
	r = e.do(&staff, "GET", "/api/purchasing/pr/"+prID, nil)
	e.expect(r, 200, "")
	detail := r.data()
	item := detail["items"].([]any)[0].(map[string]any)
	if item["raw_material"].(map[string]any)["id"] != f.Material || item["satuan"].(map[string]any)["id"] != f.BigUnit || item["product"] != nil {
		t.Fatalf("item = %v", item)
	}
	perms := detail["permissions"].(map[string]any)
	if perms["canEdit"] != true || perms["canApprove"] != false || perms["canCreatePO"] != false {
		t.Fatalf("permissions = %v", perms)
	}
	if detail["requester_name"] != staff.FullName || detail["department"].(map[string]any)["code"] == nil {
		t.Fatalf("detail = %v", detail)
	}
	if _, present := detail["approved_head_name"]; !present || detail["approved_head_name"] != nil {
		t.Fatalf("approved_head_name = %v", detail["approved_head_name"])
	}
	e.expect(e.do(&staff, "GET", "/api/purchasing/pr/not-a-uuid", nil), 404, "PR tidak ditemukan")

	// Another staff member cannot edit or submit it.
	other := e.staff(itemsAll)
	e.expect(e.do(&other, "PUT", "/api/purchasing/pr/"+prID, prBody(f, nil)), 403, "Anda tidak memiliki akses mengubah PR ini")
	e.expect(e.do(&other, "POST", "/api/purchasing/pr/"+prID+"/submit", nil), 403, "Anda tidak memiliki akses")

	// Edit and submit in one go.
	r = e.do(&staff, "PUT", "/api/purchasing/pr/"+prID, prBody(f, map[string]any{"action": "submit"}))
	e.expect(r, 200, "")
	if r.data()["id"] != prID || r.data()["status"] != "pending_head" {
		t.Fatalf("update = %s", r.Raw)
	}
	e.expect(e.do(&staff, "PUT", "/api/purchasing/pr/"+prID, prBody(f, nil)), 400, "Hanya PR draft yang bisa diedit")
	e.expect(e.do(&staff, "POST", "/api/purchasing/pr/"+prID+"/submit", nil), 400, "Hanya PR dengan status draft yang bisa disubmit")

	// Approve fills the scope from the requester.
	approver := e.staff(itemsAll)
	e.expect(e.do(&approver, "POST", "/api/purchasing/pr/"+prID+"/approve", map[string]any{"action": "maybe"}), 400, "Validation failed")
	r = e.do(&approver, "POST", "/api/purchasing/pr/"+prID+"/approve", map[string]any{"action": "approve"})
	e.expect(r, 200, "")
	if r.data()["status"] != "approved" || r.data()["approved_by_head"] != approver.UserID || r.data()["approved_at_head"] == nil {
		t.Fatalf("approve = %s", r.Raw)
	}
	e.expect(e.do(&approver, "POST", "/api/purchasing/pr/"+prID+"/approve", map[string]any{"action": "reject"}), 400, "PR sudah final")

	// Approved PRs show in for-po until converted.
	r = e.do(&staff, "GET", "/api/purchasing/pr/for-po", nil)
	e.expect(r, 200, "")
	found := false
	for _, it := range r.list() {
		if it.(map[string]any)["id"] == prID {
			found = true
			if it.(map[string]any)["requester_name"] != staff.FullName {
				t.Fatalf("for-po row = %v", it)
			}
		}
	}
	if !found {
		t.Fatalf("approved PR missing from for-po")
	}

	// Convert to PO: priced from the master purchase price (15000 per kg).
	e.expect(e.do(&staff, "POST", "/api/purchasing/pr/"+prID+"/convert-to-po", map[string]any{}), 400, "Validation failed")
	r = e.do(&staff, "POST", "/api/purchasing/pr/"+prID+"/convert-to-po", map[string]any{"supplier_id": f.Supplier, "ppn_persen": 0})
	e.expect(r, 201, "")
	po := r.data()
	if r.Body["message"] != "PR berhasil dikonversi menjadi PO" || po["status"] != "draft" || po["pr_id"] != prID {
		t.Fatalf("convert = %s", r.Raw)
	}
	if po["subtotal"] != "30000.00" || po["ppn_nominal"] != "0.00" || po["total"] != "30000.00" || po["nama_supplier"] == nil {
		t.Fatalf("po totals = %v", po)
	}
	if !regexp.MustCompile(`^PO-` + today() + `-\d{4}$`).MatchString(po["nomor_po"].(string)) {
		t.Fatalf("nomor_po = %v", po["nomor_po"])
	}
	if e.scalar(`SELECT status FROM purchasing.purchase_requests WHERE id = $1`, prID) != "converted" {
		t.Fatal("PR not converted")
	}
	e.expect(e.do(&staff, "POST", "/api/purchasing/pr/"+prID+"/convert-to-po", map[string]any{"supplier_id": f.Supplier}), 400, "PR harus approved sebelum dibuatkan PO")
}

func TestPurchaseRequestRejectAndRevise(t *testing.T) {
	e := newEnv(t)
	f := e.fixtures()
	staff := e.staff(itemsAll)
	r := e.do(&staff, "POST", "/api/purchasing/pr", prBody(f, map[string]any{"action": "submit"}))
	e.expect(r, 201, "")
	prID := r.data()["id"].(string)
	if r.data()["current_approval_level"] != "head_dept" {
		t.Fatalf("pr = %s", r.Raw)
	}
	e.expect(e.do(&staff, "POST", "/api/purchasing/pr/"+prID+"/revise", nil), 400, "Hanya PR rejected yang bisa direvisi")
	r = e.do(&staff, "POST", "/api/purchasing/pr/"+prID+"/approve", map[string]any{"action": "reject", "reason": "mahal"})
	e.expect(r, 200, "")
	if r.data()["status"] != "rejected" || r.data()["rejection_reason"] != "mahal" || r.data()["rejected_by"] != staff.UserID {
		t.Fatalf("reject = %s", r.Raw)
	}
	r = e.do(&staff, "POST", "/api/purchasing/pr/"+prID+"/revise", nil)
	e.expect(r, 201, "")
	newID := r.data()["id"].(string)
	if newID == prID || len(r.data()) != 1 {
		t.Fatalf("revise = %s", r.Raw)
	}
	if e.scalar(`SELECT status FROM purchasing.purchase_requests WHERE id = $1`, newID) != "draft" ||
		e.scalar(`SELECT count(*)::int FROM purchasing.pr_items WHERE pr_id = $1`, newID) != int32(1) {
		t.Fatal("revision not copied")
	}
}

func TestUrgentPurchaseRequestPublishesAlert(t *testing.T) {
	e := newEnv(t)
	f := e.fixtures()
	staff := e.staff(itemsAll)
	bus := outbox.NewBus(nil, nil)
	var got []outbox.Event
	bus.Subscribe("procurement.purchase_request.urgent", "procurement-test.urgent", func(_ context.Context, _ pgx.Tx, ev outbox.Event) error {
		got = append(got, ev)
		return nil
	})
	if err := bus.Register(e.ctx, e.tx); err != nil {
		t.Fatal(err)
	}
	r := e.do(&staff, "POST", "/api/purchasing/pr", prBody(f, map[string]any{"priority": "urgent", "action": "submit"}))
	e.expect(r, 201, "")
	if _, err := bus.Dispatch(e.ctx, e.tx); err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 {
		t.Fatalf("events = %d", len(got))
	}
	var payload map[string]any
	_ = got[0].Decode(&payload)
	if payload["dedup_key"] != r.data()["id"].(string)+":pending_head" || payload["total_amount"] != float64(30000) || payload["requester_name"] != staff.FullName {
		t.Fatalf("payload = %v", payload)
	}
}

func TestPurchaseRequestFormData(t *testing.T) {
	e := newEnv(t)
	f := e.fixtures()
	staff := e.staff(itemsAll)
	r := e.do(&staff, "GET", "/api/purchasing/pr/form-data", nil)
	e.expect(r, 200, "")
	data := r.data()
	if _, ok := data["materials"]; !ok || data["departments"] == nil || data["units"] == nil {
		t.Fatalf("form-data = %v", data)
	}
	found := false
	for _, m := range data["materials"].([]any) {
		if m.(map[string]any)["id"] == f.Material {
			found = true
			if _, ok := m.(map[string]any)["unit_conversions"].([]any); !ok {
				t.Fatalf("material = %v", m)
			}
		}
	}
	if !found {
		t.Fatal("material missing")
	}
	r = e.do(&staff, "GET", "/api/purchasing/pr/form-data?module_type=general", nil)
	e.expect(r, 200, "")
	if _, ok := r.data()["supplies"]; !ok {
		t.Fatalf("general form-data = %s", r.Raw)
	}
}
