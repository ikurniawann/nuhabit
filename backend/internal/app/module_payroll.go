package app

import (
	"os"
	"strings"
	"time"

	"nuhabit/backend/internal/modules/dataroom"
	"nuhabit/backend/internal/modules/payroll"
	"nuhabit/backend/internal/platform/module"
)

// payroll: payroll runs, payslips, payroll settings, salary structures,
// loans, KPI, performance reviews, 360 feedback and department tasks.
// Employees and attendance-side records come from adapters_payroll.go;
// payslips go out through the mailer port (PAYROLL_FROM_EMAIL or FROM_EMAIL
// overrides the configured sender). Department task reminders reach staff
// through the dashboard inbox, then WhatsApp and email through the gym
// channels, best effort.
func init() {
	Register(payroll.Name, func(d module.Deps) module.Module {
		return payroll.New(d, payrollPortsFor(d))
	})
	RegisterJob(payroll.Name, "dept-tasks.recurrence", time.Hour, payrollJobs, (*payroll.Jobs).MaterializeOccurrences)
	RegisterJob(payroll.Name, "dept-tasks.reminders", 15*time.Minute, payrollJobs, (*payroll.Jobs).SendReminders)
}

func payrollJobs(d module.Deps) *payroll.Jobs { return payroll.NewJobs(d, payrollPortsFor(d)) }

func payrollPortsFor(d module.Deps) payroll.Ports {
	ports := payrollPorts()
	ports.PayslipFrom = strings.TrimSpace(firstNonEmptyStr(os.Getenv("PAYROLL_FROM_EMAIL"), os.Getenv("FROM_EMAIL")))
	ports.PayslipMailer = mailPayslipMailer{svc: newMailService(d)}
	if d.Config.ModuleEnabled(dataroom.Name) {
		ports.DocumentFiler = dataroomFiler(d)
	}
	ports.TaskChannels = newGymChannels(d)
	return ports
}
