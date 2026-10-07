package app

import (
	"context"
	"testing"

	"nuhabit/backend/internal/platform/testutil"
)

// The payroll adapters read the HRIS people tables with the TS SQL; this
// checks them against the schema inside a rolled-back transaction.
func TestPayrollAdapters(t *testing.T) {
	// Staff first: cleanups run in reverse, so the rollback releases the
	// employee row that references the account before the account is deleted.
	staff := testutil.CreateStaff(t, testutil.StaffOptions{Role: "hrd"})
	tx := testutil.Tx(t)
	ctx := context.Background()
	var dept, head, worker string
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatal(err)
		}
	}
	must(tx.QueryRow(ctx, `INSERT INTO hris.departments (name, code) VALUES ('Adapter Go', 'ADP-GO') RETURNING id::text`).Scan(&dept))
	must(tx.QueryRow(ctx, `INSERT INTO hris.employees (full_name, nip, email, phone, join_date, department_id, user_id)
		VALUES ('Kepala', 'ADP-1', 'adp1@test.local', '08', '2024-01-01', $1, $2) RETURNING id::text`, dept, staff.UserID).Scan(&head))
	must(tx.QueryRow(ctx, `INSERT INTO hris.employees (full_name, nip, email, phone, join_date, department_id, reporting_to)
		VALUES ('Anggota', 'ADP-2', 'adp2@test.local', '08', '2024-01-01', $1, $2) RETURNING id::text`, dept, head).Scan(&worker))
	_, err := tx.Exec(ctx, `INSERT INTO hris.attendance (employee_id, date, status, clock_out, overtime_hours)
		VALUES ($1, '2099-06-02', 'present', now(), 1.5)`, worker)
	must(err)

	ports := payrollPorts()
	if id, err := ports.Employees.IDByUser(ctx, tx, staff.UserID); err != nil || id != head {
		t.Fatalf("IDByUser = %q, %v", id, err)
	}
	if id, err := ports.Employees.IDByEmail(ctx, tx, "adp2@test.local"); err != nil || id != worker {
		t.Fatalf("IDByEmail = %q, %v", id, err)
	}
	briefs, err := ports.Employees.Briefs(ctx, tx, []string{worker, "not-a-uuid"})
	must(err)
	if b := briefs[worker]; len(briefs) != 1 || !b.HasDepartment || *b.Department != "Adapter Go" || *b.ReportingTo != head || b.HasPosition {
		t.Fatalf("briefs %+v", briefs)
	}
	if reports, err := ports.Employees.DirectReports(ctx, tx, head); err != nil || len(reports) != 1 || reports[0] != worker {
		t.Fatalf("reports %v %v", reports, err)
	}
	if role, found, err := ports.Employees.KPIRole(ctx, tx, head); err != nil || !found || role != "hrd" {
		t.Fatalf("role %q %v %v", role, found, err)
	}
	if role, _, _ := ports.Employees.KPIRole(ctx, tx, worker); role != "employee" {
		t.Fatalf("role without account %q", role)
	}
	if members, err := ports.Employees.DepartmentMembers(ctx, tx, dept); err != nil || len(members) != 2 || members[0].FullName != "Anggota" {
		t.Fatalf("members %v %v", members, err)
	}
	if active, err := ports.Employees.Active(ctx, tx); err != nil || len(active) == 0 {
		t.Fatalf("active %v", err)
	}
	// The company comes from the linked account, else from its branch.
	var company, branch, branchCompany string
	must(tx.QueryRow(ctx, `SELECT id::text FROM configuration.companies ORDER BY created_at LIMIT 1`).Scan(&company))
	must(tx.QueryRow(ctx, `SELECT id::text, company_id::text FROM configuration.branches WHERE company_id IS NOT NULL LIMIT 1`).Scan(&branch, &branchCompany))
	_, err = tx.Exec(ctx, `UPDATE configuration.users SET company_id = $2, branch_id = NULL WHERE id = $1`, staff.UserID, company)
	must(err)
	if got, err := ports.Employees.Companies(ctx, tx, []string{head, worker}); err != nil || len(got) != 1 || got[head] != company {
		t.Fatalf("companies by user %v %v", got, err)
	}
	_, err = tx.Exec(ctx, `UPDATE configuration.users SET company_id = NULL, branch_id = $2 WHERE id = $1`, staff.UserID, branch)
	must(err)
	if got, err := ports.Employees.Companies(ctx, tx, []string{head}); err != nil || got[head] != branchCompany {
		t.Fatalf("companies by branch %v %v", got, err)
	}
	if all, err := ports.Departments.All(ctx, tx); err != nil || len(all) == 0 {
		t.Fatalf("departments %v", err)
	}
	if byID, err := ports.Departments.ByIDs(ctx, tx, []string{dept}); err != nil || byID[dept].Name != "Adapter Go" {
		t.Fatalf("department by id %v %v", byID, err)
	}
	rec, err := ports.Workforce.PeriodRecords(ctx, tx, worker, "2099-06-01", "2099-06-30")
	must(err)
	if len(rec.Attendance) != 1 || rec.Attendance[0].Date != "2099-06-02" || !rec.Attendance[0].HasClockOut || rec.Attendance[0].OvertimeHours != "1.50" {
		t.Fatalf("attendance %+v", rec.Attendance)
	}
	if _, err := ports.Workforce.Holidays(ctx, tx, "2099-01-01", "2099-12-31"); err != nil {
		t.Fatal(err)
	}
}
