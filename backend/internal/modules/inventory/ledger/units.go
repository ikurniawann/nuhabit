package ledger

import (
	"context"

	"nuhabit/backend/internal/modules/inventory/domain"
	"nuhabit/backend/internal/modules/inventory/kit"
	"nuhabit/backend/internal/platform/database"
)

// BaseUnitResolver converts a purchasing unit of a material into its base
// unit factor (createBaseUnitResolver in lib/purchasing/raw-material-units.ts).
type BaseUnitResolver func(rawMaterialID string, satuanID *string) float64

// NewBaseUnitResolver loads the materials' legacy units and active packs.
func NewBaseUnitResolver(ctx context.Context, q database.Querier, rawMaterialIDs []string) (BaseUnitResolver, error) {
	seen := map[string]bool{}
	var ids []string
	for _, id := range rawMaterialIDs {
		if id != "" && !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	if len(ids) == 0 {
		return func(string, *string) float64 { return 1 }, nil
	}
	mats, err := kit.Query(ctx, q, `SELECT id::text, satuan_besar_id::text, satuan_kecil_id::text, konversi_factor
		FROM raw_materials WHERE id = ANY($1::uuid[])`, ids)
	if err != nil {
		return nil, err
	}
	convs, err := kit.Query(ctx, q, `SELECT raw_material_id::text, satuan_id::text, qty_in_base_unit, is_base, is_purchase_default
		FROM raw_material_unit_conversions WHERE raw_material_id = ANY($1::uuid[]) AND is_active = true`, ids)
	if err != nil {
		return nil, err
	}
	materials := map[string]*domain.Material{}
	for _, m := range mats {
		materials[m.Str("id")] = &domain.Material{
			SatuanBesarID: m.StrPtr("satuan_besar_id"), SatuanKecilID: m.StrPtr("satuan_kecil_id"), KonversiFactor: m.NumPtr("konversi_factor"),
		}
	}
	packs := map[string][]domain.Pack{}
	for _, c := range convs {
		id := c.Str("raw_material_id")
		packs[id] = append(packs[id], domain.Pack{
			SatuanID: c.Str("satuan_id"), QtyInBaseUnit: c.Num("qty_in_base_unit"),
			IsBase: c.Bool("is_base"), IsPurchaseDefault: c.Bool("is_purchase_default"),
		})
	}
	return func(rawMaterialID string, satuanID *string) float64 {
		s := ""
		if satuanID != nil {
			s = *satuanID
		}
		return domain.PackFactor(materials[rawMaterialID], packs[rawMaterialID], s)
	}, nil
}
