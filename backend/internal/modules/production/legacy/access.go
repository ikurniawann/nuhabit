package legacy

import (
	"slices"

	"nuhabit/backend/internal/platform/iam"
)

// Menu prefixes of the recipe and BOM routes: production pages, the BOM
// editors under master data and the POS recipe builder (pos.catalog).
var (
	recipeReaders         = slices.Concat(iam.ItemsProduction, iam.ItemsProductMaster, iam.ItemsRawMaterialMaster)
	productBomEditors     = slices.Concat(iam.ItemsProductMaster, iam.PosCatalog)
	productBomReaders     = slices.Concat(productBomEditors, iam.ItemsReports)
	rawMaterialBomReaders = slices.Concat(iam.ItemsRawMaterialMaster, iam.ItemsRawMaterialPurchasing)
)
