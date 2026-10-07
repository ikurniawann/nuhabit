package app

import (
	"nuhabit/backend/internal/modules/payroll"
	"nuhabit/backend/internal/platform/module"
)

// payroll: payroll runs, payslips, payroll settings, salary structures,
// loans, KPI, performance reviews, 360 feedback and department tasks.
// Employees and attendance-side records come from adapters_payroll.go.
func init() {
	Register(payroll.Name, func(d module.Deps) module.Module { return payroll.New(d, payrollPorts()) })
}
