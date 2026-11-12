package catalog

import (
	"slices"

	"nuhabit/backend/internal/platform/iam"
)

// Menu prefixes of the shared master lookups: every Items sub-module whose
// pages read them. Writes stay with the owning master data menu.
var (
	unitReaders = slices.Concat(iam.ItemsProductMaster, iam.ItemsRawMaterialMaster, iam.ItemsGeneralMaster,
		iam.ItemsRawMaterialPurchasing, iam.ItemsReports)
	unitEditors   = slices.Concat(iam.ItemsProductMaster, iam.ItemsRawMaterialMaster)
	lookupEditors = slices.Concat(iam.ItemsProductMaster, iam.ItemsRawMaterialMaster, iam.ItemsGeneralMaster)
	// warehouseReaders: Items pages plus the POS catalog and user settings
	// pickers outside Items.
	warehouseReaders = slices.Concat(iam.ItemsPurchasing, iam.ItemsGeneralPurchasing, iam.ItemsInventory,
		iam.ItemsProductMaster, iam.ItemsReports, iam.PosCatalog, iam.SettingsUsers)
	rawMaterialReaders = slices.Concat(iam.ItemsProductMaster, iam.ItemsRawMaterialMaster,
		iam.ItemsRawMaterialPurchasing, iam.ItemsReports, iam.PosCatalog)
	rawMaterialPricing = slices.Concat(iam.ItemsRawMaterialMaster, iam.ItemsRawMaterialPurchasing)
	productReaders     = slices.Concat(iam.ItemsProductMaster, iam.ItemsReports, iam.PosCatalog)
	productViewers     = slices.Concat(iam.ItemsProductMaster, iam.ItemsReports)
)
