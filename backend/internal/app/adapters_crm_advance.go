package app

import (
	"nuhabit/backend/internal/modules/crm/advance"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/whatsapp"
)

// crmAdvancePorts wires the CRM advance area through its stopgap SQL
// adapters (the sales funnel and notifications are in no migration wave
// yet, and hris exposes no employee-phone read) and platform/whatsapp.
func crmAdvancePorts(d module.Deps) advance.Ports {
	return advance.Ports{
		Sales:         advance.SalesFunnelSQL{},
		Notifications: advance.NotificationsSQL{},
		Employees:     advance.EmployeesSQL{},
		WhatsApp:      advance.WhatsAppGateway{Client: whatsapp.New(d.Log)},
	}
}
