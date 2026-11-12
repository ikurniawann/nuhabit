package cogs_test

import (
	"testing"

	"nuhabit/backend/internal/modules/inventory/cogs"
	"nuhabit/backend/internal/modules/inventory/kit/kittest"
)

// Additional costs serve the production recipe pages and the raw material
// BOM editor; COGS breakdowns serve production.
func TestCogsSubModuleGuards(t *testing.T) {
	e := kittest.Setup(t, kittest.Menus, nil)
	org := e.NewOrg()
	e.Mount(cogs.Routes(e.Env, cogs.Ports{Receipts: fakeReceipts{}}))
	kg := e.Unit("KG", "Kilogram")
	rm := e.RawMaterial(org, "RMG-"+org.BranchID[:4], "Beras", kg, "", 1)
	e.CheckGuards([]kittest.Guard{
		{Path: "/api/purchasing/cogs/additional-cost",
			Allow:  []string{"items.product.production", "items.raw-material.master"},
			Refuse: []string{"items.product.master", "items.raw-material.purchasing"}},
		{Path: "/api/purchasing/cogs/raw-material/" + rm,
			Allow:  []string{"items.raw-material.production"},
			Refuse: []string{"items.raw-material.master"}},
	})
}
