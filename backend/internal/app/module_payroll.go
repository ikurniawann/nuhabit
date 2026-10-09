package app

import (
	"net/http"
	"os"
	"strings"
	"time"

	"nuhabit/backend/internal/modules/payroll"
	"nuhabit/backend/internal/platform/module"
)

// payroll: payroll runs, payslips, payroll settings, salary structures,
// loans, KPI, performance reviews, 360 feedback and department tasks.
// Employees and attendance-side records come from adapters_payroll.go.
func init() {
	Register(payroll.Name, func(d module.Deps) module.Module {
		ports := payrollPorts()
		from := strings.TrimSpace(os.Getenv("PAYROLL_FROM_EMAIL"))
		if from == "" {
			from = strings.TrimSpace(os.Getenv("FROM_EMAIL"))
		}
		ports.PayslipFrom = from
		if from != "" && strings.TrimSpace(os.Getenv("RESEND_API_KEY")) != "" {
			ports.PayslipMailer = &resendPayslipMailer{apiKey: strings.TrimSpace(os.Getenv("RESEND_API_KEY")), client: &http.Client{Timeout: 15 * time.Second}}
		}
		return payroll.New(d, ports)
	})
}
