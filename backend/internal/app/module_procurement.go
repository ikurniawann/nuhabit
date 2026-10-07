package app

import (
	"nuhabit/backend/internal/modules/procurement"
	"nuhabit/backend/internal/platform/module"
)

// procurement: purchase requests, purchase orders, receiving, returns,
// vendor credits, suppliers and vendors (/api/purchasing/...). Reads of the
// item master, identity, HRIS and inventory go through the SQL adapters in
// adapters_procurement.go.
func init() {
	Register(procurement.Name, func(d module.Deps) module.Module {
		return procurement.New(d, ProcurementPorts(procurement.Location(d.Config.TimeZone), d.Now))
	})
}
