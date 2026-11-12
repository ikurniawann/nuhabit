package cogs

import (
	"slices"

	"nuhabit/backend/internal/platform/iam"
)

// additionalCostEditors: production recipe pages and the raw material BOM
// editor manage additional costs.
var additionalCostEditors = slices.Concat(iam.ItemsProduction, iam.ItemsRawMaterialMaster)
