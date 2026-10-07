package accounting_test

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"nuhabit/backend/internal/modules/accounting/domain"
	"nuhabit/backend/internal/platform/testutil"
	"nuhabit/backend/internal/platform/xlsx"
)

// The file routes: the chart-of-accounts Excel import and the faktur pajak
// attachment of a B2B invoice, against a temporary STORAGE_DIR.

func multipartRequest(method, path string, fields map[string]string, fileName string, data []byte) *http.Request {
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	for k, v := range fields {
		_ = mw.WriteField(k, v)
	}
	if fileName != "" {
		w, _ := mw.CreateFormFile("file", fileName)
		_, _ = w.Write(data)
	}
	_ = mw.Close()
	r := httptest.NewRequest(method, path, &body)
	r.Header.Set("Content-Type", mw.FormDataContentType())
	return r
}

func (e *env) send(s *testutil.Staff, r *http.Request, status int) (*httptest.ResponseRecorder, map[string]any) {
	e.t.Helper()
	if s != nil {
		r = testutil.AsStaff(r, *s)
	}
	rec, body := testutil.Do(e.t, e.mux, r)
	if rec.Code != status {
		e.t.Fatalf("%s %s: status %d, want %d: %s", r.Method, r.URL.Path, rec.Code, status, rec.Body.String())
	}
	return rec, body
}

func workbook(t *testing.T, rows ...[]any) []byte {
	t.Helper()
	b, err := xlsx.Build(xlsx.SheetSpec{Name: "COA", Rows: rows})
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestChartOfAccountsImport(t *testing.T) {
	t.Setenv("STORAGE_DIR", t.TempDir())
	e := setup(t)
	const path = "/api/accounting/chart-of-accounts/import"
	importFile := func(s *testutil.Staff, mode string, data []byte, status int) map[string]any {
		e.t.Helper()
		_, body := e.send(s, multipartRequest("POST", path, map[string]string{"mode": mode}, "coa.xlsx", data), status)
		return body
	}
	header := []any{"code", "name", "parent_code", "account_type_code", "is_cash_bank"}
	good := workbook(t, header,
		[]any{"1 0 00 000", "CURRENT ASSETS", "", "", ""},
		[]any{"1 1 01 000", "KAS DAN BANK", "", "", ""},
		[]any{"1 1 01 001", "Kas Besar", "", "", "ya"},
	)

	// Guards: anonymous, no accounting menu, no company.
	e.send(nil, multipartRequest("POST", path, nil, "coa.xlsx", good), 401)
	other := testutil.CreateStaff(t, testutil.StaffOptions{Role: "admin", CompanyID: &e.company, Menus: map[string][]string{"pos": nil}})
	e.send(&other, multipartRequest("POST", path, nil, "coa.xlsx", good), 403)
	_, body := e.send(&e.noCompany, multipartRequest("POST", path, nil, "coa.xlsx", good), 400)
	wantError(t, body, domain.CompanyMissing)
	_, body = e.send(&e.staff, multipartRequest("POST", path, map[string]string{"mode": "commit"}, "", nil), 400)
	wantError(t, body, "File Excel wajib diunggah")
	// request.formData() is not caught by the TS route.
	e.send(&e.staff, httptest.NewRequest("POST", path, strings.NewReader("{}")), 500)
	importFile(&e.staff, "", []byte("not a workbook"), 500)

	empty := importFile(&e.staff, "anything", workbook(t, []any{"code", "name"}), 200)
	if empty["message"] != "Tidak ada baris valid untuk diimpor" || data(empty)["mode"] != "anything" ||
		len(data(empty)["preview"].([]any)) != 0 || data(empty)["summary"].(map[string]any)["error"] != float64(1) {
		t.Fatalf("empty import: %v", empty)
	}

	preview := importFile(&e.staff, "", good, 200)
	if _, ok := preview["message"]; ok || data(preview)["mode"] != "preview" {
		t.Fatalf("preview: %v", preview)
	}
	if s := data(preview)["summary"].(map[string]any); s["create"] != float64(3) || s["error"] != float64(0) {
		t.Fatalf("preview summary: %v", s)
	}
	row := data(preview)["preview"].([]any)[2].(map[string]any)
	if row["source_row"] != float64(4) || row["code"] != "1101001" || row["parent_code"] != "1101000" ||
		row["account_type_code"] != "ASSET" || row["action"] != "create" {
		t.Fatalf("preview row: %v", row)
	}
	var count int
	e.scalar(&count, `SELECT count(*) FROM accounting.chart_of_accounts WHERE company_id = $1`, e.company)
	if count != 0 {
		t.Fatalf("preview wrote %d accounts", count)
	}

	bad := workbook(t, header, []any{"1101001", "Kas", "9999000", "", ""})
	_, body = e.send(&e.staff, multipartRequest("POST", path, map[string]string{"mode": "commit"}, "coa.xlsx", bad), 400)
	wantError(t, body, "Masih ada error — perbaiki file sebelum commit")

	done := importFile(&e.staff, "commit", good, 200)
	if done["message"] != "Import selesai: 3 baru, 0 update" || data(done)["mode"] != "commit" {
		t.Fatalf("commit: %v", done)
	}
	type acc struct {
		parent             *string
		postable, cashBank bool
		cashFlow           *string
	}
	get := func(code string) acc {
		var a acc
		if err := e.tx.QueryRow(e.ctx, `
SELECT p.code, c.is_postable, c.is_cash_bank, c.cash_flow_category FROM accounting.chart_of_accounts c
  LEFT JOIN accounting.chart_of_accounts p ON p.id = c.parent_id
 WHERE c.company_id = $1 AND c.code = $2`, e.company, code).Scan(&a.parent, &a.postable, &a.cashBank, &a.cashFlow); err != nil {
			t.Fatalf("%s: %v", code, err)
		}
		return a
	}
	if a := get("1000000"); a.parent != nil || a.postable {
		t.Fatalf("1000000: %+v", a)
	}
	if a := get("1101000"); *a.parent != "1000000" || a.postable {
		t.Fatalf("1101000: %+v", a)
	}
	if a := get("1101001"); *a.parent != "1101000" || !a.postable || !a.cashBank || *a.cashFlow != "OPERATING" {
		t.Fatalf("1101001: %+v", a)
	}

	// Parents resolve against the file only, so a partial file names them (the TS clears them otherwise).
	renamed := workbook(t, header, []any{"1101001", "Kas Utama", "1101000", "", ""}, []any{"1101002", "Bank", "1101000", "", ""})
	again := importFile(&e.staff, "commit", renamed, 200)
	if again["message"] != "Import selesai: 1 baru, 1 update" {
		t.Fatalf("re-import: %v", again)
	}
	var name string
	e.scalar(&name, `SELECT name FROM accounting.chart_of_accounts WHERE company_id = $1 AND code = '1101001'`, e.company)
	if a := get("1101002"); name != "Kas Utama" || *a.parent != "1101000" || !a.postable {
		t.Fatalf("re-import rows: %q %+v", name, a)
	}
}

func TestFakturPajakAttachment(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("STORAGE_DIR", dir)
	e := setup(t)

	sfx := testutil.RandomHex(3)
	var branch, lead, deal, invoice string
	e.scalar(&branch, `INSERT INTO configuration.branches (company_id, name, code) VALUES ($1, 'Br '||$2, 'GAF'||$2) RETURNING id::text`, e.company, sfx)
	e.scalar(&lead, `INSERT INTO crm.crm_sales_leads (company_id, branch_id, org_name, pic_name, pic_phone)
VALUES ($1, $2, 'PT Pajak', 'Sari', '0813') RETURNING id::text`, e.company, branch)
	e.scalar(&deal, `INSERT INTO crm.crm_sales_deals (company_id, branch_id, lead_id, title, stage_id)
VALUES ($1, $2, $3, 'Event', (SELECT id FROM crm.crm_sales_stages ORDER BY sort_order LIMIT 1)) RETURNING id::text`, e.company, branch, lead)
	invoice = e.salesInvoice(branch, deal, "INV/2026 ü-1."+sfx, "2026-10-01T03:00:00Z", "2026-10-31", 1000)
	path := "/api/finance/invoices/" + invoice + "/faktur-pajak"
	pdf := []byte("%PDF-1.4\n% faktur\n")
	png := append([]byte("\x89PNG\r\n\x1a\n"), make([]byte, 16)...)
	post := func(s *testutil.Staff, name string, data []byte, status int) map[string]any {
		t.Helper()
		_, body := e.send(s, multipartRequest("POST", path, nil, name, data), status)
		return body
	}
	stored := func() *string {
		var url *string
		e.scalar(&url, `SELECT faktur_pajak_url FROM crm.crm_sales_invoices WHERE id = $1`, invoice)
		return url
	}

	// Guards: anonymous, no menu, no company scope, unknown invoice.
	e.send(nil, testutil.Request("GET", path, nil), 401)
	nobody := testutil.CreateStaff(t, testutil.StaffOptions{Role: "admin", CompanyID: &e.company, Menus: map[string][]string{"pos": nil}})
	e.send(&nobody, testutil.Request("GET", path, nil), 403)
	e.send(&e.noCompany, testutil.Request("GET", path, nil), 403)
	_, body := e.send(&e.staff, testutil.Request("GET", "/api/finance/invoices/00000000-0000-0000-0000-000000000000/faktur-pajak", nil), 404)
	wantError(t, body, "Invoice tidak ditemukan")

	_, body = e.send(&e.staff, testutil.Request("GET", path, nil), 404)
	wantError(t, body, "Invoice ini belum punya lampiran faktur pajak")
	_, body = e.send(&e.staff, testutil.Request("DELETE", path, nil), 409)
	wantError(t, body, "Invoice ini belum punya lampiran faktur pajak")

	_, body = e.send(&e.staff, testutil.Request("POST", path, map[string]any{"file": "x"}), 400)
	wantError(t, body, "Form data tidak valid")
	_, body = e.send(&e.staff, multipartRequest("POST", path, map[string]string{"file": "x"}, "", nil), 400)
	wantError(t, body, "File tidak ditemukan")
	wantError(t, post(&e.staff, "f.pdf", []byte("plain text"), 400), "Isi file bukan PDF/JPG/PNG/WebP yang valid")
	wantError(t, post(&e.staff, "big.pdf", append(pdf, make([]byte, 10<<20)...), 400), "Ukuran dokumen maksimal 10 MB")

	// Upload: written under private/invoice-faktur-pajak/<deal>/.
	if got := post(&e.staff, "faktur.pdf", pdf, 200); got["success"] != true || got["message"] != "Faktur pajak INV/2026 ü-1."+sfx+" tersimpan" {
		t.Fatalf("upload: %v", got)
	}
	first := stored()
	if first == nil || !strings.HasPrefix(*first, "invoice-faktur-pajak/"+deal+"/") || !strings.HasSuffix(*first, ".pdf") {
		t.Fatalf("stored path %v", first)
	}
	if b, err := os.ReadFile(filepath.Join(dir, "private", *first)); err != nil || !bytes.Equal(b, pdf) {
		t.Fatalf("stored file: %v %q", err, b)
	}

	// A sales-funnel viewer reads it but may not change it.
	sales := testutil.CreateStaff(t, testutil.StaffOptions{Role: "admin", CompanyID: &e.company, Menus: map[string][]string{"sales-funnel": nil}})
	rec, _ := e.send(&sales, testutil.Request("GET", path, nil), 200)
	if !bytes.Equal(rec.Body.Bytes(), pdf) {
		t.Fatalf("download body %q", rec.Body.Bytes())
	}
	for k, want := range map[string]string{
		"Content-Type":           "application/pdf",
		"Content-Disposition":    `inline; filename="faktur-pajak-INV_2026__-1.` + sfx + `"`,
		"Cache-Control":          "private, max-age=3600",
		"X-Content-Type-Options": "nosniff",
	} {
		if got := rec.Header().Get(k); got != want {
			t.Fatalf("%s = %q, want %q", k, got, want)
		}
	}
	post(&sales, "faktur.pdf", pdf, 403)
	e.send(&sales, testutil.Request("DELETE", path, nil), 403)

	// A re-upload replaces the file and removes the old one.
	post(&e.staff, "faktur.png", png, 200)
	second := stored()
	if second == nil || *second == *first || !strings.HasSuffix(*second, ".png") {
		t.Fatalf("replaced path %v", second)
	}
	if _, err := os.Stat(filepath.Join(dir, "private", *first)); !os.IsNotExist(err) {
		t.Fatalf("old file kept: %v", err)
	}
	if rec, _ := e.send(&e.staff, testutil.Request("GET", path, nil), 200); rec.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("png type %q", rec.Header().Get("Content-Type"))
	}

	if got := e.do("DELETE", path, nil, 200); got["success"] != true || got["message"] != "Lampiran faktur pajak dihapus" {
		t.Fatalf("delete: %v", got)
	}
	if stored() != nil {
		t.Fatal("column not cleared")
	}
	if _, err := os.Stat(filepath.Join(dir, "private", *second)); !os.IsNotExist(err) {
		t.Fatalf("file kept: %v", err)
	}

	// A stored path outside private/ is never read or deleted.
	secret := filepath.Join(dir, "secret.txt")
	if err := os.WriteFile(secret, []byte("s"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := e.tx.Exec(e.ctx, `UPDATE crm.crm_sales_invoices SET faktur_pajak_url = '../secret.txt' WHERE id = $1`, invoice); err != nil {
		t.Fatal(err)
	}
	_, body = e.send(&e.staff, testutil.Request("GET", path, nil), 404)
	wantError(t, body, "File tidak ditemukan")
	e.do("DELETE", path, nil, 200)
	if _, err := os.Stat(secret); err != nil {
		t.Fatalf("file outside private/ removed: %v", err)
	}
}
