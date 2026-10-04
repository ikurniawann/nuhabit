package catalog_test

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"nuhabit/backend/internal/platform/testutil"
	"nuhabit/backend/internal/platform/xlsx"
)

// The item master spreadsheet routes (/api/purchasing/import/* and
// /api/purchasing/export/*) on real multipart bodies.

// upload posts data as the `file` part (no part when name is "") under a
// savepoint, like kittest.Do.
func (e *env) upload(path, name string, data []byte) (*httptest.ResponseRecorder, map[string]any) {
	e.Helper()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	if name != "" {
		part, err := mw.CreateFormFile("file", name)
		if err != nil {
			e.Fatal(err)
		}
		_, _ = part.Write(data)
	} else {
		_ = mw.WriteField("note", "no file")
	}
	_ = mw.Close()
	r := testutil.AsStaff(httptest.NewRequest("POST", path, &body), e.Staff)
	r.Header.Set("Content-Type", mw.FormDataContentType())
	e.Exec(`SAVEPOINT upload`)
	rec := httptest.NewRecorder()
	e.Mux.ServeHTTP(rec, r)
	if rec.Code >= 400 {
		e.Exec(`ROLLBACK TO SAVEPOINT upload`)
	}
	e.Exec(`RELEASE SAVEPOINT upload`)
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec, out
}

func (e *env) jsonIs(got map[string]any, want string) {
	e.Helper()
	var w map[string]any
	if err := json.Unmarshal([]byte(want), &w); err != nil {
		e.Fatal(err)
	}
	if !reflect.DeepEqual(got, w) {
		b, _ := json.Marshal(got)
		e.Fatalf("got %s\nwant %s", b, want)
	}
}

// companyUnit creates a unit of the org's company with a unique code.
func (e *env) companyUnit(prefix string) string {
	e.Helper()
	code := prefix + strings.ToUpper(testutil.RandomHex(3))
	e.Exec(`INSERT INTO item.units (kode, nama, tipe, company_id) VALUES ($1, $1, 'BESAR', $2)`, code, e.org.CompanyID)
	return code
}

func xlsxFile(t *testing.T, rows [][]any) []byte {
	t.Helper()
	b, err := xlsx.Build(xlsx.SheetSpec{Name: "Sheet1", Rows: rows})
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestImportRawMaterials(t *testing.T) {
	e := setup(t)
	e.ScopeStaff("branch", e.org)
	sack, gr := e.companyUnit("SK"), e.companyUnit("GR")
	e.Exec(`INSERT INTO item.raw_material_categories (code, nama, company_id) VALUES ('BUMBU', 'Bumbu', $1)`, e.org.CompanyID)
	garam := "RMX-" + testutil.RandomHex(3)

	rec, out := e.upload("/api/purchasing/import/raw-materials", "bahan.csv", nil)
	if rec.Code != http.StatusBadRequest || out["error"] != "File must include a header row and at least one data row" {
		t.Fatalf("empty file: %d %v", rec.Code, out)
	}
	if rec, out = e.upload("/api/purchasing/import/raw-materials", "", nil); rec.Code != http.StatusBadRequest || out["error"] != "File not found" {
		t.Fatalf("no file: %d %v", rec.Code, out)
	}

	csv := strings.Join([]string{
		"Kode,Name,Kategori,Purchase Unit,Usage Unit,Konversi Factor,Harga Beli,Stok Awal,Stall Code,Status",
		`,Gula,bumbu,` + sack + `,` + gr + `,50,"500,000",100,stall-01,`,
		garam + `,Garam,bumbu,` + sack + `,,1,1000,5,,`,
		`,,bumbu,,,,,,,`,
		`,Lada,nope,` + sack + `,,,,,,`,
		`,Merica,bumbu,NOPE,,,,,,`,
		`,Kunyit,bumbu,` + sack + `,` + gr + `,0,1000,,,`,
		`,Jahe,bumbu,` + sack + `,,,,,ZZZ,`,
	}, "\n")
	rec, out = e.upload("/api/purchasing/import/raw-materials", "bahan.csv", []byte(csv))
	if rec.Code != http.StatusOK {
		t.Fatalf("import: %d %s", rec.Code, rec.Body)
	}
	e.jsonIs(out, `{"success":true,"imported":2,"updated":0,"skipped":5,"errors":[
		{"row":4,"message":"Required fields missing: nama, satuan_besar_kode"},
		{"row":5,"message":"Category \"nope\" not found. Seed categories first or use a valid code."},
		{"row":6,"message":"Satuan besar \"NOPE\" tidak ditemukan. Import satuan terlebih dahulu."},
		{"row":7,"message":"new row for relation \"raw_material_unit_conversions\" violates check constraint \"raw_material_unit_conversions_qty_in_base_unit_check\""},
		{"row":8,"message":"Stall code \"ZZZ\" was not found for this branch"}]}`)

	// Row 2 got the first BHN code of this branch and its opening stock on
	// STALL-01, costed per small unit (500 000 / 50).
	var gulaID, kategori string
	var conversions int
	e.Scalar(&gulaID, `SELECT id::text FROM item.raw_materials WHERE kode = 'BHN-2026-0001' AND branch_id = $1`, e.org.BranchID)
	e.Scalar(&kategori, `SELECT kategori FROM item.raw_materials WHERE id = $1`, gulaID)
	e.Scalar(&conversions, `SELECT count(*) FROM item.raw_material_unit_conversions WHERE raw_material_id = $1`, gulaID)
	if kategori != "BUMBU" || conversions != 2 {
		t.Fatalf("gula kategori %q conversions %d", kategori, conversions)
	}
	var stock string
	e.Scalar(&stock, `SELECT i.warehouse_id::text || ' ' || i.qty_available::text || ' ' || i.unit_cost::text || ' ' ||
		m.tipe || ' ' || m.reference_type || ' ' || m.reference_number || ' ' || m.alasan
		FROM inventory.inventory i JOIN inventory.inventory_movements m ON m.inventory_id = i.id WHERE i.raw_material_id = $1`, gulaID)
	if !strings.HasPrefix(stock, e.org.Stall1ID+" 100") || !strings.Contains(stock, " 10000") ||
		!strings.HasSuffix(stock, "in import BHN-2026-0001 Opening stock from raw material import (BHN-2026-0001)") {
		t.Fatalf("gula stock %q", stock)
	}
	// The failed row left nothing behind.
	var kunyit int
	e.Scalar(&kunyit, `SELECT count(*) FROM item.raw_materials WHERE nama = 'Kunyit' AND branch_id = $1`, e.org.BranchID)
	if kunyit != 0 {
		t.Fatal("the failing row must roll back its insert")
	}

	// Re-importing an exported sheet (XLSX) updates the code and sets the
	// stock to the file's quantity with an adjustment movement.
	book := xlsxFile(t, [][]any{
		{"kode", "nama", "kategori", "satuan_besar_kode", "harga_beli", "opening_stock", "status"},
		{garam, "Garam Halus", "BUMBU", sack, "2000", "8", "inactive"},
	})
	rec, out = e.upload("/api/purchasing/import/raw-materials", "bahan.xlsx", book)
	if rec.Code != http.StatusOK {
		t.Fatalf("reimport: %d %s", rec.Code, rec.Body)
	}
	e.jsonIs(out, `{"success":true,"imported":0,"updated":1,"skipped":0,"errors":[]}`)
	var garamState string
	e.Scalar(&garamState, `SELECT rm.nama || ' ' || rm.is_active::text || ' ' || i.qty_available::text || ' ' ||
		(SELECT string_agg(m.tipe || ':' || m.jumlah::text, ',' ORDER BY m.created_at, m.tipe) FROM inventory.inventory_movements m WHERE m.inventory_id = i.id)
		FROM item.raw_materials rm JOIN inventory.inventory i ON i.raw_material_id = rm.id
		WHERE rm.kode = $1 AND rm.branch_id = $2 AND i.warehouse_id = $3`, garam, e.org.BranchID, e.org.MainID)
	if garamState != "Garam Halus false 8.000 adjustment:3.000,in:5.000" {
		t.Fatalf("garam %q", garamState)
	}
}

func TestImportProducts(t *testing.T) {
	e := setup(t)
	e.ScopeStaff("company", e.org)
	pcs := e.companyUnit("PC")
	e.Exec(`INSERT INTO item.product_categories (code, nama, company_id) VALUES ('MERCH', 'Merch', $1)`, e.org.CompanyID)
	existing := "PX-" + testutil.RandomHex(3)
	existingID := e.Product(e.org, e.org.Stall1ID, existing, "Lama", 1000)

	book := xlsxFile(t, [][]any{
		{"Code", "Product Name", "Stall", "Category", "Unit", "Selling Price", "Status"},
		{"", "Kaos", "stall-01", "merch", pcs, "15,000", ""},
		{existing, "Baru", "STALL-01", "", pcs, "2500", "inactive"},
		{"", "", "", "", "", "", ""},
		{"", "Topi", "NOPE", "", pcs, "", ""},
		{"", "Mug", "STALL-01", "", "ZZ", "", ""},
		{"", "Jaket", "STALL-01", "badcat", pcs, "", ""},
		{"", "Syal", "", "", pcs, "", ""},
	})
	rec, out := e.upload("/api/purchasing/import/products", "produk.xlsx", book)
	if rec.Code != http.StatusOK {
		t.Fatalf("import: %d %s", rec.Code, rec.Body)
	}
	e.jsonIs(out, `{"success":true,"imported":1,"updated":1,"skipped":4,"errors":[
		{"row":5,"message":"Stall code not found: NOPE"},
		{"row":6,"message":"Unit code not found: ZZ"},
		{"row":7,"message":"Category code not found: badcat"},
		{"row":8,"message":"Required field missing: stall_code"}]}`)

	var kaos, baru string
	e.Scalar(&kaos, `SELECT kode || ' ' || kategori || ' ' || harga_jual::text || ' ' || markup_persen::text || ' ' || is_active::text || ' ' || company_id::text
		FROM item.products WHERE nama = 'Kaos' AND warehouse_id = $1`, e.org.Stall1ID)
	if kaos != "PRD-20261004-001 MERCH 15000.00 30 true "+e.org.CompanyID {
		t.Fatalf("kaos %q", kaos)
	}
	e.Scalar(&baru, `SELECT nama || ' ' || harga_jual::text || ' ' || is_active::text FROM item.products WHERE id = $1`, existingID)
	if baru != "Baru 2500.00 false" {
		t.Fatalf("updated product %q", baru)
	}
}

func TestImportUnits(t *testing.T) {
	e := setup(t)
	taken := e.companyUnit("UT")
	if rec, out := e.upload("/api/purchasing/import/units", "", nil); rec.Code != http.StatusBadRequest || out["error"] != "File tidak ditemukan" {
		t.Fatalf("no file: %d %v", rec.Code, out)
	}
	if rec, out := e.upload("/api/purchasing/import/units", "u.csv", []byte("kode,nama\n")); rec.Code != http.StatusBadRequest ||
		out["error"] != "File CSV harus memiliki header dan minimal 1 data" {
		t.Fatalf("header only: %d %v", rec.Code, out)
	}
	csv := "\ufeffKode,Nama,Tipe,Status\n,Tanpa Kode,BESAR,active\n" + taken + ",Dobel,BESAR,active\nNEW1,Baru,BESAR,active\n"
	rec, out := e.upload("/api/purchasing/import/units", "satuan.csv", []byte(csv))
	if rec.Code != http.StatusOK {
		t.Fatalf("import: %d %s", rec.Code, rec.Body)
	}
	// item.units has no faktor_konversi column: the TS insert fails on every
	// new code and the port reports the same database message.
	e.jsonIs(out, `{"success":true,"imported":0,"skipped":3,"errors":[
		{"row":2,"message":"Field wajib kosong: kode"},
		{"row":3,"message":"Kode satuan `+taken+` sudah ada"},
		{"row":4,"message":"column \"faktor_konversi\" of relation \"units\" does not exist"}]}`)
}

// download serves a GET and parses the workbook back.
func (e *env) download(path, filename string) [][]string {
	e.Helper()
	rec := e.Do("GET", path, nil)
	if rec.Code != http.StatusOK {
		e.Fatalf("%s: %d %s", path, rec.Code, rec.Body)
	}
	if rec.Header().Get("Content-Type") != xlsx.ContentType ||
		rec.Header().Get("Content-Disposition") != `attachment; filename="`+filename+`"` {
		e.Fatalf("%s headers %v", path, rec.Header())
	}
	matrix, err := xlsx.ParseMatrix(rec.Body.Bytes(), xlsx.ReadOptions{})
	if err != nil {
		e.Fatal(err)
	}
	return matrix
}

func TestExportProductsAndRawMaterials(t *testing.T) {
	e := setup(t)
	e.ScopeStaff("company", e.org)
	pcs := e.companyUnit("PC")
	kode := "PE-" + testutil.RandomHex(3)
	product := e.Product(e.org, e.org.Stall1ID, kode, "Kopi Ekspor", 4000)
	e.Exec(`UPDATE item.products SET satuan_id = (SELECT id FROM item.units WHERE kode = $1), deskripsi = '  manis  ' WHERE id = $2`, pcs, product)
	other := e.NewOrg()
	e.Product(other, other.Stall1ID, "PO-"+testutil.RandomHex(3), "Di luar scope", 1)

	matrix := e.download("/api/purchasing/export/products", "products-2026-10-04.xlsx")
	if !reflect.DeepEqual(matrix[0], []string{"kode", "nama", "stall_code", "kategori", "satuan_kode", "deskripsi",
		"harga_jual", "harga_modal", "markup_persen", "production_output_type", "status"}) {
		t.Fatalf("product header %v", matrix[0])
	}
	if len(matrix) != 2 || !reflect.DeepEqual(matrix[1], []string{kode, "Kopi Ekspor", "STALL-01", "", pcs, "manis",
		"15000.00", "4000", "30", "FINISHED_GOOD", "active"}) {
		t.Fatalf("product rows %v", matrix)
	}

	var kg string
	e.Scalar(&kg, `SELECT kode FROM item.units WHERE id = $1`, e.kg)
	rm := e.RawMaterial(e.org, "RE-"+testutil.RandomHex(3), "Beras Ekspor", e.kg, "", 1)
	e.Exec(`UPDATE item.raw_materials SET konversi_factor = NULL, stok_minimum = NULL WHERE id = $1`, rm)
	e.Stock(e.org, rm, e.org.MainID, 12, 1000)
	e.Stock(e.org, rm, e.org.Stall1ID, 3, 1000)

	matrix = e.download("/api/purchasing/export/raw-materials", "raw-materials-2026-10-04.xlsx")
	if len(matrix) != 2 || matrix[0][11] != "opening_stock" || matrix[0][12] != "stall_code" {
		t.Fatalf("raw material sheet %v", matrix)
	}
	row := matrix[1]
	if row[1] != "Beras Ekspor" || row[3] != kg || row[5] != "1" || row[6] != "0" || row[11] != "12.000" || row[12] != "MAIN" || row[14] != "active" {
		t.Fatalf("all stalls row %v", row)
	}

	// The sidebar's active stall decides whose stock is exported.
	e.Exec(`UPDATE configuration.users SET can_switch_stall = true WHERE id = $1`, e.Staff.UserID)
	e.ActiveStall(e.org.Stall1ID)
	matrix = e.download("/api/purchasing/export/raw-materials", "raw-materials-2026-10-04.xlsx")
	if matrix[1][11] != "3.000" || matrix[1][12] != "STALL-01" {
		t.Fatalf("stall row %v", matrix[1])
	}
}

func TestSpreadsheetRoutesNeedItemsMenu(t *testing.T) {
	e := setup(t)
	outsider := testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{"hris": nil}})
	for _, path := range []string{"/api/purchasing/export/products", "/api/purchasing/export/raw-materials"} {
		rec, _ := testutil.Do(t, e.Mux, testutil.AsStaff(testutil.Request("GET", path, nil), outsider))
		if rec.Code != http.StatusForbidden {
			t.Fatalf("%s outsider: %d", path, rec.Code)
		}
		if rec, _ := testutil.Do(t, e.Mux, testutil.Request("GET", path, nil)); rec.Code != http.StatusUnauthorized {
			t.Fatalf("%s anonymous: %d", path, rec.Code)
		}
	}
	rec, _ := testutil.Do(t, e.Mux, testutil.AsStaff(testutil.Request("POST", "/api/purchasing/import/units", nil), outsider))
	if rec.Code != http.StatusForbidden {
		t.Fatalf("units outsider: %d", rec.Code)
	}
}
