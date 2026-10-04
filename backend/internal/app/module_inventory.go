package app

import (
	"time"

	"nuhabit/backend/internal/modules/inventory"
	"nuhabit/backend/internal/modules/inventory/catalog"
	"nuhabit/backend/internal/modules/inventory/production"
	"nuhabit/backend/internal/modules/inventory/stock"
	"nuhabit/backend/internal/platform/module"
)

// inventory: item masters, stock levels and ledgers, opnames, transfers,
// production and COGS (/api/inventory, /api/purchasing/{inventory,
// raw-materials,...}). Procurement and POS catalog reads go through the SQL
// adapters in adapters_inventory.go; stock journals go to accounting as
// outbox events.
func init() {
	Register(inventory.Name, func(d module.Deps) module.Module {
		return inventory.New(d, inventoryPorts(d.Now))
	})
}

func inventoryPorts(now func() time.Time) inventory.Ports {
	return inventory.Ports{
		Stock: stock.Ports{
			Procurement: inventoryProcurement{},
			PosSkus:     inventoryPosSkus{},
			Journals:    stock.OutboxJournals{},
		},
		Catalog:    catalog.Ports{Pos: inventoryPosCatalog{now: now}, Procurement: inventoryGrns{}},
		Production: production.Ports{Pos: inventoryPosOutput{catalog: inventoryPosCatalog{now: now}}, Receipts: inventoryReceipts{}},
	}
}
