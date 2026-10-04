package app

import (
	"os"

	"nuhabit/backend/internal/modules/crm/advance"
	"nuhabit/backend/internal/platform/module"
)

// crmAdvancePorts wires the CRM advance area through its stopgap SQL
// adapters: the sales funnel, notifications and WhatsApp settings are in no
// migration wave yet, and hris exposes no employee-phone read.
func crmAdvancePorts(module.Deps) advance.Ports {
	return advance.Ports{
		Sales:         advance.SalesFunnelSQL{},
		Notifications: advance.NotificationsSQL{},
		Employees:     advance.EmployeesSQL{},
		WhatsApp:      advance.WhatsAppSettingsSQL{Getenv: os.Getenv},
	}
}
