package legacy_test

import (
	"testing"

	"nuhabit/backend/internal/modules/inventory/kit/kittest"
)

// Production orders belong to the production sub-module; the recipe lists
// also serve the BOM editors under master data.
func TestLegacyProductionSubModuleGuards(t *testing.T) {
	e := kittest.Setup(t, kittest.Menus, nil)
	mount(e, &fakePos{stock: map[string]float64{}})
	e.CheckGuards([]kittest.Guard{
		{Path: "/api/purchasing/production/orders",
			Allow:  []string{"items.product.production", "items.raw-material.production"},
			Refuse: []string{"items.product.master", "items.raw-material.inventory"}},
		{Path: "/api/purchasing/production/product-recipes",
			Allow:  []string{"items.product.production", "items.product.master"},
			Refuse: []string{"items.product.purchasing"}},
	})
}
