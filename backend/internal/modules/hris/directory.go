package hris

import (
	"context"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/platform/database"
)

// Employees is the read service other contexts use to see hris.employees
// (the payroll module reads employees through a port that internal/app
// adapts to this). Every method takes the caller's Querier, so it joins the
// caller's transaction. Dates are YYYY-MM-DD.
type Employees struct{}

// Employee is the employee record other contexts need.
type Employee struct {
	ID               string
	UserID           *string
	FullName         string
	Nip              string
	Email            string
	Phone            string
	PhotoURL         *string
	JoinDate         string
	EndDate          *string
	EmploymentStatus string
	IsActive         bool
	DepartmentID     *string
	DepartmentName   *string
	SectionID        *string
	JobTitleID       *string
	PositionTitle    *string
	ReportingTo      *string
	BankName         *string
	BankAccount      *string
	NPWP             *string
	BPJSTK           *string
	BPJSKesehatan    *string
}

const employeeSelect = `SELECT e.id::text, e.user_id::text, e.full_name, e.nip, e.email, e.phone, e.photo_url,
  e.join_date::text, e.end_date::text, e.employment_status, e.is_active,
  e.department_id::text, d.name, e.section_id::text, e.job_title_id::text, p.title, e.reporting_to::text,
  e.bank_name, e.bank_account, e.npwp, e.bpjs_tk, e.bpjs_kesehatan
  FROM hris.employees e
  LEFT JOIN hris.departments d ON d.id = e.department_id
  LEFT JOIN hris.positions p ON p.id = e.job_title_id`

func scanEmployee(row pgx.CollectableRow) (Employee, error) {
	var e Employee
	err := row.Scan(&e.ID, &e.UserID, &e.FullName, &e.Nip, &e.Email, &e.Phone, &e.PhotoURL,
		&e.JoinDate, &e.EndDate, &e.EmploymentStatus, &e.IsActive,
		&e.DepartmentID, &e.DepartmentName, &e.SectionID, &e.JobTitleID, &e.PositionTitle, &e.ReportingTo,
		&e.BankName, &e.BankAccount, &e.NPWP, &e.BPJSTK, &e.BPJSKesehatan)
	return e, err
}

func (Employees) list(ctx context.Context, q database.Querier, where string, args ...any) ([]Employee, error) {
	rows, err := q.Query(ctx, employeeSelect+" "+where, args...)
	if err != nil {
		return nil, err
	}
	out, err := pgx.CollectRows(rows, scanEmployee)
	if out == nil {
		out = []Employee{}
	}
	return out, err
}

func (e Employees) one(ctx context.Context, q database.Querier, where string, arg string) (*Employee, error) {
	list, err := e.list(ctx, q, where+" LIMIT 1", arg)
	if err != nil || len(list) == 0 {
		return nil, err
	}
	return &list[0], nil
}

// ByID returns the employee, or nil when the id does not exist.
func (e Employees) ByID(ctx context.Context, q database.Querier, id string) (*Employee, error) {
	return e.one(ctx, q, "WHERE e.id = $1", id)
}

// ByUserID returns the employee linked to a login account, or nil.
func (e Employees) ByUserID(ctx context.Context, q database.Querier, userID string) (*Employee, error) {
	return e.one(ctx, q, "WHERE e.user_id = $1", userID)
}

// ListByIDs returns the employees that exist among ids, ordered by name.
func (e Employees) ListByIDs(ctx context.Context, q database.Querier, ids []string) ([]Employee, error) {
	return e.list(ctx, q, "WHERE e.id = ANY($1::uuid[]) ORDER BY e.full_name", nonNil(ids))
}

// Active returns the active employees ordered by name.
func (e Employees) Active(ctx context.Context, q database.Querier) ([]Employee, error) {
	return e.list(ctx, q, "WHERE e.is_active ORDER BY e.full_name")
}

// ActiveByDepartment returns the active employees of a department.
func (e Employees) ActiveByDepartment(ctx context.Context, q database.Querier, departmentID string) ([]Employee, error) {
	return e.list(ctx, q, "WHERE e.is_active AND e.department_id = $1 ORDER BY e.full_name", departmentID)
}

// ActiveByBranch returns the active employees whose login account belongs
// to the branch (employees carry no branch; configuration.users does).
func (e Employees) ActiveByBranch(ctx context.Context, q database.Querier, branchID string) ([]Employee, error) {
	return e.list(ctx, q, `WHERE e.is_active AND EXISTS (
		SELECT 1 FROM configuration.users u WHERE u.id = e.user_id AND u.branch_id = $1)
		ORDER BY e.full_name`, branchID)
}
