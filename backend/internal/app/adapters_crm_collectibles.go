package app

import (
	"nuhabit/backend/internal/modules/crm/collectibles"
	"nuhabit/backend/internal/platform/module"
)

// crmCollectiblesPorts wires the CRM collectibles area's ports.
func crmCollectiblesPorts(d module.Deps) collectibles.Ports {
	_ = d
	return collectibles.Ports{}
}
