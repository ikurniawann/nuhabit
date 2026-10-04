package app

import (
	"nuhabit/backend/internal/modules/accounting"
	"nuhabit/backend/internal/modules/procurement"
	"nuhabit/backend/internal/platform/module"
)

// accounting: chart of accounts, fiscal years, journals, cash & bank, AP/AR,
// reports, the Finance B2B invoice API, and the journal subscribers of POS,
// stored value, procurement and inventory events.
//
// Its ports run the TS SQL in adapters_accounting.go until the owning
// modules expose these operations as services.
func init() {
	Register(accounting.Name, func(d module.Deps) module.Module { return accounting.New(d, AccountingPorts(d)) })
}

// AccountingPorts are the default adapters (also used by tests). PO payment
// terms come from procurement's service, which runs on the caller's querier.
func AccountingPorts(d module.Deps) accounting.Ports {
	loc := procurement.Location(d.Config.TimeZone)
	terms := procurement.NewService(d.DB, ProcurementPorts(loc, d.Now), d.Now, d.Log, loc)
	return accounting.Ports{
		Scopes:     accountingScopes{},
		Audit:      accountingAudit{},
		Purchasing: accountingPurchasing{terms: terms},
		PosOrders:  accountingPos{},
		Materials:  accountingMaterials{},
		Sales:      accountingSales{},
	}
}
