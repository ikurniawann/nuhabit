package app

import (
	"os"
	"strings"

	"nuhabit/backend/internal/modules/dataroom"
	"nuhabit/backend/internal/modules/payroll"
	"nuhabit/backend/internal/platform/module"
)

// payroll: payroll runs, payslips, payroll settings, salary structures,
// loans, KPI, performance reviews, 360 feedback and department tasks.
// Employees and attendance-side records come from adapters_payroll.go;
// payslips go out through the mailer port (PAYROLL_FROM_EMAIL or FROM_EMAIL
// overrides the configured sender).
func init() {
	Register(payroll.Name, func(d module.Deps) module.Module {
		ports := payrollPorts()
		ports.PayslipFrom = strings.TrimSpace(firstNonEmptyStr(os.Getenv("PAYROLL_FROM_EMAIL"), os.Getenv("FROM_EMAIL")))
		ports.PayslipMailer = mailPayslipMailer{svc: newMailService(d)}
		if d.Config.ModuleEnabled(dataroom.Name) {
			ports.DocumentFiler = dataroomFiler(d)
		}
		return payroll.New(d, ports)
	})
}
