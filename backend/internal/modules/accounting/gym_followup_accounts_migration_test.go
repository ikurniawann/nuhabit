package accounting_test

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"nuhabit/backend/internal/platform/testutil"
)

// The follow-up delta adds the adjustment, transfer, opening balance and
// referral bonus mappings: deferred and class revenue come from the
// GYM_CREDIT_USAGE lines, the ARK Coin liability from POS_SALE_ARK_COIN,
// the rest by name or in new accounts under the nearest group. A second
// run changes nothing.
func TestGymFollowupAccountsMigration(t *testing.T) {
	_, file, _, _ := runtime.Caller(0)
	sql, err := os.ReadFile(filepath.Join(filepath.Dir(file), "../../../database/migrations/deltas/20261023110000_gym_accounting_followups.sql"))
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
	company := id(`INSERT INTO configuration.companies (holding_id, name, code)
		SELECT holding_id, 'Go Gym Followup '||$1, 'GF'||$1 FROM configuration.companies LIMIT 1 RETURNING id::text`, testutil.RandomHex(3))
	account := func(code, name, typ, parent string, level int, postable bool) string {
		var p any
		if parent != "" {
			p = parent
		}
		return id(`INSERT INTO accounting.chart_of_accounts (company_id, code, name, parent_id, account_type_id, level, is_postable)
			SELECT $1, $2, $3, $4, t.id, $6, $7 FROM accounting.account_types t WHERE t.code = $5 RETURNING id::text`,
			company, code, name, p, typ, level, postable)
	}
	mapping := func(event string, lines map[string]string) {
		m := id(`INSERT INTO accounting.journal_mappings (company_id, event_code, name, module) VALUES ($1, $2, $2, 'POS')
			RETURNING id::text`, company, event)
		for role, accountID := range lines {
			id(`INSERT INTO accounting.journal_mapping_lines (mapping_id, entry_side, line_role, account_id) VALUES ($1, 'DEBIT', $2, $3)
				RETURNING id::text`, m, role, accountID)
		}
	}
	lineAccount := func(event, role string) string {
		t.Helper()
		var v *string
		if err := tx.QueryRow(ctx, `SELECT a.code FROM accounting.journal_mappings m
			JOIN accounting.journal_mapping_lines l ON l.mapping_id = m.id
			LEFT JOIN accounting.chart_of_accounts a ON a.id = l.account_id
			WHERE m.company_id = $1 AND m.event_code = $2 AND l.line_role = $3 AND m.deleted_at IS NULL`, company, event, role).Scan(&v); err != nil {
			t.Fatalf("%s %s: %v", event, role, err)
		}
		if v == nil {
			return ""
		}
		return *v
	}

	assets := account("1200000", "CURRENT ASSETS", "ASSET", "", 2, false)
	receivables := account("1202000", "ACCOUNTS RECEIVABLE", "ASSET", assets, 3, false)
	account("1202001", "Piutang Usaha", "ASSET", receivables, 4, true)
	liabilities := account("2100000", "CURRENT LIABILITIES", "LIABILITY", "", 2, false)
	wallet := account("2103006", "Trade Other", "LIABILITY", liabilities, 4, true)
	deferred := account("2103007", "Pendapatan Diterima di Muka - Kredit Gym", "LIABILITY", liabilities, 4, true)
	equity := account("3000000", "EQUITY", "EQUITY", "", 1, false)
	account("3101001", "Modal Disetor", "EQUITY", equity, 4, true)
	class := account("4101002", "Pendapatan Kelas Gym", "REVENUE", "", 4, true)
	expenses := account("6000000", "OPERATING EXPENSES", "EXPENSE", "", 1, false)
	marketing := account("6102000", "MARKETING", "EXPENSE", expenses, 3, false)
	account("6102001", "Beban Promosi", "EXPENSE", marketing, 4, true)
	mapping("POS_SALE_ARK_COIN", map[string]string{"WALLET": wallet})
	mapping("GYM_CREDIT_USAGE", map[string]string{"GYM_DEFERRED_REVENUE": deferred, "GYM_CLASS_REVENUE": class})

	for range 2 {
		if _, err := tx.Exec(ctx, string(sql)); err != nil {
			t.Fatalf("migration: %v", err)
		}
	}

	for _, c := range []struct{ event, role, want string }{
		{"GYM_CREDIT_ADJUSTMENT", "GYM_DEFERRED_REVENUE", "2103007"},
		{"GYM_CREDIT_ADJUSTMENT", "GYM_CLASS_REVENUE", "4101002"},
		{"GYM_TRANSFER_OUT", "INTERCOMPANY_PAYABLE", "2103008"},
		{"GYM_TRANSFER_IN", "INTERCOMPANY_RECEIVABLE", "1202002"},
		{"GYM_TRANSFER_IN", "GYM_DEFERRED_REVENUE", "2103007"},
		{"GYM_OPENING_BALANCE", "OPENING_BALANCE", "3101002"},
		{"WALLET_REFERRAL_BONUS", "PROMO_EXPENSE", "6102002"},
		{"WALLET_REFERRAL_BONUS", "WALLET", "2103006"},
	} {
		if got := lineAccount(c.event, c.role); got != c.want {
			t.Errorf("%s %s = %q, want %q", c.event, c.role, got, c.want)
		}
	}
	var created int
	if err := tx.QueryRow(ctx, `SELECT count(*)::int FROM accounting.chart_of_accounts
		WHERE company_id = $1 AND description LIKE '%migrasi 20261023110000%'`, company).Scan(&created); err != nil {
		t.Fatal(err)
	}
	if created != 4 {
		t.Fatalf("created %d accounts, want 4 (promo, payable, receivable, opening)", created)
	}
	var names []string
	rows, err := tx.Query(ctx, `SELECT name FROM accounting.chart_of_accounts WHERE company_id = $1 AND description LIKE '%migrasi 20261023110000%' ORDER BY code`, company)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var n string
		if err := rows.Scan(&n); err != nil {
			t.Fatal(err)
		}
		names = append(names, n)
	}
	want := []string{"Piutang Antar Perusahaan", "Utang Antar Perusahaan", "Penyesuaian Saldo Awal", "Beban Promosi Referral"}
	for i, n := range want {
		if i >= len(names) || names[i] != n {
			t.Fatalf("created accounts %v, want %v", names, want)
		}
	}
}
