package salesfunnel_test

import (
	"net/url"
	"strings"
	"testing"
	"time"

	contract "nuhabit/backend/internal/contracts/salesfunnel"
	"nuhabit/backend/internal/platform/testutil"
)

func TestGuards(t *testing.T) {
	e := newEnv(t)
	e.expect(e.do(nil, "GET", "/api/sales-funnel/leads", nil), 401, "Authentication required")
	nomenu := e.staff("admin", "dashboard")
	e.expect(e.do(&nomenu, "GET", "/api/sales-funnel/leads", nil), 403, "Insufficient permissions")
	unscoped := testutil.CreateStaff(t, testutil.StaffOptions{Role: "admin", Menus: map[string][]string{"sales-funnel": {"read"}}})
	e.expect(e.do(&unscoped, "GET", "/api/sales-funnel/leads", nil), 403, "Scope bisnis user belum dikonfigurasi — hubungi admin")
	cashier := e.staff("pos", "sales-funnel")
	e.expect(e.do(&cashier, "POST", "/api/sales-funnel/pipelines", map[string]any{}), 403, "Hanya admin/super admin yang boleh membuat pipeline")
	e.expect(e.do(&cashier, "GET", "/api/sales-funnel/recipes?product_id=x", nil), 403, "Insufficient permissions")
	r := e.do(&cashier, "POST", "/api/sales-funnel/leads", "{bad")
	e.expect(r, 500, "Terjadi kesalahan server")
}

func TestLeadLifecycle(t *testing.T) {
	e := newEnv(t)
	s := e.seller()

	r := e.do(&s, "POST", "/api/sales-funnel/leads", map[string]any{"org_name": "", "pic_name": "B", "pic_phone": "081", "pic_email": "x", "source": "tv"})
	e.expect(r, 400, "Validation failed")
	details, _ := r.Body["details"].([]any)
	var paths []string
	for _, d := range details {
		is := d.(map[string]any)
		paths = append(paths, is["path"].([]any)[0].(string)+":"+is["code"].(string))
	}
	if strings.Join(paths, ",") != "org_name:too_small,pic_phone:too_small,pic_email:invalid_format,source:invalid_value" {
		t.Fatalf("issues %v", paths)
	}

	org := "PT Maju " + testutil.RandomHex(3)
	id, phone := e.lead(s, org)
	r = e.do(&s, "POST", "/api/sales-funnel/leads", map[string]any{"org_name": strings.ToUpper(org), "pic_name": "B", "pic_phone": "0" + phone[2:]})
	e.expect(r, 409, "Lead instansi ini dengan PIC yang sama sudah ada")
	if e.events(contract.TopicCrmEventRaised, "lead:"+id) != 1 {
		t.Fatal("lead.created must be published")
	}
	// account/contact sync linked the lead
	if e.scalar(`SELECT account_id IS NOT NULL AND contact_id IS NOT NULL FROM crm.crm_sales_leads WHERE id = $1`, id) != true {
		t.Fatal("account/contact sync")
	}

	r = e.do(&s, "GET", "/api/sales-funnel/leads?q="+url.QueryEscape(org)+"&limit=1", nil)
	e.expect(r, 200, "")
	if !strings.HasPrefix(r.Raw, `{"success":true,"data":[{"id":`) || !strings.Contains(r.Raw, `"pagination":{"page":1,"limit":1,"total":`) {
		t.Fatalf("list %s", r.Raw)
	}
	row := r.list()[0].(map[string]any)
	if _, ok := row["total_count"]; ok || row["owner_user_id"] != nil || row["score"] != float64(0) {
		t.Fatalf("row %v", row)
	}

	r = e.do(&s, "GET", "/api/sales-funnel/leads/by-phone?phone=%2B"+phone, nil)
	e.expect(r, 200, "")
	if !strings.HasPrefix(r.Raw, `{"success":true,"data":{"pic":{"name":"Budi","title":null,"email":null},"leads":[{"id":"`+id) {
		t.Fatalf("by-phone %s", r.Raw)
	}
	e.expect(e.do(&s, "GET", "/api/sales-funnel/leads/by-phone?phone=123", nil), 200, "")

	r = e.do(&s, "PATCH", "/api/sales-funnel/leads/"+id, map[string]any{"status": "dihubungi", "pic_email": ""})
	e.expect(r, 200, "Lead diperbarui")
	if r.data()["status"] != "dihubungi" {
		t.Fatalf("patch %s", r.Raw)
	}
	e.expect(e.do(&s, "PATCH", "/api/sales-funnel/leads/"+id, map[string]any{}), 400, "Tidak ada field yang diubah")

	r = e.do(&s, "GET", "/api/sales-funnel/leads/"+id, nil)
	e.expect(r, 200, "")
	if !strings.HasPrefix(r.Raw, `{"success":true,"data":{"lead":{"id":"`+id) || !strings.Contains(r.Raw, `"customer":null,"recent_orders":[]}`) {
		t.Fatalf("detail %s", r.Raw)
	}

	r = e.do(&s, "POST", "/api/sales-funnel/leads/"+id+"/link-customer", map[string]any{})
	e.expect(r, 400, "Validation failed")
	r = e.do(&s, "POST", "/api/sales-funnel/leads/"+id+"/link-customer", map[string]any{"create_from_pic": true})
	e.expect(r, 200, "PIC tertaut ke member loyalty")
	customer := r.data()["customer_id"].(string)
	r = e.do(&s, "GET", "/api/sales-funnel/leads/"+id, nil)
	if !strings.Contains(r.Raw, `"customer":{"id":"`+customer) {
		t.Fatalf("detail with member %s", r.Raw)
	}
	r = e.do(&s, "DELETE", "/api/sales-funnel/leads/"+id+"/link-customer", nil)
	e.expect(r, 200, "Tautan member dilepas")
	if r.Raw != `{"success":true,"data":{"customer_id":null},"message":"Tautan member dilepas"}` {
		t.Fatalf("unlink %s", r.Raw)
	}

	// a branch-scoped user of another branch cannot reach the lead
	e.exec(`SAVEPOINT scope`)
	e.exec(`WITH b AS (INSERT INTO configuration.branches (company_id, name, code) VALUES ($1, 'Go Test', $2) RETURNING id)
		UPDATE configuration.users SET business_scope = 'branch', branch_id = (SELECT id FROM b) WHERE id = $3`,
		e.companyID, "GT"+testutil.RandomHex(3), s.UserID)
	e.expect(e.do(&s, "GET", "/api/sales-funnel/leads/"+id, nil), 403, "Insufficient permissions")
	e.exec(`ROLLBACK TO SAVEPOINT scope`)
	e.expect(e.do(&s, "DELETE", "/api/sales-funnel/leads/"+id, nil), 204, "")
	e.expect(e.do(&s, "GET", "/api/sales-funnel/leads/"+id, nil), 404, "Lead tidak ditemukan")
}

func TestDealLifecycle(t *testing.T) {
	e := newEnv(t)
	s := e.seller()
	leadID, _ := e.lead(s, "PT Deal "+testutil.RandomHex(3))
	r := e.do(&s, "POST", "/api/sales-funnel/deals", map[string]any{"lead_id": leadID, "title": "Gathering", "event_date": "2026-02-30"})
	e.expect(r, 400, "Tanggal acara tidak valid")
	r = e.do(&s, "POST", "/api/sales-funnel/deals", map[string]any{"lead_id": leadID, "title": "Gathering", "event_type": "gathering", "pax_estimate": 50})
	e.expect(r, 201, "")
	if !strings.HasSuffix(r.Body["message"].(string), "berhasil dibuat") || !strings.HasPrefix(r.Raw, `{"success":true,"data":{"id":"`) {
		t.Fatalf("create %s", r.Raw)
	}
	dealID := r.data()["id"].(string)
	if e.scalar(`SELECT status FROM crm.crm_sales_leads WHERE id = $1`, leadID) != "qualified" {
		t.Fatal("lead must become qualified")
	}
	if e.scalar(`SELECT count(*)::int FROM crm.crm_sales_deal_stage_history WHERE deal_id = $1`, dealID) != int32(1) {
		t.Fatal("stage history")
	}

	r = e.do(&s, "GET", "/api/sales-funnel/deals?q=Gathering", nil)
	e.expect(r, 200, "")
	if !strings.Contains(r.Raw, `"id":"`+dealID+`"`) || !strings.Contains(r.Raw, `"stage_name":`) {
		t.Fatalf("list %s", r.Raw)
	}

	var wonStage, lostStage string
	pipeline := e.scalar(`SELECT pipeline_id::text FROM crm.crm_sales_deals WHERE id = $1`, dealID).(string)
	_ = e.tx.QueryRow(e.ctx, `SELECT (SELECT id::text FROM crm.crm_sales_stages WHERE pipeline_id = $1 AND is_won LIMIT 1),
		(SELECT id::text FROM crm.crm_sales_stages WHERE pipeline_id = $1 AND is_lost LIMIT 1)`, pipeline).Scan(&wonStage, &lostStage)
	e.expect(e.do(&s, "PATCH", "/api/sales-funnel/deals/"+dealID, map[string]any{"stage_id": wonStage}), 400, "Deal Menang wajib diisi nilai final")
	e.expect(e.do(&s, "PATCH", "/api/sales-funnel/deals/"+dealID, map[string]any{"stage_id": lostStage}), 400, "Deal Kalah wajib pilih alasan kalah")
	r = e.do(&s, "PATCH", "/api/sales-funnel/deals/"+dealID, map[string]any{"stage_id": wonStage, "value_final": 7500000, "event_date": "2026-11-07"})
	e.expect(r, 200, "Deal diperbarui")
	if r.data()["closed_at"] == nil {
		t.Fatalf("won deal must close %s", r.Raw)
	}
	if e.scalar(`SELECT forecast_category || '|' || is_event_date_fixed::text FROM crm.crm_sales_deals WHERE id = $1`, dealID) != "closed_won|true" {
		t.Fatal("won columns")
	}
	if e.events(contract.TopicCrmEventRaised, "deal:"+dealID) != 2 {
		t.Fatal("deal.created + deal.stage_changed")
	}

	// deal team
	e.expect(e.do(&s, "POST", "/api/sales-funnel/deals/"+dealID+"/members", map[string]any{"user_id": s.UserID}), 400,
		"Penanggung jawab harus user ber-role sales atau super admin")
	super := e.staff("super_admin", "sales-funnel")
	r = e.do(&s, "POST", "/api/sales-funnel/deals/"+dealID+"/members", map[string]any{"user_id": super.UserID, "split_percent": 40})
	e.expect(r, 201, "Anggota tim ditambahkan")
	memberID := r.data()["id"].(string)
	if r.data()["split_percent"] != "40.00" || r.data()["role"] != "support" {
		t.Fatalf("member %s", r.Raw)
	}
	r = e.do(&s, "GET", "/api/sales-funnel/deals/"+dealID+"/members", nil)
	if len(r.list()) != 1 {
		t.Fatalf("members %s", r.Raw)
	}
	e.expect(e.do(&s, "DELETE", "/api/sales-funnel/deals/"+dealID+"/members", nil), 400, "member_id wajib")
	e.expect(e.do(&s, "DELETE", "/api/sales-funnel/deals/"+dealID+"/members?member_id="+memberID, nil), 204, "")

	// quick WhatsApp
	e.expect(e.do(&s, "POST", "/api/sales-funnel/deals/"+dealID+"/send-wa", map[string]any{}), 400, "Validation failed")
	r = e.do(&s, "POST", "/api/sales-funnel/deals/"+dealID+"/send-wa", map[string]any{"message": "Halo {pic}, {acara} tanggal {tanggal_acara}"})
	e.expect(r, 200, "Pesan terkirim ke Budi")
	if r.Raw != `{"success":true,"data":{"message_id":"wamid-1"},"message":"Pesan terkirim ke Budi"}` {
		t.Fatalf("send %s", r.Raw)
	}
	if len(e.waSent) != 1 || e.waSent[0]["message"] != "Halo Budi, gathering tanggal Sabtu, 7 November 2026" {
		t.Fatalf("sent %v", e.waSent)
	}
	e.expect(e.do(&s, "POST", "/api/sales-funnel/deals/"+dealID+"/send-wa", map[string]any{"message": "lagi"}), 429,
		"Tunggu sebentar — pesan ke PIC deal ini baru saja dikirim")

	e.expect(e.do(&s, "DELETE", "/api/sales-funnel/deals/"+dealID, nil), 204, "")
	e.expect(e.do(&s, "PATCH", "/api/sales-funnel/deals/"+dealID, map[string]any{"title": "x"}), 404, "Deal tidak ditemukan")
}

func TestTasks(t *testing.T) {
	e := newEnv(t)
	s := e.seller()
	dealID, leadID := e.deal(s)

	e.expect(e.do(&s, "POST", "/api/sales-funnel/activities", map[string]any{"title": "x"}), 400, "Validation failed")
	r := e.do(&s, "POST", "/api/sales-funnel/activities", map[string]any{"subject_type": "deal", "subject_id": dealID,
		"recurrence": map[string]any{"freq": "weekly"}})
	e.expect(r, 400, "Validation failed")
	if !strings.Contains(r.Raw, "Task berulang wajib punya jatuh tempo") {
		t.Fatalf("refine %s", r.Raw)
	}
	r = e.do(&s, "POST", "/api/sales-funnel/activities", map[string]any{"deal_id": dealID, "title": "Follow up",
		"due_at": "2026-09-15T09:00:00+07:00", "reminder_at": "2026-09-15T08:00:00+07:00", "priority": "high",
		"recurrence": map[string]any{"freq": "weekly"}})
	e.expect(r, 201, "Task dicatat")
	taskID := r.data()["id"].(string)
	if r.data()["due_at"] != "2026-09-15T02:00:00.000Z" || r.data()["done_at"] != nil || r.data()["priority"] != "high" {
		t.Fatalf("task %s", r.Raw)
	}

	r = e.do(&s, "GET", "/api/sales-funnel/activities?lead_id="+leadID, nil)
	e.expect(r, 200, "")
	r = e.do(&s, "GET", "/api/sales-funnel/activities?deal_id="+dealID, nil)
	if len(r.list()) != 1 || r.list()[0].(map[string]any)["subject_name"] != "Gathering" {
		t.Fatalf("subject list %s", r.Raw)
	}
	e.expect(e.do(&s, "GET", "/api/sales-funnel/activities?view=range&from=x", nil), 400, "view=range membutuhkan from & to (YYYY-MM-DD)")
	r = e.do(&s, "GET", "/api/sales-funnel/activities?view=range&from=2026-09-01&to=2026-09-30&status=open_all", nil)
	if !strings.Contains(r.Raw, taskID) {
		t.Fatalf("agenda %s", r.Raw)
	}

	e.expect(e.do(&s, "PATCH", "/api/sales-funnel/activities/"+taskID, map[string]any{"done_at": "x"}), 400, "Validation failed")
	r = e.do(&s, "PATCH", "/api/sales-funnel/activities/"+taskID, map[string]any{"is_done": true})
	e.expect(r, 200, "Task selesai — kemunculan berikutnya dijadwalkan")
	next, _ := r.data()["next_task_id"].(string)
	if next == "" || r.data()["status"] != "done" {
		t.Fatalf("done %s", r.Raw)
	}
	var due, reminder time.Time
	_ = e.tx.QueryRow(e.ctx, `SELECT due_at, reminder_at FROM crm.crm_sales_activities WHERE id = $1 AND parent_task_id = $2`, next, taskID).Scan(&due, &reminder)
	if !due.Equal(time.Date(2026, 9, 22, 2, 0, 0, 0, time.UTC)) || due.Sub(reminder) != time.Hour {
		t.Fatalf("next occurrence %v %v", due, reminder)
	}
	r = e.do(&s, "PATCH", "/api/sales-funnel/activities/"+taskID, map[string]any{"is_done": true})
	if r.data()["next_task_id"] != next {
		t.Fatalf("idempotent successor %s", r.Raw)
	}
	e.expect(e.do(&s, "DELETE", "/api/sales-funnel/activities/"+taskID, nil), 204, "")
	e.expect(e.do(&s, "DELETE", "/api/sales-funnel/activities/"+taskID, nil), 404, "Aktivitas tidak ditemukan")

	r = e.do(&s, "GET", "/api/sales-funnel/timeline?subject_type=lead&subject_id="+leadID, nil)
	e.expect(r, 200, "")
	if !strings.Contains(r.Raw, `"key":"deal:`+dealID+`"`) || !strings.Contains(r.Raw, `"kind":"stage"`) {
		t.Fatalf("timeline %s", r.Raw)
	}
	e.expect(e.do(&s, "GET", "/api/sales-funnel/timeline?subject_type=lead", nil), 400, "subject_type & subject_id wajib")
}

func TestAccountsAndContacts(t *testing.T) {
	e := newEnv(t)
	s := e.seller()
	name := "PT Akun " + testutil.RandomHex(3)
	r := e.do(&s, "POST", "/api/sales-funnel/accounts", map[string]any{"name": name, "account_type": "sekolah", "phone": "", "custom": map[string]any{}})
	e.expect(r, 201, "Account dibuat")
	accountID := r.data()["id"].(string)
	r = e.do(&s, "POST", "/api/sales-funnel/accounts", map[string]any{"name": strings.ToLower(name)})
	e.expect(r, 409, "Account dengan nama ini sudah ada")
	if r.Raw != `{"success":false,"error":"Account dengan nama ini sudah ada","details":{"account_id":"`+accountID+`"}}` {
		t.Fatalf("dup %s", r.Raw)
	}
	e.expect(e.do(&s, "POST", "/api/sales-funnel/accounts", map[string]any{"name": "X " + testutil.RandomHex(3), "phone": "123"}), 400, "Nomor telepon tidak valid")

	r = e.do(&s, "GET", "/api/sales-funnel/accounts?q="+strings.ReplaceAll(name, " ", "+"), nil)
	e.expect(r, 200, "")
	acc := r.list()[0].(map[string]any)
	if acc["contact_count"] != float64(0) || acc["won_value"] != "0" {
		t.Fatalf("account row %s", r.Raw)
	}

	// PATCH changes only the fields in the body: account_type stays.
	r = e.do(&s, "PATCH", "/api/sales-funnel/accounts/"+accountID, map[string]any{"city": "Bandung"})
	e.expect(r, 200, "Account diperbarui")
	if r.data()["account_type"] != "sekolah" || r.data()["city"] != "Bandung" {
		t.Fatalf("patch %s", r.Raw)
	}
	r = e.do(&s, "PATCH", "/api/sales-funnel/accounts/"+accountID, map[string]any{"account_type": "komunitas"})
	e.expect(r, 200, "Account diperbarui")
	if r.data()["account_type"] != "komunitas" || r.data()["city"] != "Bandung" {
		t.Fatalf("patch account_type %s", r.Raw)
	}
	e.expect(e.do(&s, "PATCH", "/api/sales-funnel/accounts/"+accountID, map[string]any{"nope": 1}), 400, "Validation failed")

	p := localPhone()
	r = e.do(&s, "POST", "/api/sales-funnel/contacts", map[string]any{"account_id": accountID, "name": "Sari", "phone": p, "is_primary": true})
	e.expect(r, 201, "Contact dibuat")
	contactID := r.data()["id"].(string)
	r = e.do(&s, "POST", "/api/sales-funnel/contacts", map[string]any{"name": "Dua", "phone": p})
	e.expect(r, 409, "Nomor ini sudah terdaftar atas nama Sari")
	r = e.do(&s, "GET", "/api/sales-funnel/contacts?account_id="+accountID, nil)
	if len(r.list()) != 1 || r.Body["pagination"].(map[string]any)["total"] != float64(1) {
		t.Fatalf("contacts %s", r.Raw)
	}
	r = e.do(&s, "GET", "/api/sales-funnel/contacts/"+contactID, nil)
	if !strings.HasPrefix(r.Raw, `{"success":true,"data":{"contact":{"id":"`+contactID) || !strings.HasSuffix(r.Raw, `"leads":[],"customer":null}}`) {
		t.Fatalf("contact detail %s", r.Raw)
	}
	r = e.do(&s, "PATCH", "/api/sales-funnel/contacts/"+contactID, map[string]any{"title": "Manager"})
	e.expect(r, 200, "Contact diperbarui")
	if r.data()["is_primary"] != true {
		t.Fatalf("PATCH without is_primary reset it %s", r.Raw)
	}
	r = e.do(&s, "PATCH", "/api/sales-funnel/contacts/"+contactID, map[string]any{"is_primary": false})
	e.expect(r, 200, "Contact diperbarui")
	if r.data()["is_primary"] != false {
		t.Fatalf("PATCH is_primary %s", r.Raw)
	}

	r = e.do(&s, "GET", "/api/sales-funnel/accounts/"+accountID, nil)
	if !strings.Contains(r.Raw, `"contacts":[{"id":"`+contactID) || !strings.HasSuffix(r.Raw, `"tasks":[]}}`) {
		t.Fatalf("account detail %s", r.Raw)
	}
	e.expect(e.do(&s, "DELETE", "/api/sales-funnel/contacts/"+contactID, nil), 204, "")

	_, _ = e.lead(s, name)
	e.expect(e.do(&s, "DELETE", "/api/sales-funnel/accounts/"+accountID, nil), 409, "Account masih punya lead aktif — hapus/pindahkan lead-nya dulu")
}

func TestPipelinesAndCatalog(t *testing.T) {
	e := newEnv(t)
	admin := e.staff("admin", "sales-funnel")
	code := "go-" + testutil.RandomHex(4)
	r := e.do(&admin, "POST", "/api/sales-funnel/pipelines", map[string]any{"name": "B2B Test", "code": code, "stages": []any{}})
	e.expect(r, 400, "Validation failed")
	r = e.do(&admin, "POST", "/api/sales-funnel/pipelines", map[string]any{"name": "B2B Test", "code": code,
		"stages": []any{map[string]any{"name": "Prospek"}, map[string]any{"name": "Nego", "probability": 60}}})
	e.expect(r, 201, "Pipeline dibuat")
	pipelineID := r.data()["id"].(string)
	if r.Raw != `{"success":true,"data":{"id":"`+pipelineID+`","code":"`+code+`","name":"B2B Test"},"message":"Pipeline dibuat"}` {
		t.Fatalf("pipeline %s", r.Raw)
	}
	e.expect(e.do(&admin, "POST", "/api/sales-funnel/pipelines", map[string]any{"name": "Dup", "code": code, "stages": []any{map[string]any{"name": "A"}}}),
		409, "Kode pipeline sudah dipakai")
	r = e.do(&admin, "GET", "/api/sales-funnel/stages?pipeline_id="+pipelineID, nil)
	if len(r.list()) != 4 {
		t.Fatalf("stages %s", r.Raw)
	}
	r = e.do(&admin, "POST", "/api/sales-funnel/stages", map[string]any{"pipeline_id": pipelineID, "name": "Survey"})
	e.expect(r, 201, "Tahap ditambahkan")
	if r.data()["sort_order"] != float64(30) || r.data()["probability"] != float64(10) {
		t.Fatalf("stage %s", r.Raw)
	}
	won := e.scalar(`SELECT id::text FROM crm.crm_sales_stages WHERE pipeline_id = $1 AND is_won`, pipelineID).(string)
	e.expect(e.do(&admin, "PATCH", "/api/sales-funnel/stages/"+won, map[string]any{"is_active": false}), 403, "Insufficient permissions")
	super := e.staff("super_admin", "sales-funnel")
	e.expect(e.do(&super, "PATCH", "/api/sales-funnel/stages/"+won, map[string]any{"is_active": false}), 400, "Tahap Menang/Kalah tidak boleh dinonaktifkan")
	r = e.do(&admin, "PATCH", "/api/sales-funnel/pipelines/"+pipelineID, map[string]any{"is_active": false})
	e.expect(r, 200, "Pipeline diperbarui")
	r = e.do(&admin, "GET", "/api/sales-funnel/pipelines?all=1", nil)
	if !strings.Contains(r.Raw, `"id":"`+pipelineID+`"`) || !strings.Contains(r.Raw, `"stages":[{`) {
		t.Fatalf("pipelines %s", r.Raw)
	}

	e.expect(e.do(&admin, "GET", "/api/sales-funnel/lost-reasons", nil), 200, "")
	e.expect(e.do(&admin, "GET", "/api/sales-funnel/products", nil), 200, "")
	e.expect(e.do(&admin, "GET", "/api/sales-funnel/owners", nil), 200, "")
	r = e.do(&admin, "GET", "/api/sales-funnel/customers?q=ab", nil)
	if r.Raw != `{"success":true,"data":[]}` {
		t.Fatalf("short query %s", r.Raw)
	}
	e.expect(e.do(&admin, "GET", "/api/sales-funnel/raw-materials?q=gula", nil), 200, "")
	e.expect(e.do(&admin, "GET", "/api/sales-funnel/custom-fields?object=x", nil), 400, "object wajib: lead|deal|account|contact")
	e.expect(e.do(&admin, "GET", "/api/sales-funnel/custom-fields?object=lead", nil), 200, "")

	r = e.do(&super, "POST", "/api/sales-funnel/wa-templates", map[string]any{"name": "Sapa", "body": "Halo {pic}"})
	e.expect(r, 201, "Template dibuat")
	tpl := r.data()["id"].(string)
	e.expect(e.do(&super, "PATCH", "/api/sales-funnel/wa-templates/"+tpl, map[string]any{}), 400, "Tidak ada field yang diubah")
	e.expect(e.do(&super, "PATCH", "/api/sales-funnel/wa-templates/"+tpl, map[string]any{"body": "Hai {pic}"}), 200, "Template diperbarui")
	e.expect(e.do(&super, "DELETE", "/api/sales-funnel/wa-templates/"+tpl, nil), 204, "")
	e.expect(e.do(&super, "DELETE", "/api/sales-funnel/wa-templates/"+tpl, nil), 404, "Template tidak ditemukan")
}
