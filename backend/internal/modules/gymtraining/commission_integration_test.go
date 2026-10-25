package gymtraining_test

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/app"
	"nuhabit/backend/internal/modules/gymtraining"
	"nuhabit/backend/internal/modules/gymtraining/domain"
	"nuhabit/backend/internal/platform/testutil"
)

// fakeDiscipline hands out incidents per coach.
type fakeDiscipline map[string][]domain.Incident

func (f fakeDiscipline) IncidentsFor(_ context.Context, coachID, _ string) ([]domain.Incident, error) {
	return f[coachID], nil
}

// commissionFixture runs revenue-share commission inside one rolled-back
// transaction (the credit ledger is append-only). April 2026 is over, so it
// may be approved; staff accounts and their sessions are committed.
type commissionFixture struct {
	t     *testing.T
	ctx   context.Context
	tx    pgx.Tx
	h     *harness
	coach testutil.Staff
	b1    testutil.Org
	b2    testutil.Org
	hana  string
	citra string
	andi  string
	zed   string
}

func (f *commissionFixture) id(sql string, args ...any) string {
	f.t.Helper()
	var v string
	if err := f.tx.QueryRow(f.ctx, sql, args...).Scan(&v); err != nil {
		f.t.Fatalf("%s: %v", sql, err)
	}
	return v
}

func (f *commissionFixture) exec(sql string, args ...any) {
	f.t.Helper()
	if _, err := f.tx.Exec(f.ctx, sql, args...); err != nil {
		f.t.Fatalf("%s: %v", sql, err)
	}
}

func newCommissionFixture(t *testing.T) *commissionFixture {
	deps := testutil.Deps(t, nil)
	staff := testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{"gym.incentives": everything}})
	coach := testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{"gym.my-classes": {"read"}}})
	tx := testutil.Tx(t)
	f := &commissionFixture{t: t, ctx: context.Background(), tx: tx, coach: coach,
		b1: testutil.CreateOrg(t, tx), b2: testutil.CreateOrg(t, tx)}
	ports := app.GymTrainingPortsOn(deps, tx)
	sfx := testutil.RandomHex(3)
	newCoach := func(name string) string {
		return f.id(`INSERT INTO gym.coaches (name) VALUES ($1) RETURNING id::text`, "Go "+name+" "+sfx)
	}
	f.hana, f.citra, f.andi, f.zed = newCoach("Hana"), newCoach("Citra"), newCoach("Andi"), newCoach("Zed")
	ports.Discipline = fakeDiscipline{f.citra: {{ID: "inc-1", Kind: "no_show", OccurredOn: "2026-04-12"}}}
	f.h = &harness{t: t, deps: deps, mux: testutil.Mux(gymtraining.NewOn(deps, tx, ports)), staff: staff}
	f.exec(`UPDATE gym.coaches SET user_id = $2 WHERE id = $1`, f.hana, coach.UserID)
	f.exec(`UPDATE gym.commission_schemes SET is_active = false WHERE branch_id IS NULL`)
	f.seed(sfx)
	return f
}

// seed: April 2026 at branch 1, Hana teaches one class (two attend), Citra
// one class (one attends), Andi one PT session; a cancelled class does not
// count. At branch 2 Hana and Zed teach one class each. Credits worth
// 100,000 each: 2 used and 1 refunded at branch 1 classes, 1 at a branch 1
// PT session, 1 at the branch 2 class, plus one used in May. Pass revenue
// released at branch 1: 50,000 in April, 10,000 in May.
func (f *commissionFixture) seed(sfx string) {
	customer := func(n string) string {
		return f.id(`INSERT INTO pos.pos_customers (phone, name) VALUES ($1, $2) RETURNING id::text`,
			"+62991"+testutil.RandomHex(4), "Go Member "+n+" "+sfx)
	}
	m1, m2 := customer("1"), customer("2")
	classType := f.id(`INSERT INTO gym.class_types (name, default_duration_min, default_credit_cost, default_capacity)
		VALUES ($1, 60, 1, 10) RETURNING id::text`, "Go Commission Class "+sfx)
	ptType := f.id(`INSERT INTO gym.class_types (name, default_duration_min, default_credit_cost, default_capacity, is_personal)
		VALUES ($1, 60, 1, 1, true) RETURNING id::text`, "Go Commission PT "+sfx)
	session := func(branch, coach, at, status string) string {
		return f.id(`INSERT INTO gym.class_sessions (class_type_id, coach_id, branch_id, starts_at, ends_at, capacity, credit_cost,
			booking_opens_at, booking_closes_at, status)
			VALUES ($1, $2, $3, $4::timestamptz, $4::timestamptz + interval '1 hour', 10, 1, $4::timestamptz - interval '7 days',
			        $4::timestamptz, $5) RETURNING id::text`, classType, coach, branch, at, status)
	}
	booking := func(sessionID, customerID, status string) string {
		return f.id(`INSERT INTO gym.bookings (session_id, customer_id, status) VALUES ($1, $2, $3) RETURNING id::text`, sessionID, customerID, status)
	}
	s1 := session(f.b1.BranchID, f.hana, "2026-04-10 07:00+07", "completed")
	hanaBooking := booking(s1, m1, "checked_in")
	booking(s1, m2, "checked_in")
	s2 := session(f.b1.BranchID, f.citra, "2026-04-10 08:00+07", "completed")
	booking(s2, m1, "completed")
	session(f.b1.BranchID, f.andi, "2026-04-10 09:00+07", "cancelled")
	s3 := session(f.b2.BranchID, f.hana, "2026-04-11 07:00+07", "completed")
	b2Booking := booking(s3, m1, "completed")
	session(f.b2.BranchID, f.zed, "2026-04-11 08:00+07", "completed")
	appointment := f.id(`INSERT INTO gym.pt_appointments (coach_id, class_type_id, branch_id, starts_at, ends_at, capacity, credit_cost, status)
		VALUES ($1, $2, $3, '2026-04-12 07:00+07', '2026-04-12 08:00+07', 1, 1, 'completed') RETURNING id::text`, f.andi, ptType, f.b1.BranchID)
	participant := f.id(`INSERT INTO gym.pt_participants (appointment_id, customer_id, status, credits_charged)
		VALUES ($1, $2, 'completed', 1) RETURNING id::text`, appointment, m1)

	creditPackage := f.id(`SELECT id::text FROM gym.credit_packages WHERE kind = 'credits' ORDER BY created_at LIMIT 1`)
	purchase := f.id(`INSERT INTO gym.credit_purchases (customer_id, package_id, credits, price_idr, total_idr, channel, payment_method,
		status, branch_id, paid_at) VALUES ($1, $2, 10, 1000000, 1000000, 'pos', 'cash', 'paid', $3, '2026-04-01') RETURNING id::text`,
		m1, creditPackage, f.b1.BranchID)
	lot := f.id(`INSERT INTO gym.credit_lots (customer_id, package_id, purchase_id, credits, expires_at)
		VALUES ($1, $2, $3, 10, '2027-04-01') RETURNING id::text`, m1, creditPackage, purchase)
	entry := func(kind string, amount int, source, sourceID, at string) {
		f.exec(`INSERT INTO gym.credit_ledger (customer_id, type, amount, lot_id, source_type, source_id, created_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz)`, m1, kind, amount, lot, source, sourceID, at)
	}
	entry("class_deduction", -2, "class_booking", hanaBooking, "2026-04-10 07:05+07")
	entry("refund", 1, "class_booking", hanaBooking, "2026-04-10 07:10+07")
	entry("class_deduction", -1, "pt_session", participant, "2026-04-12 08:00+07")
	entry("class_deduction", -1, "class_booking", b2Booking, "2026-04-11 07:05+07")
	entry("class_deduction", -1, "class_booking", hanaBooking, "2026-05-01 00:10+07")

	passPackage := f.id(`SELECT id::text FROM gym.credit_packages WHERE kind = 'pass' ORDER BY created_at LIMIT 1`)
	passPurchase := f.id(`INSERT INTO gym.credit_purchases (customer_id, package_id, credits, price_idr, total_idr, channel, payment_method,
		status, branch_id, paid_at) VALUES ($1, $2, 0, 300000, 300000, 'pos', 'cash', 'paid', $3, '2026-04-01') RETURNING id::text`,
		m2, passPackage, f.b1.BranchID)
	pass := f.id(`INSERT INTO gym.member_passes (customer_id, package_id, purchase_id, starts_at, ends_at)
		VALUES ($1, $2, $3, '2026-04-01', '2026-05-15') RETURNING id::text`, m2, passPackage, passPurchase)
	f.exec(`INSERT INTO gym.pass_revenue_releases (pass_id, release_date, amount_idr, batch_id) VALUES
		($1, '2026-04-15', 50000, gen_random_uuid()), ($1, '2026-05-01', 10000, gen_random_uuid())`, pass)
}

func (f *commissionFixture) month(branch, month string) map[string]any {
	f.t.Helper()
	c := f.h.asStaff("GET", "/api/gym/incentives/commission?month="+month+"&branch_id="+branch, nil)
	expect(f.t, c, 200, "")
	return c.list()[0].(map[string]any)
}

func lineOf(view map[string]any, coachID string) map[string]any {
	for _, l := range view["lines"].([]any) {
		if line := l.(map[string]any); line["coachId"] == coachID {
			return line
		}
	}
	return nil
}

func (f *commissionFixture) journal(event, documentID string) map[string]any {
	f.t.Helper()
	var raw []byte
	err := f.tx.QueryRow(f.ctx, `SELECT payload FROM platform.outbox_events WHERE topic = 'gym.commission.journal' AND key = $1`,
		event+":"+documentID).Scan(&raw)
	if err != nil {
		f.t.Fatalf("journal %s %s: %v", event, documentID, err)
	}
	var out map[string]any
	_ = json.Unmarshal(raw, &out)
	return out
}

func TestRevenueShareCommission(t *testing.T) {
	f := newCommissionFixture(t)
	h := f.h

	// Without an active scheme the month shows no split.
	if v := f.month(f.b1.BranchID, "2026-04"); v["settings"] != nil || v["status"] != "preview" || len(v["lines"].([]any)) != 0 {
		t.Fatalf("no scheme = %v", v)
	}
	scheme := map[string]any{"branch_id": f.b1.BranchID, "name": "Bagi hasil cabang 1", "payout_channel": "payroll"}
	expect(t, h.asStaff("POST", "/api/gym/incentives/commission/settings", map[string]any{"branch_id": f.b1.BranchID,
		"name": "Salah", "payout_channel": "payroll", "deduction_percents": map[string]any{"No Show": 10}}), 400,
		"Data tidak valid: deduction_percents.No Show")
	saved := h.asStaff("POST", "/api/gym/incentives/commission/settings", scheme)
	expect(t, saved, 200, "")
	schemeID := saved.data()["id"].(string)
	expect(t, h.asStaff("POST", "/api/gym/incentives/commission/settings", scheme), 409, "Cabang ini sudah punya skema bagi hasil")
	expect(t, h.asStaff("POST", "/api/gym/incentives/commission/settings", map[string]any{"branch_id": f.b2.BranchID,
		"name": "Bagi hasil cabang 2", "payout_channel": "direct"}), 200, "")
	for coach, profile := range map[string]map[string]any{
		f.hana:  {"role": "head_coach", "share_percent": nil},
		f.citra: {"role": "coach", "share_percent": 25},
		f.andi:  {"role": "assistant", "share_percent": nil},
		f.zed:   {"role": "coach", "share_percent": 0},
	} {
		expect(t, h.asStaff("PUT", "/api/gym/incentives/commission/coaches/"+coach, profile), 200, "")
	}
	expect(t, h.asStaff("PUT", "/api/gym/incentives/commission/coaches/"+f.hana, map[string]any{"role": "owner"}), 400, "Data tidak valid: role")
	form := h.asStaff("GET", "/api/gym/incentives/commission/settings", nil)
	expect(t, form, 200, "")
	if d := form.data()["defaults"].(map[string]any); d["classPoolPercent"] != 10.0 || d["ptPoolPercent"] != 40.0 {
		t.Fatalf("defaults = %v", d)
	}

	// Class revenue 200k − 100k refunded + 50k pass, PT 100k: pool 15k + 40k.
	v := f.month(f.b1.BranchID, "2026-04")
	if v["classRevenueIdr"] != 150000.0 || v["ptRevenueIdr"] != 100000.0 || v["totalPoolIdr"] != 55000.0 ||
		v["status"] != "preview" || v["monthOver"] != true || v["schemeId"] != schemeID {
		t.Fatalf("branch 1 month = %v", v)
	}
	hana, citra, andi := lineOf(v, f.hana), lineOf(v, f.citra), lineOf(v, f.andi)
	// Hana taught 1 of her 2 sessions here: half of 20%.
	if hana["attributionPercent"] != 50.0 || hana["grossIdr"] != 5500.0 || hana["attendees"] != 2.0 || hana["role"] != "head_coach" {
		t.Fatalf("hana = %v", hana)
	}
	// Citra's 25% override, cut 15% for a no-show.
	if citra["sharePercent"] != 25.0 || citra["grossIdr"] != 13750.0 || citra["deductionPercent"] != 15.0 ||
		citra["deductionIdr"] != 2062.5 || citra["amountIdr"] != 11687.5 || len(citra["incidents"].([]any)) != 1 {
		t.Fatalf("citra = %v", citra)
	}
	if andi["ptSessions"] != 1.0 || andi["classSessions"] != 0.0 || andi["amountIdr"] != 4400.0 {
		t.Fatalf("andi = %v", andi)
	}
	if v["allocatedPercent"] != 43.0 || v["allocatedIdr"] != 21587.5 || v["retainedIdr"] != 33412.5 || len(v["lines"].([]any)) != 3 {
		t.Fatalf("branch 1 totals = %v", v)
	}

	// Draft, then approval locks the numbers and accrues them.
	act := func(branch, month, action string) call {
		return h.asStaff("POST", "/api/gym/incentives/commission", map[string]any{"branch_id": branch, "month": month, "action": action})
	}
	expect(t, act(f.b1.BranchID, "2026-4", "draft"), 400, "Data tidak valid: month")
	draft := act(f.b1.BranchID, "2026-04", "draft")
	expect(t, draft, 200, "")
	if draft.data()["status"] != "draft" || draft.data()["statementId"] == nil {
		t.Fatalf("draft = %v", draft.data())
	}
	expect(t, act(f.b1.BranchID, "2031-04", "approve"), 409, "Komisi baru bisa disetujui setelah bulannya berakhir.")
	approved := act(f.b1.BranchID, "2026-04", "approve")
	expect(t, approved, 200, "")
	statementID := approved.data()["statementId"].(string)
	if approved.data()["status"] != "approved" || approved.data()["allocatedIdr"] != 21587.5 {
		t.Fatalf("approved = %v", approved.data())
	}
	if j := f.journal("GYM_COMMISSION_ACCRUAL", statementID); j["amount"] != 21587.5 || j["entry_date"] != "2026-04-30" ||
		j["company_id"] != f.b1.CompanyID || j["document_type"] != "gym_commission_statement" {
		t.Fatalf("accrual = %v", j)
	}
	expect(t, act(f.b1.BranchID, "2026-04", "approve"), 409, "Statement komisi bulan ini sudah disetujui.")
	expect(t, act(f.b1.BranchID, "2026-04", "draft"), 409, "Statement komisi bulan ini sudah disetujui.")

	// Later revenue no longer moves an approved month.
	f.exec(`INSERT INTO gym.pass_revenue_releases (pass_id, release_date, amount_idr, batch_id)
		SELECT pass_id, '2026-04-20', 70000, gen_random_uuid() FROM gym.pass_revenue_releases WHERE release_date = '2026-04-15'
		 AND amount_idr = 50000 LIMIT 1`)
	locked := f.month(f.b1.BranchID, "2026-04")
	hanaLine := lineOf(locked, f.hana)
	if locked["totalPoolIdr"] != 55000.0 || hanaLine["id"] == nil || hanaLine["status"] != "pending" {
		t.Fatalf("locked month = %v", locked)
	}

	// Branch 1 pays through payroll.
	pay := func(lineID string, body map[string]any) call {
		return h.asStaff("POST", "/api/gym/incentives/commission/lines/"+lineID, body)
	}
	hanaID := hanaLine["id"].(string)
	expect(t, pay(hanaID, map[string]any{"method": "cash"}), 409, "Skema ini membayar komisi lewat payroll.")
	expect(t, pay(hanaID, map[string]any{"method": "payroll"}), 409,
		"Coach ini belum tertaut ke karyawan HRIS. Tautkan akun staf coach ke data karyawan agar komisi masuk payroll.")
	employee := f.id(`INSERT INTO hris.employees (full_name, nip, email, phone, join_date, employment_status, is_active, user_id)
		VALUES ('Go Hana', $1, $2, '0812000222', '2024-01-15', 'permanent', true, $3) RETURNING id::text`,
		"GOC-"+testutil.RandomHex(4), f.coach.Email, f.coach.UserID)
	f.exec(`INSERT INTO hris.employee_salary (employee_id, base_salary, effective_date) VALUES ($1, 5000000, '2026-01-01')`, employee)
	expect(t, pay(hanaID, map[string]any{"method": "payroll"}), 200, "")
	expect(t, pay(hanaID, map[string]any{"method": "payroll"}), 409, "Komisi coach ini sudah dibayar.")
	var addition string
	if err := f.tx.QueryRow(f.ctx, `SELECT format('%s|%s|%s', amount::float8, label, source_type) FROM hris.payroll_additions
		WHERE source_id = $1`, hanaID).Scan(&addition); err != nil || addition != "5500|Komisi coach 2026-04 "+locked["branchName"].(string)+"|gym.coach_commission" {
		t.Fatalf("payroll addition = %q %v", addition, err)
	}
	if j := f.journal("GYM_COMMISSION_PAYROLL", hanaID); j["amount"] != 5500.0 || j["document_type"] != "gym_commission_line" {
		t.Fatalf("payroll hand-over = %v", j)
	}
	if lineOf(f.month(f.b1.BranchID, "2026-04"), f.hana)["paymentMethod"] != "payroll" {
		t.Fatalf("paid line not marked")
	}

	// Branch 2 pays outside payroll; Zed's zero line is settled at approval
	// and the statement closes with the last payment.
	expect(t, act(f.b2.BranchID, "2026-04", "approve"), 200, "")
	b2 := f.month(f.b2.BranchID, "2026-04")
	zed, hana2 := lineOf(b2, f.zed), lineOf(b2, f.hana)
	if b2["totalPoolIdr"] != 10000.0 || zed["status"] != "paid" || zed["amountIdr"] != 0.0 || hana2["amountIdr"] != 1000.0 {
		t.Fatalf("branch 2 = %v", b2)
	}
	hana2ID := hana2["id"].(string)
	expect(t, pay(hana2ID, map[string]any{"method": "payroll"}), 409, "Skema ini membayar komisi di luar payroll: pilih tunai atau transfer.")
	expect(t, pay(hana2ID, map[string]any{"method": "transfer", "payment_reference": "  "}), 409, "Referensi transfer wajib diisi.")
	expect(t, pay(hana2ID, map[string]any{"method": "transfer", "payment_reference": "TRF-77"}), 200, "")
	if j := f.journal("GYM_COMMISSION_PAYMENT_BANK", hana2ID); j["amount"] != 1000.0 || j["company_id"] != f.b2.CompanyID {
		t.Fatalf("direct payment = %v", j)
	}
	if s := f.month(f.b2.BranchID, "2026-04")["status"]; s != "paid" {
		t.Fatalf("branch 2 status = %v", s)
	}

	// The coach reads their lines at both branches.
	rec, body := testutil.Do(t, h.mux, testutil.AsStaff(testutil.Request("GET", "/api/gym/my-classes/commission?month=2026-04", nil), f.coach))
	mine := call{rec.Code, body}
	expect(t, mine, 200, "")
	if month, history := mine.data()["month"].([]any), mine.data()["history"].([]any); len(month) != 2 || len(history) != 2 ||
		mine.data()["coach"].(map[string]any)["id"] != f.hana {
		t.Fatalf("my commission = %v", mine.data())
	}

	expect(t, h.asStaff("DELETE", "/api/gym/incentives/commission/settings?id="+schemeID, nil), 200, "")
	defaultID := f.id(`SELECT id::text FROM gym.commission_schemes WHERE branch_id IS NULL`)
	expect(t, h.asStaff("DELETE", "/api/gym/incentives/commission/settings?id="+defaultID, nil), 404,
		"Skema bagi hasil tidak ditemukan atau skema default (tidak bisa dihapus)")
	if s := f.month(f.b1.BranchID, "2026-04")["status"]; s != "approved" {
		t.Fatalf("approved month after scheme delete = %v", s)
	}
}
