package procurement

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/jackc/pgx/v5"

	contracts "nuhabit/backend/internal/contracts/procurement"
	"nuhabit/backend/internal/modules/procurement/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/outbox"
)

// recalculatePoReceivedQty rebuilds each active PO line's qty_received from
// the active GRN lines (QC-posted, door quantity, or 0 while pending).
func (s *Service) recalculatePoReceivedQty(ctx context.Context, q database.Querier, poID string) error {
	rows, err := s.rows.Query(ctx, q, `SELECT poi.id AS po_item_id,
		  COALESCE((SELECT json_agg(json_build_object('qty_diterima', gi.qty_diterima, 'qty_qc_posted', gi.qty_qc_posted,
		    'status', g.status, 'posted', EXISTS (SELECT 1 FROM grn_qc_inspections qc WHERE qc.grn_id = g.id AND qc.inventory_posted)))
		   FROM grn_items gi JOIN grn g ON g.id = gi.grn_id
		   WHERE gi.purchase_order_item_id = poi.id AND gi.is_active = true AND g.is_active = true AND g.purchase_order_id = $1), '[]'::json) AS lines
		FROM purchase_order_items poi WHERE poi.purchase_order_id = $1 AND poi.is_active = true`, poID)
	if err != nil {
		return err
	}
	for _, r := range rows {
		var lines []struct {
			QtyDiterima float64 `json:"qty_diterima"`
			QtyQcPosted float64 `json:"qty_qc_posted"`
			Status      string  `json:"status"`
			Posted      bool    `json:"posted"`
		}
		raw, _ := r.Get("lines").(json.RawMessage)
		if err := json.Unmarshal(raw, &lines); err != nil {
			return err
		}
		received := 0.0
		for _, l := range lines {
			received += domain.GrnItemReceivedQty(l.QtyDiterima, l.QtyQcPosted, l.Status, l.Posted)
		}
		if _, err := q.Exec(ctx, `UPDATE purchase_order_items SET qty_received = $2 WHERE id = $1`, r.Str("po_item_id"), received); err != nil {
			return err
		}
	}
	return nil
}

// poQtyTotals sums ordered and received over the PO's active lines.
func poQtyTotals(ctx context.Context, q database.Querier, poID string) (ordered, received float64, lines int, err error) {
	err = q.QueryRow(ctx, `SELECT COALESCE(SUM(qty_ordered), 0)::float8, COALESCE(SUM(COALESCE(qty_received, 0)), 0)::float8, count(*)::int
		FROM purchase_order_items WHERE purchase_order_id = $1 AND is_active = true`, poID).Scan(&ordered, &received, &lines)
	return
}

// updatePOStatusAfterGrn recalculates received quantities and moves the PO
// to sent / partially_received / received (closed and cancelled stay).
func (s *Service) updatePOStatusAfterGrn(ctx context.Context, q database.Querier, poID string) error {
	if err := s.recalculatePoReceivedQty(ctx, q, poID); err != nil {
		return err
	}
	var status *string
	if err := q.QueryRow(ctx, `SELECT status FROM purchase_orders WHERE id = $1`, poID).Scan(&status); err != nil && !database.IsNoRows(err) {
		return err
	}
	if current := strings.ToLower(deref(status)); current == domain.PoClosed || current == domain.PoCancelled {
		return nil
	}
	ordered, received, lines, err := poQtyTotals(ctx, q, poID)
	if err != nil || lines == 0 {
		return err
	}
	_, err = q.Exec(ctx, `UPDATE purchase_orders SET status = $2, updated_at = $3 WHERE id = $1`,
		poID, domain.PoStatusFromReceipts(ordered, received), s.now())
	return err
}

// updateDeliveryStatusAfterGrn closes the delivery once its GRN is final.
func (s *Service) updateDeliveryStatusAfterGrn(ctx context.Context, q database.Querier, deliveryID, grnStatus string) error {
	status := domain.DeliveryStatusAfterGrn(grnStatus)
	if status == "" {
		return nil
	}
	_, err := q.Exec(ctx, `UPDATE deliveries SET status = $2, updated_at = $3 WHERE id = $1`, deliveryID, status, s.now())
	return err
}

// publishGrnPosted hands the GRN journals and AP invoice to accounting
// (postGrnAccountingJournals).
func publishGrnPosted(ctx context.Context, tx pgx.Tx, grnID, userID string) error {
	return outbox.Publish(ctx, tx, contracts.TopicGrnPosted, grnID, contracts.GrnPosted{GrnID: grnID, UserID: userID})
}

// publishSupplyStock is postSupplyStock: received stockable supply items
// go to inventory (non-stockable ones are expensed).
func (s *Service) publishSupplyStock(ctx context.Context, tx pgx.Tx, grn *Row, lines []grnLineInput, poItems []domain.PoItemForReceive, warehouseID string, companyID, branchID *string, userID string) error {
	var ids []string
	for _, l := range lines {
		if deref(l.SupplyItemID) != "" && l.QtyDiterima > 0 {
			ids = append(ids, *l.SupplyItemID)
		}
	}
	if len(ids) == 0 {
		return nil
	}
	stockable, err := s.ports.Catalog.StockableSupplies(ctx, tx, uniqueStrings(ids))
	if err != nil {
		s.log.ErrorContext(ctx, "[GRN] Supply stock posting error (non-fatal)", "error", err)
		return nil
	}
	ev := contracts.GrnStockReceived{GrnID: grn.Str("id"), GrnNumber: grn.Str("nomor_grn"), UserID: userID, CompanyID: companyID, BranchID: branchID}
	for _, l := range lines {
		supply := deref(l.SupplyItemID)
		if supply == "" || l.QtyDiterima <= 0 || !stockable[supply] {
			continue
		}
		cost := 0.0
		for _, p := range poItems {
			if (deref(l.PurchaseOrderItemID) != "" && p.ID == *l.PurchaseOrderItemID) || p.SupplyItemID == supply {
				cost = p.HargaSatuan
				break
			}
		}
		ev.Lines = append(ev.Lines, contracts.GrnStockLine{SupplyItemID: &supply, Qty: l.QtyDiterima, UnitCost: cost, WarehouseID: &warehouseID})
	}
	if len(ev.Lines) == 0 {
		return nil
	}
	return outbox.Publish(ctx, tx, contracts.TopicGrnStockReceived, grn.Str("id"), ev)
}
