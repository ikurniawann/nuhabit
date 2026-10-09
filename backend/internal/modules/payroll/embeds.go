package payroll

import (
	"context"

	"nuhabit/backend/internal/platform/database"
)

// The TS selects embed employees with PostgREST syntax, e.g.
// `processed_by:employees!processed_by ( id, full_name, nip )`. The rows
// come from this module's tables; the employee objects are stitched in
// from the Employees port with the same keys in the same order. An alias
// equal to a column name replaces that column in place; a new alias is
// appended after the columns.

// Employee embed shapes used by the routes (field lists in select order).
var (
	personFields   = []string{"id", "full_name", "nip"}
	runDetailEmp   = []string{"id", "full_name", "nip", "email", "is_active", "bank_name", "bank_account", "department_id", "department"}
	loanListEmp    = []string{"id", "full_name", "nip", "photo_url", "department"}
	payslipEmp     = []string{"id", "full_name", "nip", "photo_url", "position", "department"}
	salaryListEmp  = []string{"id", "full_name", "nip", "photo_url"}
	salaryDetailEm = []string{"id", "full_name", "nip", "email", "phone", "position", "department"}
)

// employeeObj renders an employee embed with fields; nil stays null.
func employeeObj(b *EmployeeBrief, fields []string) any {
	if b == nil {
		return nil
	}
	o := newObj()
	for _, f := range fields {
		switch f {
		case "id":
			o.Set(f, b.ID)
		case "full_name":
			o.Set(f, b.FullName)
		case "nip":
			o.Set(f, b.NIP)
		case "photo_url":
			o.Set(f, b.PhotoURL)
		case "email":
			o.Set(f, b.Email)
		case "is_active":
			o.Set(f, b.IsActive)
		case "phone":
			o.Set(f, b.Phone)
		case "bank_name":
			o.Set(f, b.BankName)
		case "bank_account":
			o.Set(f, b.BankAccount)
		case "department_id":
			o.Set(f, b.DepartmentID)
		case "department":
			if b.HasDepartment {
				o.Set(f, object("name", b.Department))
			} else {
				o.Set(f, nil)
			}
		case "position":
			if b.HasPosition {
				o.Set(f, object("title", b.Position))
			} else {
				o.Set(f, nil)
			}
		}
	}
	return o
}

// embed is one employee embed: alias set from the employee id in column.
type embed struct {
	alias, column string
	fields        []string
}

// stitch resolves every embed of rows with one Briefs call.
func (s *service) stitch(ctx context.Context, q database.Querier, rows []*obj, embeds ...embed) error {
	var ids []string
	for _, r := range rows {
		for _, e := range embeds {
			if id := r.Str(e.column); id != "" {
				ids = append(ids, id)
			}
		}
	}
	briefs := map[string]EmployeeBrief{}
	if len(ids) > 0 {
		var err error
		if briefs, err = s.ports.Employees.Briefs(ctx, q, ids); err != nil {
			return err
		}
	}
	for _, r := range rows {
		for _, e := range embeds {
			var b *EmployeeBrief
			if found, ok := briefs[r.Str(e.column)]; ok {
				b = &found
			}
			r.Set(e.alias, employeeObj(b, e.fields))
		}
	}
	return nil
}

// brief returns one employee, nil when it does not exist.
func (s *service) brief(ctx context.Context, id string) (*EmployeeBrief, error) {
	m, err := s.ports.Employees.Briefs(ctx, s.db, []string{id})
	if err != nil {
		return nil, err
	}
	if b, ok := m[id]; ok {
		return &b, nil
	}
	return nil, nil
}
