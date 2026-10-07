package sales

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/possales/internal/jsrow"
	"nuhabit/backend/internal/modules/possales/offers"
	"nuhabit/backend/internal/modules/possales/ports"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/testutil"
)

// Integration tests run every request inside one transaction that is rolled
// back; staff fixtures come from testutil (committed, removed on cleanup).
// Cross-context ports are fakes recording their calls, so the tests pin the
// pos-sales side of each contract.

type env struct {
	t     *testing.T
	ctx   context.Context
	tx    pgx.Tx
	h     *Handler
	mux   http.Handler
	staff testutil.Staff
	// spv is an active pos_supervisor (PIN 4321) and other a plain cashier,
	// both created before the test transaction: rows the transaction locks
	// must outlive it, or their cleanup would wait on the open transaction.
	spv, other testutil.Staff
	fx         fixtures
	f          *fakes
	deps       module.Deps
}

type fixtures struct {
	company, branch, stallA, stallB string
	prodA, prodB, prodA2            string
	customer                        string
}

func setup(t *testing.T) *env {
	t.Helper()
	now := func() time.Time { return time.Now() }
	deps := testutil.Deps(t, now)
	staff := testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{
		"pos.cashier": {"read", "create", "update"}, "pos.cashier.central": nil, "pos.kitchen": nil, "pos.settings.supervisors": nil,
	}})
	ctx := context.Background()
	spv := testutil.CreateStaff(t, testutil.StaffOptions{Role: "pos_supervisor", FullName: "Spv Dua"})
	if _, err := deps.DB.Exec(ctx, `UPDATE configuration.users SET pos_pin = crypt('4321', gen_salt('bf', 4)), status = 'active' WHERE id = $1`, spv.UserID); err != nil {
		t.Fatal(err)
	}
	other := testutil.CreateStaff(t, testutil.StaffOptions{Role: "pos", FullName: "Calon Spv"})
	tx, err := deps.DB.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = tx.Rollback(context.Background()) })
	e := &env{t: t, ctx: ctx, tx: tx, staff: staff, spv: spv, other: other, deps: deps}
	e.fx = e.makeFixtures()
	e.f = newFakes(e.fx)
	e.h = newHandler(tx, deps, e.f.ports())
	e.mux = testutil.Mux(subroutesModule{e.h.Routes()})
	return e
}

type subroutesModule struct{ routes []module.Route }

func (m subroutesModule) Name() string           { return "pos-sales-test" }
func (m subroutesModule) Routes() []module.Route { return m.routes }

func (e *env) exec(sql string, args ...any) {
	e.t.Helper()
	if _, err := e.tx.Exec(e.ctx, sql, args...); err != nil {
		e.t.Fatalf("exec %q: %v", sql, err)
	}
}

func (e *env) scalar(dst any, sql string, args ...any) {
	e.t.Helper()
	if err := e.tx.QueryRow(e.ctx, sql, args...).Scan(dst); err != nil {
		e.t.Fatalf("query %q: %v", sql, err)
	}
}

func (e *env) id(sql string, args ...any) string {
	e.t.Helper()
	var id string
	e.scalar(&id, sql, args...)
	return id
}

func (e *env) makeFixtures() fixtures {
	var fx fixtures
	suffix := testutil.RandomHex(4)
	holding := e.id(`INSERT INTO configuration.holdings (name, code) VALUES ('H', $1) RETURNING id::text`, "H"+suffix)
	fx.company = e.id(`INSERT INTO configuration.companies (holding_id, name, code) VALUES ($1, 'Co', $2) RETURNING id::text`, holding, "C"+suffix)
	fx.branch = e.id(`INSERT INTO configuration.branches (company_id, name, code) VALUES ($1, 'Br', $2) RETURNING id::text`, fx.company, "B"+suffix)
	fx.stallA = e.id(`INSERT INTO configuration.warehouses (branch_id, name, code, is_active) VALUES ($1, 'Stall A', $2, true) RETURNING id::text`, fx.branch, "STALL-1"+suffix)
	fx.stallB = e.id(`INSERT INTO configuration.warehouses (branch_id, name, code, is_active) VALUES ($1, 'Stall B', $2, true) RETURNING id::text`, fx.branch, "STALL-2"+suffix)
	prod := func(name string, price float64) string {
		return e.id(`INSERT INTO pos.pos_products (sku, name, base_price, cost_price) VALUES ($1, $2, $3, 1000) RETURNING id::text`, "SKU-"+name+suffix, name, price)
	}
	fx.prodA, fx.prodA2, fx.prodB = prod("Kopi", 20000), prod("Teh", 8000), prod("Roti", 15000)
	fx.customer = e.id(`INSERT INTO pos.pos_customers (phone, name, total_xp) VALUES ($1, 'Budi', 120) RETURNING id::text`, "+6299"+suffix)
	// The staff sells from stall A by default.
	e.exec(`UPDATE configuration.users SET default_warehouse_id = $1, business_scope = 'branch', company_id = $3, branch_id = $4 WHERE id = $2`,
		fx.stallA, e.staff.UserID, fx.company, fx.branch)
	return fx
}

// call serves a request as the staff (or anonymously) and checks the status.
func (e *env) call(asStaff bool, method, path string, body any, status int) map[string]any {
	e.t.Helper()
	req := testutil.Request(method, path, body)
	if asStaff {
		req = testutil.AsStaff(req, e.staff)
	}
	rec, out := testutil.Do(e.t, e.mux, req)
	if rec.Code != status {
		e.t.Fatalf("%s %s: status %d, want %d; body %s", method, path, rec.Code, status, rec.Body.String())
	}
	return out
}

// raw serves a request and returns the exact body.
func (e *env) raw(method, path string, body any, status int) string {
	e.t.Helper()
	req := testutil.AsStaff(testutil.Request(method, path, body), e.staff)
	rec, _ := testutil.Do(e.t, e.mux, req)
	if rec.Code != status {
		e.t.Fatalf("%s %s: status %d, want %d; body %s", method, path, rec.Code, status, rec.Body.String())
	}
	return rec.Body.String()
}

func errorOf(body map[string]any) string {
	s, _ := body["error"].(string)
	return s
}

/* ── fakes ───────────────────────────────────────────────────────────── */

type fakes struct {
	fx         fixtures
	warehouses map[string]string
	loyalty    *fakeLoyalty
	wallet     *fakeWallet
	notifier   *fakeNotifier
	merch      *fakeMerch
	gift       *fakeGift
	tabs       *fakeTabs
	directory  *fakeDirectory
}

func newFakes(fx fixtures) *fakes {
	return &fakes{
		fx:         fx,
		warehouses: map[string]string{fx.prodA: fx.stallA, fx.prodA2: fx.stallA, fx.prodB: fx.stallB},
		loyalty:    &fakeLoyalty{arkEnabled: true},
		wallet:     &fakeWallet{balance: 50000},
		notifier:   &fakeNotifier{},
		merch:      &fakeMerch{},
		gift:       &fakeGift{},
		tabs:       &fakeTabs{},
		directory:  &fakeDirectory{company: fx.company, branch: fx.branch},
	}
}

func (f *fakes) ports() Ports {
	return Ports{
		Loyalty: f.loyalty, Wallet: f.wallet, GiftCards: f.gift, Tabs: f.tabs, Merchandise: f.merch,
		Catalog: fakeCatalog{f}, Directory: f.directory, Notifier: f.notifier,
		Offers: noOffers{}, Xendit: &fakeXendit{},
	}
}

// noOffers is an offer engine without offers or promo codes: the sale
// tests seed none (the stored-value engine is covered in internal/app).
type noOffers struct{}

func (noOffers) EvaluateForPosCart(context.Context, database.Querier, *string, *string, []offers.CartLine, string, string) (offers.CartEvaluation, error) {
	return offers.CartEvaluation{Applied: []offers.AppliedOffer{}}, nil
}
func (noOffers) RecordUsage(context.Context, database.Querier, offers.UsageInput) error { return nil }
func (noOffers) CaptureUsage(context.Context, database.Querier, string) error           { return nil }
func (noOffers) ReleaseUsage(context.Context, database.Querier, string) error           { return nil }
func (noOffers) HoldPromo(context.Context, database.Querier, offers.HoldInput) (*offers.PromoHold, error) {
	return nil, &offers.PromoRejectedError{Reason: "nonaktif", Message: "Kode promo tidak dikenal atau sudah tidak berlaku"}
}
func (noOffers) CapturePromo(context.Context, database.Querier, string, string) error { return nil }
func (noOffers) ReleasePromo(context.Context, database.Querier, string, string) error { return nil }

type fakeCatalog struct{ f *fakes }

func (c fakeCatalog) Warehouses(_ context.Context, _ database.Querier, ids []string) (map[string]string, error) {
	out := map[string]string{}
	for _, id := range ids {
		if w, ok := c.f.warehouses[id]; ok {
			out[id] = w
		}
	}
	return out, nil
}

func (c fakeCatalog) CostPrices(ctx context.Context, q database.Querier, ids []string) (map[string]float64, error) {
	out := map[string]float64{}
	rows, err := jsrow.Query(ctx, q, `SELECT id, cost_price FROM pos.pos_products WHERE id = ANY($1::uuid[])`, ids)
	for _, r := range rows {
		out[r.Str("id")] = r.Num("cost_price")
	}
	return out, err
}

func (c fakeCatalog) Skus(ctx context.Context, q database.Querier, ids []string) (map[string]ports.ProductSku, error) {
	out := map[string]ports.ProductSku{}
	rows, err := jsrow.Query(ctx, q, `SELECT id, sku FROM pos.pos_products WHERE id = ANY($1::uuid[])`, ids)
	for _, r := range rows {
		out[r.Str("id")] = ports.ProductSku{PosSku: r.StrPtr("sku")}
	}
	return out, err
}

type fakeLoyalty struct {
	arkEnabled bool
	awards     []ports.OrderXP
	xp         float64
	privilege  string
	kolReason  string
}

func (l *fakeLoyalty) AwardOrderXP(_ context.Context, _ database.Querier, in ports.OrderXP) (ports.XPAward, error) {
	l.awards = append(l.awards, in)
	if in.CustomerID == "" {
		return ports.XPAward{Status: "skipped", Reason: "no_customer"}, nil
	}
	if l.xp > 0 {
		return ports.XPAward{Status: "posted", XPAwarded: l.xp, LedgerIDs: []string{"l1"}}, nil
	}
	return ports.XPAward{Status: "skipped", Reason: "non_ark_payment"}, nil
}

func (l *fakeLoyalty) AwardSplitXP(_ context.Context, _ database.Querier, in ports.SplitXP) (ports.XPAward, error) {
	return ports.XPAward{Status: "skipped", Reason: "non_ark_payment"}, nil
}

func (l *fakeLoyalty) TotalXP(ctx context.Context, q database.Querier, id string) (*float64, error) {
	var v *float64
	err := q.QueryRow(ctx, `SELECT total_xp::float8 FROM pos.pos_customers WHERE id = $1`, id).Scan(&v)
	return v, err
}

func (l *fakeLoyalty) ArkCoinEnabled(context.Context, database.Querier) bool { return l.arkEnabled }

func (l *fakeLoyalty) CheckProductPrivileges(context.Context, database.Querier, []string, string) (bool, string, error) {
	return l.privilege == "", l.privilege, nil
}

func (l *fakeLoyalty) ValidateKolComp(context.Context, database.Querier, string, float64) (string, error) {
	return l.kolReason, nil
}

type fakeWallet struct {
	balance float64
	moves   []ports.ArkMove
}

func (w *fakeWallet) Move(_ context.Context, _ database.Querier, m ports.ArkMove) (*float64, error) {
	if w.balance+m.Amount < 0 {
		return nil, ports.ErrArkInsufficient
	}
	w.balance += m.Amount
	w.moves = append(w.moves, m)
	b := w.balance
	return &b, nil
}

func (w *fakeWallet) Balance(context.Context, database.Querier, string) (*float64, error) {
	b := w.balance
	return &b, nil
}

func (w *fakeWallet) OrderRows(context.Context, database.Querier, []string) ([]ports.WalletRow, error) {
	return nil, nil
}

type fakeNotifier struct{ texts []string }

func (n *fakeNotifier) SendText(_ context.Context, target, message, _, _ string) ports.Delivery {
	n.texts = append(n.texts, target+"|"+message)
	return ports.Delivery{OK: true}
}
func (n *fakeNotifier) NotifyComp(context.Context, ports.CompNotice)                   {}
func (n *fakeNotifier) NotifyLargeVoid(context.Context, ports.VoidNotice)              {}
func (n *fakeNotifier) NotifyGiftCardsSold(context.Context, ports.GiftCardsSoldNotice) {}

type fakeMerch struct {
	reject   string
	restored []ports.MerchClaim
}

func (m *fakeMerch) Claim(_ context.Context, _ database.Querier, lines []ports.MerchLine) ([]ports.MerchClaim, int, string, error) {
	if m.reject != "" {
		return nil, 400, m.reject, nil
	}
	return nil, 0, "", nil
}
func (m *fakeMerch) Restore(_ context.Context, _ database.Querier, c []ports.MerchClaim) {
	m.restored = append(m.restored, c...)
}
func (m *fakeMerch) RestoreOne(_ context.Context, _ database.Querier, c ports.MerchClaim) bool {
	m.restored = append(m.restored, c)
	return true
}
func (m *fakeMerch) HasTracked(context.Context, database.Querier, []string) bool { return false }

type fakeGift struct{}

func (fakeGift) PrepareSale(context.Context, database.Querier, []ports.GiftSaleLine) ([]float64, string, error) {
	return nil, "", nil
}
func (fakeGift) Redeem(context.Context, database.Querier, ports.GiftRedeem) (ports.GiftOutcome, error) {
	return ports.GiftOutcome{OK: true}, nil
}
func (fakeGift) Refund(context.Context, database.Querier, ports.GiftScope, string, string, string) (bool, error) {
	return true, nil
}
func (fakeGift) Issue(context.Context, database.Querier, ports.GiftIssue) ([]ports.IssuedGiftCard, error) {
	return nil, nil
}
func (fakeGift) VoidIssued(context.Context, database.Querier, string, string) (int, error) {
	return 0, nil
}

type fakeTabs struct{}

func (fakeTabs) Charge(context.Context, database.Querier, ports.TabCharge) (ports.TabOutcome, error) {
	return ports.TabOutcome{OK: true}, nil
}
func (fakeTabs) Void(context.Context, database.Querier, string, string, string) (bool, error) {
	return true, nil
}

type fakeDirectory struct {
	company, branch string
	central         bool
	supervisors     []ports.Supervisor
}

func (d *fakeDirectory) Venue(context.Context, database.Querier) (string, string) {
	return d.company, d.branch
}
func (d *fakeDirectory) Flags(ctx context.Context, q database.Querier, userID string) (ports.CashierFlags, error) {
	var def *string
	_ = q.QueryRow(ctx, `SELECT default_warehouse_id::text FROM configuration.users WHERE id = $1`, userID).Scan(&def)
	f := ports.CashierFlags{CanCentralCheckout: d.central}
	if def != nil {
		f.DefaultWarehouseID = *def
	}
	return f, nil
}
func (d *fakeDirectory) AssignedWarehouses(context.Context, database.Querier, string) ([]ports.Warehouse, error) {
	return nil, nil
}
func (d *fakeDirectory) BranchWarehouses(context.Context, database.Querier, string) ([]ports.Warehouse, error) {
	return nil, nil
}
func (d *fakeDirectory) ActiveWarehouse(_ context.Context, _ database.Querier, id string) (*ports.Warehouse, error) {
	return &ports.Warehouse{ID: id}, nil
}
func (d *fakeDirectory) EmployeeID(context.Context, database.Querier, string) (string, error) {
	return "", nil
}
func (d *fakeDirectory) EmployeeName(context.Context, database.Querier, string) (*string, error) {
	return nil, nil
}
func (d *fakeDirectory) UserName(context.Context, database.Querier, string) (*string, error) {
	return nil, nil
}
func (d *fakeDirectory) ActiveSupervisors(context.Context, database.Querier) ([]ports.Supervisor, error) {
	return d.supervisors, nil
}
func (d *fakeDirectory) HasCentralMenu(context.Context, string, string) bool { return d.central }

type fakeXendit struct {
	qr       map[string]any
	payments []map[string]any
	created  []string
}

func (x *fakeXendit) Config(context.Context, database.Querier) (*XenditConfig, error) {
	return &XenditConfig{SecretKey: "sk"}, nil
}
func (x *fakeXendit) CreateQR(_ context.Context, _, ref string, amount float64, _, _ string) (*CreatedQR, error) {
	x.created = append(x.created, ref)
	return &CreatedQR{ID: "qr_1", ReferenceID: ref, QRString: "000201", Amount: amount}, nil
}
func (x *fakeXendit) GetQR(_ context.Context, _, id string) (map[string]any, error) {
	if x.qr == nil {
		return map[string]any{"id": id, "status": "ACTIVE"}, nil
	}
	return x.qr, nil
}
func (x *fakeXendit) GetQRByReference(_ context.Context, _, ref string) (map[string]any, error) {
	return map[string]any{"id": "qr_ref", "reference_id": ref}, nil
}
func (x *fakeXendit) QRPayments(context.Context, string, string) ([]map[string]any, error) {
	return x.payments, nil
}

var _ = json.Marshal
