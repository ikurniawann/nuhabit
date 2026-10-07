package app

import (
	"nuhabit/backend/internal/modules/hris"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/whatsapp"
)

// hris: employees, attendance, leave, shifts, overtime, holidays,
// contracts, onboarding/offboarding, self service, announcements,
// notifications, logbook, reports and HR master data.
func init() {
	Register(hris.Name, func(d module.Deps) module.Module { return hris.New(d, HrisPorts(d)) })
}

// HrisPorts wires the hris ports to the adapters in adapters_hris.go. The
// module's integration tests use it too.
func HrisPorts(d module.Deps) hris.Ports {
	return hris.Ports{
		Payroll:     hrisPayrollSQL{},
		Salary:      hrisSalarySQL{},
		Recruitment: hrisRecruitmentSQL{},
		Directory:   hrisDirectorySQL{},
		WhatsApp:    &hrisWhatsApp{db: d.DB, wa: whatsapp.New(d.Log)},
		Company:     hrisCompany{},
	}
}
