package procurement

import (
	"context"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/procurement/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// UpdateGrn is updateGrn (GRN Continue).
func (s *Service) UpdateGrn(ctx context.Context, id string, in *updateGrnInput, userID string) (*Row, error) {
	var out *Row
	err := database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		current, err := s.rows.One(ctx, tx, `SELECT * FROM grn WHERE id = $1::text::uuid AND is_active = true`, id)
		if err != nil || current == nil {
			return notFound("GRN tidak ditemukan")
		}
		currentStatus := current.Str("status")
		if in.Status != nil && *in.Status != currentStatus {
			if msg := domain.GrnTransitionError(currentStatus, *in.Status); msg != "" {
				return badRequest(msg)
			}
		}
		existingRows, err := s.rows.Query(ctx, tx, `SELECT * FROM grn_items WHERE grn_id = $1 AND is_active = true`, current.Str("id"))
		if err != nil {
			existingRows = nil
		}
		existing := map[string]*Row{}
		qty := map[string]domain.ExistingGrnQty{}
		for _, r := range existingRows {
			key := domain.ReceiveLine{PurchaseOrderItemID: r.Str("purchase_order_item_id"), RawMaterialID: r.Str("raw_material_id")}.LineKey()
			existing[key] = r
			qty[key] = domain.ExistingGrnQty{QtyDiterima: r.Num("qty_diterima"), QtyDitolak: r.Num("qty_ditolak")}
		}
		receive := make([]domain.ReceiveLine, len(in.Items))
		for i, l := range in.Items {
			receive[i] = l.receive()
		}
		if len(in.Items) > 0 {
			poItems, err := s.poItemsForReceive(ctx, tx, current.Str("purchase_order_id"), true)
			if err != nil {
				return err
			}
			if err := domain.ValidateAdditionalReceive(receive, poItems, qty); err != nil {
				return receiveErr(err)
			}
			linked := false
			for _, l := range in.Items {
				linked = linked || deref(l.PurchaseOrderItemID) != ""
			}
			if !linked {
				return badRequest("Minimal 1 item harus terhubung dengan item PO")
			}
		}
		qtyChanged := false
		for _, l := range receive {
			if l.QtyDiterima-qty[l.LineKey()].QtyDiterima != 0 {
				qtyChanged = true
			}
		}
		sets := []string{"updated_by = $2", "updated_at = $3"}
		args := []any{current.Str("id"), userID, s.now()}
		add := func(col string, v any) {
			args = append(args, v)
			sets = append(sets, col+" = $"+strconv.Itoa(len(args)))
		}
		status := ""
		if in.Status != nil {
			status = *in.Status
		}
		if in.Catatan != nil {
			add("catatan", *in.Catatan)
		}
		if deref(in.TanggalPenerimaan) != "" {
			args = append(args, *in.TanggalPenerimaan)
			sets = append(sets, "tanggal_penerimaan = $"+strconv.Itoa(len(args))+"::text::date")
		}
		if len(in.Items) > 0 {
			diterima, ditolak := domain.GrnTotals(receive)
			args = append(args, diterima, ditolak)
			sets = append(sets, "total_item_diterima = $"+strconv.Itoa(len(args)-1)+"::numeric", "total_item_ditolak = $"+strconv.Itoa(len(args))+"::numeric")
			if fromLines := domain.StatusFromLines(receive); fromLines != "" {
				status = fromLines
			}
		}
		if qtyChanged && currentStatus != domain.GrnPending {
			status = domain.GrnPending
			if _, err := tx.Exec(ctx, `DELETE FROM grn_qc_inspection_items WHERE qc_inspection_id IN (SELECT id FROM grn_qc_inspections WHERE grn_id = $1)`, current.Str("id")); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `DELETE FROM grn_qc_inspections WHERE grn_id = $1`, current.Str("id")); err != nil {
				return err
			}
		}
		if status != "" {
			add("status", status)
		}
		out, err = s.rows.One(ctx, tx, `UPDATE grn SET `+strings.Join(sets, ", ")+` WHERE id = $1 RETURNING *`, args...)
		if err != nil {
			return err
		}
		if len(in.Items) > 0 {
			if _, err := tx.Exec(ctx, `UPDATE grn_items SET is_active = false WHERE grn_id = $1`, current.Str("id")); err != nil {
				return err
			}
			for _, l := range in.Items {
				prev := existing[l.receive().LineKey()]
				var warehouse, batch, expiry *string
				posted := 0.0
				if prev != nil {
					warehouse, batch, expiry = prev.StrPtr("warehouse_id"), prev.StrPtr("batch_number"), dateOnly(prev.Get("expiry_date"), s.loc)
					posted = prev.Num("qty_qc_posted")
				}
				if b := strings.TrimSpace(deref(l.BatchNumber)); b != "" {
					batch = &b
				}
				if e := nonEmpty(l.ExpiryDate); e != nil {
					expiry = e
				}
				if _, err := tx.Exec(ctx, `INSERT INTO grn_items
					(grn_id, delivery_id, purchase_order_item_id, raw_material_id, qty_diterima, qty_ditolak, kondisi, catatan,
					 warehouse_id, qc_status, qty_qc_posted, batch_number, expiry_date)
					VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', $10, $11, $12::text::date)`,
					current.Str("id"), current.StrPtr("delivery_id"), l.PurchaseOrderItemID, l.RawMaterialID, l.QtyDiterima, l.QtyDitolak,
					l.Kondisi, nonEmpty(l.Catatan), warehouse, posted, batch, expiry); err != nil {
					return err
				}
			}
		}
		if status != "" && status != domain.GrnPending && current.Str("delivery_id") != "" {
			if err := s.updateDeliveryStatusAfterGrn(ctx, tx, current.Str("delivery_id"), status); err != nil {
				return err
			}
		}
		if po := current.Str("purchase_order_id"); po != "" {
			if err := s.updatePOStatusAfterGrn(ctx, tx, po); err != nil {
				return err
			}
		}
		s.nonFatal(ctx, tx, "[PATCH GRN] Vendor credit sync error", func(sp pgx.Tx) error {
			return s.syncRejectCredits(ctx, sp, current.Str("id"), "receive_reject", userID)
		})
		return nil
	})
	return out, err
}

// dateOnly is toDateOnly for a date column read through RowReader (local
// midnight in the process time zone).
func dateOnly(v any, loc *time.Location) *string {
	t, ok := v.(httpx.JSTime)
	if !ok {
		return nil
	}
	s := time.Time(t).In(loc).Format("2006-01-02")
	return &s
}

// DeleteGrn is deleteGrn: soft delete the GRN and its lines.
func (s *Service) DeleteGrn(ctx context.Context, id, userID string) (*Row, string, error) {
	var deleted *Row
	var number string
	err := database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		grn, err := s.rows.One(ctx, tx, `SELECT * FROM grn WHERE id = $1::text::uuid AND is_active = true`, id)
		if err != nil || grn == nil {
			return notFound("GRN tidak ditemukan")
		}
		number = grn.Str("nomor_grn")
		if _, err := tx.Exec(ctx, `UPDATE grn_items SET is_active = false WHERE grn_id = $1`, grn.Str("id")); err != nil {
			return err
		}
		if deleted, err = s.rows.One(ctx, tx, `UPDATE grn SET is_active = false, updated_by = $2 WHERE id = $1 RETURNING *`, grn.Str("id"), userID); err != nil {
			return err
		}
		if po := grn.Str("purchase_order_id"); po != "" {
			return s.updatePOStatusAfterGrn(ctx, tx, po)
		}
		return nil
	})
	return deleted, number, err
}
