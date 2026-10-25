package accounting_test

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"testing"

	"nuhabit/backend/internal/contracts/gym"
	"nuhabit/backend/internal/platform/testutil"
)

// Coach commission: the accrual books expense against the payable, a line
// handed to payroll takes the expense back (the payroll run books it), a
// direct payment clears the payable against the bank; each once per
// document, other events and zero amounts post nothing.
func TestGymCommissionJournals(t *testing.T) {
	e := setup(t)
	bank := e.account("1102001", "Bank BCA", "ASSET", true)
	payable := e.account("2102009", "Utang Komisi Coach", "LIABILITY", false)
	expense := e.account("6101009", "Beban Komisi Coach", "EXPENSE", false)
	e.fiscal2026()
	e.mapping("GYM_COMMISSION_ACCRUAL", "PAYROLL", mline("DEBIT", "GYM_COMMISSION_EXPENSE", expense, "TOTAL"),
		mline("CREDIT", "GYM_COMMISSION_PAYABLE", payable, "TOTAL"))
	e.mapping("GYM_COMMISSION_PAYROLL", "PAYROLL", mline("DEBIT", "GYM_COMMISSION_PAYABLE", payable, "TOTAL"),
		mline("CREDIT", "GYM_COMMISSION_EXPENSE", expense, "TOTAL"))
	e.mapping("GYM_COMMISSION_PAYMENT_BANK", "PAYROLL", mline("DEBIT", "GYM_COMMISSION_PAYABLE", payable, "TOTAL"),
		mline("CREDIT", "BANK", bank, "TOTAL"))

	statement, viaPayroll, direct := "6f1d5c2e-6666-4a1b-9c1d-000000000001", "6f1d5c2e-6666-4a1b-9c1d-000000000002", "6f1d5c2e-6666-4a1b-9c1d-000000000003"
	journal := func(event, doc string, amount float64) gym.CommissionJournal {
		return gym.CommissionJournal{EventCode: event, DocumentType: "gym_commission_line", DocumentID: doc, CompanyID: &e.company,
			UserID: e.staff.UserID, EntryDate: "2026-10-05", Amount: amount, Description: "Komisi coach"}
	}
	e.publish(gym.TopicCommissionJournal, statement, journal("GYM_COMMISSION_ACCRUAL", statement, 21587.5))
	e.publish(gym.TopicCommissionJournal, statement, journal("GYM_COMMISSION_ACCRUAL", statement, 21587.5))
	e.publish(gym.TopicCommissionJournal, viaPayroll, journal("GYM_COMMISSION_PAYROLL", viaPayroll, 5500))
	e.publish(gym.TopicCommissionJournal, direct, journal("GYM_COMMISSION_PAYMENT_BANK", direct, 1000))
	e.publish(gym.TopicCommissionJournal, direct, journal("GYM_SALE_CASH", direct, 1000))
	e.publish(gym.TopicCommissionJournal, direct, journal("GYM_COMMISSION_PAYMENT_CASH", direct, 0))
	e.dispatch()
	for doc, want := range map[string][]string{
		statement:  {"GYM_COMMISSION_ACCRUAL:DEBIT=21587.50,CREDIT=21587.50"},
		viaPayroll: {"GYM_COMMISSION_PAYROLL:DEBIT=5500.00,CREDIT=5500.00"},
		direct:     {"GYM_COMMISSION_PAYMENT_BANK:DEBIT=1000.00,CREDIT=1000.00"},
	} {
		if got := e.journals(doc); fmt.Sprint(got) != fmt.Sprint(want) {
			t.Errorf("%s:\n got %v\nwant %v", doc, got, want)
		}
	}
}

// The commission delta maps its accounts by name or next to the payroll
// accounts and creates the ones it cannot find; a second run changes nothing.
func TestGymCommissionAccountsMigration(t *testing.T) {
	_, file, _, _ := runtime.Caller(0)
	sql, err := os.ReadFile(filepath.Join(filepath.Dir(file), "../../../database/migrations/deltas/20261028140000_gym_revenue_share_commission.sql"))
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
		SELECT holding_id, 'Go Gym Commission '||$1, 'GK'||$1 FROM configuration.companies LIMIT 1 RETURNING id::text`, testutil.RandomHex(3))
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

	assets := account("1100000", "CURRENT ASSETS", "ASSET", "", 2, false)
	cash := account("1101001", "Kas Besar", "ASSET", assets, 4, true)
	bank := account("1102001", "Bank BCA", "ASSET", assets, 4, true)
	liabilities := account("2100000", "CURRENT LIABILITIES", "LIABILITY", "", 2, false)
	accrued := account("2102000", "UTANG BEBAN", "LIABILITY", liabilities, 3, false)
	salaryPayable := account("2102001", "Utang Gaji", "LIABILITY", accrued, 4, true)
	account("2102009", "Hutang Komisi Coach", "LIABILITY", accrued, 4, true)
	expenses := account("6000000", "OPERATING EXPENSES", "EXPENSE", "", 1, false)
	staffCost := account("6101000", "BEBAN KARYAWAN", "EXPENSE", expenses, 3, false)
	salary := account("6101001", "Beban Gaji", "EXPENSE", staffCost, 4, true)
	mapping("POS_SALE_CASH", map[string]string{"CASH": cash})
	mapping("POS_SALE_DEBIT", map[string]string{"BANK": bank})
	mapping("PAYROLL_ACCRUAL", map[string]string{"SALARY_EXPENSE": salary, "SALARY_PAYABLE": salaryPayable})

	for range 2 {
		if _, err := tx.Exec(ctx, string(sql)); err != nil {
			t.Fatalf("migration: %v", err)
		}
	}
	for _, c := range []struct{ event, role, want string }{
		{"GYM_COMMISSION_ACCRUAL", "GYM_COMMISSION_EXPENSE", "6101002"},
		{"GYM_COMMISSION_ACCRUAL", "GYM_COMMISSION_PAYABLE", "2102009"},
		{"GYM_COMMISSION_PAYROLL", "GYM_COMMISSION_PAYABLE", "2102009"},
		{"GYM_COMMISSION_PAYROLL", "GYM_COMMISSION_EXPENSE", "6101002"},
		{"GYM_COMMISSION_PAYMENT_CASH", "CASH", "1101001"},
		{"GYM_COMMISSION_PAYMENT_BANK", "BANK", "1102001"},
	} {
		if got := lineAccount(c.event, c.role); got != c.want {
			t.Errorf("%s %s = %q, want %q", c.event, c.role, got, c.want)
		}
	}
	var created, mappings int
	if err := tx.QueryRow(ctx, `SELECT count(*)::int FROM accounting.chart_of_accounts
		WHERE company_id = $1 AND description LIKE '%migrasi 20261028140000%' AND name = 'Beban Komisi Coach'`, company).Scan(&created); err != nil {
		t.Fatal(err)
	}
	if err := tx.QueryRow(ctx, `SELECT count(*)::int FROM accounting.journal_mappings
		WHERE company_id = $1 AND event_code LIKE 'GYM_COMMISSION_%' AND module = 'PAYROLL' AND deleted_at IS NULL`, company).Scan(&mappings); err != nil {
		t.Fatal(err)
	}
	if created != 1 || mappings != 4 {
		t.Fatalf("created %d expense accounts and %d mappings, want 1 and 4", created, mappings)
	}
}
