package procurement

import (
	"context"
	"encoding/json"

	"nuhabit/backend/internal/modules/procurement/domain"
	"nuhabit/backend/internal/platform/database"
	pscope "nuhabit/backend/internal/platform/scope"
)

// warehouseScopeErrors are WAREHOUSE_SCOPE_ERRORS of grn-create.
var warehouseScopeErrors = map[string]string{
	"not_found":       "Gudang tidak ditemukan",
	"inactive":        "Gudang tidak aktif",
	"branch_mismatch": "Gudang tidak sesuai cabang yang diizinkan untuk penerimaan ini",
}

// receivingScope is resolveReceivingScope: the warehouse's company and
// branch (or the SULU fallback), checked against the user's scope.
func (s *Service) receivingScope(ctx context.Context, q database.Querier, warehouseID string, scope *pscope.Scope) (*BusinessIDs, error) {
	business, err := s.ports.Locations.WarehouseScope(ctx, q, warehouseID)
	if err != nil {
		return nil, err
	}
	if business == nil {
		if business, err = s.ports.Locations.ScopeByCodes(ctx, q, "SULU", "SULU-BANDUNG"); err != nil {
			return nil, err
		}
	}
	var contextBranch *string
	if business != nil {
		contextBranch = &business.BranchID
	}
	if code, err := s.validateWarehouse(ctx, q, warehouseID, scope, contextBranch); err != nil {
		return nil, err
	} else if code != "" {
		return nil, badRequest(warehouseScopeErrors[code])
	}
	return business, nil
}

// validateWarehouse is validateWarehouseForReceivingScope; it returns the
// error code ("not_found", "inactive", "branch_mismatch") or "".
func (s *Service) validateWarehouse(ctx context.Context, q database.Querier, warehouseID string, scope *pscope.Scope, contextBranch *string) (string, error) {
	expectedBranch := pscope.WarehouseBranchFilter(scope, contextBranch)
	expectedCompany := pscope.WarehouseCompanyFilter(scope)
	w, err := s.ports.Locations.Warehouse(ctx, q, warehouseID)
	if err != nil {
		return "", err
	}
	switch {
	case w == nil:
		return "not_found", nil
	case !w.IsActive:
		return "inactive", nil
	case expectedBranch != nil && *expectedBranch != "" && w.BranchID != *expectedBranch:
		return "branch_mismatch", nil
	case expectedCompany != nil && (w.CompanyID == nil || *w.CompanyID != *expectedCompany):
		return "branch_mismatch", nil
	}
	return "", nil
}

// poItemsForReceive reads the PO lines receiving validates against; with
// labels it also embeds the raw material name (GRN Continue messages).
func (s *Service) poItemsForReceive(ctx context.Context, q database.Querier, poID string, labels bool) ([]domain.PoItemForReceive, error) {
	rows, err := s.rows.Query(ctx, q, `SELECT id, raw_material_id, product_id, supply_item_id, pos_sku_id,
		qty_ordered::float8 AS qty_ordered, COALESCE(qty_received, 0)::float8 AS qty_received, harga_satuan::float8 AS harga_satuan
		FROM purchase_order_items WHERE purchase_order_id = $1 AND is_active = true`, poID)
	if err != nil {
		return nil, err
	}
	var names map[string]json.RawMessage
	if labels {
		if names, err = s.ports.Catalog.Refs(ctx, q, EntityRawMaterial, "id, nama", uniqueStrings(column(rows, "raw_material_id"))); err != nil {
			return nil, err
		}
	}
	out := make([]domain.PoItemForReceive, len(rows))
	for i, r := range rows {
		out[i] = domain.PoItemForReceive{
			ID: r.Str("id"), RawMaterialID: r.Str("raw_material_id"), ProductID: r.Str("product_id"), SupplyItemID: r.Str("supply_item_id"),
			PosSkuID: r.StrPtr("pos_sku_id"), QtyOrdered: r.Num("qty_ordered"), QtyReceived: r.Num("qty_received"), HargaSatuan: r.Num("harga_satuan"),
		}
		if raw, ok := names[r.Str("raw_material_id")]; ok {
			if rm, err := decodeRow(raw); err == nil {
				out[i].Label = rm.Str("nama")
			}
		}
	}
	return out, nil
}

// validateDeliveryCanReceive returns the delivery (nil when missing) and the
// problems that block receiving it.
func (s *Service) validateDeliveryCanReceive(ctx context.Context, q database.Querier, deliveryID string) (*Row, []string, error) {
	delivery, err := s.rows.One(ctx, q, `SELECT * FROM deliveries WHERE id = $1::text::uuid AND is_active = true`, deliveryID)
	if err != nil || delivery == nil {
		return nil, []string{"Delivery tidak ditemukan"}, nil
	}
	var errs []string
	switch delivery.Str("status") {
	case "pending", "shipped", "in_transit", "delivered":
	default:
		errs = append(errs, "Delivery dengan status "+jsString(delivery.Get("status"))+" tidak dapat diterima")
	}
	existing, err := s.rows.One(ctx, q, `SELECT id, nomor_grn, status FROM grn WHERE delivery_id = $1 AND is_active = true LIMIT 1`, delivery.Str("id"))
	if err == nil && existing != nil {
		label := existing.Str("nomor_grn")
		if label == "" {
			label = existing.Str("id")
		}
		errs = append(errs, "Delivery ini sudah memiliki dokumen Barang Masuk ("+label+"). Buat delivery baru jika ada pengiriman susulan.")
	}
	return delivery, errs, nil
}

// validatePOCanDelivery returns the reasons a PO cannot take a delivery.
func (s *Service) validatePOCanDelivery(ctx context.Context, q database.Querier, poID string) ([]string, error) {
	po, err := s.rows.One(ctx, q, `SELECT id, nomor_po, status, supplier_id, is_active FROM purchase_orders WHERE id = $1::text::uuid`, poID)
	if err != nil {
		if isPgError(err) {
			return []string{"Database error: " + pgMessage(err)}, nil
		}
		return nil, err
	}
	if po == nil {
		return []string{"Database error: No rows found"}, nil
	}
	var errs []string
	if !po.Bool("is_active") {
		errs = append(errs, "Purchase order is no longer active")
	}
	if !domain.IsPoStatusEligibleForDelivery(po.Str("status")) {
		errs = append(errs, `Purchase order status is "`+jsString(po.Get("status"))+`". It must be approved, sent, or partially received before creating a delivery.`)
	}
	rows, err := s.rows.Query(ctx, q, `SELECT id, status FROM deliveries WHERE purchase_order_id = $1 AND is_active = true AND status <> 'cancelled'`, po.Str("id"))
	if err != nil {
		return append(errs, "Database error: "+pgMessage(err)), nil
	}
	for _, d := range rows {
		if domain.IsOpenDeliveryStatus(d.Str("status")) {
			errs = append(errs, "This purchase order already has an open delivery in progress.")
			break
		}
	}
	return errs, nil
}

/* ── Update and delete ───────────────────────────────────────────────── */
