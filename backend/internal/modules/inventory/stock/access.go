package stock

import (
	"slices"

	"nuhabit/backend/internal/platform/iam"
)

// materialMovementReaders: raw material stock movements, also opened from
// the general items stock page.
var materialMovementReaders = slices.Concat(iam.ItemsRawMaterialInventory, iam.ItemsGeneralInventory)
