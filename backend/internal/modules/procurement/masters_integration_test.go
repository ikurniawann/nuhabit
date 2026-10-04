package procurement_test

import (
	"regexp"
	"testing"
)

func TestSuppliers(t *testing.T) {
	e := newEnv(t)
	f := e.fixtures()
	staff := e.staff(itemsAll)

	e.expect(e.do(&staff, "GET", "/api/purchasing/suppliers?sort_dir=SIDEWAYS", nil), 400, `Invalid option: expected one of "ASC"|"DESC"`)
	e.expect(e.do(&staff, "POST", "/api/purchasing/suppliers", map[string]any{"nama_supplier": ""}), 400, "Validation failed")
	e.expect(e.do(&staff, "POST", "/api/purchasing/suppliers", map[string]any{"nama_supplier": "CV X", "pic_email": "nope"}), 400, "Validation failed")
	r := e.do(&staff, "POST", "/api/purchasing/suppliers", map[string]any{"nama_supplier": "CV Kopi " + suffix(), "pic_email": "", "kota": "Bandung"})
	e.expect(r, 201, "")
	sup := r.data()
	if !regexp.MustCompile(`^SUP-\d{4}-\d{4}$`).MatchString(sup["kode"].(string)) || sup["payment_terms"] != "TOP30" || sup["currency"] != "IDR" ||
		sup["status"] != "active" || sup["is_active"] != true || r.Body["success"] != nil {
		t.Fatalf("create = %s", r.Raw)
	}
	id := sup["id"].(string)
	e.expect(e.do(&staff, "POST", "/api/purchasing/suppliers", map[string]any{"nama_supplier": "Dup", "kode_supplier": sup["kode"]}), 409, "Kode supplier sudah digunakan")

	r = e.do(&staff, "GET", "/api/purchasing/suppliers?search="+sup["kode"].(string), nil)
	e.expect(r, 200, "")
	if len(r.list()) != 1 || r.Body["pagination"].(map[string]any)["totalPages"] != float64(1) {
		t.Fatalf("list = %s", r.Raw)
	}
	r = e.do(&staff, "GET", "/api/purchasing/suppliers/"+id, nil)
	e.expect(r, 200, "")
	if a := r.data()["analytics"].(map[string]any); a["po_aktif_count"] != float64(0) || a["bahan_sering_dibeli"] == nil {
		t.Fatalf("detail = %s", r.Raw)
	}
	e.expect(e.do(&staff, "PUT", "/api/purchasing/suppliers/"+id, map[string]any{"npwp": "123"}), 400, "Format NPWP tidak valid. Gunakan format: XX.XXX.XXX.X-XXX.XXX")
	r = e.do(&staff, "PUT", "/api/purchasing/suppliers/"+id, map[string]any{"kota": "Jakarta", "npwp": "01.234.567.8-901.234"})
	e.expect(r, 200, "")
	if r.data()["kota"] != "Jakarta" || r.Body["message"] != "Supplier berhasil diperbarui" {
		t.Fatalf("update = %s", r.Raw)
	}
	e.exec(`INSERT INTO purchasing.purchase_orders (nomor_po, supplier_id, status) VALUES ('GT-PO-'||$1, $2, 'draft')`, suffix(), id)
	e.expect(e.do(&staff, "DELETE", "/api/purchasing/suppliers/"+id, nil), 409,
		"Tidak dapat menghapus supplier. Terdapat 1 PO aktif (DRAFT/SENT/PARTIAL) yang masih terkait dengan supplier ini.")
	r = e.do(&staff, "DELETE", "/api/purchasing/suppliers/"+f.Supplier, nil)
	if r.Status != 204 || r.Raw != "" {
		t.Fatalf("delete = %d %s", r.Status, r.Raw)
	}
	e.expect(e.do(&staff, "GET", "/api/purchasing/suppliers/"+f.Supplier, nil), 404, "Supplier tidak ditemukan")

	r = e.do(&staff, "GET", "/api/purchasing/suppliers/"+id+"/price-history", nil)
	e.expect(r, 200, "")
	if r.Body["success"] != true || len(r.list()) != 0 || r.Body["pagination"].(map[string]any)["total_pages"] != float64(0) {
		t.Fatalf("price history = %s", r.Raw)
	}
	e.expect(e.do(&staff, "GET", "/api/purchasing/suppliers/"+id+"/price-history?months=x", nil), 500, "Terjadi kesalahan server")
}

func TestVendorsAndPriceLists(t *testing.T) {
	e := newEnv(t)
	f := e.fixtures()
	staff := e.staff(itemsAll)

	e.expect(e.do(&staff, "POST", "/api/purchasing/vendors", map[string]any{"name": "V"}), 400, "Validation failed")
	r := e.do(&staff, "POST", "/api/purchasing/vendors", map[string]any{"name": "PT Rak " + suffix(), "contact_person": "Ani", "phone": "08",
		"email": "ani@test.local", "address": "Jl", "category": "office"})
	e.expect(r, 201, "")
	v := r.data()
	if !regexp.MustCompile(`^V-\d{4}-\d{4}$`).MatchString(v["code"].(string)) || v["usage_scope"] != "keduanya" || r.Body["message"] != "Vendor created successfully" {
		t.Fatalf("vendor = %s", r.Raw)
	}
	vid := v["id"].(string)
	r = e.do(&staff, "GET", "/api/purchasing/vendors?usage_scope=fnb&search="+v["code"].(string), nil)
	e.expect(r, 200, "")
	if len(r.list()) != 1 || r.Body["pagination"].(map[string]any)["total_pages"] != float64(1) {
		t.Fatalf("vendor list = %s", r.Raw)
	}
	r = e.do(&staff, "GET", "/api/purchasing/vendors?search=zz-nothing-zz", nil)
	if r.Body["pagination"].(map[string]any)["total_pages"] != float64(1) {
		t.Fatalf("empty list keeps one page: %s", r.Raw)
	}
	r = e.do(&staff, "PUT", "/api/purchasing/vendors/"+vid, map[string]any{"notes": "ok"})
	e.expect(r, 200, "")
	if r.data()["notes"] != "ok" || r.Body["message"] != "Vendor updated successfully" {
		t.Fatalf("vendor update = %s", r.Raw)
	}
	e.expect(e.do(&staff, "GET", "/api/purchasing/vendors/11111111-1111-4111-8111-111111111111", nil), 404, "Vendor not found")

	// Price list needs a product with a base unit.
	_, _, wh := e.warehouse()
	product := e.id(`INSERT INTO item.products (kode, nama, satuan_id, warehouse_id) VALUES ('GTP'||$1, 'Kaos '||$1, $2, $3) RETURNING id::text`, suffix(), f.Unit, wh)
	e.expect(e.do(&staff, "POST", "/api/purchasing/vendor-price-list", map[string]any{"vendor_id": vid, "product_id": product, "harga": 5000, "satuan_id": f.BigUnit}),
		400, "Unit must match the product base unit")
	r = e.do(&staff, "POST", "/api/purchasing/vendor-price-list", map[string]any{"vendor_id": vid, "product_id": product, "harga": 5000})
	e.expect(r, 201, "")
	pl := r.data()
	if pl["satuan_id"] != f.Unit || r.Body["message"] != "Price list created successfully" {
		t.Fatalf("price list = %s", r.Raw)
	}
	if _, embedded := pl["vendor"]; embedded {
		t.Fatalf("insert response carries no embeds: %s", r.Raw)
	}
	plID := pl["id"].(string)
	e.expect(e.do(&staff, "POST", "/api/purchasing/vendor-price-list", map[string]any{"vendor_id": vid, "product_id": product, "harga": 1}),
		400, "A price list for this vendor and product already exists")
	r = e.do(&staff, "GET", "/api/purchasing/vendor-price-list?vendor_id="+vid, nil)
	e.expect(r, 200, "")
	if row := r.list()[0].(map[string]any); row["vendor"].(map[string]any)["code"] != v["code"] || row["product"] == nil || row["unit"] == nil {
		t.Fatalf("price lists = %s", r.Raw)
	}
	e.expect(e.do(&staff, "GET", "/api/purchasing/vendor-price-list?search="+v["code"].(string), nil), 400, "Format data tidak valid")
	r = e.do(&staff, "GET", "/api/purchasing/vendor-price-list/"+plID, nil)
	e.expect(r, 200, "")
	if r.data()["vendor"].(map[string]any)["email"] != "ani@test.local" {
		t.Fatalf("price list detail = %s", r.Raw)
	}
	r = e.do(&staff, "PUT", "/api/purchasing/vendor-price-list/"+plID, map[string]any{"harga": 4500, "is_preferred": true})
	e.expect(r, 200, "")
	if r.data()["harga"] != "4500.00" || r.data()["is_preferred"] != true {
		t.Fatalf("price list update = %s", r.Raw)
	}
	if r = e.do(&staff, "DELETE", "/api/purchasing/vendor-price-list/"+plID, nil); r.Status != 204 {
		t.Fatalf("price list delete = %d", r.Status)
	}
	if r = e.do(&staff, "DELETE", "/api/purchasing/vendors/"+vid, nil); r.Status != 204 {
		t.Fatalf("vendor delete = %d", r.Status)
	}
}
