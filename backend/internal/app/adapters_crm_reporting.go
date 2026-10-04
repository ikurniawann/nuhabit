package app

import (
	"os"

	"nuhabit/backend/internal/modules/crm/reporting"
	"nuhabit/backend/internal/platform/module"
)

// crmReportingPorts wires the CRM reporting area: in-app notifications,
// HRIS phones and the WhatsApp gateway through stopgap adapters until the
// notifications and hris contexts expose them.
func crmReportingPorts(module.Deps) reporting.Ports {
	return reporting.Ports{
		Notify:   reporting.NotificationsSQL{},
		Staff:    reporting.EmployeesSQL{},
		WhatsApp: reporting.WhatsAppGateway{Getenv: os.Getenv},
	}
}
