package procurement_test

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"strings"
	"testing"

	"nuhabit/backend/internal/platform/testutil"
	"nuhabit/backend/internal/platform/xlsx"
)

// Receipt archive, receipt scan and the supplier spreadsheet routes on
// real multipart bodies and a temporary STORAGE_DIR.

var itemsOnly = map[string][]string{"items": {"read", "create", "update", "delete"}}

// pngBytes sniffs as PNG.
var pngBytes = append([]byte{0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a}, []byte("receipt-image")...)

// fileEnv sets STORAGE_DIR before the module is built.
func fileEnv(t *testing.T) (*env, string) {
	dir := t.TempDir()
	t.Setenv("STORAGE_DIR", dir)
	return newEnv(t), dir
}

// upload posts data as the `file` part (no part when name is "").
func (e *env) upload(s *testutil.Staff, target, name string, data []byte) resp {
	e.t.Helper()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	if name != "" {
		part, err := mw.CreateFormFile("file", name)
		if err != nil {
			e.t.Fatal(err)
		}
		_, _ = part.Write(data)
	} else {
		_ = mw.WriteField("note", "no file")
	}
	_ = mw.Close()
	req := httptest.NewRequest("POST", target, &body)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	if s != nil {
		req = testutil.AsStaff(req, *s)
	}
	e.exec(`SAVEPOINT upload`)
	rec := httptest.NewRecorder()
	e.mux.ServeHTTP(rec, req)
	if rec.Code >= 400 {
		e.exec(`ROLLBACK TO SAVEPOINT upload`)
	}
	e.exec(`RELEASE SAVEPOINT upload`)
	var parsed map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &parsed)
	return resp{Status: rec.Code, Body: parsed, Raw: rec.Body.String()}
}

func (e *env) get(s *testutil.Staff, target string) *httptest.ResponseRecorder {
	req := httptest.NewRequest("GET", target, nil)
	if s != nil {
		req = testutil.AsStaff(req, *s)
	}
	rec := httptest.NewRecorder()
	e.mux.ServeHTTP(rec, req)
	return rec
}

func TestReceiptFile(t *testing.T) {
	e, dir := fileEnv(t)
	staff := e.staff(itemsOnly)
	outsider := e.staff(map[string][]string{"hris": nil})
	receipts := filepath.Join(dir, "private", "purchasing-receipts", "2026", "10")
	if err := os.MkdirAll(receipts, 0o755); err != nil {
		t.Fatal(err)
	}
	_ = os.WriteFile(filepath.Join(receipts, "a.png"), pngBytes, 0o644)
	_ = os.WriteFile(filepath.Join(receipts, ".hidden"), []byte("x"), 0o644)
	_ = os.WriteFile(filepath.Join(dir, "private", "secrets"), []byte("x"), 0o644)

	rec := e.get(&staff, "/api/purchasing/receipts/2026/10/a.png")
	if rec.Code != 200 || !bytes.Equal(rec.Body.Bytes(), pngBytes) {
		t.Fatalf("download = %d %q", rec.Code, rec.Body.String())
	}
	want := map[string]string{"Content-Type": "image/png", "Content-Disposition": "inline",
		"X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=3600"}
	for k, v := range want {
		if rec.Header().Get(k) != v {
			t.Fatalf("%s = %q, want %q", k, rec.Header().Get(k), v)
		}
	}

	for _, path := range []string{"2026/..%2F..%2Fsecrets", "2026/10/.hidden", "2026/10/%2e%2e", "2026/10/a%5Cb", "2026/10/missing.png"} {
		rec := e.get(&staff, "/api/purchasing/receipts/"+path)
		if rec.Code != 404 || strings.TrimSpace(rec.Body.String()) != `{"success":false,"error":"File tidak ditemukan"}` {
			t.Fatalf("%s = %d %s", path, rec.Code, rec.Body)
		}
	}
	if rec := e.get(nil, "/api/purchasing/receipts/2026/10/a.png"); rec.Code != 401 {
		t.Fatalf("anonymous = %d", rec.Code)
	}
	if rec := e.get(&outsider, "/api/purchasing/receipts/2026/10/a.png"); rec.Code != 403 {
		t.Fatalf("outsider = %d", rec.Code)
	}
}

// fakeTesseract puts a tesseract stand-in on TESSERACT_BIN that prints text.
func fakeTesseract(t *testing.T, text string) {
	script := filepath.Join(t.TempDir(), "tesseract")
	if err := os.WriteFile(script, []byte("#!/bin/sh\ncat <<'EOF'\n"+text+"\nEOF\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("TESSERACT_BIN", script)
}

func TestReceiptScan(t *testing.T) {
	e, dir := fileEnv(t)
	staff := e.staff(itemsOnly)
	outsider := e.staff(map[string][]string{"hris": nil})
	const route = "/api/purchasing/receipt-scan"

	e.expect(e.upload(&staff, route, "", nil), 400, "Pilih file nota dulu")
	e.expect(e.upload(&staff, route, "nota.png", nil), 400, "Pilih file nota dulu")
	e.expect(e.do(&staff, "POST", route, map[string]any{"file": "x"}), 400, "Pilih file nota dulu")
	e.expect(e.upload(&staff, route, "nota.csv", []byte("a,b")), 400, "Format tidak didukung — gunakan foto (JPG/PNG) atau PDF")
	e.expect(e.upload(&staff, route, "nota.png", []byte("not an image at all")), 400, "Isi file bukan PDF/JPG/PNG/WebP yang valid")
	e.expect(e.upload(&outsider, route, "nota.png", pngBytes), 403, "")
	e.expect(e.upload(nil, route, "nota.png", pngBytes), 401, "")

	pathRe := regexp.MustCompile(`^purchasing-receipts/\d{4}/\d{2}/\d+-[0-9a-f]{16}\.png$`)
	check := func(r resp, fields string) {
		t.Helper()
		e.expect(r, 200, "")
		data := r.data()
		path, _ := data["receipt_path"].(string)
		if !pathRe.MatchString(path) || data["receipt_name"] != "nota.png" || r.Body["success"] != true {
			t.Fatalf("scan = %s", r.Raw)
		}
		if got, _ := json.Marshal(data["fields"]); string(got) != fields {
			t.Fatalf("fields = %s, want %s", got, fields)
		}
		stored, err := os.ReadFile(filepath.Join(dir, "private", filepath.FromSlash(path)))
		if err != nil || !bytes.Equal(stored, pngBytes) {
			t.Fatalf("archived file: %v", err)
		}
	}

	// OCR missing: the upload still succeeds with empty fields.
	t.Setenv("TESSERACT_BIN", filepath.Join(dir, "no-tesseract"))
	check(e.upload(&staff, route, "nota.png", pngBytes), `{"nomor":null,"tanggal":null,"total":null}`)

	fakeTesseract(t, "TOKO SUMBER REZEKI\nNo Nota: SR-0451\nTanggal: 24/07/2026\nTOTAL        Rp 123.000")
	check(e.upload(&staff, route, "nota.png", pngBytes), `{"nomor":"SR-0451","tanggal":"2026-07-24","total":123000}`)
}

// scopedStaff is a branch-level purchasing user of a fresh org.
func (e *env) scopedStaff() (testutil.Staff, string, string) {
	s := suffix()
	holding := e.id(`INSERT INTO configuration.holdings (name, code) VALUES ('H '||$1, 'H'||$1) RETURNING id::text`, s)
	company := e.id(`INSERT INTO configuration.companies (holding_id, name, code) VALUES ($1, 'C '||$2, 'C'||$2) RETURNING id::text`, holding, s)
	branch := e.id(`INSERT INTO configuration.branches (company_id, name, code) VALUES ($1, 'B '||$2, 'B'||$2) RETURNING id::text`, company, s)
	staff := e.staff(itemsOnly)
	e.exec(`UPDATE configuration.users SET business_scope = 'branch', holding_id = $2, company_id = $3, branch_id = $4 WHERE id = $1`,
		staff.UserID, holding, company, branch)
	return staff, company, branch
}

func TestSupplierImportExport(t *testing.T) {
	e, _ := fileEnv(t)
	staff, company, branch := e.scopedStaff()
	lama := "SI-" + suffix()
	lamaID := e.id(`INSERT INTO purchasing.suppliers (kode, nama_supplier, company_id, branch_id) VALUES ($1, 'Toko Lama', $2, $3) RETURNING id::text`,
		lama, company, branch)
	// Same code outside the caller's branch: not the row the import updates.
	e.exec(`INSERT INTO purchasing.suppliers (kode, nama_supplier) VALUES ($1, 'Global')`, lama)

	e.expect(e.upload(&staff, "/api/purchasing/import/suppliers", "", nil), 400, "File not found")
	e.expect(e.upload(&staff, "/api/purchasing/import/suppliers", "s.csv", []byte("kode,nama\n")), 400,
		"File must include a header row and at least one data row")
	e.expect(e.do(&staff, "POST", "/api/purchasing/import/suppliers", map[string]any{}), 500, "Terjadi kesalahan server")

	csv := strings.Join([]string{
		"Kode,Name,Contact Person,Phone,Email,Payment Term,Mata Uang,Status,Notes",
		",Toko Baru,Budi,0812,,top 30,usd,,catatan",
		lama + ",Toko Lama Update,,,,cash,,blocked,",
		",,,,,,,,",
		",,Tanpa Nama,,,,,,",
		strings.Repeat("K", 60) + ",Kode Panjang,,,,,,,",
	}, "\n")
	r := e.upload(&staff, "/api/purchasing/import/suppliers", "supplier.csv", []byte(csv))
	e.expect(r, 200, "")
	if r.Raw != `{"success":true,"imported":1,"updated":1,"skipped":2,"errors":[{"row":5,"message":"Required field missing: nama_supplier"},`+
		`{"row":6,"message":"value too long for type character varying(50)"}]}` {
		t.Fatalf("import = %s", r.Raw)
	}
	var baru string
	if err := e.tx.QueryRow(e.ctx, `SELECT kode || ' ' || pic_name || ' ' || telepon || ' ' || payment_terms || ' ' || currency || ' ' ||
		status || ' ' || is_active::text || ' ' || catatan || ' ' || (email IS NULL)::text FROM purchasing.suppliers
		WHERE nama_supplier = 'Toko Baru' AND company_id = $1 AND branch_id = $2`, company, branch).Scan(&baru); err != nil {
		t.Fatal(err)
	}
	if !regexp.MustCompile(`^SUP-\d{4}-\d{4} Budi 0812 TOP30 USD active true catatan true$`).MatchString(baru) {
		t.Fatalf("inserted = %q", baru)
	}
	if got := e.scalar(`SELECT nama_supplier || ' ' || payment_terms || ' ' || status || ' ' || is_active::text FROM purchasing.suppliers WHERE id = $1`, lamaID); got != "Toko Lama Update CBD blocked false" {
		t.Fatalf("updated = %v", got)
	}

	// XLSX import of the same layout, then the export holds only this branch.
	book, err := xlsx.Build(xlsx.SheetSpec{Rows: [][]any{{"nama_supplier", "kota"}, {"Toko Xlsx", " Bandung "}}})
	if err != nil {
		t.Fatal(err)
	}
	e.expect(e.upload(&staff, "/api/purchasing/import/suppliers", "supplier.xlsx", book), 200, "")

	rec := e.get(&staff, "/api/purchasing/export/suppliers")
	if rec.Code != 200 || rec.Header().Get("Content-Type") != xlsx.ContentType ||
		!regexp.MustCompile(`^attachment; filename="suppliers-\d{4}-\d{2}-\d{2}\.xlsx"$`).MatchString(rec.Header().Get("Content-Disposition")) {
		t.Fatalf("export = %d %v", rec.Code, rec.Header())
	}
	matrix, err := xlsx.ParseMatrix(rec.Body.Bytes(), xlsx.ReadOptions{})
	if err != nil {
		t.Fatal(err)
	}
	header := []string{"kode", "nama_supplier", "pic_name", "pic_phone", "pic_email", "telepon", "email", "alamat", "kota", "npwp",
		"payment_terms", "currency", "bank_nama", "bank_rekening", "bank_atas_nama", "kategori", "catatan", "status"}
	if !reflect.DeepEqual(matrix[0], header) || len(matrix) != 4 {
		t.Fatalf("export sheet = %v", matrix)
	}
	if names := []string{matrix[1][1], matrix[2][1], matrix[3][1]}; !reflect.DeepEqual(names, []string{"Toko Baru", "Toko Lama Update", "Toko Xlsx"}) {
		t.Fatalf("export rows = %v", names)
	}
	if row := matrix[3]; row[8] != "Bandung" || row[10] != "TOP30" || row[11] != "IDR" || row[17] != "active" || row[2] != "" {
		t.Fatalf("xlsx supplier row = %v", row)
	}

	outsider := e.staff(map[string][]string{"hris": nil})
	if rec := e.get(&outsider, "/api/purchasing/export/suppliers"); rec.Code != 403 {
		t.Fatalf("outsider export = %d", rec.Code)
	}
	e.expect(e.upload(nil, "/api/purchasing/import/suppliers", "supplier.csv", []byte(csv)), 401, "")
}
