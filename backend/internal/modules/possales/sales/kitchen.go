package sales

import (
	"context"
	"encoding/json"

	"nuhabit/backend/internal/modules/possales/domain"
	"nuhabit/backend/internal/modules/possales/internal/jsrow"
	"nuhabit/backend/internal/modules/possales/kitchen"
	kdomain "nuhabit/backend/internal/modules/possales/kitchen/domain"
	"nuhabit/backend/internal/platform/database"
)

func optStr(r *jsrow.Row, key string) *string {
	if !r.Has(key) {
		return nil
	}
	return r.StrPtr(key)
}

func rawField(r *jsrow.Row, key string) json.RawMessage {
	switch v := r.Get(key).(type) {
	case json.RawMessage:
		return v
	case nil:
		return nil
	default:
		b, _ := jsrow.Marshal(v)
		return b
	}
}

// printItem maps an order item row (as read or as about to be inserted) to
// a KitchenPrintItem.
func printItem(r *jsrow.Row) kdomain.PrintItem {
	return kdomain.PrintItem{
		ID:           optStr(r, "id"),
		ProductID:    r.StrPtr("product_id"),
		ProductName:  r.StrPtr("product_name"),
		ProductSKU:   r.StrPtr("product_sku"),
		Variants:     rawField(r, "variants"),
		Modifiers:    rawField(r, "modifiers"),
		Quantity:     domain.Or(jsrow.ToNumber(r.Get("quantity")), 1),
		UnitPrice:    jsrow.ToNumber(r.Get("unit_price")),
		TotalAmount:  jsrow.ToNumber(r.Get("total_amount")),
		Station:      r.Str("station"),
		KitchenNotes: r.Str("kitchen_notes"),
	}
}

// printOrder maps an order row to the print job header.
func (h *Handler) printOrder(o *jsrow.Row, queueNumber string) kdomain.PrintOrder {
	return kdomain.PrintOrder{
		ID:          o.Str("id"),
		OrderNumber: o.Str("order_number"),
		QueueNumber: queueNumber,
		OrderType:   o.Str("order_type"),
		TableID:     o.StrPtr("table_id"),
		RequestedAt: h.clock(),
	}
}

// insertPrintJobs inserts kitchen tickets; like the TS, a failure only warns
// (the sale does not fail because a ticket could not be queued).
func (h *Handler) insertPrintJobs(ctx context.Context, q database.Querier, order kdomain.PrintOrder, items []*jsrow.Row) {
	pi := make([]kdomain.PrintItem, len(items))
	for i, it := range items {
		pi[i] = printItem(it)
	}
	jobs := kdomain.BuildKitchenPrintJobs(order, pi)
	if len(jobs) == 0 {
		return
	}
	var err error
	if b, ok := q.(database.TxBeginner); ok {
		err = savepointExec(ctx, b, func(q database.Querier) error { return kitchen.InsertPrintJobs(ctx, q, jobs) })
	} else {
		err = kitchen.InsertPrintJobs(ctx, q, jobs)
	}
	if err != nil && !database.IsUndefinedTable(err) {
		h.log.Warn("print jobs warning", "order_id", order.ID, "error", err)
	}
}

func kdomainNormalize(station, name, notes string) string {
	return kdomain.NormalizeStation(station, name, notes)
}
