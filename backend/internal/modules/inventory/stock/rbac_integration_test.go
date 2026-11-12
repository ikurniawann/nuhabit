package stock_test

import (
	"testing"

	"nuhabit/backend/internal/modules/inventory/kit/kittest"
)

// Product, raw material and general items inventory are separate
// sub-modules; the stock reports belong to Items reports.
func TestStockSubModuleGuards(t *testing.T) {
	e := setup(t)
	e.CheckGuards([]kittest.Guard{
		{Path: "/api/inventory/stock-opnames", Allow: []string{"items.raw-material.inventory"},
			Refuse: []string{"items.product.inventory"}},
		{Path: "/api/inventory/product-stock-opnames", Allow: []string{"items.product.inventory"},
			Refuse: []string{"items.raw-material.inventory"}},
		{Path: "/api/inventory/finished-goods", Allow: []string{"items.product.inventory"},
			Refuse: []string{"items.raw-material.inventory", "items.product.master"}},
		{Path: "/api/purchasing/inventory/transfer", Allow: []string{"items.raw-material.inventory"},
			Refuse: []string{"items.product.inventory", "items.raw-material.purchasing"}},
		{Path: "/api/purchasing/inventory/supply", Allow: []string{"items.general.inventory"},
			Refuse: []string{"items.raw-material.inventory", "items.general.master"}},
		{Path: "/api/purchasing/inventory/supply-usage", Allow: []string{"items.general.inventory"},
			Refuse: []string{"items.general.purchasing"}},
		{Path: "/api/purchasing/reports/inventory-valuation", Allow: []string{"items.reports"},
			Refuse: []string{"items.raw-material.inventory"}},
	})
}
