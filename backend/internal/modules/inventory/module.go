// Package inventory is the inventory bounded context: item masters
// (catalog), stock and its ledgers (stock, ledger), production and COGS
// (production). Sub-packages share kit (scope, rows, query parsing) and
// domain (pure rules).
package inventory

import (
	"nuhabit/backend/internal/modules/inventory/catalog"
	"nuhabit/backend/internal/modules/inventory/kit"
	"nuhabit/backend/internal/modules/inventory/production"
	"nuhabit/backend/internal/modules/inventory/stock"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/module"
)

// Name is the MODULES key.
const Name = "inventory"

// Ports are the adapters internal/app wires per sub-area.
type Ports struct {
	Stock      stock.Ports
	Catalog    catalog.Ports
	Production production.Ports
}

type inventoryModule struct{ routes []module.Route }

func (m inventoryModule) Name() string           { return Name }
func (m inventoryModule) Routes() []module.Route { return m.routes }

// New mounts the module on the shared pool and subscribes the stock
// effects procurement publishes.
func New(deps module.Deps, ports Ports) module.Module {
	if deps.Events != nil {
		stock.Subscribe(deps.Events, deps.Now)
	}
	return NewOn(deps, deps.DB, ports)
}

// NewOn mounts the module on db (a test transaction in integration tests).
func NewOn(deps module.Deps, db database.DB, ports Ports) module.Module {
	env := kit.NewEnv(deps, db)
	var routes []module.Route
	routes = append(routes, stock.Routes(env, ports.Stock)...)
	routes = append(routes, catalog.Routes(env, ports.Catalog)...)
	routes = append(routes, production.Routes(env, ports.Production)...)
	return inventoryModule{routes: routes}
}
