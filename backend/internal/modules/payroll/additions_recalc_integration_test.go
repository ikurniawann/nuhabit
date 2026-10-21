package payroll

import "testing"

// An addition that lands in a draft run after it was calculated flags the
// run until it is calculated again, and the slip then taxes the addition as
// irregular income.
func TestAdditionAfterCalculationFlagsTheRun(t *testing.T) {
	e := setup(t)
	worker := e.employee("Coach Flag", "", true)
	e.exec(`INSERT INTO hris.employee_salary (employee_id, base_salary, ptkp_status, effective_date)
		VALUES ($1, 10000000, 'TK/0', '2026-01-01')`, worker)
	run := e.call(&e.hr, "POST", "/api/hris/payroll", map[string]any{"period_month": 5, "period_year": 2097}, 200)["data"].(map[string]any)
	runID := run["id"].(string)
	flagged := func() bool {
		var v bool
		e.scalar(&v, `SELECT needs_recalculation FROM hris.payroll_runs WHERE id = $1`, runID)
		return v
	}
	newID := func() string {
		var id string
		e.scalar(&id, `SELECT gen_random_uuid()::text`)
		return id
	}
	add := func(amount float64) {
		t.Helper()
		if _, err := AddToOpenPeriod(e.ctx, e.tx, Addition{EmployeeID: worker, Amount: amount, Label: "Insentif coach",
			SourceType: "test.flag", SourceID: newID()}, Period{5, 2097}); err != nil {
			t.Fatal(err)
		}
	}

	// Before the first calculation nothing is stale.
	add(1_000_000)
	if flagged() {
		t.Fatal("a run without slips has nothing to recalculate")
	}
	e.call(&e.hr, "POST", "/api/hris/payroll/"+runID+"/calculate", nil, 200)
	if flagged() {
		t.Fatal("calculating clears the flag")
	}

	// A late addition flags the calculated draft; the run page shows it.
	add(30_000_000)
	if !flagged() {
		t.Fatal("an addition after calculation must flag the run")
	}
	if got := e.call(&e.hr, "GET", "/api/hris/payroll/"+runID, nil, 200)["data"].(map[string]any)["needs_recalculation"]; got != true {
		t.Fatalf("run needs_recalculation = %v", got)
	}

	// Calculating again clears it and taxes the one-off 31,000,000 as
	// irregular income: base 10,000,000 x 12 plus 31,000,000, not 41,000,000 x 12.
	calc := e.call(&e.hr, "POST", "/api/hris/payroll/"+runID+"/calculate", nil, 200)
	if flagged() {
		t.Fatal("recalculating must clear the flag")
	}
	detail := calc["data"].([]any)[0].(map[string]any)
	if detail["bonus"] != "31000000.00" || detail["gross_salary"] != "41000000.00" {
		t.Fatalf("detail = %v", detail)
	}
	var annualised, withheld float64
	e.scalar(&annualised, `SELECT pph21_annual::float8 FROM hris.payroll_details WHERE payroll_run_id = $1`, runID)
	e.scalar(&withheld, `SELECT pph21_deduction::float8 FROM hris.payroll_details WHERE payroll_run_id = $1`, runID)
	if annualised >= 12*withheld {
		t.Fatalf("pph21 annual %v should hold the addition once, withheld %v", annualised, withheld)
	}
}
