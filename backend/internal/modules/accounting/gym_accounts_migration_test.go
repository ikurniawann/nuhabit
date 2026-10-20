package accounting_test

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"nuhabit/backend/internal/platform/testutil"
)

// The gym journal delta creates the GYM_* mappings for every company with a
// chart of accounts and maps them: payment accounts from the POS mappings,
// deferred, class, breakage and pass revenue by name, else in new accounts
// next to the ARK Coin liability and the POS revenue account. A second run
// changes nothing. Runs inside a rolled-back transaction.
func TestGymAccountsMigration(t *testing.T) {
	_, file, _, _ := runtime.Caller(0)
	sql, err := os.ReadFile(filepath.Join(filepath.Dir(file), "../../../database/migrations/deltas/20261021110000_gym_credit_journals.sql"))
	if err != nil {
		t.Fatal(err)
	}
	tx := testutil.Tx(t)
	ctx := context.Background()
	id := func(q string, args ...any) string {
		t.Helper()
		var v string
		if err := tx.QueryRow(ctx, q, args...).Scan(&v); err != nil {
			t.Fatalf("%s: %v", q, err)
		}
		return v
	}
	company := func() string {
		return id(`INSERT INTO configuration.companies (holding_id, name, code)
			SELECT holding_id, 'Go Gym COA '||$1, 'GG'||$1 FROM configuration.companies LIMIT 1 RETURNING id::text`, testutil.RandomHex(3))
	}
	account := func(co, code, name, typ, parent string, level int, postable bool) string {
		var p any
		if parent != "" {
			p = parent
		}
		return id(`INSERT INTO accounting.chart_of_accounts (company_id, code, name, parent_id, account_type_id, level, is_postable)
			SELECT $1, $2, $3, $4, t.id, $6, $7 FROM accounting.account_types t WHERE t.code = $5 RETURNING id::text`,
			co, code, name, p, typ, level, postable)
	}
	mapping := func(co, event string, lines map[string]string) {
		m := id(`INSERT INTO accounting.journal_mappings (company_id, event_code, name, module) VALUES ($1, $2, $2, 'POS')
			RETURNING id::text`, co, event)
		for role, accountID := range lines {
			id(`INSERT INTO accounting.journal_mapping_lines (mapping_id, entry_side, line_role, account_id) VALUES ($1, 'DEBIT', $2, $3)
				RETURNING id::text`, m, role, accountID)
		}
	}
	lineAccount := func(co, event, role string) string {
		t.Helper()
		var v *string
		if err := tx.QueryRow(ctx, `SELECT a.code FROM accounting.journal_mappings m
			JOIN accounting.journal_mapping_lines l ON l.mapping_id = m.id
			LEFT JOIN accounting.chart_of_accounts a ON a.id = l.account_id
			WHERE m.company_id = $1 AND m.event_code = $2 AND l.line_role = $3 AND m.deleted_at IS NULL`, co, event, role).Scan(&v); err != nil {
			t.Fatalf("%s %s: %v", event, role, err)
		}
		if v == nil {
			return ""
		}
		return *v
	}
	created := func(co string) int {
		t.Helper()
		var n int
		if err := tx.QueryRow(ctx, `SELECT count(*)::int FROM accounting.chart_of_accounts
			WHERE company_id = $1 AND description LIKE '%migrasi 20261021110000%'`, co).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	run := func() {
		t.Helper()
		if _, err := tx.Exec(ctx, string(sql)); err != nil {
			t.Fatalf("migration: %v", err)
		}
	}

	// A: POS mappings in place, no gym accounts yet.
	a := company()
	account(a, "1100000", "CASH & BANK", "ASSET", "", 2, false)
	cash := account(a, "1101001", "House Bank / Cashier", "ASSET", "", 4, true)
	qris := account(a, "1202002", "AR QR BCA", "ASSET", "", 4, true)
	edc := account(a, "1202005", "AR EDC BCA", "ASSET", "", 4, true)
	liabilities := account(a, "2100000", "CURRENT LIABILITIES", "LIABILITY", "", 2, false)
	other := account(a, "2103000", "OTHER PAYABLES", "LIABILITY", liabilities, 3, false)
	wallet := account(a, "2103006", "Trade Other", "LIABILITY", other, 4, true)
	revenueGroup := account(a, "4000000", "REVENUE", "REVENUE", "", 1, false)
	foodGroup := account(a, "4101000", "FOOD REVENUE", "REVENUE", revenueGroup, 3, false)
	food := account(a, "4101001", "Food Revenue", "REVENUE", foodGroup, 4, true)
	mapping(a, "POS_SALE_CASH", map[string]string{"CASH": cash, "REVENUE": food})
	mapping(a, "POS_SALE_QRIS", map[string]string{"BANK": qris})
	mapping(a, "POS_SALE_DEBIT", map[string]string{"BANK": edc})
	mapping(a, "POS_SALE_ARK_COIN", map[string]string{"WALLET": wallet})

	// B: gym accounts that match by name, no POS mappings.
	b := company()
	account(b, "2201001", "Pendapatan Diterima di Muka - Kredit Gym", "LIABILITY", "", 4, true)
	account(b, "4201001", "Pendapatan Kelas Gym", "REVENUE", "", 4, true)
	account(b, "7101001", "Breakage", "OTHER_INCOME", "", 4, true)
	account(b, "4201002", "Pendapatan Pass Gym", "REVENUE", "", 4, true)

	run()
	run()

	for _, c := range []struct{ event, role, want string }{
		{"GYM_SALE_CASH", "CASH", "1101001"},
		{"GYM_SALE_CASH", "GYM_DEFERRED_REVENUE", "2103007"},
		{"GYM_SALE_BANK", "BANK", "1202005"},
		{"GYM_SALE_QRIS", "BANK", "1202002"},
		{"GYM_SALE_ARK_COIN", "WALLET", "2103006"},
		{"GYM_REFUND_QRIS", "BANK", "1202002"},
		{"GYM_REFUND_CASH", "CASH", "1101001"},
		{"GYM_CREDIT_USAGE", "GYM_CLASS_REVENUE", "4101002"},
		{"GYM_CREDIT_USAGE_REVERSAL", "GYM_DEFERRED_REVENUE", "2103007"},
		{"GYM_CREDIT_BREAKAGE", "GYM_BREAKAGE_REVENUE", "4101003"},
		{"GYM_PASS_REVENUE", "GYM_PASS_REVENUE", "4101002"},
	} {
		if got := lineAccount(a, c.event, c.role); got != c.want {
			t.Errorf("company A %s %s = %q, want %q", c.event, c.role, got, c.want)
		}
	}
	if n := created(a); n != 3 {
		t.Fatalf("company A created %d accounts, want 3", n)
	}

	for _, c := range []struct{ event, role, want string }{
		{"GYM_SALE_CASH", "GYM_DEFERRED_REVENUE", "2201001"},
		{"GYM_CREDIT_USAGE", "GYM_CLASS_REVENUE", "4201001"},
		{"GYM_CREDIT_BREAKAGE", "GYM_BREAKAGE_REVENUE", "7101001"},
		{"GYM_PASS_REVENUE_REVERSAL", "GYM_PASS_REVENUE", "4201002"},
		{"GYM_SALE_CASH", "CASH", ""},
	} {
		if got := lineAccount(b, c.event, c.role); got != c.want {
			t.Errorf("company B %s %s = %q, want %q", c.event, c.role, got, c.want)
		}
	}
	var mappings int
	if err := tx.QueryRow(ctx, `SELECT count(*)::int FROM accounting.journal_mappings WHERE company_id = $1
		AND event_code LIKE 'GYM\_%' AND deleted_at IS NULL`, b).Scan(&mappings); err != nil {
		t.Fatal(err)
	}
	if mappings != 13 || created(b) != 0 {
		t.Fatalf("company B has %d gym mappings, %d new accounts", mappings, created(b))
	}
}
