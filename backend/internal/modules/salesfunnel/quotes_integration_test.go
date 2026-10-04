package salesfunnel_test

import (
	"strings"
	"testing"

	contract "nuhabit/backend/internal/contracts/salesfunnel"
	"nuhabit/backend/internal/modules/salesfunnel"
	"nuhabit/backend/internal/platform/testutil"
)

func TestQuotations(t *testing.T) {
	e := newEnv(t)
	s := e.seller()
	dealID, _ := e.deal(s)
	base := "/api/sales-funnel/deals/" + dealID + "/quotations"

	r := e.do(&s, "POST", base, map[string]any{"items": []any{map[string]any{"item_type": "produk", "description": "Paket", "qty": 1, "unit_price": 1}},
		"terms": []any{map[string]any{"label": "DP", "percent": 50}}})
	e.expect(r, 400, "Validation failed")
	for _, want := range []string{"Baris produk wajib memilih produk katalog", "Total persentase termin harus tepat 100%"} {
		if !strings.Contains(r.Raw, want) {
			t.Fatalf("missing %q: %s", want, r.Raw)
		}
	}

	var product string
	e.tx.QueryRow(e.ctx, `INSERT INTO pos.pos_products (sku, name, base_price) VALUES ($1, 'Paket Makan', 20000) RETURNING id::text`,
		"GO-"+testutil.RandomHex(4)).Scan(&product)
	payload := map[string]any{"use_ppn": true, "ppn_persen": 11, "discount_percent": 10, "valid_until": "",
		"items": []any{
			map[string]any{"item_type": "produk", "product_id": product, "description": "Paket Makan", "qty": 50, "unit_price": 20000},
			map[string]any{"description": "Sewa venue", "qty": 1, "unit_price": 1000000},
		},
		"terms": []any{map[string]any{"label": "DP", "percent": 33.33}, map[string]any{"label": "Termin", "percent": 33.33},
			map[string]any{"label": "Pelunasan", "percent": 33.34, "due_date": "2026-12-01"}}}
	r = e.do(&s, "POST", base, payload)
	e.expect(r, 201, "")
	qid := r.data()["id"].(string)
	number := r.data()["quote_number"].(string)
	if r.Body["message"] != "Quotation "+number+" dibuat" || r.data()["total"] != "1998000.00" {
		t.Fatalf("create %s", r.Raw)
	}
	if e.scalar(`SELECT value_estimate::text FROM crm.crm_sales_deals WHERE id = $1`, dealID) != "1998000.00" {
		t.Fatal("deal estimate follows the quotation")
	}
	if e.events(contract.TopicQuotationPriced, qid) != 1 || e.events(contract.TopicCrmEventRaised, "quotation:"+qid) != 1 {
		t.Fatal("quotation events")
	}

	r = e.do(&s, "GET", base, nil)
	q := r.list()[0].(map[string]any)
	if len(q["items"].([]any)) != 2 || len(q["terms"].([]any)) != 3 || q["approval_status"] != "none" {
		t.Fatalf("list %s", r.Raw)
	}

	// discount approval pending blocks sending
	e.exec(`UPDATE crm.crm_sales_quotations SET approval_status = 'pending' WHERE id = $1`, qid)
	e.expect(e.do(&s, "PATCH", "/api/sales-funnel/quotations/"+qid, map[string]any{"status": "terkirim"}), 409,
		"Quotation menunggu approval diskon — belum boleh dikirim/diterima")
	e.expect(e.do(&s, "POST", "/api/sales-funnel/quotations/"+qid+"/send-wa", nil), 409,
		"Quotation menunggu approval diskon — belum boleh dikirim")
	e.exec(`UPDATE crm.crm_sales_quotations SET approval_status = 'approved' WHERE id = $1`, qid)
	e.expect(e.do(&s, "PATCH", "/api/sales-funnel/quotations/"+qid, map[string]any{}), 400, "Tidak ada field yang diubah")

	r = e.do(&s, "POST", "/api/sales-funnel/quotations/"+qid+"/send-wa", nil)
	e.expect(r, 200, "Quotation terkirim ke Budi")
	if !strings.HasPrefix(e.waSent[0]["message"], "*PENAWARAN "+number+"*\n") ||
		!strings.Contains(e.waSent[0]["message"], "• Paket Makan — 50 pax @ Rp20.000 = *Rp1.000.000*") {
		t.Fatalf("wa %q", e.waSent[0]["message"])
	}
	if e.scalar(`SELECT status FROM crm.crm_sales_quotations WHERE id = $1`, qid) != "terkirim" {
		t.Fatal("draft becomes terkirim")
	}

	r = e.do(&s, "POST", "/api/sales-funnel/quotations/"+qid+"/realize", nil)
	e.expect(r, 409, "Hanya quotation berstatus Diterima yang bisa direalisasi")
	r = e.do(&s, "PATCH", "/api/sales-funnel/quotations/"+qid, map[string]any{"status": "diterima"})
	e.expect(r, 200, "Quotation diperbarui")
	r = e.do(&s, "POST", "/api/sales-funnel/quotations/"+qid+"/realize", map[string]any{})
	e.expect(r, 409, "Stok bahan baku tidak mencukupi")
	if r.Raw != `{"success":false,"error":"Stok bahan baku tidak mencukupi","shortages":[],"warnings":["Produk \"Paket Makan\" belum punya resep — tidak ada bahan yang dipotong untuknya","Tidak ada resep produk yang bisa dipotong — lanjutkan tanpa potong BOM?"]}` {
		t.Fatalf("realize %s", r.Raw)
	}

	// a recipe without stock is a shortage; with stock it is deducted
	var material string
	e.tx.QueryRow(e.ctx, `INSERT INTO item.raw_materials (kode, nama, kategori) VALUES ($1, 'Beras', 'bahan') RETURNING id::text`,
		"GO-"+testutil.RandomHex(4)).Scan(&material)
	e.exec(`INSERT INTO pos.pos_recipes (product_id, raw_material_id, quantity_per_unit, unit_of_measure, waste_percentage, is_active)
		VALUES ($1, $2, 0.2, 'kg', 10, true)`, product, material)
	r = e.do(&s, "POST", "/api/sales-funnel/quotations/"+qid+"/realize", map[string]any{})
	e.expect(r, 409, "Stok bahan baku tidak mencukupi")
	if !strings.Contains(r.Raw, `"shortages":[{"raw_material_id":"`+material+`","needed":11,"available":0,"kode":"GO-`) {
		t.Fatalf("shortage %s", r.Raw)
	}
	e.exec(`INSERT INTO inventory.inventory (raw_material_id, branch_id, qty_available, qty_on_order, qty_minimum, is_active)
		VALUES ($1, $2, 14, 0, 0, true)`, material, e.branchID)
	r = e.do(&s, "POST", "/api/sales-funnel/quotations/"+qid+"/realize", map[string]any{})
	e.expect(r, 200, "Realisasi selesai — 1 pergerakan stok dicatat")
	if r.Raw != `{"success":true,"data":{"bomStatus":"terpotong","movedCount":1,"warnings":[]},"message":"Realisasi selesai — 1 pergerakan stok dicatat"}` {
		t.Fatalf("realized %s", r.Raw)
	}
	if e.scalar(`SELECT sum(qty_available)::text FROM inventory.inventory WHERE raw_material_id = $1`, material) != "3.000" {
		t.Fatal("stock deducted")
	}
	e.expect(e.do(&s, "PATCH", "/api/sales-funnel/quotations/"+qid, map[string]any{"payload": payload}), 409,
		"Quotation sudah direalisasi — isi tidak bisa diubah")
	e.expect(e.do(&s, "DELETE", "/api/sales-funnel/quotations/"+qid, nil), 409, "Quotation sudah direalisasi — tidak bisa dihapus")

	r = e.do(&s, "POST", "/api/sales-funnel/quotations/"+qid+"/revise", nil)
	e.expect(r, 201, "Revisi v2 dibuat")
	revision := r.data()["id"].(string)
	if e.scalar(`SELECT count(*)::int FROM crm.crm_sales_quotation_items WHERE quotation_id = $1`, revision) != int32(2) ||
		e.scalar(`SELECT status FROM crm.crm_sales_quotations WHERE id = $1`, qid) != "diterima" {
		t.Fatal("revision copies items; a realised source keeps its status")
	}
	e.expect(e.do(&s, "DELETE", "/api/sales-funnel/quotations/"+revision, nil), 204, "")
}

func TestBilling(t *testing.T) {
	e := newEnv(t)
	s := e.seller()
	dealID, _ := e.deal(s)
	e.exec(`INSERT INTO crm.crm_sales_quotations (company_id, branch_id, deal_id, quote_number, total, status)
		VALUES ($1, $2, $3, $4, 10000000, 'diterima')`, e.companyID, e.branchID, dealID, "QT-GO-"+testutil.RandomHex(3))
	qid := e.scalar(`SELECT id::text FROM crm.crm_sales_quotations WHERE deal_id = $1`, dealID).(string)
	e.exec(`INSERT INTO crm.crm_sales_quotation_terms (quotation_id, label, percent, sort_order) VALUES ($1, 'DP', 50, 0), ($1, 'Pelunasan', 50, 1)`, qid)
	term := e.scalar(`SELECT id::text FROM crm.crm_sales_quotation_terms WHERE quotation_id = $1 AND sort_order = 0`, qid).(string)

	base := "/api/sales-funnel/deals/" + dealID
	e.expect(e.do(&s, "POST", base+"/invoices", map[string]any{"label": "DP", "amount": 1, "due_date": "2026-02-30"}), 400, "Validation failed")
	r := e.do(&s, "POST", base+"/invoices", map[string]any{"term_id": term, "label": "DP 50%", "amount": 5000000.004, "due_date": ""})
	e.expect(r, 201, "")
	invoiceID := r.data()["id"].(string)
	if !strings.HasPrefix(r.Body["message"].(string), "Pengajuan invoice INV-") {
		t.Fatalf("invoice %s", r.Raw)
	}
	e.expect(e.do(&s, "POST", base+"/invoices", map[string]any{"term_id": term, "label": "lagi", "amount": 1}), 409, "Termin ini sudah memiliki invoice aktif")

	r = e.do(&s, "GET", base+"/invoices", nil)
	e.expect(r, 200, "")
	if !strings.Contains(r.Raw, `"amount":5000000,"due_date":null`) || !strings.Contains(r.Raw, `"paid":0,"created_at":`) || !strings.Contains(r.Raw, `"payment_status":"belum"}`) ||
		!strings.Contains(r.Raw, `"available_terms":[{"term_id":"`+term+`","label":"DP","percent":50,"amount":5000000,"due_date":null,"invoiced":true}`) {
		t.Fatalf("invoices %s", r.Raw)
	}

	// recording payments is finance-only
	e.expect(e.do(&s, "POST", base+"/payments", map[string]any{"amount": 1, "paid_on": "2026-10-01"}), 403, "Insufficient permissions")
	fin := e.staff("finance_staff", "accounting")
	e.expect(e.do(&fin, "POST", base+"/payments", map[string]any{"amount": 1, "paid_on": "2026-02-30"}), 400, "Validation failed")
	r = e.do(&fin, "POST", base+"/payments", map[string]any{"amount": 3000000, "paid_on": "2026-10-01", "invoice_id": invoiceID})
	e.expect(r, 201, "Pembayaran tercatat")
	payment := r.data()["id"].(string)
	r = e.do(&s, "GET", base+"/payments", nil)
	e.expect(r, 200, "")
	if !strings.Contains(r.Raw, `"summary":{"reference_total":10000000,"reference_quote_number":"QT-GO-`) ||
		!strings.Contains(r.Raw, `"total_paid":3000000,"outstanding":7000000}`) ||
		!strings.Contains(r.Raw, `"terms":[{"label":"DP","due_date":null,"percent":50,"amount":5000000,"paid":3000000,"status":"sebagian"}`) {
		t.Fatalf("payments %s", r.Raw)
	}
	e.expect(e.do(&fin, "PATCH", "/api/sales-funnel/invoices/"+invoiceID, map[string]any{"status": "batal"}), 409,
		"Invoice sudah menerima pembayaran — tidak bisa dibatalkan")
	e.expect(e.do(&s, "DELETE", "/api/sales-funnel/invoices/"+invoiceID, nil), 409, "Invoice sudah menerima pembayaran — tidak bisa dihapus")
	e.expect(e.do(&fin, "DELETE", base+"/payments/"+payment, nil), 204, "")
	e.expect(e.do(&fin, "DELETE", base+"/payments/"+payment, nil), 404, "Catatan pembayaran tidak ditemukan")

	r = e.do(&fin, "PATCH", "/api/sales-funnel/invoices/"+invoiceID, map[string]any{"status": "terkirim"})
	e.expect(r, 200, "")
	ar := e.scalar(`SELECT invoice_no FROM accounting.ar_invoices WHERE sales_invoice_id = $1`, invoiceID)
	if r.Body["message"] != "Invoice diperbarui (AR "+ar.(string)+")" || r.data()["status"] != "terkirim" {
		t.Fatalf("issue %s", r.Raw)
	}
	e.expect(e.do(&s, "DELETE", "/api/sales-funnel/invoices/"+invoiceID, nil), 204, "")
	e.expect(e.do(&s, "DELETE", "/api/sales-funnel/invoices/"+invoiceID, nil), 404, "Invoice tidak ditemukan")
}

func TestForecastReportsTargets(t *testing.T) {
	e := newEnv(t)
	admin := e.seller()
	dealID, _ := e.deal(admin)
	e.exec(`UPDATE crm.crm_sales_deals SET value_estimate = 4000000, event_date = '2026-10-15' WHERE id = $1`, dealID)

	e.expect(e.do(&admin, "GET", "/api/sales-funnel/forecast?month=10-2026", nil), 400, "month: YYYY-MM")
	r := e.do(&admin, "PUT", "/api/sales-funnel/targets", map[string]any{"targets": []any{
		map[string]any{"user_id": nil, "period_month": "2026-10", "target_value": 80000000, "target_deals": 5},
		map[string]any{"user_id": admin.UserID, "period_month": "2026-10", "target_value": 30000000},
	}})
	e.expect(r, 200, "2 target disimpan")
	e.expect(e.do(&admin, "PUT", "/api/sales-funnel/targets", map[string]any{"targets": []any{map[string]any{"period_month": "2026-9", "target_value": 1}}}),
		400, "Validation failed")
	r = e.do(&admin, "GET", "/api/sales-funnel/targets?month=2026-10", nil)
	if len(r.list()) < 2 || r.list()[0].(map[string]any)["user_id"] != nil {
		t.Fatalf("targets %s", r.Raw)
	}
	r = e.do(&admin, "GET", "/api/sales-funnel/forecast?month=2026-10", nil)
	e.expect(r, 200, "")
	if !strings.HasPrefix(r.Raw, `{"success":true,"data":{"month":"2026-10","rows":[`) ||
		!strings.Contains(r.Raw, `"company_target":{"target_value":`) || !strings.Contains(r.Raw, `"company_target_set":true}`) ||
		!strings.Contains(r.Raw, `"id":"`+dealID+`","title":"Gathering"`) {
		t.Fatalf("forecast %s", r.Raw)
	}

	r = e.do(&admin, "GET", "/api/sales-funnel/reports?from=2026-01-01&to=2026-12-31", nil)
	e.expect(r, 200, "")
	if !strings.HasPrefix(r.Raw, `{"success":true,"data":{"period":{"from":"2026-01-01","to":"2026-12-31"},"funnel":[`) ||
		!strings.Contains(r.Raw, `"summary":{"total_created":`) || !strings.HasSuffix(r.Raw, `]}}`) {
		t.Fatalf("report %s", r.Raw)
	}
	summary := r.data()["summary"].(map[string]any)
	if _, isNum := summary["total_created"].(float64); !isNum {
		t.Fatalf("summary counts are numbers %v", summary)
	}
}

func TestRecordsService(t *testing.T) {
	e := newEnv(t)
	s := e.seller()
	dealID, leadID := e.deal(s)
	var rec salesfunnel.Records
	ctx := e.ctx
	if err := rec.SetLeadScore(ctx, e.tx, leadID, 42, `[{"rule":"x","points":42}]`); err != nil {
		t.Fatal(err)
	}
	super := e.staff("super_admin", "sales-funnel")
	if err := rec.SetOwner(ctx, e.tx, "deal", dealID, super.UserID); err != nil {
		t.Fatal(err)
	}
	temp := "panas"
	if err := rec.UpdateField(ctx, e.tx, "lead", leadID, "temperature", &temp); err != nil {
		t.Fatal(err)
	}
	if err := rec.SetOwner(ctx, e.tx, "nope", dealID, super.UserID); err == nil {
		t.Fatal("unknown object")
	}
	if e.scalar(`SELECT score::text || '|' || temperature FROM crm.crm_sales_leads WHERE id = $1`, leadID) != "42|panas" ||
		e.scalar(`SELECT owner_user_id::text FROM crm.crm_sales_deals WHERE id = $1`, dealID) != super.UserID {
		t.Fatal("records writes")
	}
	// Text values reach PostgreSQL untyped and coerce like node-postgres'.
	for field, v := range map[string]string{"pax_estimate": "12", "is_event_date_fixed": "true"} {
		if err := rec.UpdateField(ctx, e.tx, "deal", dealID, field, &v); err != nil {
			t.Fatalf("%s: %v", field, err)
		}
	}
	if e.scalar(`SELECT pax_estimate::text || '|' || is_event_date_fixed::text FROM crm.crm_sales_deals WHERE id = $1`, dealID) != "12|true" {
		t.Fatal("coerced update_field")
	}
}

func TestRecordsQuotationApprovalAndFormLeads(t *testing.T) {
	e := newEnv(t)
	s := e.seller()
	dealID, _ := e.deal(s)
	var rec salesfunnel.Records
	ctx := e.ctx
	var qid string
	if err := e.tx.QueryRow(ctx, `INSERT INTO crm.crm_sales_quotations (company_id, branch_id, deal_id, quote_number, subtotal, total)
		VALUES ($1, $2, $3, 'Q-'||$4, 100, 100) RETURNING id::text`, e.companyID, e.branchID, dealID, testutil.RandomHex(3)).Scan(&qid); err != nil {
		t.Fatal(err)
	}
	if err := rec.SetQuotationApproval(ctx, e.tx, qid, "none", nil); err != nil {
		t.Fatal(err)
	}
	if e.scalar(`SELECT approval_status || '|' || (approval_request_id IS NULL)::text FROM crm.crm_sales_quotations WHERE id = $1`, qid) != "none|true" {
		t.Fatal("approval link")
	}

	phone, org := "62"+localPhone()[1:], "PT Form "+testutil.RandomHex(3)
	pic, campaign := "Ani", "oktober"
	id, err := rec.CreateFormLead(ctx, e.tx, salesfunnel.FormLead{CompanyID: e.companyID, BranchID: &e.branchID, OrgName: org,
		OrgType: "lainnya", Source: "instagram", PicName: &pic, PicPhone: &phone, Custom: "{}", UtmCampaign: &campaign})
	if err != nil {
		t.Fatal(err)
	}
	if dup, err := rec.DuplicateLead(ctx, e.tx, e.companyID, phone, strings.ToUpper(org)); err != nil || dup != id {
		t.Fatalf("duplicate %q %v", dup, err)
	}
	if dup, _ := rec.DuplicateLead(ctx, e.tx, e.companyID, phone, "lain"); dup != "" {
		t.Fatal("other org is no duplicate")
	}
	for _, note := range []string{"satu", "dua"} {
		if err := rec.AppendLeadNote(ctx, e.tx, id, note); err != nil {
			t.Fatal(err)
		}
	}
	if got := e.scalar(`SELECT temperature || '|' || status || '|' || utm_campaign || '|' || notes FROM crm.crm_sales_leads WHERE id = $1`, id); got != "hangat|baru|oktober|satu\n\ndua" {
		t.Fatalf("form lead %q", got)
	}
}
