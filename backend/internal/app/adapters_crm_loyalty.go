package app

import (
	"nuhabit/backend/internal/modules/crm/loyalty"
	"nuhabit/backend/internal/platform/module"
)

// crmLoyaltyPorts wires the CRM loyalty area: dashboard pos_orders reads
// through the stopgap SQL adapter until pos-sales exposes them.
func crmLoyaltyPorts(module.Deps) loyalty.Ports {
	return loyalty.Ports{Orders: loyalty.PosOrdersSQL{}}
}
