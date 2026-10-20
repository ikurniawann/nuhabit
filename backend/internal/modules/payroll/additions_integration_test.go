package payroll

import (
	"errors"
	"testing"
)

func TestAdditionsReachTheSlip(t *testing.T) {
	e := setup(t)
	worker := e.employee("Coach Gaji", "", true)
	e.exec(`INSERT INTO hris.employee_salary (employee_id, base_salary, ptkp_status, effective_date)
		VALUES ($1, 5000000, 'TK/0', '2026-01-01')`, worker)
	if ok, err := HasActiveSalary(e.ctx, e.tx, worker); err != nil || !ok {
		t.Fatalf("HasActiveSalary = %v, %v", ok, err)
	}
	if ok, _ := HasActiveSalary(e.ctx, e.tx, e.employee("Tanpa Gaji", "", true)); ok {
		t.Fatal("an employee without salary should not be payable")
	}

	run := e.call(&e.hr, "POST", "/api/hris/payroll", map[string]any{"period_month": 3, "period_year": 2097}, 200)["data"].(map[string]any)
	runID := run["id"].(string)
	add := func(source string, amount float64) (Period, error) {
		return AddToOpenPeriod(e.ctx, e.tx, Addition{EmployeeID: worker, Amount: amount, Label: "Insentif coach",
			SourceType: "test.source", SourceID: source}, Period{3, 2097})
	}
	newID := func() string {
		var id string
		e.scalar(&id, `SELECT gen_random_uuid()::text`)
		return id
	}

	// A draft run is still open: the addition lands in its period.
	first := newID()
	if p, err := add(first, 250000); err != nil || p != (Period{3, 2097}) {
		t.Fatalf("draft period = %v, %v", p, err)
	}
	if _, err := add(first, 250000); !errors.Is(err, ErrDuplicateAddition) {
		t.Fatalf("duplicate source = %v", err)
	}
	calc := e.call(&e.hr, "POST", "/api/hris/payroll/"+runID+"/calculate", nil, 200)
	detail := calc["data"].([]any)[0].(map[string]any)
	if detail["bonus"] != "250000.00" || detail["gross_salary"] != "5250000.00" {
		t.Fatalf("detail = %v", detail)
	}

	// Once the run moves on, the next addition waits for the next period.
	e.call(&e.hr, "PUT", "/api/hris/payroll/"+runID, map[string]any{"status": "processing"}, 200)
	if p, err := add(newID(), 100000); err != nil || p != (Period{4, 2097}) {
		t.Fatalf("closed period = %v, %v", p, err)
	}
	if next := (Period{12, 2097}).next(); next != (Period{1, 2098}) {
		t.Fatalf("next of December = %v", next)
	}
}
