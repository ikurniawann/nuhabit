package app

import (
	"nuhabit/backend/internal/modules/crm/engagement"
	"nuhabit/backend/internal/platform/module"
)

// crmEngagementPorts wires the CRM engagement area's ports: POS order reads
// and member web push, both stopgap adapters in the engagement package.
func crmEngagementPorts(d module.Deps) engagement.Ports {
	return engagement.Ports{
		Orders: engagement.OrdersSQL{},
		Push:   engagement.NewWebPush(d.DB, d.Log, d.Now),
	}
}
