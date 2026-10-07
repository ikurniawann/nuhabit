package loyalty

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/contracts/posops"
	"nuhabit/backend/internal/contracts/possales"
	"nuhabit/backend/internal/modules/crm/internal/crmtest"
	"nuhabit/backend/internal/modules/crm/xp"
	xpdomain "nuhabit/backend/internal/modules/crm/xp/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/outbox"
	"nuhabit/backend/internal/platform/testutil"
)

// testPos is a minimal PosReads for tests (the real adapter lives in
// internal/app).
type testPos struct{}

func (testPos) LoyaltySettings(context.Context, database.Querier) (xpdomain.PosSettings, error) {
	return xpdomain.DefaultPosSettings(), nil
}
func (testPos) ProductXP(context.Context, database.Querier, []string) (map[string]float64, error) {
	return map[string]float64{}, nil
}
func (testPos) ProductBonusXP(context.Context, database.Querier, []string) (map[string]float64, error) {
	return map[string]float64{}, nil
}
func (testPos) OrderNumber(context.Context, database.Querier, string) string { return "" }

type env struct {
	t   *testing.T
	tx  pgx.Tx
	mux *http.ServeMux
	eng *xp.Engine
}

func setup(t *testing.T) env {
	t.Helper()
	tx := testutil.Tx(t)
	d := testutil.Deps(t, nil)
	eng := &xp.Engine{Pos: testPos{}, Log: d.Log, Now: d.Now}
	return env{t: t, tx: tx, mux: crmtest.Mux(newHandler(tx, d, eng, Ports{}).routes()), eng: eng}
}

func (e env) call(method, path string, body any, s *testutil.Staff) (int, map[string]any) {
	e.t.Helper()
	return crmtest.Call(e.t, e.mux, method, path, body, s)
}

func (e env) customer(totalXP int) string {
	e.t.Helper()
	return crmtest.Scalar[string](e.t, e.tx, `INSERT INTO pos.pos_customers (phone, name, total_xp) VALUES ($1, 'Loyalty Test', $2) RETURNING id::text`,
		"+6298"+testutil.RandomHex(4), totalXP)
}

func data(t *testing.T, body map[string]any) map[string]any {
	t.Helper()
	d, ok := body["data"].(map[string]any)
	if !ok {
		t.Fatalf("no data object: %v", body)
	}
	return d
}

func TestTiersAndXPRules(t *testing.T) {
	e := setup(t)
	pos := crmtest.Staff(t, "pos")
	settings := crmtest.Staff(t, "crm.settings")

	if code, body := e.call("GET", "/api/crm/tiers", nil, nil); code != 401 || body["error"] != "Authentication required" {
		t.Fatalf("anon tiers: %d %v", code, body)
	}
	if code, _ := e.call("GET", "/api/crm/tiers", nil, &settings); code != 401 {
		t.Fatalf("tiers without pos grant must be 401, got %d", code)
	}
	code, body := e.call("GET", "/api/crm/tiers", nil, &pos)
	if code != 200 || body["meta"].(map[string]any)["schemaReady"] != true {
		t.Fatalf("tiers: %d %v", code, body)
	}
	first := body["data"].([]any)[0].(map[string]any)
	if _, isStr := first["min_total_spend"].(string); !isStr {
		t.Fatalf("numeric columns must be strings: %v", first)
	}

	if code, _ := e.call("POST", "/api/crm/tiers", map[string]any{}, &pos); code != 403 {
		t.Fatalf("tier POST without settings grant: %d", code)
	}
	code, body = e.call("POST", "/api/crm/tiers", map[string]any{"code": "", "name": "X"}, &settings)
	if code != 400 || body["error"] != "Validation failed" {
		t.Fatalf("tier validation: %d %v", code, body)
	}
	tierCode := "GoTier" + testutil.RandomHex(3)
	code, body = e.call("POST", "/api/crm/tiers", map[string]any{
		"code": " " + tierCode + " ", "name": "Go Tier", "rank": 9000 + int(testutil.RandomHex(1)[0]), "benefits": []string{"a", "b"},
	}, &settings)
	row := data(t, body)
	if code != 200 || row["code"] != strings.ToLower(tierCode) || row["display_color"] != "#6B7280" || len(row["benefits"].([]any)) != 2 || row["xp_multiplier"] != "1.00" {
		t.Fatalf("tier upsert: %d %v", code, body)
	}

	code, body = e.call("POST", "/api/crm/xp-rules", map[string]any{
		"code": "R1", "name": "Rule", "source_channel": "pos", "source_type": "order_amount",
		"outlet_scope": "specific", "xp_mode": "fixed", "xp_value": 5,
	}, &settings)
	issues, _ := body["details"].([]any)
	if code != 400 || body["error"] != "Validation failed" || len(issues) != 1 ||
		issues[0].(map[string]any)["message"] != "outlet_id wajib diisi jika outlet_scope specific" {
		t.Fatalf("xp rule refine: %d %v", code, body)
	}
	ruleCode := "go_rule_" + testutil.RandomHex(3)
	code, body = e.call("POST", "/api/crm/xp-rules", map[string]any{
		"code": ruleCode, "name": "Rule", "source_channel": "photobooth", "source_type": "session",
		"xp_mode": "per_amount", "xp_value": 2, "amount_step": 1000, "starts_at": "2026-10-01T00:00:00Z",
		"metadata": map[string]any{"k": 1},
	}, &settings)
	row = data(t, body)
	if code != 200 || row["xp_value"] != "2.0000" || row["priority"] != float64(100) || row["starts_at"] != "2026-10-01T00:00:00.000Z" {
		t.Fatalf("xp rule upsert: %d %v", code, body)
	}
	code, body = e.call("GET", "/api/crm/xp-rules?source_channel=photobooth", nil, &pos)
	if code != 200 {
		t.Fatalf("xp rules list: %d %v", code, body)
	}
	found := false
	for _, it := range body["data"].([]any) {
		if it.(map[string]any)["code"] == ruleCode {
			found = true
		}
	}
	if !found {
		t.Fatalf("rule not listed: %v", body)
	}
}

func TestRewardsAndRedemptions(t *testing.T) {
	e := setup(t)
	pos := crmtest.Staff(t, "pos")
	settings := crmtest.Staff(t, "crm.settings")
	operator := crmtest.Staff(t, "crm.loyalty")

	rewardCode := "go_reward_" + testutil.RandomHex(3)
	code, body := e.call("POST", "/api/crm/rewards", map[string]any{
		"code": rewardCode, "name": "Voucher", "reward_type": "voucher", "min_xp": 500, "stock_total": 2,
		"max_redemptions_per_member": 1, "quota_period": "monthly",
	}, &settings)
	reward := data(t, body)
	if code != 200 || reward["quota_period"] != "monthly" || reward["stock_redeemed"] != float64(0) {
		t.Fatalf("reward upsert: %d %v", code, body)
	}
	rewardID := reward["id"].(string)

	code, body = e.call("GET", "/api/crm/rewards", nil, &pos)
	if code != 200 {
		t.Fatalf("rewards list: %d %v", code, body)
	}
	for _, it := range body["data"].([]any) {
		m := it.(map[string]any)
		if m["reward_type"] == "avatar" {
			t.Fatal("avatar rewards must be hidden by default")
		}
		if _, ok := m["required_tier"]; !ok {
			t.Fatalf("required_tier embed missing: %v", m)
		}
	}

	poor := e.customer(100)
	code, body = e.call("POST", "/api/crm/redemptions", map[string]any{"customer_id": poor, "reward_id": rewardID}, &operator)
	if code != 409 || body["error"] != "XP kamu belum mencukupi" {
		t.Fatalf("insufficient XP: %d %v", code, body)
	}
	rich := e.customer(1000)
	code, body = e.call("POST", "/api/crm/redemptions", map[string]any{"customer_id": rich, "reward_id": rewardID, "notes": " hi "}, &operator)
	red := data(t, body)
	if code != 200 || red["status"] != "fulfilled" || red["channel"] != "admin" || red["fulfilled_at"] == nil {
		t.Fatalf("claim: %d %v", code, body)
	}
	if n := crmtest.Scalar[int32](t, e.tx, `SELECT stock_redeemed FROM crm.crm_rewards WHERE id = $1`, rewardID); n != 1 {
		t.Fatalf("stock_redeemed = %d", n)
	}
	code, body = e.call("POST", "/api/crm/redemptions", map[string]any{"customer_id": rich, "reward_id": rewardID}, &operator)
	if code != 409 || body["error"] != "Jatah redeem kamu untuk reward ini sudah habis" {
		t.Fatalf("quota: %d %v", code, body)
	}
	code, body = e.call("PATCH", "/api/crm/redemptions", map[string]any{"id": red["id"], "action": "approve"}, &operator)
	if code != 409 || body["error"] != `Redemption berstatus "fulfilled" tidak bisa di-approve` {
		t.Fatalf("bad transition: %d %v", code, body)
	}

	pendingID := crmtest.Scalar[string](t, e.tx, `INSERT INTO crm.crm_redemptions (customer_id, reward_id, min_xp_at_redeem, status, channel)
		VALUES ($1, $2, 500, 'pending', 'portal') RETURNING id::text`, poor, rewardID)
	crmtest.MustExec(t, e.tx, `UPDATE crm.crm_rewards SET stock_redeemed = 2 WHERE id = $1`, rewardID)
	code, body = e.call("PATCH", "/api/crm/redemptions", map[string]any{"id": pendingID, "action": "cancel", "notes": "x"}, &operator)
	if code != 200 || data(t, body)["status"] != "cancelled" || data(t, body)["cancelled_at"] == nil {
		t.Fatalf("cancel: %d %v", code, body)
	}
	if n := crmtest.Scalar[int32](t, e.tx, `SELECT stock_redeemed FROM crm.crm_rewards WHERE id = $1`, rewardID); n != 1 {
		t.Fatalf("cancel must release stock, got %d", n)
	}
	if code, body := e.call("PATCH", "/api/crm/redemptions", map[string]any{"id": "550e8400-e29b-41d4-a716-446655440000", "action": "fulfill"}, &operator); code != 404 || body["error"] != "Redemption tidak ditemukan" {
		t.Fatalf("missing redemption: %d %v", code, body)
	}

	reader := crmtest.Staff(t, "crm.reports")
	code, body = e.call("GET", "/api/crm/redemptions?customer_id="+rich+"&limit=5", nil, &reader)
	list := body["data"].([]any)
	if code != 200 || len(list) != 1 || list[0].(map[string]any)["reward"].(map[string]any)["min_xp"] != float64(500) {
		t.Fatalf("redemptions list: %d %v", code, body)
	}

	code, body = e.call("DELETE", "/api/crm/rewards?id="+rewardID, nil, &settings)
	if code != 409 || body["error"] != "Reward sudah memiliki redemption dan tidak bisa dihapus. Nonaktifkan reward sebagai gantinya." {
		t.Fatalf("delete with redemptions: %d %v", code, body)
	}
	if code, body := e.call("DELETE", "/api/crm/rewards", nil, &settings); code != 400 || body["error"] != "Reward id wajib diisi" {
		t.Fatalf("delete without id: %d %v", code, body)
	}
	// A 22P02 aborts the transaction, so it runs on a fresh one.
	if code, body := setup(t).call("GET", "/api/crm/redemptions?customer_id=nope", nil, &reader); code != 400 || body["error"] != "Format data tidak valid" {
		t.Fatalf("bad uuid filter: %d %v", code, body)
	}
}

func TestSettingsAndFeatures(t *testing.T) {
	e := setup(t)
	pos := crmtest.Staff(t, "pos")
	settings := crmtest.Staff(t, "crm.settings")

	code, body := e.call("GET", "/api/crm/settings", nil, &pos)
	if code != 200 || body["meta"].(map[string]any)["schemaReady"] != true {
		t.Fatalf("settings: %d %v", code, body)
	}
	if _, ok := data(t, body)["default_company_id"]; ok {
		t.Fatal("non-editable keys must not be exposed")
	}
	code, body = e.call("PUT", "/api/crm/settings", map[string]any{"unknown": 1}, &settings)
	issues, _ := body["details"].([]any)
	if code != 400 || body["error"] != "Validation failed" || len(issues) != 1 || issues[0].(map[string]any)["message"] != "Minimal satu setting harus diisi" {
		t.Fatalf("empty settings: %d %v", code, body)
	}
	code, body = e.call("PUT", "/api/crm/settings", map[string]any{"xp_enabled": false, "cs_auto_reply_text": "  Halo  "}, &settings)
	if code != 200 || body["success"] != true || len(body) != 1 {
		t.Fatalf("settings put: %d %v", code, body)
	}
	if v := crmtest.Scalar[string](t, e.tx, `SELECT value::text FROM crm.crm_settings WHERE key = 'cs_auto_reply_text'`); v != `"Halo"` {
		t.Fatalf("trimmed text: %s", v)
	}
	code, body = e.call("GET", "/api/crm/loyalty-features", nil, &pos)
	if f := data(t, body); code != 200 || f["xp"] != false || f["arkCoin"] == nil {
		t.Fatalf("features: %d %v", code, body)
	}
}

func TestXPAdjust(t *testing.T) {
	e := setup(t)
	writer := crmtest.Staff(t, "crm.loyalty")
	customer := e.customer(50)
	path := "/api/crm/members/pos-" + customer + "/xp-adjust"
	req := "550e8400-e29b-41d4-a716-" + testutil.RandomHex(6)

	if code, body := e.call("POST", "/api/crm/members/550e8400-e29b-41d4-a716-446655440000/xp-adjust", map[string]any{}, &writer); code != 404 || body["error"] != "Member tidak ditemukan" {
		t.Fatalf("missing member: %d %v", code, body)
	}
	code, body := e.call("POST", path, map[string]any{"delta": 0, "reason": "koreksi", "request_id": req}, &writer)
	if code != 400 || body["error"] != "Jumlah XP tidak boleh 0" {
		t.Fatalf("zero delta: %d %v", code, body)
	}
	code, body = e.call("POST", path, map[string]any{"delta": 10, "reason": "ok", "request_id": req}, &writer)
	if code != 400 || body["error"] != "Data tidak valid" {
		t.Fatalf("short reason: %d %v", code, body)
	}
	code, body = e.call("POST", path, map[string]any{"delta": -80, "reason": "koreksi salah input", "request_id": req}, &writer)
	if d := data(t, body); code != 200 || d["status"] != "posted" || d["xpDelta"] != float64(-50) || d["totalXp"] != float64(0) || body["message"] != "XP member disesuaikan" {
		t.Fatalf("adjust: %d %v", code, body)
	}
	code, body = e.call("POST", path, map[string]any{"delta": -80, "reason": "koreksi salah input", "request_id": req}, &writer)
	if code != 200 || data(t, body)["status"] != "duplicate" || body["message"] != "Penyesuaian ini sudah tercatat" {
		t.Fatalf("duplicate: %d %v", code, body)
	}
	other := "550e8400-e29b-41d4-a716-" + testutil.RandomHex(6)
	code, body = e.call("POST", path, map[string]any{"delta": -5, "reason": "koreksi lagi", "request_id": other}, &writer)
	if code != 409 || body["error"] != "XP member sudah 0, tidak ada yang dikurangi" {
		t.Fatalf("skipped: %d %v", code, body)
	}
}

func TestPosSaleSubscriberAwardsXPAndStats(t *testing.T) {
	e := setup(t)
	ctx := context.Background()
	bus := outbox.NewBus(nil, testutil.Deps(t, nil).Log)
	Subscribe(bus, e.eng)
	if err := bus.Register(ctx, e.tx); err != nil {
		t.Fatal(err)
	}
	customer := e.customer(0)
	orderID := "550e8400-e29b-41d4-a716-" + testutil.RandomHex(6)
	stats := 25000.0
	ev := possales.SaleCompleted{
		OrderID: orderID, CustomerID: &customer, TotalAmount: 25000, PaymentMethod: "ark_coin",
		Items: []possales.SaleItem{{ProductID: "550e8400-e29b-41d4-a716-446655440001", Quantity: 1}}, StatsAmount: &stats,
	}
	for range 2 { // the second delivery must be a no-op for XP
		if err := outbox.Publish(ctx, e.tx, possales.TopicSaleCompleted, orderID, ev); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := bus.Dispatch(ctx, e.tx); err != nil {
		t.Fatal(err)
	}
	// Default settings: 1 XP per Rp10.000 => 2 XP, regular tier multiplier 1.
	if xpTotal := crmtest.Scalar[float64](t, e.tx, `SELECT total_xp::float8 FROM pos.pos_customers WHERE id = $1`, customer); xpTotal != 2 {
		t.Fatalf("total_xp = %v", xpTotal)
	}
	if n := crmtest.Scalar[int64](t, e.tx, `SELECT count(*) FROM crm.crm_xp_ledger WHERE idempotency_key = $1`, "pos:order:"+orderID+":order_amount"); n != 1 {
		t.Fatalf("ledger rows = %d", n)
	}
	if visits := crmtest.Scalar[int32](t, e.tx, `SELECT visit_count FROM pos.pos_customers WHERE id = $1`, customer); visits != 2 {
		t.Fatalf("visit_count = %d (stats follow each event)", visits)
	}
	desc := crmtest.Scalar[string](t, e.tx, `SELECT description FROM crm.crm_xp_ledger WHERE idempotency_key = $1`, "pos:order:"+orderID+":order_amount")
	if desc != "XP transaksi POS — order "+orderID[:8]+" (Rp25.000)" {
		t.Fatalf("description %q", desc)
	}

	if err := outbox.Publish(ctx, e.tx, possales.TopicOrdersVoided, orderID, possales.OrdersVoided{
		OrderIDs: []string{orderID}, VoidReason: "salah", ReverseXP: true, StatsCustomerID: &customer, StatsAmount: 25000, StatsVisitDelta: 1,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := bus.Dispatch(ctx, e.tx); err != nil {
		t.Fatal(err)
	}
	if xpTotal := crmtest.Scalar[float64](t, e.tx, `SELECT total_xp::float8 FROM pos.pos_customers WHERE id = $1`, customer); xpTotal != 0 {
		t.Fatalf("total_xp after void = %v", xpTotal)
	}
	if visits := crmtest.Scalar[int32](t, e.tx, `SELECT visit_count FROM pos.pos_customers WHERE id = $1`, customer); visits != 1 {
		t.Fatalf("visit_count after void = %d", visits)
	}

	if err := outbox.Publish(ctx, e.tx, possales.TopicCustomerOrderRecorded, orderID, possales.CustomerOrderRecorded{CustomerID: customer, OrderID: orderID, Amount: 1000}); err != nil {
		t.Fatal(err)
	}
	if _, err := bus.Dispatch(ctx, e.tx); err != nil {
		t.Fatal(err)
	}
	if visits := crmtest.Scalar[int32](t, e.tx, `SELECT visit_count FROM pos.pos_customers WHERE id = $1`, customer); visits != 2 {
		t.Fatalf("visit_count after table order = %d", visits)
	}

	if res := e.eng.AwardPosOrder(ctx, e.tx, xp.PosOrder{OrderID: orderID + "x", CustomerID: customer, TotalAmount: 50000, PaymentMethod: "cash"}); res.Status != "skipped" || res.Reason != "non_ark_payment" {
		t.Fatalf("cash: %+v", res)
	}
}

func TestDashboard(t *testing.T) {
	e := setup(t)
	pos := crmtest.Staff(t, "pos")
	if code, _ := e.call("GET", "/api/crm/dashboard", nil, nil); code != 401 {
		t.Fatalf("anon: %d", code)
	}
	customer := e.customer(0)
	if res, err := e.eng.AwardFlat(context.Background(), e.tx, xp.FlatAward{
		CustomerID: customer, XPAmount: 7, SourceType: "challenge", SourceID: customer, ReferenceTable: "challenges",
		IdempotencyKey: "dash-test:" + customer, Description: "Bonus 0b6f2c1e-5d4a-4c3b-9a8e-7f6d5c4b3a21",
	}); err != nil || res.Status != "posted" {
		t.Fatalf("award: %+v %v", res, err)
	}
	code, body := e.call("GET", "/api/crm/dashboard", nil, &pos)
	if code != 200 || body["meta"].(map[string]any)["schemaReady"] != true {
		t.Fatalf("dashboard: %d %v", code, body)
	}
	d := data(t, body)
	stats := d["stats"].(map[string]any)
	if stats["totalCustomers"].(float64) < 1 || stats["tierCount"].(float64) < 1 {
		t.Fatalf("stats: %v", stats)
	}
	activity := d["recentXpActivity"].([]any)
	first := activity[0].(map[string]any)
	if first["description"] != "Bonus 0b6f2c1e" || first["member"].(map[string]any)["customer_id"] != customer {
		t.Fatalf("activity: %v", first)
	}
	if len(d["topLoyalMembers"].([]any)) == 0 {
		t.Fatal("top loyal members")
	}
}

func TestPosEnrollmentSubscriber(t *testing.T) {
	e := setup(t)
	ctx := context.Background()
	bus := outbox.NewBus(nil, testutil.Deps(t, nil).Log)
	Subscribe(bus, e.eng)
	if err := bus.Register(ctx, e.tx); err != nil {
		t.Fatal(err)
	}
	customer := e.customer(40)
	ev := posops.CustomerEnrolled{CustomerID: customer, TierCode: "no-such-tier", LifetimeXp: 40, EnrolledBy: "staff-1", EnrolledAt: "2026-10-04T03:00:00.000Z"}
	for range 2 { // redelivery is harmless
		if err := outbox.Publish(ctx, e.tx, posops.TopicCustomerEnrolled, customer, ev); err != nil {
			t.Fatal(err)
		}
	}
	ev.TierCode = "silver"
	if err := outbox.Publish(ctx, e.tx, posops.TopicCustomerEnrolled, customer, ev); err != nil {
		t.Fatal(err)
	}
	if _, err := bus.Dispatch(ctx, e.tx); err != nil {
		t.Fatal(err)
	}
	got := crmtest.Scalar[string](t, e.tx, `SELECT t.code || '|' || p.lifetime_xp || '|' || p.loyalty_score || '|' || p.status || '|' || (p.metadata->>'enrolled_by')
		|| '|' || to_char(p.last_activity_at AT TIME ZONE 'UTC', 'HH24:MI')
		FROM crm.crm_member_profiles p JOIN crm.crm_membership_tiers t ON t.id = p.tier_id WHERE p.customer_id = $1`, customer)
	if got != "silver|40|40.00|active|staff-1|03:00" {
		t.Fatalf("profile %q", got)
	}
	if n := crmtest.Scalar[int64](t, e.tx, `SELECT count(*) FROM platform.outbox_deliveries d JOIN platform.outbox_events ev ON ev.id = d.event_id
		WHERE ev.key = $1 AND d.delivered_at IS NULL`, customer); n != 0 {
		t.Fatalf("%d undelivered", n)
	}
}
