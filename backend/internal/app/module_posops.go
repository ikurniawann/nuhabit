package app

import (
	"nuhabit/backend/internal/modules/posops"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/whatsapp"
)

// pos-ops: shifts, tables, reservations, catalog, customers, dashboard,
// reports and POS settings.
func init() {
	Register(posops.Name, func(d module.Deps) module.Module {
		return posops.New(d, PosOpsPorts(d))
	})
}

// PosOpsPorts wires pos-ops' ports to SQL adapters ported from the TS
// routes (adapters_posops.go) until pos-sales, stored-value and CRM expose
// these reads. The module's integration tests use it too.
func PosOpsPorts(d module.Deps) posops.Ports {
	return posops.Ports{
		Sales:       posOpsSales{},
		MemberBills: posOpsMemberBills{},
		Directory:   posOpsDirectory{},
		Stalls:      posOpsStalls{},
		Inventory:   posOpsInventory{},
		Shop:        posOpsShop{},
		CRM:         posOpsCRM{},
		StoredValue: posOpsStoredValue{},
		WhatsApp:    posOpsWhatsApp{db: d.DB, wa: whatsapp.New(d.Log)},
		ReportRows:  posOpsReportRows{},
	}
}
