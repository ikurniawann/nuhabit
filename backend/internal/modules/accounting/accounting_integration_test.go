package accounting_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/app"
	"nuhabit/backend/internal/contracts/inventory"
	"nuhabit/backend/internal/contracts/possales"
	"nuhabit/backend/internal/contracts/storedvalue"
	acct "nuhabit/backend/internal/modules/accounting"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/outbox"
	"nuhabit/backend/internal/platform/testutil"
)

// Integration tests against TEST_DATABASE_URL. The company and staff are
// committed fixtures (auth reads them on the pool, removed on cleanup); every
// accounting write runs in one transaction that is rolled back.

type env struct {
	t         *testing.T
	ctx       context.Context
	tx        pgx.Tx
	mux       http.Handler
	deps      module.Deps
	staff     testutil.Staff
	noCompany testutil.Staff
	company   string
}

// Pin the clock inside the OPEN October 2026 period the tests create.
var fixedNow = time.Date(2026, 10, 4, 3, 0, 0, 0, time.UTC)

func setup(t *testing.T) *env {
	t.Helper()
	deps := testutil.Deps(t, func() time.Time { return fixedNow })
	ctx := context.Background()
	var company string
	if err := deps.DB.QueryRow(ctx, `
INSERT INTO configuration.companies (holding_id, name, code)
SELECT holding_id, 'Go Acct '||$1, 'GA'||$1 FROM configuration.companies LIMIT 1 RETURNING id::text`, testutil.RandomHex(3)).Scan(&company); err != nil {
		t.Fatalf("company: %v", err)
	}
	t.Cleanup(func() {
		_, _ = deps.DB.Exec(context.Background(), `DELETE FROM configuration.companies WHERE id = $1`, company)
	})
	staff := testutil.CreateStaff(t, testutil.StaffOptions{Role: "admin", CompanyID: &company, Menus: map[string][]string{"accounting": nil}})
	noCompany := testutil.CreateStaff(t, testutil.StaffOptions{Role: "admin", Menus: map[string][]string{"accounting": nil}})
	tx, err := deps.DB.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = tx.Rollback(context.Background()) })
	m := acct.NewOn(deps, tx, app.AccountingPorts(deps))
	if err := deps.Events.Register(ctx, tx); err != nil {
		t.Fatal(err)
	}
	return &env{t: t, ctx: ctx, tx: tx, mux: testutil.Mux(m), deps: deps, staff: staff, noCompany: noCompany, company: company}
}

func (e *env) call(s testutil.Staff, method, path string, body any, status int) map[string]any {
	e.t.Helper()
	rec, out := testutil.Do(e.t, e.mux, testutil.AsStaff(testutil.Request(method, path, body), s))
	if rec.Code != status {
		e.t.Fatalf("%s %s: status %d, want %d: %s", method, path, rec.Code, status, rec.Body.String())
	}
	return out
}

func (e *env) do(method, path string, body any, status int) map[string]any {
	e.t.Helper()
	return e.call(e.staff, method, path, body, status)
}

func (e *env) scalar(dst any, sql string, args ...any) {
	e.t.Helper()
	if err := e.tx.QueryRow(e.ctx, sql, args...).Scan(dst); err != nil {
		e.t.Fatalf("query %q: %v", sql, err)
	}
}

func data(m map[string]any) map[string]any { return m["data"].(map[string]any) }

func wantError(t *testing.T, body map[string]any, msg string) {
	t.Helper()
	if body["success"] != false || body["error"] != msg {
		t.Fatalf("error body = %v, want %q", body, msg)
	}
}

func (e *env) typeID(code string) string {
	var id string
	e.scalar(&id, `SELECT id::text FROM accounting.account_types WHERE code = $1`, code)
	return id
}

func (e *env) account(code, name, typ string, cashBank bool) string {
	e.t.Helper()
	body := e.do("POST", "/api/accounting/chart-of-accounts", map[string]any{
		"code": code, "name": name, "account_type_id": e.typeID(typ), "is_cash_bank": cashBank,
	}, 201)
	return data(body)["id"].(string)
}

// fiscal2026 creates FY2026 with October OPEN and every other month CLOSED.
func (e *env) fiscal2026() map[string]any {
	periods := []map[string]any{}
	for m := 1; m <= 12; m++ {
		start := time.Date(2026, time.Month(m), 1, 0, 0, 0, 0, time.UTC)
		status := "CLOSED"
		if m == 10 {
			status = "OPEN"
		}
		periods = append(periods, map[string]any{"period_no": m, "name": start.Format("January 2006"),
			"start_date": start.Format("2006-01-02"), "end_date": start.AddDate(0, 1, -1).Format("2006-01-02"), "status": status})
	}
	return data(e.do("POST", "/api/accounting/fiscal-years", map[string]any{
		"code": "fy2026", "name": "FY 2026", "start_date": "2026-01-01", "end_date": "2026-12-31", "periods": periods,
	}, 201))
}

func (e *env) mapping(event, module string, lines ...map[string]any) {
	e.t.Helper()
	e.do("POST", "/api/accounting/journal-mappings", map[string]any{"event_code": strings.ToLower(event), "name": " " + event + " ", "module": module, "lines": lines}, 201)
}

func mline(side, role, account, source string) map[string]any {
	return map[string]any{"entry_side": side, "line_role": role, "account_id": account, "amount_source": source}
}

func TestSetupJournalsAndReports(t *testing.T) {
	e := setup(t)

	types := e.do("GET", "/api/accounting/account-types", nil, 200)["data"].([]any)
	if len(types) < 8 {
		t.Fatalf("account types: %v", types)
	}

	// No company on the profile: lists are empty, writes need a company.
	if got := e.call(e.noCompany, "GET", "/api/accounting/chart-of-accounts", nil, 200)["data"].([]any); len(got) != 0 {
		t.Fatalf("no-company COA: %v", got)
	}
	wantError(t, e.call(e.noCompany, "GET", "/api/accounting/fiscal-periods", nil, 400),
		"Akun Anda belum terikat company. Data accounting hanya tampil untuk company user yang login.")

	cash := e.account("1 1 01 001", "Kas Besar", "ASSET", true)
	revenue := e.account("4101001", "Penjualan", "REVENUE", false)
	coa := e.do("GET", "/api/accounting/chart-of-accounts?is_cash_bank=true", nil, 200)["data"].([]any)
	if len(coa) != 1 {
		t.Fatalf("cash filter: %v", coa)
	}
	row := coa[0].(map[string]any)
	if row["code"] != "1101001" || row["code_display"] != "1 1 01 001" || row["level"] != float64(4) || row["account_type_code"] != "ASSET" || row["normal_balance"] != "DEBIT" {
		t.Fatalf("coa row: %v", row)
	}
	wantError(t, e.do("POST", "/api/accounting/chart-of-accounts", map[string]any{"code": "1101001", "name": "Dup", "account_type_id": e.typeID("ASSET")}, 400),
		"Kode akun sudah digunakan")
	wantError(t, e.do("POST", "/api/accounting/chart-of-accounts", map[string]any{"code": "11-01", "name": "Bad", "account_type_id": e.typeID("ASSET")}, 400),
		"Format kode akun tidak valid")

	year := e.fiscal2026()
	if year["code"] != "FY2026" || year["open_periods_count"] != float64(1) || len(year["periods"].([]any)) != 12 {
		t.Fatalf("fiscal year: %v", year)
	}
	cov := data(e.do("GET", "/api/accounting/fiscal-years?coverage=1&date=2026-10-15", nil, 200))
	if cov["ready"] != true || cov["period"].(map[string]any)["name"] != "October 2026" {
		t.Fatalf("coverage: %v", cov)
	}
	cov = data(e.do("GET", "/api/accounting/fiscal-years?coverage=1&date=2026-11-02", nil, 200))
	sugg := cov["suggestion"].(map[string]any)
	if cov["ready"] != false || sugg["can_open"] != true || len(sugg["close_previous"].([]any)) != 1 {
		t.Fatalf("coverage suggestion: %v", cov)
	}

	lines := func(d, c float64) []map[string]any {
		return []map[string]any{
			{"account_id": cash, "entry_side": "DEBIT", "amount": d},
			{"account_id": revenue, "entry_side": "CREDIT", "amount": c},
		}
	}
	wantError(t, e.do("POST", "/api/accounting/journal-entries", map[string]any{"entry_date": "2026-10-04", "lines": lines(100, 90)}, 400),
		"Jurnal tidak balance: Debit 100 ≠ Credit 90")
	wantError(t, e.do("POST", "/api/accounting/journal-entries", map[string]any{"entry_date": "2026-03-04", "lines": lines(100, 100)}, 400),
		"Tidak ada fiscal period OPEN untuk tanggal jurnal. Konfigurasi Fiscal Years terlebih dahulu.")
	if body := e.do("POST", "/api/accounting/journal-entries", map[string]any{"entry_date": "04-10-2026"}, 400); body["error"] != "Validation failed" {
		t.Fatalf("validation: %v", body)
	}

	created := e.do("POST", "/api/accounting/journal-entries", map[string]any{"entry_date": "2026-10-04", "description": "  Modal awal ", "lines": lines(1500.5, 1500.5)}, 201)
	entry := data(created)
	if created["message"] != "Journal entry draft berhasil disimpan" || entry["entry_no"] != "JE-202610-0001" || entry["status"] != "DRAFT" ||
		entry["can_edit"] != true || entry["total_debit"] != 1500.5 || entry["description"] != "Modal awal" || entry["fiscal_period_name"] != "October 2026" {
		t.Fatalf("created entry: %v", created)
	}
	id := entry["id"].(string)

	preview := data(e.do("GET", "/api/accounting/fiscal-periods/"+entry["fiscal_period_id"].(string)+"/close", nil, 200))
	if preview["can_close"] != false || preview["draft_count"] != float64(1) {
		t.Fatalf("close preview: %v", preview)
	}

	posted := data(e.do("POST", "/api/accounting/journal-entries/"+id+"/post", nil, 200))
	if posted["status"] != "POSTED" || posted["can_edit"] != false || posted["posted_at"] == nil {
		t.Fatalf("posted: %v", posted)
	}
	wantError(t, e.do("POST", "/api/accounting/journal-entries/"+id+"/post", nil, 400), "Journal entry sudah POSTED")
	wantError(t, e.do("DELETE", "/api/accounting/journal-entries/"+id, nil, 400), "Journal entry POSTED tidak bisa diubah/dihapus")
	wantError(t, e.do("GET", "/api/accounting/journal-entries/00000000-0000-0000-0000-000000000000", nil, 404), "Journal entry tidak ditemukan")

	// Cash in posts a MANUAL POSTED journal and moves the cash balance.
	in := e.do("POST", "/api/accounting/cash-bank/cash-in", map[string]any{"entry_date": "2026-10-05", "amount": 250, "cash_account_id": cash, "offset_account_id": revenue}, 201)
	if in["message"] != "Cash In berhasil dicatat & diposting" || data(in)["entry_no"] != "JE-202610-0002" || data(in)["cash_account_code"] != "1 1 01 001" {
		t.Fatalf("cash in: %v", in)
	}
	accounts := e.do("GET", "/api/accounting/cash-bank", nil, 200)["data"].([]any)
	if acc := accounts[0].(map[string]any); acc["balance"] != 1750.5 || acc["movement_count"] != float64(2) {
		t.Fatalf("cash accounts: %v", accounts)
	}
	list := e.do("GET", "/api/accounting/cash-bank/cash-in?limit=5", nil, 200)
	if list["meta"].(map[string]any)["total"] != float64(1) {
		t.Fatalf("cash-in list: %v", list)
	}
	ledger := data(e.do("GET", "/api/accounting/cash-bank/"+cash+"/ledger?date_from=2026-10-05", nil, 200))
	if ledger["opening_balance"] != 1500.5 || ledger["closing_balance"] != 1750.5 || len(ledger["lines"].([]any)) != 1 {
		t.Fatalf("ledger: %v", ledger)
	}

	tb := data(e.do("GET", "/api/accounting/reports/trial-balance?as_of=2026-10-31", nil, 200))
	if tb["total_debit"] != 1750.5 || tb["total_credit"] != 1750.5 {
		t.Fatalf("trial balance: %v", tb)
	}
	is := data(e.do("GET", "/api/accounting/reports/income-statement?date_from=2026-01-01&date_to=2026-12-31", nil, 200))
	if is["total_revenue"] != 1750.5 || is["net_income"] != 1750.5 {
		t.Fatalf("income statement: %v", is)
	}
	bs := data(e.do("GET", "/api/accounting/reports/balance-sheet?as_of=2026-10-31", nil, 200))
	if bs["total_assets"] != 1750.5 || bs["current_year_earnings"] != 1750.5 || bs["total_liabilities_and_equity"] != 1750.5 {
		t.Fatalf("balance sheet: %v", bs)
	}
	wantError(t, e.do("GET", "/api/accounting/reports/nope", nil, 404), "Report tidak ditemukan")
	dash := data(e.do("GET", "/api/accounting/dashboard?as_of=2026-10-31", nil, 200))
	if kpis := dash["kpis"].(map[string]any); kpis["cash_balance"] != 1750.5 || kpis["posted_entries_ytd"] != float64(2) || len(dash["monthly_trend"].([]any)) != 10 {
		t.Fatalf("dashboard: %v", dash)
	}
	// LIMIT NaN fails in PostgreSQL like node-pg's (last: it aborts the test tx).
	if body := e.do("GET", "/api/accounting/cash-bank/cash-in?limit=abc", nil, 400); body["error"] != "Format data tidak valid" {
		t.Fatalf("NaN limit: %v", body)
	}
}

func TestPeriodsAndOpeningBalance(t *testing.T) {
	e := setup(t)
	cash := e.account("1101001", "Kas", "ASSET", true)
	equity := e.account("3101001", "Modal", "EQUITY", false)
	year := e.fiscal2026()
	periods := year["periods"].([]any)
	oct := periods[9].(map[string]any)["id"].(string)
	nov := periods[10].(map[string]any)["id"].(string)

	opened := e.do("POST", "/api/accounting/fiscal-periods/"+nov+"/open", map[string]any{"close_previous": false}, 400)
	wantError(t, opened, "Tutup period October 2026 terlebih dahulu sebelum OPEN November 2026")
	if body := e.do("POST", "/api/accounting/fiscal-periods/"+nov+"/open", map[string]any{"close_previous": "yes"}, 400); body["error"] != "Invalid input: expected boolean, received string" {
		t.Fatalf("bad body: %v", body)
	}
	res := e.do("POST", "/api/accounting/fiscal-periods/"+nov+"/open", nil, 200)
	if res["message"] != "Period November 2026 berhasil dibuka" || data(res)["status"] != "OPEN" {
		t.Fatalf("open: %v", res)
	}
	if _, has := data(res)["company_id"]; has {
		t.Fatal("a freshly opened period has no company_id key")
	}
	if again := data(e.do("POST", "/api/accounting/fiscal-periods/"+nov+"/open", nil, 200)); again["company_id"] != e.company {
		t.Fatalf("already open keeps company_id: %v", again)
	}
	closed := e.do("POST", "/api/accounting/fiscal-periods/"+nov+"/close", nil, 200)
	if closed["success"] != true || data(closed)["status"] != "CLOSED" {
		t.Fatalf("close: %v", closed)
	}
	wantError(t, e.do("POST", "/api/accounting/fiscal-periods/"+oct+"/close", nil, 400), "Period October 2026 sudah CLOSED")

	list := e.do("GET", "/api/accounting/fiscal-periods?status=CLOSED", nil, 200)["data"].([]any)
	if len(list) != 12 {
		t.Fatalf("closed periods: %d", len(list))
	}

	// Opening balance: first year, manual lines, January re-opened for it.
	sugg := data(e.do("GET", "/api/accounting/fiscal-years/"+year["id"].(string)+"/beginning-balance", nil, 200))
	if sugg["is_first_year"] != true || sugg["can_edit"] != true || len(sugg["lines"].([]any)) != 0 {
		t.Fatalf("suggestion: %v", sugg)
	}
	saved := e.do("POST", "/api/accounting/fiscal-years/"+year["id"].(string)+"/beginning-balance", map[string]any{
		"lines": []map[string]any{{"account_id": cash, "entry_side": "DEBIT", "amount": 1000}, {"account_id": equity, "entry_side": "CREDIT", "amount": 1000}},
		"post":  true,
	}, 200)
	if saved["message"] != "Beginning balance berhasil diposting" || data(saved)["status"] != "POSTED" {
		t.Fatalf("saved: %v", saved)
	}
	var entryNo string
	e.scalar(&entryNo, `SELECT entry_no FROM accounting.journal_entries WHERE id = $1`, data(saved)["entry_id"])
	if entryNo != "OB-2026-0001" {
		t.Fatalf("opening number %s", entryNo)
	}
	sugg = data(e.do("GET", "/api/accounting/fiscal-years/"+year["id"].(string)+"/beginning-balance", nil, 200))
	if sugg["existing_status"] != "POSTED" || sugg["can_edit"] != false || sugg["total_debit"] != float64(1000) {
		t.Fatalf("after save: %v", sugg)
	}
	wantError(t, e.do("DELETE", "/api/accounting/fiscal-years/"+year["id"].(string), nil, 400), "Fiscal year masih dipakai journal entry dan tidak bisa dihapus")
}

// vendor creates a purchasing vendor in the test transaction.
func (e *env) vendor() string {
	var id string
	e.scalar(&id, `INSERT INTO purchasing.vendors (code, name, contact_person, phone, email, address, category)
VALUES ('GV'||$1, 'Go Vendor', 'x', '0', 'v@x.test', 'x', 'other') RETURNING id::text`, testutil.RandomHex(3))
	return id
}

func TestApPaymentAndVoid(t *testing.T) {
	e := setup(t)
	cash := e.account("1101001", "Bank", "ASSET", true)
	ap := e.account("2101001", "Hutang Usaha", "LIABILITY", false)
	e.fiscal2026()
	e.mapping("PURCHASE_PAYMENT", "PURCHASING", mline("DEBIT", "AP", ap, "PAID"), mline("CREDIT", "BANK", cash, "PAID"))

	var invoice string
	e.scalar(&invoice, `INSERT INTO accounting.ap_invoices (company_id, invoice_no, invoice_date, due_date, vendor_id, subtotal, total_amount, status)
VALUES ($1, 'AP-TEST-1', '2026-08-09', '2026-08-01', $2, 1000, 1000, 'POSTED') RETURNING id::text`, e.company, e.vendor())

	inv := e.do("GET", "/api/accounting/ap/invoices/"+invoice, nil, 200)
	if d := data(inv); d["invoice_date"] != "Sun Aug 09" || d["due_date"] != "Sat Aug 01" || d["payment_status"] != "unpaid" || d["party_name"] != "Go Vendor" {
		t.Fatalf("invoice (TS date strings): %v", inv)
	}
	wantError(t, e.do("POST", "/api/accounting/ap/payments", map[string]any{"invoice_id": invoice, "amount": 2000}, 400),
		"Amount pembayaran tidak boleh melebihi outstanding")

	paid := e.do("POST", "/api/accounting/ap/payments", map[string]any{"invoice_id": invoice, "amount": 400, "notes": "termin 1"}, 201)
	payment := data(paid)
	if paid["message"] != "Pembayaran AP berhasil dicatat (jurnal posted)" || payment["payment_no"] != "APP-20261004-0001" ||
		payment["method"] != "bank_transfer" || payment["payment_date"] != "2026-10-04" {
		t.Fatalf("payment: %v", paid)
	}
	if invAfter := paid["invoice"].(map[string]any); invAfter["outstanding_amount"] != float64(600) || invAfter["payment_status"] != "partial" {
		t.Fatalf("invoice after payment: %v", invAfter)
	}
	payID := payment["id"].(string)
	var audits int
	e.scalar(&audits, `SELECT count(*)::int FROM audit.audit_log WHERE entity_id = $1 AND action = 'ap_payment.create'`, payID)
	if audits != 1 {
		t.Fatal("ap_payment.create audit missing")
	}

	payments := e.do("GET", "/api/accounting/ap/payments", nil, 200)
	if first := payments["data"].([]any)[0].(map[string]any); first["invoice_nos"].([]any)[0] != "AP-TEST-1" || first["party_name"] != "Go Vendor" {
		t.Fatalf("payments list: %v", payments)
	}
	aging := data(e.do("GET", "/api/accounting/ap/aging?as_of=2026-10-04", nil, 200))
	if b := aging["buckets"].([]any)[0].(map[string]any); b["bucket"] != "current" || b["amount"] != float64(600) {
		t.Fatalf("aging (TS date strings bucket as current): %v", aging)
	}

	wantError(t, e.do("POST", "/api/accounting/ap/payments/"+payID+"/void", map[string]any{"reason": "abc"}, 400),
		"Alasan void wajib diisi (minimal 5 karakter)")
	voided := e.do("POST", "/api/accounting/ap/payments/"+payID+"/void", map[string]any{"reason": "salah input"}, 200)
	if voided["message"] != "Pembayaran APP-20261004-0001 di-void (jurnal pembalik diposting)" || data(voided)["status"] != "VOID" {
		t.Fatalf("void: %v", voided)
	}
	wantError(t, e.do("POST", "/api/accounting/ap/payments/"+payID+"/void", map[string]any{"reason": "salah input"}, 409), "Pembayaran ini sudah di-void")
	var debit, credit float64
	e.scalar(&debit, `SELECT COALESCE(SUM(l.amount) FILTER (WHERE l.entry_side='DEBIT' AND l.account_id = $2), 0)::float8
  FROM accounting.journal_entry_lines l JOIN accounting.journal_entries j ON j.id = l.entry_id
 WHERE j.source_document_id = $1 AND j.status = 'POSTED'`, payID, cash)
	e.scalar(&credit, `SELECT COALESCE(SUM(l.amount) FILTER (WHERE l.entry_side='CREDIT' AND l.account_id = $2), 0)::float8
  FROM accounting.journal_entry_lines l JOIN accounting.journal_entries j ON j.id = l.entry_id
 WHERE j.source_document_id = $1 AND j.status = 'POSTED'`, payID, cash)
	if debit != 400 || credit != 400 {
		t.Fatalf("payment journal and its reversal net to zero: debit %v credit %v", debit, credit)
	}
	if invAfter := data(e.do("GET", "/api/accounting/ap/invoices/"+invoice, nil, 200)); invAfter["outstanding_amount"] != float64(1000) {
		t.Fatalf("void restores outstanding: %v", invAfter)
	}
}

func (e *env) dispatch() {
	e.t.Helper()
	if _, err := e.deps.Events.Dispatch(e.ctx, e.tx); err != nil {
		e.t.Fatal(err)
	}
}

func (e *env) publish(topic, key string, payload any) {
	e.t.Helper()
	if err := outbox.Publish(e.ctx, e.tx, topic, key, payload); err != nil {
		e.t.Fatal(err)
	}
}

func (e *env) journals(docID string) []string {
	e.t.Helper()
	rows, err := e.tx.Query(e.ctx, `
SELECT j.source_event_code||':'||string_agg(l.entry_side||'='||l.amount::text, ',' ORDER BY l.sort_order, l.entry_side)
  FROM accounting.journal_entries j JOIN accounting.journal_entry_lines l ON l.entry_id = j.id
 WHERE j.source_document_id = $1 AND j.deleted_at IS NULL AND j.entry_type = 'AUTO' AND j.status = 'POSTED'
 GROUP BY j.id, j.source_event_code ORDER BY j.source_event_code`, docID)
	if err != nil {
		e.t.Fatal(err)
	}
	out, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		e.t.Fatal(err)
	}
	return out
}

func TestJournalSubscribers(t *testing.T) {
	e := setup(t)
	cash := e.account("1101001", "Kas", "ASSET", true)
	deposit := e.account("2105001", "Uang Muka Member", "LIABILITY", false)
	revenue := e.account("4101001", "Penjualan", "REVENUE", false)
	cogs := e.account("5101001", "HPP", "COGS", false)
	stock := e.account("1301001", "Persediaan", "ASSET", false)
	e.fiscal2026()
	e.mapping("POS_SALE_CASH", "POS", mline("DEBIT", "CASH", cash, "TOTAL"), mline("CREDIT", "REVENUE", revenue, "TOTAL"))
	e.mapping("POS_SALE_MEMBER_BILL", "POS", mline("DEBIT", "MEMBER_DEPOSIT", deposit, "TOTAL"), mline("CREDIT", "REVENUE", revenue, "TOTAL"))
	e.mapping("POS_MEMBER_DEPOSIT_CASH", "POS", mline("DEBIT", "CASH", cash, "TOTAL"), mline("CREDIT", "MEMBER_DEPOSIT", deposit, "TOTAL"))
	e.mapping("STOCK_ADJUSTMENT_SHORTAGE", "INVENTORY", mline("DEBIT", "COGS", cogs, "TOTAL"), mline("CREDIT", "INVENTORY", stock, "TOTAL"))

	order := func(method string) string {
		var id string
		e.scalar(&id, `INSERT INTO pos.pos_orders (order_number, cashier_id, company_id, payment_method, subtotal, total_amount, amount_paid, ordered_at)
VALUES ('ORD-'||$1, $2, $3, $4, 36000, 36000, 50000, '2026-10-04T20:00:00Z') RETURNING id::text`, testutil.RandomHex(3), e.staff.UserID, e.company, method)
		return id
	}

	// pos.sale.settled: the cash sale journal, once however often delivered.
	sale := order("cash")
	settled := possales.SaleSettled{OrderID: sale, UserID: e.staff.UserID}
	e.publish(possales.TopicSaleSettled, sale, settled)
	e.publish(possales.TopicSaleSettled, sale, settled)
	e.dispatch()
	if got := e.journals(sale); len(got) != 1 || got[0] != "POS_SALE_CASH:DEBIT=36000.00,CREDIT=36000.00" {
		t.Fatalf("sale journals: %v", got)
	}
	var entryDate string
	e.scalar(&entryDate, `SELECT entry_date::text FROM accounting.journal_entries WHERE source_document_id = $1`, sale)
	if entryDate != "2026-10-05" {
		t.Fatalf("entry date is the Jakarta calendar day of ordered_at: %s", entryDate)
	}

	// Split-bill settlement: amounts_override and the split document replace
	// the order's amounts and id; each split posts once.
	splitOrder := order("cash")
	splitA, splitB := "6f1d5c2e-1111-4a1b-9c1d-0000000000a1", "6f1d5c2e-1111-4a1b-9c1d-0000000000b2"
	for _, doc := range []string{splitA, splitA, splitB} {
		e.publish(possales.TopicSaleSettled, splitOrder, possales.SaleSettled{OrderID: splitOrder, UserID: e.staff.UserID,
			DocumentID: doc, DocumentType: "pos_split_payment",
			AmountsOverride: map[string]float64{"SUBTOTAL": 20000, "TOTAL": 20000, "PAID": 20000}})
	}
	e.dispatch()
	for _, doc := range []string{splitA, splitB} {
		if got := e.journals(doc); len(got) != 1 || got[0] != "POS_SALE_CASH:DEBIT=20000.00,CREDIT=20000.00" {
			t.Fatalf("split %s journals: %v", doc, got)
		}
	}
	var docType string
	e.scalar(&docType, `SELECT source_document_type FROM accounting.journal_entries WHERE source_document_id = $1`, splitA)
	if docType != "pos_split_payment" || len(e.journals(splitOrder)) != 0 {
		t.Fatalf("split document: %s, order journals %v", docType, e.journals(splitOrder))
	}

	// pos.sale.completed from a member bill settlement posts; other methods
	// are left to pos.sale.settled.
	billed, walkIn := order("member_bill"), order("cash")
	e.publish(possales.TopicSaleCompleted, billed, possales.SaleCompleted{OrderID: billed, PaymentMethod: "member_bill", TotalAmount: 36000})
	e.publish(possales.TopicSaleCompleted, walkIn, possales.SaleCompleted{OrderID: walkIn, PaymentMethod: "cash", TotalAmount: 36000})
	e.dispatch()
	if got := e.journals(billed); len(got) != 1 || !strings.HasPrefix(got[0], "POS_SALE_MEMBER_BILL:") {
		t.Fatalf("member bill sale: %v", got)
	}
	if got := e.journals(walkIn); len(got) != 0 {
		t.Fatalf("sale.completed of a cash order must not post: %v", got)
	}

	// wallet.member_bill.paid: the instalment deposit journal.
	paymentID := "6f1d5c2e-1111-4a1b-9c1d-000000000001"
	e.publish(storedvalue.TopicMemberBillPaid, paymentID, storedvalue.MemberBillPaid{PaymentID: paymentID, CompanyID: &e.company,
		UserID: e.staff.UserID, EventCode: "POS_MEMBER_DEPOSIT_CASH", DocumentType: "pos_member_bill_payment", EntryDate: "2026-10-04",
		AmountTotal: 125000, Description: "Cicilan tagihan member Budi (Tunai)", SourceModule: "POS"})
	e.dispatch()
	if got := e.journals(paymentID); len(got) != 1 || got[0] != "POS_MEMBER_DEPOSIT_CASH:DEBIT=125000.00,CREDIT=125000.00" {
		t.Fatalf("deposit journal: %v", got)
	}

	// inventory.stock.adjusted: shortage Dr COGS / Cr inventory (mapping roles).
	adj := "6f1d5c2e-1111-4a1b-9c1d-000000000002"
	e.publish(inventory.TopicStockAdjusted, adj, inventory.StockAdjusted{DocumentID: adj, CompanyID: &e.company, UserID: e.staff.UserID,
		EntryDate: "2026-10-04", RawMaterialID: "6f1d5c2e-1111-4a1b-9c1d-000000000003", QtyDiff: -2, UnitCost: 1500.25})
	e.dispatch()
	if got := e.journals(adj); len(got) != 1 || got[0] != "STOCK_ADJUSTMENT_SHORTAGE:DEBIT=3000.50,CREDIT=3000.50" {
		t.Fatalf("adjustment journal: %v", got)
	}
	var memo string
	e.scalar(&memo, `SELECT j.description FROM accounting.journal_entries j WHERE j.source_document_id = $1`, adj)
	if memo != "Stock adjustment shortage (-2)" {
		t.Fatalf("adjustment description: %q", memo)
	}

	// A sale in a CLOSED period is logged and dropped, like the TS callers.
	closedSale := order("cash")
	e.exec(`UPDATE pos.pos_orders SET ordered_at = '2026-03-04T03:00:00Z' WHERE id = $1`, closedSale)
	e.publish(possales.TopicSaleSettled, closedSale, possales.SaleSettled{OrderID: closedSale, UserID: e.staff.UserID})
	e.dispatch()
	var undelivered int
	e.scalar(&undelivered, `SELECT count(*)::int FROM platform.outbox_deliveries d JOIN platform.outbox_events ev ON ev.id = d.event_id
 WHERE ev.key = $1 AND d.subscriber = 'accounting.journal-pos-sale' AND d.delivered_at IS NULL`, closedSale)
	if undelivered != 0 || len(e.journals(closedSale)) != 0 {
		t.Fatalf("closed-period sale: undelivered %d", undelivered)
	}
}

func (e *env) exec(sql string, args ...any) {
	e.t.Helper()
	if _, err := e.tx.Exec(e.ctx, sql, args...); err != nil {
		e.t.Fatalf("exec %q: %v", sql, err)
	}
}

func TestMappingsAndFinance(t *testing.T) {
	e := setup(t)
	cash := e.account("1101001", "Kas", "ASSET", true)
	e.mapping("POS_SALE_QRIS", "POS", mline("DEBIT", "BANK", cash, "TOTAL"), map[string]any{"entry_side": "CREDIT", "line_role": "REVENUE", "account_id": nil, "amount_source": "TOTAL", "is_required": false})
	list := e.do("GET", "/api/accounting/journal-mappings?module=POS", nil, 200)["data"].([]any)
	m := list[0].(map[string]any)
	if m["event_code"] != "POS_SALE_QRIS" || m["name"] != "POS_SALE_QRIS" || m["description"] != "Penjualan POS dibayar QRIS" || m["lines_count"] != float64(2) || m["mapped_count"] != float64(1) {
		t.Fatalf("mapping defaults from JOURNAL_EVENT_META: %v", m)
	}
	if body := e.do("POST", "/api/accounting/journal-mappings", map[string]any{"event_code": "pos_sale_qris", "name": "x", "module": "POS",
		"lines": []map[string]any{mline("DEBIT", "BANK", cash, "TOTAL")}}, 400); body["error"] != "Event code sudah ada untuk company ini" {
		t.Fatalf("duplicate mapping: %v", body)
	}
	var global string
	e.scalar(&global, `SELECT id::text FROM accounting.journal_mappings WHERE company_id IS NULL AND deleted_at IS NULL LIMIT 1`)
	if got := data(e.do("GET", "/api/accounting/journal-mappings/"+global, nil, 200)); got["company_id"] != nil {
		t.Fatalf("global template: %v", got)
	}
}

func TestFinanceRoutes(t *testing.T) {
	e := setup(t)
	gone := e.do("POST", "/api/finance/invoices/00000000-0000-0000-0000-000000000000/payments", nil, 410)
	if gone["redirect"] != "/dashboard/accounting/receivable/receipts" {
		t.Fatalf("410: %v", gone)
	}
	wantError(t, e.do("GET", "/api/finance/invoices/00000000-0000-0000-0000-000000000000", nil, 404), "Invoice tidak ditemukan")
	wantError(t, e.do("DELETE", "/api/finance/payments/00000000-0000-0000-0000-000000000000", nil, 404), "Catatan pembayaran tidak ditemukan")
	if got := e.do("GET", "/api/finance/invoices?status=terkirim", nil, 200)["data"].([]any); len(got) != 0 {
		t.Fatalf("finance invoices of a fresh company: %v", got)
	}
	wantError(t, e.call(e.noCompany, "GET", "/api/finance/invoices", nil, 403), acct.ScopeMissing)
	if body := e.do("PATCH", "/api/finance/invoices/x", map[string]any{"label": "", "amount": -1}, 400); body["error"] != "Validation failed" {
		t.Fatalf("revise validation: %v", body)
	}
}

func TestGuards(t *testing.T) {
	e := setup(t)
	rec, body := testutil.Do(t, e.mux, testutil.Request("GET", "/api/accounting/account-types", nil))
	if rec.Code != 401 {
		t.Fatalf("anon: %d %v", rec.Code, body)
	}
	other := testutil.CreateStaff(t, testutil.StaffOptions{Role: "admin", Menus: map[string][]string{"gym.packages": nil}})
	wantError(t, e.call(other, "GET", "/api/accounting/account-types", nil, 403), "Insufficient permissions")
	raw, _ := json.Marshal(map[string]any{"code": "zz" + testutil.RandomHex(2), "name": "Tmp", "normal_balance": "DEBIT"})
	created := e.do("POST", "/api/accounting/account-types", string(raw), 201)
	if d := data(created); d["code"] != strings.ToUpper(d["code"].(string)) || d["sort_order"] != float64(0) {
		t.Fatalf("account type: %v", created)
	}
	if rec, _ := testutil.Do(t, e.mux, testutil.AsStaff(testutil.Request("POST", "/api/accounting/account-types", "{bad"), e.staff)); rec.Code != 500 {
		t.Fatalf("malformed JSON is the TS 500, got %d", rec.Code)
	}
	wantError(t, e.do("PUT", "/api/accounting/account-types/"+fmt.Sprint("00000000-0000-0000-0000-000000000000"), map[string]any{"code": "x", "name": "y", "normal_balance": "DEBIT"}, 500),
		"Terjadi kesalahan server")
}

func TestProcurementSubscribersAndAR(t *testing.T) {
	e := setup(t)
	stock := e.account("1301001", "Persediaan", "ASSET", false)
	grni := e.account("2102001", "GRNI", "LIABILITY", false)
	ap := e.account("2101001", "Hutang Usaha", "LIABILITY", false)
	bank := e.account("1102001", "Bank", "ASSET", true)
	ar := e.account("1201001", "Piutang", "ASSET", false)
	e.fiscal2026()
	e.mapping("PURCHASE_GRN", "PURCHASING", mline("DEBIT", "INVENTORY", stock, "TOTAL"), mline("CREDIT", "GRNI", grni, "TOTAL"))
	e.mapping("PURCHASE_AP_INVOICE", "PURCHASING", mline("DEBIT", "GRNI", grni, "TOTAL"), mline("CREDIT", "AP", ap, "TOTAL"))
	e.mapping("PURCHASE_RETURN", "PURCHASING", mline("DEBIT", "AP", ap, "TOTAL"), mline("CREDIT", "INVENTORY", stock, "TOTAL"))
	e.mapping("STOCK_TRANSFER", "INVENTORY", mline("DEBIT", "INVENTORY", stock, "TOTAL"), mline("CREDIT", "INVENTORY", stock, "TOTAL"))
	e.mapping("SALE_AR_RECEIPT", "SALES", mline("DEBIT", "BANK", bank, "PAID"), mline("CREDIT", "AR", ar, "PAID"))

	vendor := e.vendor()
	var po, poItem, grn string
	e.scalar(&po, `INSERT INTO purchasing.purchase_orders (nomor_po, vendor_id, company_id, ppn_persen, tanggal_kirim_estimasi, subtotal, total)
VALUES ('PO-GO-'||$1, $2, $3, 11, '2026-10-20', 2000, 2220) RETURNING id::text`, testutil.RandomHex(3), vendor, e.company)
	var material *string
	_ = e.tx.QueryRow(e.ctx, `SELECT id::text FROM item.raw_materials LIMIT 1`).Scan(&material)
	if material == nil {
		t.Skip("no raw material to target the PO item")
	}
	e.scalar(&poItem, `INSERT INTO purchasing.purchase_order_items (purchase_order_id, raw_material_id, qty_ordered, harga_satuan)
VALUES ($1, $2, 2, 1000) RETURNING id::text`, po, *material)
	e.scalar(&grn, `INSERT INTO purchasing.grn (nomor_grn, purchase_order_id, vendor_id, company_id, tanggal_penerimaan)
VALUES ('GRN-GO-'||$1, $2, $3, $4, '2026-10-04') RETURNING id::text`, testutil.RandomHex(3), po, vendor, e.company)
	e.exec(`INSERT INTO purchasing.grn_items (grn_id, purchase_order_item_id, raw_material_id, qty_diterima) VALUES ($1, $2, $3, 2)`, grn, poItem, *material)

	e.publish("procurement.grn.posted", grn, map[string]any{"grn_id": grn, "user_id": e.staff.UserID})
	e.publish("procurement.grn.posted", grn, map[string]any{"grn_id": grn, "user_id": e.staff.UserID})
	e.dispatch()
	if got := e.journals(grn); len(got) != 1 || got[0] != "PURCHASE_GRN:DEBIT=2220.00,CREDIT=2220.00" {
		t.Fatalf("GRN journal: %v", got)
	}
	var invoice, dueDate string
	var count int
	e.scalar(&count, `SELECT count(*)::int FROM accounting.ap_invoices WHERE grn_id = $1`, grn)
	e.scalar(&invoice, `SELECT id::text FROM accounting.ap_invoices WHERE grn_id = $1`, grn)
	e.scalar(&dueDate, `SELECT due_date::text FROM accounting.ap_invoices WHERE grn_id = $1`, grn)
	if count != 1 || dueDate != "2026-10-20" {
		t.Fatalf("one AP invoice per GRN: %d, due %s", count, dueDate)
	}
	if got := e.journals(invoice); len(got) != 1 || got[0] != "PURCHASE_AP_INVOICE:DEBIT=2220.00,CREDIT=2220.00" {
		t.Fatalf("AP invoice journal: %v", got)
	}

	// AP payment against the PO invoice: procurement resolves the payment
	// term and the vendor payment is linked in the same transaction.
	paid := e.do("POST", "/api/accounting/ap/payments", map[string]any{"invoice_id": invoice, "amount": 1000}, 201)
	vp, ok := data(paid)["vendor_payment_id"].(string)
	if !ok {
		t.Fatalf("vendor payment not linked: %v", paid)
	}
	var vpStatus, vpNo string
	var termPaid float64
	e.scalar(&vpStatus, `SELECT status FROM purchasing.vendor_payments WHERE id = $1`, vp)
	e.scalar(&vpNo, `SELECT payment_number FROM purchasing.vendor_payments WHERE id = $1`, vp)
	e.scalar(&termPaid, `SELECT t.paid_amount::float8 FROM purchasing.vendor_payments v JOIN purchasing.purchase_order_payment_terms t ON t.id = v.payment_term_id WHERE v.id = $1`, vp)
	if vpStatus != "posted" || vpNo != "VP-20261004-0001" || termPaid != 1000 {
		t.Fatalf("vendor payment: %s %s term paid %v", vpStatus, vpNo, termPaid)
	}

	ret := "6f1d5c2e-1111-4a1b-9c1d-000000000010"
	e.publish("procurement.purchase_return.approved", ret, map[string]any{"return_id": ret, "return_number": "RT-1",
		"return_date": "2026-10-04", "company_id": e.company, "user_id": e.staff.UserID, "total_amount": 500})
	transfer := "6f1d5c2e-1111-4a1b-9c1d-000000000011"
	e.publish(inventory.TopicStockTransferred, transfer, inventory.StockTransferred{TransferID: transfer, TransferNumber: "TR-1",
		CompanyID: &e.company, UserID: e.staff.UserID, EntryDate: "2026-10-04", RawMaterialID: "6f1d5c2e-1111-4a1b-9c1d-000000000012",
		Qty: 3, UnitCost: 10, SourceWarehouseName: "Gudang A"})
	e.dispatch()
	if got := e.journals(ret); len(got) != 1 || got[0] != "PURCHASE_RETURN:DEBIT=500.00,CREDIT=500.00" {
		t.Fatalf("return journal: %v", got)
	}
	var desc string
	e.scalar(&desc, `SELECT description FROM accounting.journal_entries WHERE source_document_id = $1`, transfer)
	if got := e.journals(transfer); len(got) != 1 || desc != "Transfer TR-1: Gudang A → tujuan" {
		t.Fatalf("transfer journal: %v %q", got, desc)
	}

	// AR receipt against a manual AR invoice.
	var arInvoice string
	e.scalar(&arInvoice, `INSERT INTO accounting.ar_invoices (company_id, invoice_no, invoice_date, customer_name, subtotal, total_amount, status)
VALUES ($1, 'AR-TEST-1', '2026-10-01', 'PT Contoh', 1000, 1000, 'POSTED') RETURNING id::text`, e.company)
	got := e.do("POST", "/api/accounting/ar/receipts", map[string]any{"invoice_id": arInvoice, "amount": 250, "method": "qris"}, 201)
	if got["message"] != "Penerimaan AR berhasil dicatat (jurnal posted)" || data(got)["receipt_no"] != "ARR-20261004-0001" ||
		data(got)["invoice_nos"].([]any)[0] != "AR-TEST-1" || got["invoice"].(map[string]any)["outstanding_amount"] != float64(750) {
		t.Fatalf("receipt: %v", got)
	}
	list := e.do("GET", "/api/accounting/ar/invoices?payment_status=partial", nil, 200)
	if list["meta"].(map[string]any)["total"] != float64(1) {
		t.Fatalf("ar list: %v", list)
	}
	parties := e.do("GET", "/api/accounting/ledger/subsidiary?kind=ar", nil, 200)["data"].([]any)
	if p := parties[0].(map[string]any); p["party_key"] != "PT Contoh" || p["outstanding"] != float64(750) {
		t.Fatalf("AR parties: %v", parties)
	}
	ledger := data(e.do("GET", "/api/accounting/ledger/subsidiary?kind=AR&party_key=PT%20Contoh&date_from=2026-01-01", nil, 200))
	if ledger["closing_balance"] != float64(750) || len(ledger["lines"].([]any)) != 2 {
		t.Fatalf("AR ledger: %v", ledger)
	}
	wantError(t, e.do("GET", "/api/accounting/ledger/subsidiary?kind=XX", nil, 400), "kind harus AP atau AR")
}
