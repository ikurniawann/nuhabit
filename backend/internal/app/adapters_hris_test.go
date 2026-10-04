package app

import (
	"context"
	"testing"
	"time"

	"nuhabit/backend/internal/modules/hris"
	"nuhabit/backend/internal/platform/testutil"
)

// The hris adapters run SQL against other contexts' tables; this checks the
// queries against the real schema inside a rolled-back transaction.
func TestHrisAdapters(t *testing.T) {
	tx := testutil.Tx(t)
	ctx := context.Background()
	var emp string
	if err := tx.QueryRow(ctx, `INSERT INTO hris.employees (full_name, nip, email, phone, join_date)
		VALUES ('Adapter Test', 'T-'||md5(random()::text), 'adapter@hris.test', '', '2026-01-01') RETURNING id::text`).Scan(&emp); err != nil {
		t.Fatal(err)
	}

	payroll := hrisPayrollSQL{}
	if p, err := payroll.LatestPaidPayslip(ctx, tx, emp); err != nil || p != nil {
		t.Fatalf("payslip = %v, %v", p, err)
	}
	if s, err := payroll.ActiveLoans(ctx, tx, emp); err != nil || s.Count != 0 || s.TotalRemaining != "0" {
		t.Fatalf("loans = %+v, %v", s, err)
	}
	if _, err := payroll.RecentLoans(ctx, tx, emp); err != nil {
		t.Fatal(err)
	}
	if k, err := payroll.LatestKPISummary(ctx, tx, emp); err != nil || k.Count != 0 || k.AvgScore != nil {
		t.Fatalf("kpi = %+v, %v", k, err)
	}
	if _, err := payroll.PendingLoanCount(ctx, tx); err != nil {
		t.Fatal(err)
	}
	since := time.Now()
	if _, err := payroll.LoanUpdatesSince(ctx, tx, emp, &since); err != nil {
		t.Fatal(err)
	}

	salary := hrisSalarySQL{}
	if err := salary.SyncFromContract(ctx, tx, hris.SalarySync{EmployeeID: emp, BaseSalary: 5_000_000, StartDate: "2026-01-01", ContractNumber: "0001/PKWT/I/2026"}); err != nil {
		t.Fatal(err)
	}
	// A second contract versions the salary, carrying the allowances.
	if err := salary.SyncFromContract(ctx, tx, hris.SalarySync{EmployeeID: emp, BaseSalary: 5_500_000.5, StartDate: "2026-07-01", ContractNumber: "0002/PKWT/VII/2026"}); err != nil {
		t.Fatal(err)
	}
	if base, err := salary.ActiveBaseSalary(ctx, tx, emp); err != nil || base == nil || *base != "5500000.50" {
		t.Fatalf("base salary = %v, %v", base, err)
	}

	if c, err := (hrisRecruitmentSQL{}).PromotedCandidate(ctx, tx, emp); err != nil || c != nil {
		t.Fatalf("candidate = %v, %v", c, err)
	}
	dir := hrisDirectorySQL{}
	if a, err := dir.Account(ctx, tx, "00000000-0000-0000-0000-000000000000"); err != nil || a != nil {
		t.Fatalf("account = %v, %v", a, err)
	}
	if _, err := dir.SuperAdminUserIDs(ctx, tx); err != nil {
		t.Fatal(err)
	}
	if _, err := dir.BrandNames(ctx, tx, []string{"00000000-0000-0000-0000-000000000000"}); err != nil {
		t.Fatal(err)
	}

	wa := &hrisWhatsApp{db: tx}
	id, claimed, err := wa.Claim(ctx, tx, "cuti", "leave:adapter-test", "pesan", []string{"628123"})
	if err != nil || !claimed {
		t.Fatalf("claim = %v, %v", claimed, err)
	}
	if _, again, _ := wa.Claim(ctx, tx, "cuti", "leave:adapter-test", "pesan", nil); again {
		t.Fatal("duplicate claim")
	}
	if err := wa.Release(ctx, tx, id); err != nil {
		t.Fatal(err)
	}
}
