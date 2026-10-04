package app

import (
	"nuhabit/backend/internal/modules/crm/marketing"
	"nuhabit/backend/internal/platform/module"
)

// crmMarketingPorts wires the CRM marketing area's ports to its stopgap SQL
// adapters (settings, promo and sales-funnel tables).
func crmMarketingPorts(d module.Deps) marketing.Ports {
	_ = d
	return marketing.Ports{
		Settings: marketing.AppSettingsSQL{},
		Promo:    marketing.PromoSQL{},
		Funnel:   marketing.FunnelSQL{},
	}
}
