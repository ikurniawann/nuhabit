package catalog_test

import (
	"testing"

	"nuhabit/backend/internal/modules/inventory/kit/kittest"
)

// The shared master lookups pass every sub-module whose pages read them;
// writes and exports stay with the owning master data menu.
func TestCatalogSubModuleGuards(t *testing.T) {
	e := setup(t)
	e.CheckGuards([]kittest.Guard{
		{Path: "/api/purchasing/units",
			Allow:  []string{"items.product.master", "items.raw-material.master", "items.general.master", "items.raw-material.purchasing", "items.reports"},
			Refuse: []string{"items.product.inventory", "items.product.production"}},
		{Path: "/api/purchasing/warehouses",
			Allow:  []string{"items.product.inventory", "items.general.purchasing", "pos.catalog", "settings.users"},
			Refuse: []string{"items.product.production", "items.product.approval"}},
		{Path: "/api/purchasing/products",
			Allow:  []string{"items.product.master", "items.reports", "pos.catalog"},
			Refuse: []string{"items.product.purchasing", "items.raw-material.master"}},
		{Path: "/api/purchasing/raw-materials",
			Allow:  []string{"items.raw-material.master", "items.raw-material.purchasing", "items.product.master"},
			Refuse: []string{"items.raw-material.inventory", "items.product.purchasing"}},
		{Path: "/api/purchasing/supply-items", Allow: []string{"items.general.master"},
			Refuse: []string{"items.general.purchasing", "items.general.inventory"}},
		{Path: "/api/purchasing/export/raw-materials", Allow: []string{"items.raw-material.master"},
			Refuse: []string{"items.product.master", "items.raw-material.purchasing"}},
	})
}
