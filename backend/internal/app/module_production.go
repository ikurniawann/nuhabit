package app

import (
	"nuhabit/backend/internal/modules/production"
	"nuhabit/backend/internal/platform/module"
)

// production: BOM explosion, material issue, WIP and batch receipts
// (/api/production). Stock and POS go through adapters_production.go;
// journals go to accounting as outbox events.
func init() {
	Register(production.Name, func(d module.Deps) module.Module {
		return production.New(d, ProductionPorts(d.Now))
	})
}
