package demo

import (
	"bytes"
	"context"
	"fmt"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/platform/testutil"
)

// The migrations seed the demo class types, coaches, packages, templates
// and two weeks of sessions; the tests run against that seed inside one
// rolled-back transaction.

func scalar(t *testing.T, tx pgx.Tx, sql string, args ...any) string {
	t.Helper()
	var v *string
	if err := tx.QueryRow(context.Background(), sql, args...).Scan(&v); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
	if v == nil {
		return ""
	}
	return *v
}

func exec(t *testing.T, tx pgx.Tx, sql string, args ...any) {
	t.Helper()
	if _, err := tx.Exec(context.Background(), sql, args...); err != nil {
		t.Fatalf("%s: %v", sql, err)
	}
}

func kept(p *Plan, table, id string) *Item {
	for i := range p.Keep {
		if p.Keep[i].Table == table && p.Keep[i].ID == id {
			return &p.Keep[i]
		}
	}
	return nil
}

func removes(p *Plan, table, id string) bool {
	for _, it := range p.Remove {
		if it.Table == table && it.ID == id {
			return true
		}
	}
	return false
}

// A real booking on a demo session keeps the session, its class type, its
// coach and its template; a purchase keeps its package. Everything else
// in the demo set goes, and real rows stay.
func TestRemoveKeepsTouchedRows(t *testing.T) {
	member := testutil.CreateMember(t)
	tx := testutil.Tx(t)
	ctx := context.Background()

	booked := scalar(t, tx, `SELECT s.id::text FROM gym.class_sessions s JOIN gym.class_types t ON t.id = s.class_type_id
		WHERE s.created_by IS NULL AND lower(t.name) = 'engine builder' AND s.coach_id IS NOT NULL ORDER BY s.starts_at LIMIT 1`)
	if booked == "" {
		t.Skip("no seeded demo session in this database")
	}
	exec(t, tx, `INSERT INTO gym.bookings (session_id, customer_id, status, source) VALUES ($1, $2, 'confirmed', 'admin')`, booked, member.CustomerID)
	bought := scalar(t, tx, `SELECT id::text FROM gym.credit_packages WHERE name = 'Starter 5'`)
	exec(t, tx, `INSERT INTO gym.credit_purchases (customer_id, package_id, credits, price_idr, total_idr, channel, status)
		VALUES ($1, $2, 5, 800000, 800000, 'front_desk', 'paid')`, member.CustomerID, bought)
	realType := scalar(t, tx, `INSERT INTO gym.class_types (name, default_duration_min, default_credit_cost, default_capacity)
		VALUES ('Go Real Class ' || $1, 60, 1, 10) RETURNING id::text`, testutil.RandomHex(3))
	demoSessions := scalar(t, tx, `SELECT count(*)::text FROM gym.class_sessions s JOIN gym.class_types t ON t.id = s.class_type_id
		WHERE s.created_by IS NULL AND lower(t.name) = ANY($1)`, lower(ClassTypes))

	plan, err := PlanRemoval(ctx, tx)
	if err != nil {
		t.Fatal(err)
	}
	if k := kept(plan, "gym.class_sessions", booked); k == nil || !strings.Contains(k.Reason, "gym.bookings") {
		t.Fatalf("booked session must stay because of the booking: %+v", k)
	}
	engine := scalar(t, tx, `SELECT class_type_id::text FROM gym.class_sessions WHERE id = $1`, booked)
	if k := kept(plan, "gym.class_types", engine); k == nil || !strings.Contains(k.Reason, "gym.class_sessions") {
		t.Fatalf("class type of the kept session must stay: %+v", k)
	}
	coach := scalar(t, tx, `SELECT coach_id::text FROM gym.class_sessions WHERE id = $1`, booked)
	if kept(plan, "gym.coaches", coach) == nil {
		t.Fatal("coach of the kept session must stay")
	}
	if k := kept(plan, "gym.credit_packages", bought); k == nil || !strings.Contains(k.Reason, "gym.credit_purchases") {
		t.Fatalf("bought package must stay: %+v", k)
	}
	mobility := scalar(t, tx, `SELECT id::text FROM gym.class_types WHERE name = 'Mobility & Recovery'`)
	if !removes(plan, "gym.class_types", mobility) {
		t.Fatal("an untouched demo class type must go")
	}
	trial := scalar(t, tx, `SELECT id::text FROM gym.credit_packages WHERE name = 'Trial Class'`)
	if !removes(plan, "gym.credit_packages", trial) {
		t.Fatal("an untouched demo package must go")
	}
	if removes(plan, "gym.class_types", realType) || kept(plan, "gym.class_types", realType) != nil {
		t.Fatal("a real class type is not part of the plan")
	}

	var out bytes.Buffer
	if err := Remove(ctx, tx, true, &out); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), "Akan dihapus") || !strings.Contains(out.String(), "Dipertahankan") ||
		!strings.Contains(out.String(), "masih dirujuk gym.bookings") {
		t.Fatalf("dry run output: %s", out.String())
	}
	if n := scalar(t, tx, `SELECT count(*)::text FROM gym.class_sessions s JOIN gym.class_types t ON t.id = s.class_type_id
		WHERE s.created_by IS NULL AND lower(t.name) = ANY($1)`, lower(ClassTypes)); n != demoSessions {
		t.Fatalf("dry run deleted sessions: %s -> %s", demoSessions, n)
	}

	if err := Remove(ctx, tx, false, &out); err != nil {
		t.Fatal(err)
	}
	if n := scalar(t, tx, `SELECT count(*)::text FROM gym.class_sessions WHERE id = $1`, booked); n != "1" {
		t.Fatal("kept session was deleted")
	}
	if n := scalar(t, tx, `SELECT count(*)::text FROM gym.class_types WHERE id = ANY($1::uuid[])`, []string{engine, realType}); n != "2" {
		t.Fatalf("kept and real class types: %s", n)
	}
	if n := scalar(t, tx, `SELECT count(*)::text FROM gym.class_types WHERE id = $1`, mobility); n != "0" {
		t.Fatal("untouched demo class type still there")
	}
	if n := scalar(t, tx, `SELECT count(*)::text FROM gym.credit_packages WHERE lower(name) = ANY($1)`, lower(Packages)); n != "1" {
		t.Fatalf("packages left: %s, want only the bought one", n)
	}
	if n := scalar(t, tx, `SELECT count(*)::text FROM gym.session_templates st JOIN gym.class_types t ON t.id = st.class_type_id
		WHERE st.created_by IS NULL AND lower(t.name) = ANY($1) AND t.id <> $2`, lower(ClassTypes), engine); n != "0" {
		t.Fatalf("templates of removed class types left: %s", n)
	}
	// Running again finds nothing new to remove and keeps the same rows.
	again, err := PlanRemoval(ctx, tx)
	if err != nil {
		t.Fatal(err)
	}
	// Packages running in parallel commit test branches, and the branch sync
	// trigger gives each one a brand the plan also removes; those are not
	// rows this run left behind.
	var left []Item
	for _, item := range again.Remove {
		if item.Table != "item.brands" {
			left = append(left, item)
		}
	}
	if len(left) != 0 {
		t.Fatalf("second run would remove %d rows: %+v", len(left), left)
	}
}

// Remove takes the demo accounts with everything they own, including a
// credit ledger, and leaves the real member alone.
func TestRemoveDeletesFixtures(t *testing.T) {
	real := testutil.CreateMember(t)
	tx := testutil.Tx(t)
	ctx := context.Background()
	if _, err := EnsureUsers(ctx, tx, Options{}); err != nil {
		t.Fatal(err)
	}
	member := scalar(t, tx, `SELECT id::text FROM pos.pos_customers WHERE phone = $1`, memberPhone)
	exec(t, tx, `INSERT INTO gym.credit_lots (customer_id, credits, expires_at) VALUES ($1, 5, now() + interval '30 days')`, member)
	exec(t, tx, `INSERT INTO gym.credit_ledger (customer_id, lot_id, type, amount, idempotency_key)
		SELECT $1, id, 'adjustment', 5, 'demo-fixture-' || id::text FROM gym.credit_lots WHERE customer_id = $1`, member)

	var out bytes.Buffer
	if err := Remove(ctx, tx, false, &out); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), "Data uji dihapus") {
		t.Fatalf("missing fixture summary: %s", out.String())
	}
	for sql, want := range map[string]string{
		`SELECT count(*)::text FROM auth.users WHERE email LIKE 'demo-%@nuhabit.test'`:        "1",
		`SELECT count(*)::text FROM auth.users WHERE email = 'demo-super_admin@nuhabit.test'`: "1",
		`SELECT count(*)::text FROM hris.employees WHERE nip = 'DEMO-COACH'`:                  "0",
		`SELECT count(*)::text FROM gym.coaches WHERE lower(name) = 'demo coach'`:             "0",
		`SELECT count(*)::text FROM pos.pos_customers WHERE phone = '` + memberPhone + `'`:    "0",
	} {
		if got := scalar(t, tx, sql); got != want {
			t.Fatalf("%s = %s, want %s", sql, got, want)
		}
	}
	if got := scalar(t, tx, `SELECT count(*)::text FROM pos.pos_customers WHERE id = $1`, real.CustomerID); got != "1" {
		t.Fatal("a real member must stay")
	}
	if got := scalar(t, tx, `SELECT tgenabled::text FROM pg_trigger WHERE tgname = 'trg_gym_credit_ledger_append_only'`); got != "O" {
		t.Fatalf("the ledger trigger must be back on, got %q", got)
	}
}

// RemoveOtherUsers keeps super admins and employees and lists the rest; a dry
// run lists them and writes nothing.
func TestRemoveOtherUsers(t *testing.T) {
	tx := testutil.Tx(t)
	ctx := context.Background()
	if _, err := EnsureUsers(ctx, tx, Options{}); err != nil {
		t.Fatal(err)
	}
	count := func(email string) string {
		return scalar(t, tx, `SELECT count(*)::text FROM auth.users WHERE email = $1`, email)
	}
	var out bytes.Buffer
	if err := RemoveOtherUsers(ctx, tx, true, &out); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), "demo-marketing@nuhabit.test") || count("demo-marketing@nuhabit.test") != "1" {
		t.Fatalf("dry run must list and keep the account: %s", out.String())
	}
	if err := RemoveOtherUsers(ctx, tx, false, &out); err != nil {
		t.Fatal(err)
	}
	for email, want := range map[string]string{
		"demo-marketing@nuhabit.test":   "0",
		"demo-super_admin@nuhabit.test": "1", // super admin
		"demo-gym_coach@nuhabit.test":   "1", // has an employee record
	} {
		if got := count(email); got != want {
			t.Fatalf("%s = %s, want %s", email, got, want)
		}
	}
	if got := scalar(t, tx, `SELECT count(*)::text FROM configuration.users WHERE email = 'demo-marketing@nuhabit.test'`); got != "0" {
		t.Fatalf("profile left behind: %s", got)
	}
}

// Demo accounts are created once and reset on re-run; the coach gets its
// employee, salary and coach rows; missing roles are skipped.
func TestEnsureUsers(t *testing.T) {
	tx := testutil.Tx(t)
	ctx := context.Background()
	results, err := EnsureUsers(ctx, tx, Options{})
	if err != nil {
		t.Fatal(err)
	}
	byRole := map[string]Result{}
	for _, r := range results {
		byRole[r.Role] = r
	}
	if r := byRole["gym_coach"]; r.Skipped != "" || len(r.Password) < 12 {
		t.Fatalf("coach: %+v", r)
	}
	if r := byRole["super_admin"]; r.Skipped != "" {
		t.Fatalf("super_admin must be created when the role is missing: %+v", r)
	}
	if exists := scalar(t, tx, `SELECT EXISTS (SELECT 1 FROM iam.roles WHERE code = 'investor' AND deleted_at IS NULL)::text`); exists == "false" {
		if r := byRole["investor"]; r.Skipped == "" || r.Password != "" {
			t.Fatalf("investor must be skipped without its role: %+v", r)
		}
	}
	coach := Account{Role: "gym_coach"}
	userID := scalar(t, tx, `SELECT id::text FROM auth.users WHERE email = $1`, coach.Email())
	if userID == "" {
		t.Fatal("coach auth user missing")
	}
	if got := scalar(t, tx, `SELECT r.code FROM iam.user_roles ur JOIN iam.roles r ON r.id = ur.role_id WHERE ur.user_id = $1`, userID); got != "gym_coach" {
		t.Fatalf("coach role: %s", got)
	}
	if got := scalar(t, tx, `SELECT e.nip || ' ' || (SELECT count(*) FROM hris.employee_salary s WHERE s.employee_id = e.id AND s.is_active)::text
		FROM hris.employees e WHERE e.user_id = $1`, userID); got != coachNIP+" 1" {
		t.Fatalf("coach employee: %s", got)
	}
	if got := scalar(t, tx, `SELECT name FROM gym.coaches WHERE user_id = $1`, userID); got != coachName {
		t.Fatalf("coach row: %s", got)
	}
	memberHash := scalar(t, tx, `SELECT password_hash FROM pos.pos_customers WHERE phone = $1`, memberPhone)
	if memberHash == "" {
		t.Fatal("member password missing")
	}
	if n := scalar(t, tx, `SELECT count(*)::text FROM crm.crm_member_profiles p JOIN pos.pos_customers c ON c.id = p.customer_id WHERE c.phone = $1`, memberPhone); n != "1" {
		t.Fatalf("member profile: %s", n)
	}
	staffHash := scalar(t, tx, `SELECT password_hash FROM auth.users WHERE id = $1`, userID)

	again, err := EnsureUsers(ctx, tx, Options{Password: "Shared-pass-123"})
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range again {
		if r.Password != "" {
			t.Fatalf("shared password must not be reported: %+v", r)
		}
	}
	staff := 0
	for _, r := range again {
		if r.Skipped == "" && r.Role != "member" {
			staff++
		}
	}
	if n := scalar(t, tx, `SELECT count(*)::text FROM auth.users WHERE email LIKE 'demo-%@' || $1`, EmailDomain); n != fmt.Sprint(staff) {
		t.Fatalf("staff accounts after re-run: %s, want %d", n, staff)
	}
	if got := scalar(t, tx, `SELECT password_hash FROM auth.users WHERE id = $1`, userID); got == staffHash {
		t.Fatal("re-run must reset the staff password")
	}
	if got := scalar(t, tx, `SELECT password_hash FROM pos.pos_customers WHERE phone = $1`, memberPhone); got == memberHash {
		t.Fatal("re-run must reset the member password")
	}
	if n := scalar(t, tx, `SELECT count(*)::text FROM gym.coaches WHERE lower(name) = lower($1)`, coachName); n != "1" {
		t.Fatalf("coach rows: %s", n)
	}
}
