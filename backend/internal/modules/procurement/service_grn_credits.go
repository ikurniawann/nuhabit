package procurement

import (
	"context"

	"nuhabit/backend/internal/modules/procurement/domain"
	"nuhabit/backend/internal/platform/database"
)

type creditLine struct {
	GrnItemID, RawMaterialID string
	Qty, UnitPrice           float64
	Notes                    *string
}

// syncRejectCredits is syncReceiveRejectCredits / syncQcRejectCredits:
// keep one editable credit per GRN and source in step with the rejects.
func (s *Service) syncRejectCredits(ctx context.Context, q database.Querier, grnID, sourceType string, userID string) error {
	grn, err := s.rows.One(ctx, q, `SELECT id, supplier_id, purchase_order_id FROM grn WHERE id = $1 AND is_active = true`, grnID)
	if err != nil || grn == nil {
		return err
	}
	var lines []creditLine
	if sourceType == "receive_reject" {
		rows, err := s.rows.Query(ctx, q, `SELECT gi.id, gi.raw_material_id, gi.qty_ditolak::float8 AS qty, gi.catatan,
			COALESCE(poi.harga_satuan, 0)::float8 AS price
			FROM grn_items gi LEFT JOIN purchase_order_items poi ON poi.id = gi.purchase_order_item_id
			WHERE gi.grn_id = $1 AND gi.is_active = true AND gi.raw_material_id IS NOT NULL`, grnID)
		if err != nil {
			return err
		}
		for _, r := range rows {
			lines = append(lines, creditLine{GrnItemID: r.Str("id"), RawMaterialID: r.Str("raw_material_id"), Qty: r.Num("qty"), UnitPrice: r.Num("price"), Notes: r.StrPtr("catatan")})
		}
	} else {
		var qcID string
		var posted bool
		err := q.QueryRow(ctx, `SELECT id::text, inventory_posted FROM grn_qc_inspections WHERE grn_id = $1 LIMIT 1`, grnID).Scan(&qcID, &posted)
		if err != nil && !database.IsNoRows(err) {
			return err
		}
		if !posted {
			return s.cancelEditableCredit(ctx, q, grnID, sourceType)
		}
		rows, err := s.rows.Query(ctx, q, `SELECT qi.grn_item_id, qi.raw_material_id, qi.qty_rejected::float8 AS qty, qi.catatan,
			COALESCE(poi.harga_satuan, 0)::float8 AS price
			FROM grn_qc_inspection_items qi
			LEFT JOIN grn_items gi ON gi.id = qi.grn_item_id
			LEFT JOIN purchase_order_items poi ON poi.id = gi.purchase_order_item_id
			WHERE qi.qc_inspection_id = $1 AND qi.raw_material_id IS NOT NULL`, qcID)
		if err != nil {
			return err
		}
		for _, r := range rows {
			lines = append(lines, creditLine{GrnItemID: r.Str("grn_item_id"), RawMaterialID: r.Str("raw_material_id"), Qty: r.Num("qty"), UnitPrice: r.Num("price"), Notes: r.StrPtr("catatan")})
		}
	}
	var active []creditLine
	total := 0.0
	for _, l := range lines {
		if l.Qty > 0.0001 {
			active = append(active, l)
			total += domain.RoundMoney(l.Qty * l.UnitPrice)
		}
	}
	if len(active) == 0 {
		return s.cancelEditableCredit(ctx, q, grnID, sourceType)
	}
	total = domain.RoundMoney(total)
	reason := "Auto-generated from goods receipt reject quantities"
	if sourceType == "qc_reject" {
		reason = "Auto-generated from QC reject quantities"
	}
	creditID, err := s.editableCredit(ctx, q, grnID, sourceType)
	if err != nil {
		return err
	}
	if creditID == "" {
		var creator *string
		if userID != "" {
			creator = &userID
		}
		if err := q.QueryRow(ctx, `INSERT INTO vendor_credits
			(grn_id, purchase_order_id, supplier_id, source_type, status, total_amount, reason_notes, notes, created_by, updated_at)
			VALUES ($1, $2, $3, $4, 'draft', $5, $6, NULL, $7, $8) RETURNING id::text`,
			grnID, grn.StrPtr("purchase_order_id"), grn.StrPtr("supplier_id"), sourceType, total, reason, creator, s.now()).Scan(&creditID); err != nil {
			return err
		}
	} else {
		if _, err := q.Exec(ctx, `UPDATE vendor_credits SET total_amount = $2, reason_notes = $3, updated_at = $4 WHERE id = $1`,
			creditID, total, reason, s.now()); err != nil {
			return err
		}
		if _, err := q.Exec(ctx, `DELETE FROM vendor_credit_items WHERE vendor_credit_id = $1`, creditID); err != nil {
			return err
		}
	}
	for _, l := range active {
		if _, err := q.Exec(ctx, `INSERT INTO vendor_credit_items (vendor_credit_id, grn_item_id, raw_material_id, qty, unit_price, line_amount, notes)
			VALUES ($1, $2, $3, $4, $5, $6, $7)`, creditID, l.GrnItemID, l.RawMaterialID, l.Qty, l.UnitPrice, domain.RoundMoney(l.Qty*l.UnitPrice), l.Notes); err != nil {
			return err
		}
	}
	return nil
}

// editableCredit is findEditableCredit: the newest draft/pending credit.
func (s *Service) editableCredit(ctx context.Context, q database.Querier, grnID, sourceType string) (string, error) {
	var id string
	err := q.QueryRow(ctx, `SELECT id::text FROM vendor_credits WHERE grn_id = $1 AND source_type = $2
		AND status IN ('draft', 'pending_approval') ORDER BY created_at DESC LIMIT 1`, grnID, sourceType).Scan(&id)
	if database.IsNoRows(err) {
		return "", nil
	}
	return id, err
}

func (s *Service) cancelEditableCredit(ctx context.Context, q database.Querier, grnID, sourceType string) error {
	id, err := s.editableCredit(ctx, q, grnID, sourceType)
	if err != nil || id == "" {
		return err
	}
	if _, err := q.Exec(ctx, `DELETE FROM vendor_credit_items WHERE vendor_credit_id = $1`, id); err != nil {
		return err
	}
	_, err = q.Exec(ctx, `UPDATE vendor_credits SET status = 'cancelled', total_amount = 0, updated_at = $2 WHERE id = $1`, id, s.now())
	return err
}

/* ── QC ──────────────────────────────────────────────────────────────── */
