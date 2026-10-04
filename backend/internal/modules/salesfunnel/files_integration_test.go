package salesfunnel_test

import (
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"nuhabit/backend/internal/platform/extract"
	"nuhabit/backend/internal/platform/testutil"
	"nuhabit/backend/internal/platform/xlsx"
)

// upload is a multipart POST with one "file" part.
func upload(t *testing.T, target, name string, data []byte) *http.Request {
	t.Helper()
	var body bytes.Buffer
	mw := multipart.NewWriter(&body)
	fw, err := mw.CreateFormFile("file", name)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = fw.Write(data)
	_ = mw.Close()
	req := httptest.NewRequest("POST", target, &body)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	return req
}

const importURL = "/api/sales-funnel/leads/import"

func TestLeadImport(t *testing.T) {
	e := newEnv(t)
	s := e.seller()
	org := "PT Impor " + testutil.RandomHex(3)
	phone := localPhone()
	csv := "Nama Instansi,Jenis,Nama PIC,No WA,Email,Kota,Sumber,Suhu,Catatan\n" +
		org + ",SEKOLAH,Budi,\"" + phone + "\",budi@,Bandung,referral,PANAS,\"150 pax, akhir tahun\"\n" +
		",,,,,,,,\n" +
		strings.ToUpper(org) + ",,Sari," + phone + ",,,,,\n" +
		"PT Lain,,Andi,0812,,,,,\n" +
		"PT Kosong,,,,,,,,\n"

	r := e.send(nil, upload(t, importURL, "leads.csv", []byte(csv)))
	e.expect(r, 401, "Authentication required")
	nomenu := e.staff("admin", "dashboard")
	e.expect(e.send(&nomenu, upload(t, importURL, "leads.csv", []byte(csv))), 403, "Insufficient permissions")

	r = e.send(&s, upload(t, importURL, "leads.csv", []byte(csv)))
	e.expect(r, 200, "")
	want := `{"success":true,"imported":1,"skipped":3,"errors":[{"row":2,"message":"Email diabaikan (tidak valid): budi@"},` +
		`{"row":4,"message":"Duplikat instansi + no. WA: ` + strings.ToUpper(org) + ` / ` + phone + `"},` +
		`{"row":5,"message":"No. WA tidak valid: 0812"},` +
		`{"row":6,"message":"Field wajib kosong: nama_instansi / nama_pic / wa_pic"}],"updated":0}`
	if strings.TrimSpace(r.Raw) != want {
		t.Fatalf("import\n got %s\nwant %s", r.Raw, want)
	}
	var orgType, city, source, temp, notes, createdBy string
	var email, account, contact *string
	if err := e.tx.QueryRow(e.ctx, `SELECT org_type, city, source, temperature, notes, created_by::text, pic_email, account_id::text, contact_id::text
		FROM crm.crm_sales_leads WHERE org_name = $1 AND pic_phone = $2`, org, "62"+phone[1:]).
		Scan(&orgType, &city, &source, &temp, &notes, &createdBy, &email, &account, &contact); err != nil {
		t.Fatal(err)
	}
	if orgType != "sekolah" || city != "Bandung" || source != "referral" || temp != "panas" || notes != "150 pax, akhir tahun" ||
		createdBy != s.UserID || email != nil || account == nil || contact == nil {
		t.Fatalf("lead %s %s %s %s %q %s %v %v %v", orgType, city, source, temp, notes, createdBy, email, account, contact)
	}

	// The same file again: every row is now a duplicate of the database.
	r = e.send(&s, upload(t, importURL, "leads.csv", []byte(csv)))
	if r.Status != 200 || r.Body["imported"] != float64(0) || !strings.Contains(r.Raw, `{"row":2,"message":"Duplikat instansi + no. WA: `+org+` / `+phone+`"}`) {
		t.Fatalf("reimport %s", r.Raw)
	}

	// XLSX goes through the ExcelJS-style reader: numbers read back as text.
	book, err := xlsx.Build(xlsx.SheetSpec{Name: "Leads", Rows: [][]any{
		{"nama_instansi", "nama_pic", "wa_pic", "suhu"},
		{"PT Xlsx " + testutil.RandomHex(3), "Rina", 81234567890 + float64(len(org)), "dingin"},
	}})
	if err != nil {
		t.Fatal(err)
	}
	r = e.send(&s, upload(t, importURL, "leads.xlsx", book))
	if r.Status != 200 || r.Body["imported"] != float64(1) || r.Body["skipped"] != float64(0) {
		t.Fatalf("xlsx %s", r.Raw)
	}

	// Failures inside the route carry both error and message.
	expectBoth := func(r resp, status int, msg string) {
		t.Helper()
		if r.Status != status || r.Body["error"] != msg || r.Body["message"] != msg || r.Body["success"] != false {
			t.Fatalf("want %d %q: %d %s", status, msg, r.Status, r.Raw)
		}
	}
	expectBoth(e.send(&s, upload(t, importURL, "leads.csv", []byte("nama_instansi,nama_pic,wa_pic\n"))), 400,
		"File harus berisi baris header dan minimal satu baris data")
	big := "nama_instansi,nama_pic,wa_pic\n" + strings.Repeat("PT A,B,081234567890\n", 501)
	expectBoth(e.send(&s, upload(t, importURL, "leads.csv", []byte(big))), 400, "Maksimal 500 baris per import")
	var noFile bytes.Buffer
	mw := multipart.NewWriter(&noFile)
	_ = mw.WriteField("file", "not a file")
	_ = mw.Close()
	req := httptest.NewRequest("POST", importURL, &noFile)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	expectBoth(e.send(&s, req), 400, "File not found")
	unscoped := testutil.CreateStaff(t, testutil.StaffOptions{Role: "admin", Menus: map[string][]string{"sales-funnel": {"read", "create"}}})
	expectBoth(e.send(&unscoped, upload(t, importURL, "leads.csv", []byte(csv))), 403, "Scope bisnis user belum dikonfigurasi — hubungi admin")

	// A body that is not multipart is request.formData() throwing: a 500.
	e.expect(e.send(&s, testutil.Request("POST", importURL, map[string]any{"file": "x"})), 500, "Terjadi kesalahan server")
	// A broken workbook is a parse failure, also a 500.
	e.expect(e.send(&s, upload(t, importURL, "leads.xlsx", []byte("PK not a zip"))), 500, "Terjadi kesalahan server")
}

func pdfOf(t *testing.T, r resp, fileName string) string {
	t.Helper()
	if r.Status != 200 || r.Header.Get("Content-Type") != "application/pdf" ||
		r.Header.Get("Content-Disposition") != `attachment; filename="`+fileName+`"` {
		t.Fatalf("pdf %d %v", r.Status, r.Header)
	}
	text, err := extract.PDFText([]byte(r.Raw))
	if err != nil {
		t.Fatal(err)
	}
	return text
}

func TestQuotationAndInvoicePDF(t *testing.T) {
	e := newEnv(t)
	s := e.seller()
	dealID, leadID := e.deal(s)
	e.exec(`UPDATE crm.crm_sales_leads SET org_name = 'PT. Maju & Jaya', pic_title = 'HRD' WHERE id = $1`, leadID)
	e.exec(`UPDATE crm.crm_sales_deals SET event_type = 'field-trip', event_date = '2026-12-01' WHERE id = $1`, dealID)
	var product string
	e.tx.QueryRow(e.ctx, `INSERT INTO pos.pos_products (sku, name, base_price) VALUES ($1, 'Paket Makan', 20000) RETURNING id::text`,
		"GO-"+testutil.RandomHex(4)).Scan(&product)
	r := e.do(&s, "POST", "/api/sales-funnel/deals/"+dealID+"/quotations", map[string]any{
		"use_ppn": true, "ppn_persen": 11, "discount_percent": 10, "valid_until": "2026-11-15", "notes": "Termasuk sound system",
		"items": []any{
			map[string]any{"item_type": "produk", "product_id": product, "description": "Paket Makan", "qty": 50, "unit_price": 20000},
			map[string]any{"description": "Sewa venue", "qty": 1, "unit_price": 1000000},
		},
		"terms": []any{map[string]any{"label": "DP", "percent": 50}, map[string]any{"label": "Pelunasan", "percent": 50, "due_date": "2026-12-01"}}})
	e.expect(r, 201, "")
	qid, number := r.data()["id"].(string), r.data()["quote_number"].(string)
	company := e.scalar(`SELECT name FROM configuration.companies WHERE id = $1`, e.companyID).(string)

	target := "/api/sales-funnel/quotations/" + qid + "/pdf"
	e.expect(e.do(nil, "GET", target, nil), 401, "Authentication required")
	nomenu := e.staff("admin", "dashboard")
	e.expect(e.do(&nomenu, "GET", target, nil), 403, "Insufficient permissions")
	e.expect(e.do(&s, "GET", "/api/sales-funnel/quotations/00000000-0000-0000-0000-000000000000/pdf", nil), 404, "Quotation tidak ditemukan")

	text := pdfOf(t, e.do(&s, "GET", target, nil), number+"-PT-Maju-Jaya.pdf")
	inOrder(t, text, company, "QUOTATION "+number, "PT. Maju & Jaya — up. Budi (HRD)", "Gathering (Field Trip)",
		"1 Desember 2026 / 15 November 2026", "Paket Makan", "50 pax", "Rp20.000", "Rp1.000.000", "Sewa venue",
		"Subtotal", "Rp2.000.000", "Diskon 10%", "- Rp200.000", "PPN 11%", "Rp198.000", "TOTAL", "Rp1.998.000",
		"DP (50%)", "Rp999.000", "Pelunasan (50%) — jatuh tempo 1 Desember 2026", "Rp999.000",
		"CATATAN", "Termasuk sound system", "Hormat kami,")

	// Invoices: sales submit, finance and sales may download.
	term := e.scalar(`SELECT id::text FROM crm.crm_sales_quotation_terms WHERE quotation_id = $1 AND sort_order = 0`, qid).(string)
	r = e.do(&s, "POST", "/api/sales-funnel/deals/"+dealID+"/invoices", map[string]any{"term_id": term, "label": "DP 50%", "amount": 999000, "due_date": "2026-11-01"})
	e.expect(r, 201, "")
	invoiceID, invoiceNo := r.data()["id"].(string), r.data()["invoice_number"].(string)
	fin := e.staff("finance_staff", "accounting")
	e.expect(e.do(&fin, "POST", "/api/sales-funnel/deals/"+dealID+"/payments", map[string]any{"amount": 400000, "paid_on": "2026-10-01", "invoice_id": invoiceID}), 201, "Pembayaran tercatat")

	target = "/api/sales-funnel/invoices/" + invoiceID + "/pdf"
	e.expect(e.do(nil, "GET", target, nil), 401, "Authentication required")
	e.expect(e.do(&nomenu, "GET", target, nil), 403, "Insufficient permissions")
	e.expect(e.do(&fin, "GET", "/api/sales-funnel/invoices/00000000-0000-0000-0000-000000000000/pdf", nil), 404, "Invoice tidak ditemukan")
	text = pdfOf(t, e.do(&fin, "GET", target, nil), invoiceNo+"-PT-Maju-Jaya.pdf")
	inOrder(t, text, company, "INVOICE "+invoiceNo, "Ditagihkan kepada", "PT. Maju & Jaya — up. Budi (HRD)",
		"Tanggal Acara / Jatuh Tempo", "1 Desember 2026 / 1 November 2026",
		"DP 50% (50% dari nilai kesepakatan) — sesuai "+number, "Rp999.000",
		"DPP", "Rp900.000", "PPN 11%", "Rp99.000", "TOTAL TAGIHAN", "Rp999.000",
		"Sudah dibayar", "Rp400.000", "SISA TAGIHAN", "Rp599.000", "Hormat kami,")
	pdfOf(t, e.do(&s, "GET", target, nil), invoiceNo+"-PT-Maju-Jaya.pdf")
}

// inOrder fails unless every part appears in text, each after the previous.
func inOrder(t *testing.T, text string, parts ...string) {
	t.Helper()
	at := 0
	for _, p := range parts {
		i := strings.Index(text[at:], p)
		if i < 0 {
			t.Fatalf("%q missing after offset %d in %q", p, at, text)
		}
		at += i + len(p)
	}
}
