package storedvalue

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/testutil"
)

// Integration tests against TEST_DATABASE_URL: every write runs in one
// transaction rolled back at the end. Ports to other contexts are fakes
// (the real adapters live in internal/app).

type fakeDir struct {
	Directory
	scope *UserScope
	venue Venue
}

func (d *fakeDir) UserScope(context.Context, database.Querier, string) (*UserScope, error) {
	return d.scope, nil
}
func (d *fakeDir) DefaultVenue(context.Context, database.Querier) Venue { return d.venue }
func (d *fakeDir) BranchCompany(context.Context, database.Querier, string) (*string, error) {
	return nil, nil
}
func (d *fakeDir) ActiveBranches(context.Context, database.Querier) ([]Branch, error) {
	return []Branch{{ID: "b1", Name: "Kemang"}}, nil
}
func (d *fakeDir) FirstCompanyName(context.Context, database.Querier) (*string, error) {
	return strPtr("NüHabit"), nil
}
func (d *fakeDir) ArkCoinEnabled(context.Context, database.Querier) bool { return true }
func (d *fakeDir) OrderNumbers(context.Context, database.Querier, []string) (map[string]string, error) {
	return map[string]string{}, nil
}

type fakeLoyalty struct{}

func (fakeLoyalty) AwardTopupXP(_ context.Context, _ database.DB, _ string, _ float64, txID string) CrmXP {
	return CrmXP{Status: "posted", XPAwarded: 5, LedgerIDs: []string{"ledger-" + txID[:4]}}
}

type fakeSupervisors struct{}

func (fakeSupervisors) Approve(_ context.Context, _, pin string) (SupervisorApproval, error) {
	switch pin {
	case "1234":
		return SupervisorApproval{OK: true, Supervisor: ApprovedSupervisor{ID: "11111111-1111-4111-8111-111111111111", Name: "Budi"}}, nil
	case "9999":
		return SupervisorApproval{Reason: "locked", RetryMinutes: 12}, nil
	}
	return SupervisorApproval{Reason: "invalid"}, nil
}

type fakeWhatsApp struct {
	mu   sync.Mutex
	sent []string
	foc  chan FocTopupNotice
}

func (w *fakeWhatsApp) SendText(_ context.Context, target, message, _ string, _ *string) WADelivery {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.sent = append(w.sent, target+"|"+message)
	return WADelivery{Delivered: true}
}
func (w *fakeWhatsApp) NotifyFocTopup(_ context.Context, n FocTopupNotice) { w.foc <- n }

type fakeGateway struct{ paid bool }

func (fakeGateway) LoadConfig(context.Context, database.Querier) (*XenditConfig, error) {
	return &XenditConfig{SecretKey: "sk", Environment: "sandbox"}, nil
}
func (fakeGateway) CreateDynamicQR(_ context.Context, _, ref string, _ float64, _, _ string) (*XenditQR, error) {
	return &XenditQR{ID: "qr_" + ref, QRString: "QRSTRING-" + ref, Status: "ACTIVE", ExpiresAt: "2026-10-04T10:00:00.000Z"}, nil
}
func (g *fakeGateway) QRPayments(context.Context, string, string) ([]map[string]any, error) {
	if g.paid {
		return []map[string]any{{"id": "pay_1", "status": "SUCCEEDED", "amount": 50000.0}}, nil
	}
	return []map[string]any{}, nil
}
func (fakeGateway) QRCode(_ context.Context, _, id string) (map[string]any, error) {
	return map[string]any{"id": id, "status": "ACTIVE"}, nil
}

// fakeOrders holds one member's open orders.
type fakeOrders struct {
	customer string
	open     []OpenOrder
	settled  []string
}

func (o *fakeOrders) OpenOrderSummaries(context.Context, database.Querier) ([]OpenOrderSummary, error) {
	if len(o.open) == 0 {
		return nil, nil
	}
	s := OpenOrderSummary{CustomerID: o.customer, Count: len(o.open)}
	for _, ord := range o.open {
		s.Total += ord.TotalAmount
	}
	oldest := o.open[0].OrderedAt
	s.Oldest = &oldest
	return []OpenOrderSummary{s}, nil
}
func (o *fakeOrders) OpenOrders(context.Context, database.Querier, string, bool) ([]OpenOrder, error) {
	return o.open, nil
}
func (o *fakeOrders) OrderItems(context.Context, database.Querier, []string) ([]BillOrderItem, error) {
	var out []BillOrderItem
	for _, ord := range o.open {
		out = append(out, BillOrderItem{OrderID: ord.ID, ProductName: "Kopi", Quantity: 2, TotalAmount: ord.TotalAmount,
			Variants: json.RawMessage(`[{"name":"Large"}]`), Modifiers: json.RawMessage(`null`)})
	}
	return out, nil
}
func (o *fakeOrders) SettledOrders(context.Context, database.Querier, string) ([]SettledOrder, error) {
	return nil, nil
}
func (o *fakeOrders) SettleOrders(_ context.Context, _ database.Querier, ids, _ []string, _ string) error {
	o.settled = append(o.settled, ids...)
	o.open = nil
	return nil
}
func (o *fakeOrders) ActivePaymentMethod(_ context.Context, _ database.Querier, code string) (*PaymentMethod, error) {
	switch code {
	case "cash":
		return &PaymentMethod{Code: "cash", Name: "Tunai", Handler: "cash"}, nil
	case "foc":
		return &PaymentMethod{Code: "foc", Name: "FOC", Handler: "cash"}, nil
	}
	return nil, nil
}
func (o *fakeOrders) ActiveShift(context.Context, database.Querier, string) (*string, error) {
	return nil, nil
}

type env struct {
	t       *testing.T
	ctx     context.Context
	tx      pgx.Tx
	mux     *http.ServeMux
	admin   testutil.Staff
	cashier testutil.Staff
	member  testutil.Member
	dir     *fakeDir
	wa      *fakeWhatsApp
	gateway *fakeGateway
	orders  *fakeOrders
}

var fixedNow = time.Date(2026, 10, 4, 3, 0, 0, 0, time.UTC)

func newEnv(t *testing.T) *env {
	t.Helper()
	deps := testutil.Deps(t, func() time.Time { return fixedNow })
	e := &env{t: t, ctx: context.Background(), wa: &fakeWhatsApp{foc: make(chan FocTopupNotice, 4)}, gateway: &fakeGateway{}, orders: &fakeOrders{}}
	e.admin = testutil.CreateStaff(t, testutil.StaffOptions{FullName: "Rina", Menus: map[string][]string{"pos.loyalty.wallet": nil}})
	e.cashier = testutil.CreateStaff(t, testutil.StaffOptions{FullName: "Arip", Menus: map[string][]string{
		"pos": nil, "pos.operations.member-bills": {"read", "create"}}})
	e.member = testutil.CreateMember(t)
	e.dir = &fakeDir{scope: &UserScope{FullName: strPtr("Arip")}}
	e.tx = testutil.Tx(t)
	m := newModule(deps, Ports{
		Directory: e.dir, Loyalty: fakeLoyalty{}, Supervisors: fakeSupervisors{}, WhatsApp: e.wa,
		Gateway: e.gateway, Orders: e.orders,
	}, e.tx)
	e.mux = testutil.Mux(m)
	return e
}

func (e *env) do(s testutil.Staff, method, target string, body any) (int, map[string]any, string) {
	e.t.Helper()
	r := testutil.AsStaff(testutil.Request(method, target, body), s)
	rec := httptest.NewRecorder()
	e.mux.ServeHTTP(rec, r)
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return rec.Code, out, rec.Body.String()
}

func (e *env) exec(sql string, args ...any) {
	e.t.Helper()
	if _, err := e.tx.Exec(e.ctx, sql, args...); err != nil {
		e.t.Fatalf("exec: %v", err)
	}
}

func (e *env) balance() float64 {
	e.t.Helper()
	var b float64
	if err := e.tx.QueryRow(e.ctx, `SELECT COALESCE(ark_coin_balance,0)::float FROM pos.pos_customers WHERE id = $1`, e.member.CustomerID).Scan(&b); err != nil {
		e.t.Fatal(err)
	}
	return b
}

func expect(t *testing.T, label string, gotStatus, wantStatus int, raw string) {
	t.Helper()
	if gotStatus != wantStatus {
		t.Fatalf("%s: status %d want %d: %s", label, gotStatus, wantStatus, raw)
	}
}

func TestWalletAdminRoutes(t *testing.T) {
	e := newEnv(t)
	base := "/api/wallet/members/" + e.member.CustomerID

	code, _, raw := e.do(e.cashier, "POST", base+"/adjust", map[string]any{"amount": 1000, "reason": "x"})
	expect(t, "403 without the wallet menu", code, 403, raw)
	code, _, raw = e.do(e.admin, "POST", "/api/wallet/members/abc/adjust", map[string]any{"amount": 1000, "reason": "x"})
	if code != 400 || raw != `{"success":false,"error":"ID tidak valid"}` {
		t.Fatalf("bad id: %d %s", code, raw)
	}
	code, _, raw = e.do(e.admin, "POST", base+"/adjust", map[string]any{"amount": "seribu", "reason": "x"})
	if code != 400 || raw != `{"success":false,"error":"Invalid input: expected number, received string"}` {
		t.Fatalf("first issue: %d %s", code, raw)
	}
	code, _, raw = e.do(e.admin, "POST", base+"/adjust", map[string]any{"amount": -5000, "reason": "salah input"})
	if code != 400 || !strings.Contains(raw, "saldo minus") {
		t.Fatalf("negative: %d %s", code, raw)
	}

	code, body, raw := e.do(e.admin, "POST", base+"/adjust", map[string]any{"amount": 100000, "reason": "  koreksi kasir  "})
	expect(t, "adjust", code, 201, raw)
	adj := body["data"].(map[string]any)
	if adj["type"] != "adjustment" || adj["amount"] != 100000.0 || adj["notes"] != "Penyesuaian manual: koreksi kasir" ||
		adj["balance_after"] != 100000.0 || adj["metadata"].(map[string]any)["actor_name"] != "Rina" {
		t.Fatalf("adjust row %s", raw)
	}
	if e.balance() != 100000 {
		t.Fatal("balance after adjust")
	}

	code, body, raw = e.do(e.admin, "GET", base, nil)
	expect(t, "member wallet", code, 200, raw)
	data := body["data"].(map[string]any)
	lots := data["lots"].([]any)
	if len(lots) != 1 || lots[0].(map[string]any)["remaining"] != 100000.0 || len(data["entries"].([]any)) != 1 {
		t.Fatalf("member wallet %s", raw)
	}

	code, body, raw = e.do(e.admin, "POST", "/api/wallet/entries/"+adj["id"].(string)+"/reverse", map[string]any{"reason": "dobel input"})
	expect(t, "reverse", code, 201, raw)
	rev := body["data"].(map[string]any)
	if rev["type"] != "reversal" || rev["amount"] != -100000.0 || e.balance() != 0 {
		t.Fatalf("reverse %s", raw)
	}
	code, _, raw = e.do(e.admin, "POST", "/api/wallet/entries/"+adj["id"].(string)+"/reverse", map[string]any{"reason": "dobel input"})
	if code != 400 || raw != `{"success":false,"error":"Entri ini sudah pernah dibatalkan"}` {
		t.Fatalf("double reverse %d %s", code, raw)
	}

	code, _, raw = e.do(e.admin, "GET", "/api/wallet/members?q="+e.member.Phone[3:], nil)
	expect(t, "search", code, 200, raw)
	if !strings.Contains(raw, e.member.CustomerID) {
		t.Fatalf("search %s", raw)
	}
	code, _, raw = e.do(e.admin, "GET", "/api/wallet/members?q=a", nil)
	if code != 200 || raw != `{"success":true,"data":[]}` {
		t.Fatalf("short search %s", raw)
	}
	code, _, raw = e.do(e.admin, "GET", "/api/wallet/branches", nil)
	if raw != `{"success":true,"data":[{"id":"b1","name":"Kemang"}]}` {
		t.Fatalf("branches %d %s", code, raw)
	}
}

func TestWalletSettingsPackagesSweep(t *testing.T) {
	e := newEnv(t)
	code, _, raw := e.do(e.admin, "PUT", "/api/wallet/settings", map[string]any{
		"topup_max_amount": 5000000, "low_balance_threshold_idr": 20000, "wallet_default_validity_days": nil, "wallet_expiry_reminder_days": 7})
	expect(t, "settings", code, 200, raw)
	if !strings.Contains(raw, `"topup_max_amount":5000000,"low_balance_threshold_idr":20000,"wallet_default_validity_days":null,"wallet_expiry_reminder_days":7`) {
		t.Fatalf("settings %s", raw)
	}
	code, _, raw = e.do(e.admin, "PUT", "/api/wallet/settings", map[string]any{"topup_max_amount": -1})
	if code != 400 || raw != `{"success":false,"error":"Too small: expected number to be >=0"}` {
		t.Fatalf("settings validation %s", raw)
	}

	code, _, raw = e.do(e.admin, "POST", "/api/wallet/packages", map[string]any{"name": "Hemat", "price_idr": 100000, "credit_idr": 90000})
	if code != 400 || raw != `{"success":false,"error":"Saldo yang diterima tidak boleh lebih kecil dari harga"}` {
		t.Fatalf("package refine %s", raw)
	}
	code, body, raw := e.do(e.admin, "POST", "/api/wallet/packages", map[string]any{"name": " Hemat ", "price_idr": 100000, "credit_idr": 115000, "validity_days": 30})
	expect(t, "create package", code, 201, raw)
	pkg := body["data"].(map[string]any)
	if pkg["name"] != "Hemat" || pkg["description"] != "" || pkg["validity_days"] != 30.0 || pkg["branch_ids"] != nil || pkg["sort"] != 0.0 {
		t.Fatalf("package %s", raw)
	}
	id := pkg["id"].(string)
	code, _, raw = e.do(e.admin, "PUT", "/api/wallet/packages/"+id, map[string]any{"name": "Hemat Plus", "price_idr": 100000, "credit_idr": 120000, "is_active": false})
	expect(t, "update package", code, 200, raw)
	code, _, raw = e.do(e.cashier, "GET", "/api/wallet/packages?scope=cashier", nil)
	expect(t, "cashier packages", code, 200, raw)
	if strings.Contains(raw, id) {
		t.Fatal("inactive package sold at the counter")
	}
	code, _, raw = e.do(e.admin, "DELETE", "/api/wallet/packages/"+id, nil)
	if code != 200 || raw != `{"success":true,"data":{"id":"`+id+`"}}` {
		t.Fatalf("delete package %s", raw)
	}

	// An expired lot is swept: expiration row, balance down, event published.
	e.exec(`INSERT INTO pos.pos_wallet_transactions (customer_id, type, amount, ark_coins, balance_before, balance_after, status, created_at, expires_at)
	        VALUES ($1, 'topup', 30000, 30, 0, 30000, 'completed', now() - interval '40 days', now() - interval '1 day')`, e.member.CustomerID)
	e.exec(`UPDATE pos.pos_customers SET ark_coin_balance = 30000 WHERE id = $1`, e.member.CustomerID)
	code, body, raw = e.do(e.admin, "POST", "/api/wallet/sweep", nil)
	expect(t, "sweep", code, 200, raw)
	res := body["data"].(map[string]any)
	if res["status"] != "done" || res["expired_lots"].(float64) < 1 || e.balance() != 0 {
		t.Fatalf("sweep %s", raw)
	}
	code, _, raw = e.do(e.admin, "GET", "/api/wallet/sweep", nil)
	if code != 200 || !strings.Contains(raw, res["run_id"].(string)) {
		t.Fatalf("sweep runs %s", raw)
	}
}

func TestCashierTopup(t *testing.T) {
	e := newEnv(t)
	code, _, raw := e.do(e.cashier, "POST", "/api/pos/topup", map[string]any{"customer_id": e.member.CustomerID, "amount": 50000, "payment_method": "foc"})
	if code != 400 || raw != `{"success":false,"error":"Topup FOC membutuhkan PIN supervisor"}` {
		t.Fatalf("foc pin %s", raw)
	}
	code, _, _ = e.do(e.cashier, "POST", "/api/pos/topup", map[string]any{"customer_id": e.member.CustomerID, "amount": 50000, "payment_method": "foc", "supervisor_pin": "1"})
	if code != 403 {
		t.Fatal("invalid pin")
	}
	code, _, raw = e.do(e.cashier, "POST", "/api/pos/topup", map[string]any{"customer_id": e.member.CustomerID, "amount": 50000, "payment_method": "foc", "supervisor_pin": "9999"})
	if code != 429 || !strings.Contains(raw, "12 menit") {
		t.Fatalf("locked %s", raw)
	}
	code, _, raw = e.do(e.cashier, "POST", "/api/pos/topup", map[string]any{"customer_id": e.member.CustomerID, "amount": 0})
	if code != 400 || raw != `{"success":false,"error":"Customer ID and valid amount are required"}` {
		t.Fatalf("amount required %s", raw)
	}
	code, _, raw = e.do(e.cashier, "POST", "/api/pos/topup", map[string]any{"customer_id": e.member.CustomerID, "amount": 5000, "payment_method": "cash"})
	if code != 400 || raw != `{"success":false,"error":"Minimum top-up is Rp10.000"}` {
		t.Fatalf("minimum %s", raw)
	}

	code, body, raw := e.do(e.cashier, "POST", "/api/pos/topup", map[string]any{"customer_id": e.member.CustomerID, "amount": 50000, "payment_method": "cash"})
	expect(t, "cash topup", code, 201, raw)
	data := body["data"].(map[string]any)
	tx := data["transaction"].(map[string]any)
	if data["status"] != "completed" || data["balance_after"] != 50000.0 || data["xp_awarded"] != 5.0 ||
		tx["amount"] != "50000.00" || tx["notes"] != "Cash top-up" || data["crm_xp"].(map[string]any)["status"] != "posted" ||
		data["qr_code_url"] != nil {
		t.Fatalf("cash topup %s", raw)
	}
	if e.balance() != 50000 {
		t.Fatal("balance after cash topup")
	}

	code, body, raw = e.do(e.cashier, "POST", "/api/pos/topup", map[string]any{"customer_id": e.member.CustomerID, "amount": 20000, "payment_method": "foc", "supervisor_pin": "1234"})
	expect(t, "foc topup", code, 201, raw)
	if !strings.Contains(raw, `"crm_xp":{"status":"skipped","xpAwarded":0,"reason":"foc_topup"}`) ||
		body["data"].(map[string]any)["transaction"].(map[string]any)["notes"] != "FOC top-up (marketing) — disetujui Budi" {
		t.Fatalf("foc topup %s", raw)
	}
	if n := <-e.wa.foc; n.AmountIdr != 20000 || *n.ApprovedName != "Budi" {
		t.Fatalf("foc notice %+v", n)
	}

	// QRIS: pending row, credited on the status poll once Xendit has a payment.
	code, body, raw = e.do(e.cashier, "POST", "/api/pos/topup", map[string]any{"customer_id": e.member.CustomerID, "amount": 50000})
	expect(t, "qris topup", code, 201, raw)
	data = body["data"].(map[string]any)
	id := data["topup_id"].(string)
	if data["status"] != "pending" || !strings.HasPrefix(data["qr_string"].(string), "QRSTRING-topup_") ||
		!strings.HasPrefix(data["qr_code_url"].(string), "https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=QRSTRING-topup_") {
		t.Fatalf("qris %s", raw)
	}
	code, body, raw = e.do(e.cashier, "GET", "/api/pos/topup/"+id+"/status", nil)
	if code != 200 || body["data"].(map[string]any)["status"] != "pending" {
		t.Fatalf("pending status %s", raw)
	}
	code, _, raw = e.do(e.cashier, "POST", "/api/pos/topup/"+id+"/reconcile", nil)
	if code != 200 || !strings.Contains(raw, `"message":"Belum ada pembayaran berhasil tercatat di Xendit","data":{"status":"pending"`) {
		t.Fatalf("reconcile pending %s", raw)
	}
	e.gateway.paid = true
	code, body, raw = e.do(e.cashier, "GET", "/api/pos/topup/"+id+"/status", nil)
	expect(t, "credited status", code, 200, raw)
	data = body["data"].(map[string]any)
	if data["status"] != "completed" || data["balance_before"] != 70000.0 || data["balance_after"] != 120000.0 || data["xp_awarded"] != 5.0 {
		t.Fatalf("credited %s", raw)
	}
	code, _, raw = e.do(e.cashier, "POST", "/api/pos/topup/"+id+"/reconcile", nil)
	if code != 200 || !strings.Contains(raw, `"message":"Topup ini sudah selesai sebelumnya"`) {
		t.Fatalf("reconcile again %s", raw)
	}
	code, _, raw = e.do(e.cashier, "POST", "/api/pos/topup/"+id+"/cancel", nil)
	if code != 400 || raw != `{"success":false,"error":"Only pending top-ups can be cancelled"}` {
		t.Fatalf("cancel completed %s", raw)
	}
	if e.balance() != 120000 {
		t.Fatal("balance after qris")
	}

	// Cancel a fresh pending QR.
	e.gateway.paid = false
	_, body, _ = e.do(e.cashier, "POST", "/api/pos/topup", map[string]any{"customer_id": e.member.CustomerID, "amount": 15000})
	pending := body["data"].(map[string]any)["topup_id"].(string)
	code, body, raw = e.do(e.cashier, "POST", "/api/pos/topup/"+pending+"/cancel", nil)
	if code != 200 || body["data"].(map[string]any)["transaction"].(map[string]any)["status"] != "cancelled" {
		t.Fatalf("cancel %s", raw)
	}

	code, _, raw = e.do(e.cashier, "GET", "/api/pos/topup?customer_id="+e.member.CustomerID+"&limit=2", nil)
	expect(t, "history", code, 200, raw)
	var hist struct{ Data []map[string]any }
	_ = json.Unmarshal([]byte(raw), &hist)
	if len(hist.Data) != 2 || hist.Data[0]["customer"].(map[string]any)["phone"] != e.member.Phone {
		t.Fatalf("history %s", raw)
	}

	code, body, raw = e.do(e.cashier, "POST", "/api/pos/topup/"+id+"/send-wa", map[string]any{})
	expect(t, "send wa", code, 200, raw)
	if len(e.wa.sent) != 1 || !strings.Contains(e.wa.sent[0], "*Top-up: Rp 50.000*") {
		t.Fatalf("wa %v", e.wa.sent)
	}
	code, _, raw = e.do(e.cashier, "POST", "/api/pos/topup/"+pending+"/send-wa", nil)
	if code != 400 || raw != `{"success":false,"error":"Top-up belum berhasil — bukti tidak dikirim"}` {
		t.Fatalf("send wa cancelled %s", raw)
	}

	// Admin refund of the QRIS top-up: manual, balance back down.
	code, body, raw = e.do(e.admin, "POST", "/api/wallet/entries/"+id+"/refund", map[string]any{"method": "transfer", "reason": "member minta refund"})
	expect(t, "refund", code, 201, raw)
	ref := body["data"].(map[string]any)
	if ref["amount"] != -50000.0 || ref["notes"] != "Refund top-up Rp50.000 via transfer (manual, QRIS tanpa refund API)" || e.balance() != 70000 {
		t.Fatalf("refund %s", raw)
	}
	code, body, raw = e.do(e.admin, "GET", "/api/wallet/payments/"+id, nil)
	if code != 200 || len(body["data"].(map[string]any)["related"].([]any)) != 1 {
		t.Fatalf("payment detail %s", raw)
	}
	code, _, raw = e.do(e.admin, "GET", "/api/wallet/payments?source=cashier&status=completed", nil)
	if code != 200 || !strings.Contains(raw, id) {
		t.Fatalf("payments %s", raw)
	}
	code, _, raw = e.do(e.admin, "GET", "/api/wallet/payments?limit=0", nil)
	if code != 400 || raw != `{"success":false,"error":"Too small: expected number to be >=1"}` {
		t.Fatalf("payments limit %s", raw)
	}
}

func TestMemberCardsAndRefunds(t *testing.T) {
	e := newEnv(t)
	uid := "TEST" + testutil.RandomHex(4)
	e.exec(`UPDATE pos.pos_customers SET nfc_uid = $2, ark_coin_balance = 67350 WHERE id = $1`, e.member.CustomerID, uid)

	code, body, raw := e.do(e.cashier, "GET", "/api/pos/member-cards?nfc_uid="+strings.ToLower(uid), nil)
	expect(t, "tap", code, 200, raw)
	members := body["data"].(map[string]any)["members"].([]any)
	if len(members) != 1 || members[0].(map[string]any)["ark_coin_balance"] != "67350.00" {
		t.Fatalf("tap %s", raw)
	}
	code, _, raw = e.do(e.cashier, "POST", "/api/pos/member-cards/"+e.member.CustomerID+"/unlink", map[string]any{"reason": "other"})
	if code != 400 || raw != `{"success":false,"error":"Tuliskan keterangan alasannya (minimal 3 karakter)"}` {
		t.Fatalf("unlink validation %s", raw)
	}
	code, _, raw = e.do(e.cashier, "POST", "/api/pos/member-cards/"+e.member.CustomerID+"/refund", map[string]any{"notes": "transfer BCA"})
	expect(t, "refund request", code, 200, raw)
	if !strings.Contains(raw, `"message":"Kartu `+uid+` dilepas & refund Rp67.350 untuk Go Test Member diajukan ke Finance"`) {
		t.Fatalf("refund request %s", raw)
	}
	code, _, raw = e.do(e.cashier, "POST", "/api/pos/member-cards/"+e.member.CustomerID+"/unlink", map[string]any{"reason": "lost"})
	if code != 400 || raw != `{"success":false,"error":"Member ini tidak punya kartu yang tertaut"}` {
		t.Fatalf("unlink after refund %s", raw)
	}

	var requestID string
	if err := e.tx.QueryRow(e.ctx, `SELECT id FROM pos.pos_member_refund_requests WHERE customer_id = $1`, e.member.CustomerID).Scan(&requestID); err != nil {
		t.Fatal(err)
	}
	code, _, _ = e.do(e.cashier, "POST", "/api/pos/member-refunds/"+requestID+"/complete", map[string]any{})
	if code != 400 {
		t.Fatal("pin required")
	}
	code, _, raw = e.do(e.cashier, "POST", "/api/pos/member-refunds/"+requestID+"/complete", map[string]any{"supervisor_pin": "9999"})
	if code != 429 || !strings.Contains(raw, "12 menit") {
		t.Fatalf("locked %s", raw)
	}
	code, body, raw = e.do(e.cashier, "POST", "/api/pos/member-refunds/"+requestID+"/complete", map[string]any{"supervisor_pin": "1234"})
	expect(t, "complete", code, 200, raw)
	if body["message"] != "Refund Go Test Member selesai — Rp67.350 dikembalikan, saldo member kini Rp0" || e.balance() != 0 {
		t.Fatalf("complete %s", raw)
	}
	code, _, raw = e.do(e.cashier, "POST", "/api/pos/member-refunds/"+requestID+"/complete", map[string]any{"supervisor_pin": "1234"})
	if code != 409 || raw != `{"success":false,"error":"Permintaan ini sudah selesai"}` {
		t.Fatalf("complete twice %s", raw)
	}
	code, _, raw = e.do(e.cashier, "POST", "/api/pos/member-refunds/"+requestID+"/cancel", nil)
	if code != 409 || raw != `{"success":false,"error":"Permintaan tidak ditemukan atau sudah diproses"}` {
		t.Fatalf("cancel completed %s", raw)
	}
}

func TestMemberBills(t *testing.T) {
	e := newEnv(t)
	cid := e.member.CustomerID
	e.orders.open = []OpenOrder{
		{ID: "aaaaaaaa-0000-4000-8000-000000000001", OrderNumber: strPtr("POS-1"), OrderedAt: fixedNow.Add(-48 * time.Hour), Status: "completed", TotalAmount: 60000},
		{ID: "aaaaaaaa-0000-4000-8000-000000000002", OrderNumber: strPtr("POS-2"), OrderedAt: fixedNow.Add(-24 * time.Hour), Status: "completed", TotalAmount: 40000},
	}
	e.orders.customer = cid
	base := "/api/pos/member-bills/" + cid
	code, _, raw := e.do(e.admin, "GET", "/api/pos/member-bills", nil)
	expect(t, "403 without menu", code, 403, raw)
	code, _, raw = e.do(e.cashier, "GET", "/api/pos/member-bills?search=Go%20Test", nil)
	if code != 200 || !strings.Contains(raw, `"customer_id":"`+cid+`","name":"Go Test Member"`) || !strings.Contains(raw, `"open_order_count":2`) {
		t.Fatalf("list %s", raw)
	}
	code, _, raw = e.do(e.cashier, "POST", "/api/pos/member-bills/bukan-uuid/payments", map[string]any{"amount": 1000, "payment_method_code": "cash"})
	if code != 400 || raw != `{"success":false,"error":"Member tidak valid"}` {
		t.Fatalf("bad id %s", raw)
	}
	code, _, raw = e.do(e.cashier, "POST", base+"/payments", map[string]any{"amount": 10.5, "payment_method_code": "cash"})
	if code != 400 || raw != `{"success":false,"error":"Data pembayaran tidak valid"}` {
		t.Fatalf("fraction %s", raw)
	}
	code, body, raw := e.do(e.cashier, "GET", base, nil)
	expect(t, "detail", code, 200, raw)
	d := body["data"].(map[string]any)
	if !strings.Contains(raw, `"balance":{"openTotal":100000,"credit":0,"outstanding":100000,"surplus":0,"canSettle":false}`) ||
		!strings.Contains(raw, `"options":["Large"]`) || d["customer"].(map[string]any)["name"] != "Go Test Member" {
		t.Fatalf("detail %s", raw)
	}
	code, _, raw = e.do(e.cashier, "POST", base+"/payments", map[string]any{"amount": 200000, "payment_method_code": "cash"})
	if code != 400 || raw != `{"success":false,"error":"Nominal melebihi sisa tagihan"}` {
		t.Fatalf("overpay %s", raw)
	}
	code, _, raw = e.do(e.cashier, "POST", base+"/payments", map[string]any{"amount": 1000, "payment_method_code": "foc"})
	if code != 400 || raw != `{"success":false,"error":"FOC tidak bisa dipakai untuk tagihan member"}` {
		t.Fatalf("foc %s", raw)
	}
	code, body, raw = e.do(e.cashier, "POST", base+"/payments", map[string]any{"amount": 30000, "payment_method_code": "cash", "notes": " cicil "})
	expect(t, "instalment", code, 201, raw)
	if body["data"].(map[string]any)["settled_order_count"] != 0.0 || !strings.Contains(raw, `"outstanding":70000`) {
		t.Fatalf("instalment %s", raw)
	}
	code, body, raw = e.do(e.cashier, "POST", base+"/send-wa", map[string]any{"preview": true})
	expect(t, "preview", code, 200, raw)
	if body["data"].(map[string]any)["sent"] != false || !strings.Contains(body["data"].(map[string]any)["message"].(string), "*Sisa tagihan: Rp 70.000*") {
		t.Fatalf("preview %s", raw)
	}
	code, _, raw = e.do(e.cashier, "POST", base+"/settle", nil)
	if code != 400 || raw != `{"success":false,"error":"Saldo cicilan belum menutup semua order"}` {
		t.Fatalf("settle early %s", raw)
	}
	code, body, raw = e.do(e.cashier, "POST", base+"/payments", map[string]any{"amount": 70000, "payment_method_code": "cash"})
	expect(t, "final instalment", code, 201, raw)
	if body["data"].(map[string]any)["settled_order_count"] != 2.0 || len(e.orders.settled) != 2 ||
		!strings.Contains(raw, `"balance":{"openTotal":0,"credit":0,"outstanding":0,"surplus":0,"canSettle":false}`) {
		t.Fatalf("settled %s", raw)
	}
	var events int
	if err := e.tx.QueryRow(e.ctx, `SELECT count(*) FROM platform.outbox_events WHERE key = ANY($1) AND topic = 'pos.sale.completed'`,
		[]string{"aaaaaaaa-0000-4000-8000-000000000001", "aaaaaaaa-0000-4000-8000-000000000002"}).Scan(&events); err != nil || events != 2 {
		t.Fatalf("sale events %d %v", events, err)
	}
}

func strPtr(s string) *string { return &s }
