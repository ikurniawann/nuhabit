package app

import (
	"nuhabit/backend/internal/modules/crm/reporting"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/whatsapp"
)

// crmReportingPorts wires the CRM reporting area: in-app notifications,
// HRIS phones and the WhatsApp gateway through stopgap adapters until the
// notifications and hris contexts expose them.
func crmReportingPorts(d module.Deps) reporting.Ports {
	return reporting.Ports{
		Notify:   reporting.NotificationsSQL{},
		Staff:    reporting.EmployeesSQL{},
		WhatsApp: reporting.WhatsAppGateway{Client: whatsapp.New(d.Log)},
	}
}
