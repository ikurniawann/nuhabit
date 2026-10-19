package procurement

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5"

	contracts "nuhabit/backend/internal/contracts/procurement"
	"nuhabit/backend/internal/modules/procurement/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/outbox"
)

// QcItem is one QC inspection line (QcInspectionItemInput).
type QcItem struct {
	GrnItemID                              string
	RawMaterialID, ProductID               *string
	QtyInspected, QtyAccepted, QtyRejected float64
	Catatan                                *string
}

// QcInput is SubmitGrnQcInput.
type QcInput struct {
	GrnID             string
	Status            string
	ParameterInspeksi json.RawMessage
	HasilInspeksi     json.RawMessage
	Catatan           *string
	Rekomendasi       *string
	Items             []QcItem
	UserID            string
}

// QcResult is what submitGrnQcInspection returns.
type QcResult struct {
	InspectionID               string
	GrnStatus                  string
	TotalAccepted, TotalReject float64
}

// SubmitQc is submitGrnQcInspection on its own transaction.
func (s *Service) SubmitQc(ctx context.Context, in QcInput) (*QcResult, error) {
	var out *QcResult
	err := database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		var err error
		out, err = s.submitQc(ctx, tx, in)
		return err
	})
	return out, err
}

type qcGrnItem struct {
	ID, RawMaterialID, ProductID, SatuanID, WarehouseID, PosSkuID string
	QtyDiterima, QtyQcPosted, Harga                               float64
	BatchNumber, ExpiryDate                                       *string
}

func (s *Service) submitQc(ctx context.Context, tx pgx.Tx, in QcInput) (*QcResult, error) {
	grn, err := s.rows.One(ctx, tx, `SELECT id, nomor_grn, status, purchase_order_id, delivery_id FROM grn WHERE id = $1::text::uuid AND is_active = true`, in.GrnID)
	if err != nil || grn == nil {
		return nil, badRequest("GRN not found")
	}
	if grn.Str("status") != domain.GrnPending {
		return nil, badRequest("GRN is not awaiting quality control")
	}
	var existingQcID *string
	var posted bool
	if err := tx.QueryRow(ctx, `SELECT id::text, inventory_posted FROM grn_qc_inspections WHERE grn_id = $1 LIMIT 1`, grn.Str("id")).Scan(&existingQcID, &posted); err != nil && !database.IsNoRows(err) {
		return nil, err
	}
	if posted {
		return nil, badRequest("Quality control has already been completed for this goods receipt")
	}
	rows, err := s.rows.Query(ctx, tx, `SELECT gi.id, gi.raw_material_id, gi.product_id, gi.qty_diterima::float8 AS qty_diterima, gi.satuan_id,
		gi.warehouse_id, gi.qty_qc_posted::float8 AS qty_qc_posted, gi.pos_sku_id, gi.batch_number, gi.expiry_date::text AS expiry_date,
		poi.harga_satuan::float8 AS harga
		FROM grn_items gi LEFT JOIN purchase_order_items poi ON poi.id = gi.purchase_order_item_id
		WHERE gi.grn_id = $1 AND gi.is_active = true`, grn.Str("id"))
	if err != nil {
		return nil, err
	}
	byID := map[string]qcGrnItem{}
	for _, r := range rows {
		byID[r.Str("id")] = qcGrnItem{
			ID: r.Str("id"), RawMaterialID: r.Str("raw_material_id"), ProductID: r.Str("product_id"), SatuanID: r.Str("satuan_id"),
			WarehouseID: r.Str("warehouse_id"), PosSkuID: r.Str("pos_sku_id"), QtyDiterima: r.Num("qty_diterima"),
			QtyQcPosted: r.Num("qty_qc_posted"), Harga: r.Num("harga"), BatchNumber: r.StrPtr("batch_number"), ExpiryDate: r.StrPtr("expiry_date"),
		}
	}
	itemRef := func(item QcItem) (rm, product string) {
		g := byID[item.GrnItemID]
		rm, product = deref(item.RawMaterialID), deref(item.ProductID)
		if item.RawMaterialID == nil {
			rm = g.RawMaterialID
		}
		if item.ProductID == nil {
			product = g.ProductID
		}
		return
	}
	var productIDs []string
	for _, item := range in.Items {
		if _, product := itemRef(item); product != "" {
			productIDs = append(productIDs, product)
		}
	}
	variants, err := s.variantProducts(ctx, tx, uniqueStrings(productIDs))
	if err != nil {
		return nil, err
	}
	accepted := make([]float64, len(in.Items))
	rejected := make([]float64, len(in.Items))
	for i, item := range in.Items {
		g, ok := byID[item.GrnItemID]
		if !ok {
			return nil, badRequest("GRN item " + item.GrnItemID + " not found")
		}
		rm, product := itemRef(item)
		if rm == "" && product == "" {
			return nil, badRequest("GRN item " + item.GrnItemID + " has no raw material or product")
		}
		switch {
		case item.QtyInspected <= 0:
			return nil, badRequest("Inspected quantity must be greater than zero")
		case abs(item.QtyAccepted+item.QtyRejected-item.QtyInspected) > 0.0001:
			return nil, badRequest("Accepted and rejected quantities must equal inspected quantity")
		case item.QtyInspected > g.QtyDiterima+0.0001:
			return nil, badRequest("Inspected quantity cannot exceed received good quantity")
		case item.QtyAccepted > g.QtyDiterima+0.0001:
			return nil, badRequest("Accepted quantity cannot exceed received good quantity")
		case product != "" && variants[product] && g.PosSkuID == "":
			return nil, badRequest("GRN produk ber-varian wajib menyebut SKU (pos_sku_id)")
		}
		accepted[i], rejected[i] = item.QtyAccepted, item.QtyRejected
	}
	status := in.Status
	if status == "" {
		status = domain.QcOverallStatus(accepted, rejected)
	}
	var totalAccepted, totalRejected float64
	for i := range accepted {
		totalAccepted += accepted[i]
		totalRejected += rejected[i]
	}
	if existingQcID != nil {
		if _, err := tx.Exec(ctx, `DELETE FROM grn_qc_inspection_items WHERE qc_inspection_id = $1`, *existingQcID); err != nil {
			return nil, err
		}
		if _, err := tx.Exec(ctx, `DELETE FROM grn_qc_inspections WHERE id = $1`, *existingQcID); err != nil {
			return nil, err
		}
	}
	var inspectionID string
	if err := tx.QueryRow(ctx, `INSERT INTO grn_qc_inspections
		(grn_id, status, parameter_inspeksi, hasil_inspeksi, catatan, rekomendasi, inspector_id, inspected_at, inventory_posted, created_by, updated_by)
		VALUES ($1, $2, $3::jsonb, $4::jsonb, $5, $6, $7, $8, false, $7, $7) RETURNING id::text`,
		grn.Str("id"), status, jsonOrNil(in.ParameterInspeksi), jsonOrNil(in.HasilInspeksi), nonEmpty(in.Catatan), nonEmpty(in.Rekomendasi),
		in.UserID, s.now()).Scan(&inspectionID); err != nil {
		return nil, plainError(err)
	}
	for _, item := range in.Items {
		rm, product := itemRef(item)
		if _, err := tx.Exec(ctx, `INSERT INTO grn_qc_inspection_items
			(qc_inspection_id, grn_item_id, raw_material_id, product_id, qty_inspected, qty_accepted, qty_rejected, item_status, catatan)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
			inspectionID, item.GrnItemID, nilIfEmpty(rm), nilIfEmpty(product), item.QtyInspected, item.QtyAccepted, item.QtyRejected,
			domain.QcItemStatus(item.QtyAccepted, item.QtyRejected), nonEmpty(item.Catatan)); err != nil {
			return nil, plainError(err)
		}
	}

	var materialIDs []string
	for _, item := range in.Items {
		if rm, _ := itemRef(item); rm != "" {
			materialIDs = append(materialIDs, rm)
		}
	}
	units, err := s.ports.Catalog.MaterialUnits(ctx, tx, uniqueStrings(materialIDs))
	if err != nil {
		units = map[string]MaterialUnits{}
	}
	stock := contracts.GrnStockReceived{GrnID: grn.Str("id"), GrnNumber: grn.Str("nomor_grn"), UserID: in.UserID}
	for _, item := range in.Items {
		g := byID[item.GrnItemID]
		toPost := max(0, item.QtyAccepted-g.QtyQcPosted)
		rm, product := itemRef(item)
		if _, err := tx.Exec(ctx, `UPDATE grn_items SET qc_status = $2, qty_qc_posted = $3, updated_at = $4 WHERE id = $1`,
			item.GrnItemID, domain.QcItemStatus(item.QtyAccepted, item.QtyRejected), item.QtyAccepted, s.now()); err != nil {
			return nil, err
		}
		if toPost <= 0 {
			continue
		}
		switch {
		case rm != "":
			factor := 1.0
			if m, ok := units[rm]; ok {
				factor = domain.PackFactor(&m.Units, m.Packs, g.SatuanID)
			}
			stock.Lines = append(stock.Lines, contracts.GrnStockLine{
				RawMaterialID: &rm, Qty: domain.PackToBase(toPost, factor), UnitCost: domain.PackPriceToBase(g.Harga, factor),
				WarehouseID: nilIfEmpty(g.WarehouseID), BatchNumber: g.BatchNumber, ExpiryDate: g.ExpiryDate,
			})
		case product != "" && g.PosSkuID != "":
			n, err := s.ports.Merchandise.ReceiveSkuStock(ctx, tx, g.PosSkuID, toPost)
			if err != nil {
				return nil, plainError(err)
			}
			if n == 0 {
				return nil, badRequest("SKU " + g.PosSkuID + " tidak aktif atau tidak ditemukan — stok tidak dapat diposting")
			}
		case product != "":
			s.nonFatal(ctx, tx, "[GRN QC] Merch stock posting error", func(sp pgx.Tx) error {
				n, err := s.ports.Merchandise.ReceiveProductStock(ctx, sp, product, toPost)
				if err == nil && n == 0 {
					s.log.WarnContext(ctx, "[GRN QC] No linked POS merchandise product — stock not posted", "product_id", product)
				}
				return err
			})
		}
	}
	if len(stock.Lines) > 0 {
		if err := outbox.Publish(ctx, tx, contracts.TopicGrnStockReceived, grn.Str("id"), stock); err != nil {
			return nil, err
		}
	}

	// Mark the inspection posted first so the PO quantities below count
	// this QC's accepted quantity.
	if _, err := tx.Exec(ctx, `UPDATE grn_qc_inspections SET inventory_posted = true, updated_by = $2, updated_at = $3 WHERE id = $1`, inspectionID, in.UserID, s.now()); err != nil {
		return nil, err
	}
	grnStatus := domain.GrnRejected
	poID := grn.Str("purchase_order_id")
	if totalAccepted > 0 {
		if err := s.recalculatePoReceivedQty(ctx, tx, poID); err != nil {
			return nil, err
		}
		ordered, received, lines, err := poQtyTotals(ctx, tx, poID)
		if err != nil {
			return nil, err
		}
		grnStatus = domain.GrnStatusAfterQc(totalAccepted, ordered, received, lines > 0)
	}
	if _, err := tx.Exec(ctx, `UPDATE grn SET status = $2, updated_by = $3, updated_at = $4 WHERE id = $1`, grn.Str("id"), grnStatus, in.UserID, s.now()); err != nil {
		return nil, err
	}
	if d := grn.Str("delivery_id"); d != "" {
		if err := s.updateDeliveryStatusAfterGrn(ctx, tx, d, grnStatus); err != nil {
			return nil, err
		}
	}
	if poID != "" {
		if err := s.updatePOStatusAfterGrn(ctx, tx, poID); err != nil {
			return nil, err
		}
	}
	s.nonFatal(ctx, tx, "[GRN QC] Vendor credit sync error", func(sp pgx.Tx) error {
		return s.syncRejectCredits(ctx, sp, grn.Str("id"), "qc_reject", in.UserID)
	})
	if err := publishGrnPosted(ctx, tx, grn.Str("id"), in.UserID); err != nil {
		return nil, err
	}
	return &QcResult{InspectionID: inspectionID, GrnStatus: grnStatus, TotalAccepted: totalAccepted, TotalReject: totalRejected}, nil
}

// variantProducts is resolveVariantProductIds: products with an active SKU.
func (s *Service) variantProducts(ctx context.Context, q database.Querier, productIDs []string) (map[string]bool, error) {
	out := map[string]bool{}
	if len(productIDs) == 0 {
		return out, nil
	}
	skus, err := s.ports.Catalog.MerchandiseSkus(ctx, q, productIDs)
	if err != nil {
		return nil, err
	}
	for _, sku := range skus {
		if sku.Bool("is_active") {
			out[sku.Str("source_product_id")] = true
		}
	}
	return out, nil
}
