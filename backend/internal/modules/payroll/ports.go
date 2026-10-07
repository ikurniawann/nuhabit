package payroll

import (
	"context"

	"nuhabit/backend/internal/modules/payroll/domain"
	"nuhabit/backend/internal/platform/database"
)

// Employees, departments, positions, attendance, shifts, leaves, overtime,
// contracts and public holidays belong to the HRIS people context
// (module hris). Payroll reads them through these ports; internal/app wires
// the adapters. Every method runs on the caller's Querier.

// EmployeeBrief is the display and payroll subset of an hris.employees row
// with its department and position names.
type EmployeeBrief struct {
	ID               string
	FullName         string
	NIP              *string
	Email            *string
	Phone            *string
	PhotoURL         *string
	IsActive         bool
	EmploymentStatus string
	JoinDate         string // YYYY-MM-DD
	DepartmentID     *string
	// Department is the departments row's name; HasDepartment is false when
	// the employee has none (the embed is null).
	Department    *string
	HasDepartment bool
	Position      *string
	HasPosition   bool
	ReportingTo   *string
}

// Employees reads hris.employees.
type Employees interface {
	// IDByUser is the employee linked to an account (employees.user_id):
	// the first matching row, as the TS query-builder .single() returns it,
	// "" when none.
	IDByUser(ctx context.Context, q database.Querier, userID string) (string, error)
	// IDByEmail is the first employee with this email, "" when none.
	IDByEmail(ctx context.Context, q database.Querier, email string) (string, error)
	// Briefs returns the employees that exist among ids (ids that are not
	// UUIDs simply match nothing).
	Briefs(ctx context.Context, q database.Querier, ids []string) (map[string]EmployeeBrief, error)
	// Active lists is_active employees in the table's natural order.
	Active(ctx context.Context, q database.Querier) ([]EmployeeBrief, error)
	// DirectReports are the active employees whose reporting_to is managerID.
	DirectReports(ctx context.Context, q database.Querier, managerID string) ([]string, error)
	// KPIRole is the role code a scorecard uses: the linked account's
	// configuration.users role, "employee" without one; found is false for
	// an unknown employee.
	KPIRole(ctx context.Context, q database.Querier, employeeID string) (role string, found bool, err error)
	// DepartmentMembers are the department's active employees ordered by
	// full_name (database collation).
	DepartmentMembers(ctx context.Context, q database.Querier, departmentID string) ([]Member, error)
	// Companies maps each employee among ids to the company of its linked
	// account (the user's company, else its branch's company); employees
	// without one are absent.
	Companies(ctx context.Context, q database.Querier, ids []string) (map[string]string, error)
}

// Member is an employee's id and name.
type Member struct {
	ID       string
	FullName string
}

// Department is an hris.departments row's id and name.
type Department struct {
	ID   string
	Name string
}

// Departments reads hris.departments.
type Departments interface {
	// All lists every department ordered by name.
	All(ctx context.Context, q database.Querier) ([]Department, error)
	// ByIDs returns the departments that exist among ids.
	ByIDs(ctx context.Context, q database.Querier, ids []string) (map[string]Department, error)
}

// Workforce reads the attendance-side records a payroll period needs.
type Workforce interface {
	PeriodRecords(ctx context.Context, q database.Querier, employeeID, start, end string) (domain.WorkforceRecords, error)
	// Holidays are the active public holiday dates in [start, end].
	Holidays(ctx context.Context, q database.Querier, start, end string) (map[string]bool, error)
}

// AppSettings reads configuration.app_settings (the company identity on
// payslips): every key, nil when missing or NULL.
type AppSettings interface {
	GetMany(ctx context.Context, q database.Querier, keys []string) (map[string]*string, error)
}

// Ports bundles the adapters the module needs.
type Ports struct {
	Employees   Employees
	Departments Departments
	Workforce   Workforce
	Settings    AppSettings
	// KPI reads what the KPI snapshot measures in other contexts.
	KPI KPISources
}
