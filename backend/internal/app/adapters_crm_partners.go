package app

import (
	"nuhabit/backend/internal/modules/crm/partners"
	"nuhabit/backend/internal/platform/module"
)

// crmPartnersPorts wires the CRM partners area's ports.
func crmPartnersPorts(d module.Deps) partners.Ports {
	_ = d
	return partners.Ports{}
}
