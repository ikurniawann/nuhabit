package app

import (
	"context"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/payroll"
	"nuhabit/backend/internal/modules/payroll/domain"
	"nuhabit/backend/internal/platform/database"
)

// Payroll reads employees and attendance-side records owned by the HRIS
// people context. Until module hris exposes a read service, these adapters
// run the SQL the TS libs ran (lib/payroll/inputs.ts, lib/hris/workforce-auth.ts,
// lib/hris/holidays-db.ts and the PostgREST employee embeds). Switch them to
// the hris read service once it exists; the payroll ports stay the same.

func payrollPorts() payroll.Ports {
	return payroll.Ports{Employees: payrollEmployeesSQL{}, Departments: payrollDepartmentsSQL{}, Workforce: payrollWorkforceSQL{}}
}

type payrollEmployeesSQL struct{}

var _ payroll.Employees = payrollEmployeesSQL{}

func (payrollEmployeesSQL) IDByUser(ctx context.Context, q database.Querier, userID string) (string, error) {
	return payrollFirstID(ctx, q, `SELECT id::text FROM hris.employees WHERE user_id = $1 LIMIT 1`, userID)
}

func (payrollEmployeesSQL) IDByEmail(ctx context.Context, q database.Querier, email string) (string, error) {
	return payrollFirstID(ctx, q, `SELECT id::text FROM hris.employees WHERE email = $1 LIMIT 1`, email)
}

func payrollFirstID(ctx context.Context, q database.Querier, sql string, arg string) (string, error) {
	var id string
	err := q.QueryRow(ctx, sql, arg).Scan(&id)
	if database.IsNoRows(err) {
		return "", nil
	}
	return id, err
}

func (payrollEmployeesSQL) Briefs(ctx context.Context, q database.Querier, ids []string) (map[string]payroll.EmployeeBrief, error) {
	rows, err := q.Query(ctx, `
		SELECT e.id::text, e.full_name, e.nip, e.email, e.phone, e.photo_url, e.is_active,
		       e.employment_status, e.join_date::text, e.department_id::text,
		       d.id IS NOT NULL, d.name, p.id IS NOT NULL, p.title, e.reporting_to::text
		  FROM hris.employees e
		  LEFT JOIN hris.departments d ON d.id = e.department_id
		  LEFT JOIN hris.positions p ON p.id = e.job_title_id
		 WHERE e.id::text = ANY($1)`, ids)
	if err != nil {
		return nil, err
	}
	list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (payroll.EmployeeBrief, error) {
		var b payroll.EmployeeBrief
		err := r.Scan(&b.ID, &b.FullName, &b.NIP, &b.Email, &b.Phone, &b.PhotoURL, &b.IsActive,
			&b.EmploymentStatus, &b.JoinDate, &b.DepartmentID, &b.HasDepartment, &b.Department,
			&b.HasPosition, &b.Position, &b.ReportingTo)
		return b, err
	})
	if err != nil {
		return nil, err
	}
	out := make(map[string]payroll.EmployeeBrief, len(list))
	for _, b := range list {
		out[b.ID] = b
	}
	return out, nil
}

// Active keeps the TS query shape (no joins) so the rows come back in the
// same natural order the TS loop processed them in.
func (payrollEmployeesSQL) Active(ctx context.Context, q database.Querier) ([]payroll.EmployeeBrief, error) {
	rows, err := q.Query(ctx, `SELECT id::text, full_name, nip, is_active, employment_status, join_date::text,
		department_id::text FROM hris.employees WHERE is_active = $1`, true)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (payroll.EmployeeBrief, error) {
		var b payroll.EmployeeBrief
		err := r.Scan(&b.ID, &b.FullName, &b.NIP, &b.IsActive, &b.EmploymentStatus, &b.JoinDate, &b.DepartmentID)
		return b, err
	})
}

func (payrollEmployeesSQL) DirectReports(ctx context.Context, q database.Querier, managerID string) ([]string, error) {
	rows, err := q.Query(ctx, `SELECT id::text FROM hris.employees WHERE reporting_to = $1 AND is_active = true`, managerID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

// KPIRole reads the linked account's role (configuration.users), as the TS
// snapshot does; "employee" for an employee without an account.
func (payrollEmployeesSQL) KPIRole(ctx context.Context, q database.Querier, employeeID string) (string, bool, error) {
	var role string
	err := q.QueryRow(ctx, `SELECT COALESCE(u.role, 'employee') FROM hris.employees e
		LEFT JOIN configuration.users u ON u.id = e.user_id WHERE e.id = $1`, employeeID).Scan(&role)
	if database.IsNoRows(err) {
		return "", false, nil
	}
	return role, err == nil, err
}

func (payrollEmployeesSQL) DepartmentMembers(ctx context.Context, q database.Querier, departmentID string) ([]payroll.Member, error) {
	rows, err := q.Query(ctx, `SELECT id::text, full_name FROM hris.employees
		WHERE department_id = $1 AND is_active ORDER BY full_name`, departmentID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[payroll.Member])
}

type payrollDepartmentsSQL struct{}

var _ payroll.Departments = payrollDepartmentsSQL{}

func (payrollDepartmentsSQL) All(ctx context.Context, q database.Querier) ([]payroll.Department, error) {
	rows, err := q.Query(ctx, `SELECT id::text, name FROM hris.departments ORDER BY name`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[payroll.Department])
}

func (payrollDepartmentsSQL) ByIDs(ctx context.Context, q database.Querier, ids []string) (map[string]payroll.Department, error) {
	rows, err := q.Query(ctx, `SELECT id::text, name FROM hris.departments WHERE id::text = ANY($1)`, ids)
	if err != nil {
		return nil, err
	}
	list, err := pgx.CollectRows(rows, pgx.RowToStructByPos[payroll.Department])
	out := make(map[string]payroll.Department, len(list))
	for _, d := range list {
		out[d.ID] = d
	}
	return out, err
}

type payrollWorkforceSQL struct{}

var _ payroll.Workforce = payrollWorkforceSQL{}

func (payrollWorkforceSQL) PeriodRecords(ctx context.Context, q database.Querier, employeeID, start, end string) (domain.WorkforceRecords, error) {
	var rec domain.WorkforceRecords
	rows, err := q.Query(ctx, `SELECT date::text, status::text, clock_out IS NOT NULL, is_late, late_minutes::text, overtime_hours::text
		FROM hris.attendance WHERE date >= $1 AND date <= $2 AND employee_id = $3`, start, end, employeeID)
	if err != nil {
		return rec, err
	}
	if rec.Attendance, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (domain.AttendanceRow, error) {
		var a domain.AttendanceRow
		var date, status, late, overtime *string
		err := r.Scan(&date, &status, &a.HasClockOut, &a.IsLate, &late, &overtime)
		if d := domain.DateText(date); d != nil {
			a.Date = *d
		}
		if status != nil {
			a.Status = *status
		}
		a.LateMinutes, a.OvertimeHours = payrollText(late), payrollText(overtime)
		return a, err
	}); err != nil {
		return rec, err
	}

	rows, err = q.Query(ctx, `SELECT day_of_week, shift_id::text, effective_from::text, effective_to::text
		FROM hris.employee_shifts WHERE employee_id = $1 AND effective_from <= $2`, employeeID, end)
	if err != nil {
		return rec, err
	}
	if rec.Schedule, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (domain.ShiftRow, error) {
		var s domain.ShiftRow
		var from *string
		err := r.Scan(&s.DayOfWeek, &s.ShiftID, &from, &s.EffectiveTo)
		if d := domain.DateText(from); d != nil {
			s.EffectiveFrom = *d
		}
		return s, err
	}); err != nil {
		return rec, err
	}

	rows, err = q.Query(ctx, `SELECT date::text, hours::text FROM hris.overtime_requests
		WHERE employee_id = $1 AND status = 'approved' AND date >= $2 AND date <= $3`, employeeID, start, end)
	if err != nil {
		return rec, err
	}
	overtime, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (*domain.OvertimeRequest, error) {
		var date, hours *string
		if err := r.Scan(&date, &hours); err != nil {
			return nil, err
		}
		d := domain.DateText(date)
		if d == nil {
			return nil, nil
		}
		return &domain.OvertimeRequest{Date: *d, Hours: domain.OrZero(payrollText(hours))}, nil
	})
	if err != nil {
		return rec, err
	}
	for _, o := range overtime {
		if o != nil {
			rec.Overtime = append(rec.Overtime, *o)
		}
	}

	rows, err = q.Query(ctx, `SELECT start_date::text, end_date::text, leave_type::text FROM hris.leaves
		WHERE employee_id = $1 AND status = 'approved' AND start_date <= $2 AND end_date >= $3`, employeeID, end, start)
	if err != nil {
		return rec, err
	}
	if rec.Leaves, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (domain.Leave, error) {
		var l domain.Leave
		var kind *string
		err := r.Scan(&l.StartDate, &l.EndDate, &kind)
		if kind != nil {
			l.LeaveType = *kind
		}
		return l, err
	}); err != nil {
		return rec, err
	}

	rows, err = q.Query(ctx, `SELECT contract_type, start_date::text, end_date::text FROM hris.employment_contracts
		WHERE employee_id = $1 AND status <> 'draft' AND start_date <= $2
		ORDER BY start_date DESC LIMIT 50`, employeeID, end)
	if err != nil {
		return rec, err
	}
	rec.Contracts, err = pgx.CollectRows(rows, func(r pgx.CollectableRow) (domain.Contract, error) {
		var c domain.Contract
		err := r.Scan(&c.ContractType, &c.StartDate, &c.EndDate)
		return c, err
	})
	return rec, err
}

func (payrollWorkforceSQL) Holidays(ctx context.Context, q database.Querier, start, end string) (map[string]bool, error) {
	rows, err := q.Query(ctx, `SELECT holiday_date::text FROM hris.public_holidays
		WHERE deleted_at IS NULL AND status = 'aktif' AND holiday_date BETWEEN $1::date AND $2::date`, start, end)
	if err != nil {
		return nil, err
	}
	dates, err := pgx.CollectRows(rows, pgx.RowTo[string])
	out := make(map[string]bool, len(dates))
	for _, d := range dates {
		out[d] = true
	}
	return out, err
}

func payrollText(s *string) any {
	if s == nil {
		return nil
	}
	return *s
}
