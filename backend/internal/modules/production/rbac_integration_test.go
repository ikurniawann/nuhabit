package production_test

import (
	"testing"

	"nuhabit/backend/internal/modules/inventory/kit/kittest"
)

// Production reads belong to the production sub-module; recipe settings to
// the master data menu whose BOM editor shows them.
func TestProductionSubModuleGuards(t *testing.T) {
	e := setup(t)
	product := e.Product(e.org, e.org.Stall1ID, "PRG-"+e.org.BranchID[:4], "Roti", 5000)
	e.CheckGuards([]kittest.Guard{
		{Path: "/api/production/wip",
			Allow:  []string{"items.product.production", "items.raw-material.production"},
			Refuse: []string{"items.product.master", "items.raw-material.inventory"}},
		{Path: "/api/production/recipe-settings?product_id=" + product,
			Allow:  []string{"items.product.master"},
			Refuse: []string{"items.product.production", "items.raw-material.master"}},
	})
}
