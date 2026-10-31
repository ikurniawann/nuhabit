package salesfunnel_test

import "testing"

func TestDocumentReads(t *testing.T) {
	e := newEnv(t)
	s := e.seller()
	nomenu := e.staff("admin", "dashboard")
	dealID, leadID := e.deal(s)
	e.exec(`UPDATE crm.crm_sales_leads SET pic_title = 'HRD', pic_email = 'budi@maju.id' WHERE id = $1`, leadID)
	r := e.do(&s, "POST", "/api/sales-funnel/deals/"+dealID+"/quotations", map[string]any{
		"items": []any{map[string]any{"description": "Sewa venue", "qty": 1, "unit_price": 1000000}},
		"terms": []any{map[string]any{"label": "DP", "percent": 50}, map[string]any{"label": "Pelunasan", "percent": 50}}})
	e.expect(r, 201, "")
	qid := r.data()["id"].(string)

	for _, path := range []string{"/api/sales-funnel/deals/" + dealID, "/api/sales-funnel/quotations/" + qid} {
		e.expect(e.do(nil, "GET", path, nil), 401, "Authentication required")
		e.expect(e.do(&nomenu, "GET", path, nil), 403, "Insufficient permissions")
	}
	e.expect(e.do(&s, "GET", "/api/sales-funnel/deals/x", nil), 400, "ID tidak valid")
	e.expect(e.do(&s, "GET", "/api/sales-funnel/quotations/x", nil), 400, "ID tidak valid")
	e.expect(e.do(&s, "GET", "/api/sales-funnel/deals/00000000-0000-0000-0000-000000000000", nil), 404, "Deal tidak ditemukan")
	e.expect(e.do(&s, "GET", "/api/sales-funnel/quotations/00000000-0000-0000-0000-000000000000", nil), 404, "Quotation tidak ditemukan")

	r = e.do(&s, "GET", "/api/sales-funnel/deals/"+dealID, nil)
	e.expect(r, 200, "")
	deal := r.data()
	company := e.scalar(`SELECT name FROM configuration.companies WHERE id = $1`, e.companyID)
	if deal["id"] != dealID || deal["title"] != "Gathering" || deal["pic_name"] != "Budi" || deal["pic_title"] != "HRD" ||
		deal["pic_email"] != "budi@maju.id" || deal["company_id"] != e.companyID || deal["company_name"] != company || deal["branch_name"] == nil {
		t.Fatalf("deal %s", r.Raw)
	}

	r = e.do(&s, "GET", "/api/sales-funnel/quotations/"+qid, nil)
	e.expect(r, 200, "")
	q := r.data()
	if q["id"] != qid || q["deal_id"] != dealID || q["company_id"] != e.companyID || q["status"] != "draft" ||
		len(q["items"].([]any)) != 1 || len(q["terms"].([]any)) != 2 {
		t.Fatalf("quotation %s", r.Raw)
	}
	e.expect(e.do(&s, "DELETE", "/api/sales-funnel/quotations/"+qid, nil), 204, "")
	e.expect(e.do(&s, "GET", "/api/sales-funnel/quotations/"+qid, nil), 404, "Quotation tidak ditemukan")
}
