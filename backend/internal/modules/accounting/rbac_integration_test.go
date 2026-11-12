package accounting_test

import (
	"testing"

	"nuhabit/backend/internal/platform/testutil"
)

// TestSubModuleGuards: each route admits the accounting sub-modules whose
// pages call it and turns a sibling sub-module away.
func TestSubModuleGuards(t *testing.T) {
	e := setup(t)
	role := func(code string) testutil.Staff {
		return testutil.CreateStaff(t, testutil.StaffOptions{Role: "finance_staff", CompanyID: &e.company,
			Menus: map[string][]string{code: nil}})
	}
	cases := []struct {
		method, path   string
		allow, sibling string
	}{
		{"GET", "/api/accounting/chart-of-accounts", "accounting.master.chart-of-accounts", "accounting.master.account-types"},
		// COA is a shared lookup: pickers on other pages read it.
		{"GET", "/api/accounting/chart-of-accounts", "accounting.master.journal-mappings", "accounting.ledger.general-ledger"},
		{"GET", "/api/accounting/chart-of-accounts", "items.raw-material.master.materials", "items.raw-material.master.units"},
		{"GET", "/api/accounting/account-types", "accounting.master.account-types", "accounting.master.journal-mappings"},
		{"GET", "/api/accounting/journal-mappings", "accounting.master.journal-mappings", "accounting.master.chart-of-accounts"},
		{"GET", "/api/accounting/journal-entries", "accounting.ledger.journal-history", "accounting.ledger.general-ledger"},
		{"GET", "/api/accounting/fiscal-years", "accounting.period.accounting-period", "accounting.period.closing"},
		{"GET", "/api/accounting/fiscal-periods", "accounting.period.closing", "accounting.period.fiscal-years"},
		{"GET", "/api/accounting/cash-bank/cash-in", "accounting.cash-bank.cash-in", "accounting.cash-bank.cash-out"},
		{"GET", "/api/accounting/cash-bank", "accounting.cash-bank.accounts", "accounting.cash-bank.cash-in"},
		{"GET", "/api/accounting/reports/balance-sheet", "accounting.reports.balance-sheet", "accounting.reports.income-statement"},
		{"GET", "/api/accounting/reports/trial-balance", "accounting.dashboard.overview", "accounting.reports.balance-sheet"},
		{"GET", "/api/accounting/dashboard", "accounting.dashboard.overview", "accounting.reports.cash-flow"},
		{"GET", "/api/accounting/ap/aging", "accounting.accounts-payable.aging", "accounting.receivable.aging"},
		{"GET", "/api/accounting/ap/payable", "accounting.accounts-payable.payable", "accounting.accounts-payable.aging"},
		{"GET", "/api/accounting/ar/receipts", "accounting.receivable.receipts", "accounting.receivable.invoices"},
		{"GET", "/api/accounting/ar/receivable", "accounting.receivable.list", "accounting.receivable.aging"},
		{"GET", "/api/finance/invoices", "accounting.receivable.invoices-b2b", "accounting.receivable.invoices"},
	}
	for _, c := range cases {
		allowed, sibling := role(c.allow), role(c.sibling)
		rec, _ := testutil.Do(t, e.mux, testutil.AsStaff(testutil.Request(c.method, c.path, nil), allowed))
		if rec.Code < 200 || rec.Code > 299 {
			t.Errorf("%s %s as %s: status %d, want 2xx: %s", c.method, c.path, c.allow, rec.Code, rec.Body.String())
		}
		e.call(sibling, c.method, c.path, nil, 403)
	}

	// Writes stay with the owning sub-module: a COA reader cannot add accounts.
	e.call(role("accounting.master.journal-mappings"), "POST", "/api/accounting/chart-of-accounts", map[string]any{}, 403)
	e.call(role("accounting.ledger.journal-history"), "POST", "/api/accounting/journal-entries", map[string]any{}, 403)
}
