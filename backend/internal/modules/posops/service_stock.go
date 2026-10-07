package posops

import (
	"context"
	"slices"

	"nuhabit/backend/internal/modules/posops/domain"
	"nuhabit/backend/internal/platform/httpx"
)

// StockAlerts mirrors GET /api/pos/stock-alerts.
func (s *Service) StockAlerts(ctx context.Context) (*Obj, error) {
	low, err := s.ports.Inventory.LowRawMaterials(ctx, s.db)
	if err != nil {
		return nil, err
	}
	bom, err := s.ports.Inventory.ActiveBom(ctx, s.db)
	if err != nil {
		return nil, err
	}
	posRows, err := trackedPosStock(ctx, s.db)
	if err != nil {
		return nil, err
	}
	raw := make([]domain.RawMaterialAlert, len(low))
	for i, m := range low {
		raw[i] = domain.NewRawMaterialAlert(m)
	}
	var ids []string
	for _, b := range bom {
		if b.RawMaterialID != "" && !slices.Contains(ids, b.RawMaterialID) {
			ids = append(ids, b.RawMaterialID)
		}
	}
	stock := map[string]domain.RawMaterialStock{}
	if len(ids) > 0 {
		if stock, err = s.ports.Inventory.MaterialStock(ctx, s.db, ids); err != nil {
			return nil, err
		}
	}
	atRisk := domain.ProductsAtRisk(bom, stock)
	pos := domain.PosStockAlerts(posRows)
	return NewObj("raw_materials", raw, "products_at_risk", atRisk, "pos_products", pos,
		"summary", NewObj("raw_material_count", len(raw), "product_at_risk_count", len(atRisk), "pos_product_count", len(pos)),
		"updated_at", httpx.JSTime(s.now())), nil
}
