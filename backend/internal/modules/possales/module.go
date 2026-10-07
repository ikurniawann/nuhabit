// Package possales is the POS sales bounded context (module name
// "pos-sales"): cashier orders and payments, central checkouts, QRIS,
// supervisor approvals, the kitchen queue, GoFood and table self-order.
// Ports of frontend/src/app/api/pos/{orders,checkouts,qris,print-jobs,kds,
// supervisors,promo-check,offer-rules,pass-lookup,member-qr,gofood} and
// frontend/src/app/api/table-order. Each route family lives in a
// sub-package; internal/app builds them with their ports and mounts them here.
package possales

import "nuhabit/backend/internal/platform/module"

// Name is the MODULES key.
const Name = "pos-sales"

type salesModule struct{ routes []module.Route }

func (m salesModule) Name() string           { return Name }
func (m salesModule) Routes() []module.Route { return m.routes }

// Subroutes is a sub-package handler mounted by the module.
type Subroutes interface{ Routes() []module.Route }

// New mounts the sub-package handlers.
func New(subs ...Subroutes) module.Module {
	var routes []module.Route
	for _, s := range subs {
		routes = append(routes, s.Routes()...)
	}
	return salesModule{routes: routes}
}
