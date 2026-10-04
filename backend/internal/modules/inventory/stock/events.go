package stock

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	contracts "nuhabit/backend/internal/contracts/inventory"
	"nuhabit/backend/internal/contracts/procurement"
	"nuhabit/backend/internal/modules/inventory/ledger"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/outbox"
)

// Subscribe registers the stock effects other contexts publish. Each
// handler leaves stock as the TS inline call did.
func Subscribe(bus *outbox.Bus, now func() time.Time) {
	bus.Subscribe(procurement.TopicPurchaseOrderOnOrderChanged, "inventory.on-order-from-po",
		func(ctx context.Context, tx pgx.Tx, e outbox.Event) error {
			var p procurement.PurchaseOrderOnOrderChanged
			if err := e.Decode(&p); err != nil {
				return err
			}
			return ApplyOnOrder(ctx, tx, p, now())
		})
	bus.Subscribe(procurement.TopicGrnStockReceived, "inventory.stock-from-grn",
		func(ctx context.Context, tx pgx.Tx, e outbox.Event) error {
			var p procurement.GrnStockReceived
			if err := e.Decode(&p); err != nil {
				return err
			}
			return ApplyGrnStock(ctx, tx, p, now())
		})
}

// ApplyOnOrder is adjustOnOrderForOpenQty's inventory half: each open line
// moves qty_on_order by direction × open qty in base units.
func ApplyOnOrder(ctx context.Context, q database.Querier, p procurement.PurchaseOrderOnOrderChanged, now time.Time) error {
	ids := make([]string, len(p.Lines))
	for i, l := range p.Lines {
		ids[i] = l.RawMaterialID
	}
	resolve, err := ledger.NewBaseUnitResolver(ctx, q, ids)
	if err != nil {
		return err
	}
	for _, l := range p.Lines {
		if l.RawMaterialID == "" || l.OpenQty <= 0 {
			continue
		}
		delta := float64(p.Direction) * l.OpenQty * resolve(l.RawMaterialID, l.SatuanID)
		if err := ledger.AdjustOnOrder(ctx, q, l.RawMaterialID, delta, nil, now); err != nil {
			return err
		}
	}
	return nil
}

// ApplyGrnStock posts a goods receipt: raw material lines (already in base
// units) through addInventoryFromGrn, stockable supply item lines through
// addSupplyStockFromGrn.
func ApplyGrnStock(ctx context.Context, q database.Querier, p procurement.GrnStockReceived, now time.Time) error {
	stockable, err := stockableSupplies(ctx, q, p.Lines)
	if err != nil {
		return err
	}
	var userID *string
	if p.UserID != "" {
		userID = &p.UserID
	}
	for _, l := range p.Lines {
		switch {
		case l.RawMaterialID != nil && *l.RawMaterialID != "":
			err = ledger.AddFromGrn(ctx, q, ledger.GrnReceipt{
				RawMaterialID: *l.RawMaterialID, Qty: l.Qty, UnitCost: l.UnitCost, GrnID: p.GrnID, GrnNumber: p.GrnNumber,
				UserID: p.UserID, WarehouseID: l.WarehouseID, BatchNumber: l.BatchNumber, ExpiryDate: l.ExpiryDate,
			}, now)
		case l.SupplyItemID != nil && stockable[*l.SupplyItemID]:
			err = ledger.AddSupplyFromGrn(ctx, q, ledger.SupplyTarget{
				SupplyItemID: *l.SupplyItemID, WarehouseID: l.WarehouseID, CompanyID: p.CompanyID, BranchID: p.BranchID, UserID: userID,
			}, l.Qty, l.UnitCost, p.GrnID, p.GrnNumber, now)
		}
		if err != nil {
			return err
		}
	}
	return nil
}

// stockableSupplies is the stockable filter of createGrn's supply posting.
func stockableSupplies(ctx context.Context, q database.Querier, lines []procurement.GrnStockLine) (map[string]bool, error) {
	var ids []string
	for _, l := range lines {
		if l.SupplyItemID != nil && *l.SupplyItemID != "" && l.Qty > 0 {
			ids = append(ids, *l.SupplyItemID)
		}
	}
	out := map[string]bool{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := q.Query(ctx, `SELECT id::text FROM supply_items WHERE id = ANY($1::uuid[]) AND stockable = true`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out[id] = true
	}
	return out, rows.Err()
}

// OutboxJournals posts inventory journals through the accounting context's
// outbox subscribers (contracts/inventory). It returns no note: the journal
// is posted after the response, so accounting_note is null and the message
// carries no "(jurnal …)" suffix. Wire a synchronous adapter over the
// accounting service to restore the note (ERP brief rule 2).
type OutboxJournals struct{}

var _ Journals = OutboxJournals{}

// PostStockOpname publishes inventory.stock_opname.completed.
func (OutboxJournals) PostStockOpname(ctx context.Context, q database.Querier, in OpnameJournal) (*string, error) {
	return nil, outbox.Publish(ctx, q, contracts.TopicStockOpnameCompleted, in.OpnameID, contracts.StockOpnameCompleted{
		OpnameID: in.OpnameID, OpnameNumber: in.OpnameNumber, OpnameDate: in.OpnameDate, CompanyID: in.CompanyID,
		UserID: in.UserID, Lines: in.Lines,
	})
}

// PostStockAdjustment publishes inventory.stock.adjusted.
func (OutboxJournals) PostStockAdjustment(ctx context.Context, q database.Querier, in AdjustmentJournal) (*string, error) {
	return nil, outbox.Publish(ctx, q, contracts.TopicStockAdjusted, in.DocumentID, contracts.StockAdjusted{
		DocumentID: in.DocumentID, CompanyID: in.CompanyID, UserID: in.UserID, EntryDate: in.EntryDate,
		RawMaterialID: in.RawMaterialID, QtyDiff: in.QtyDiff, UnitCost: in.UnitCost, Notes: in.Notes,
	})
}

// PostStockTransfer publishes inventory.stock.transferred.
func (OutboxJournals) PostStockTransfer(ctx context.Context, q database.Querier, in TransferJournal) (*string, error) {
	return nil, outbox.Publish(ctx, q, contracts.TopicStockTransferred, in.TransferID, contracts.StockTransferred{
		TransferID: in.TransferID, TransferNumber: in.TransferNumber, CompanyID: in.CompanyID, UserID: in.UserID,
		EntryDate: in.EntryDate, RawMaterialID: in.RawMaterialID, Qty: in.Qty, UnitCost: in.UnitCost,
		SourceWarehouseName: in.SourceWarehouseName, DestWarehouseName: in.DestWarehouseName,
	})
}
