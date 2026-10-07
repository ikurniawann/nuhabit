package app

import (
	"nuhabit/backend/internal/modules/accounting"
	"nuhabit/backend/internal/modules/salesfunnel"
	"nuhabit/backend/internal/platform/module"
)

// sales-funnel: leads, deals, pipelines, accounts and contacts, tasks,
// quotations, invoices and payments, forecast, reports and timeline. Its
// ports run the TS SQL in adapters_salesfunnel.go; AR invoices go through
// accounting's service.
func init() {
	Register(salesfunnel.Name, func(d module.Deps) module.Module { return salesfunnel.New(d, SalesFunnelPorts(d)) })
}

// SalesFunnelPorts are the default adapters (also used by tests).
func SalesFunnelPorts(d module.Deps) salesfunnel.Ports {
	return salesfunnel.Ports{
		Directory:   salesFunnelDirectory{},
		Catalog:     salesFunnelCatalog{},
		Stock:       salesFunnelStock{},
		Members:     salesFunnelMembers{},
		CRM:         salesFunnelCRM{},
		Receivables: salesFunnelReceivables{svc: accounting.NewService(d.DB, AccountingPorts(d), d.Log, d.Now)},
	}
}
