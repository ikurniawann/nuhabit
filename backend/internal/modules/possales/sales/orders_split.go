package sales

import (
	"context"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/possales/domain"
	"nuhabit/backend/internal/modules/possales/internal/jsrow"
	"nuhabit/backend/internal/modules/possales/internal/kit"
	"nuhabit/backend/internal/platform/database"
)

// createSplitOrder is orders/split-order.ts: the legacy DB function
// pos_create_split_order_transaction, then the columns it does not set.
//
// Parity note: that function inserts columns pos_order_items does not have
// (variant_info, modifier_info, notes), so it fails on every database built
// from the current migrations, in TS and here alike (500 with the database
// message). The TS also sends p_items/p_splits as Postgres array literals;
// here they are JSON, as the jsonb parameters expect.
func (h *Handler) createSplitOrder(ctx context.Context, oc orderCtx, splits []any) (*response, error) {
	req := oc.req
	if len(oc.giftNominals) > 0 {
		return nil, fail(400, "Gift card belum didukung untuk split bill")
	}
	if domain.Trim(req.Str("promo_code")) != "" {
		return nil, fail(400, "Kode promo belum didukung untuk split bill")
	}
	if h.p.Merchandise.HasTracked(ctx, h.db, productIDs(req.Items, true)) {
		return nil, fail(400, "Merchandise belum didukung untuk split bill")
	}
	var res *response
	err := database.WithTx(ctx, h.db, func(tx pgx.Tx) error {
		var err error
		res, err = h.placeSplitOrder(ctx, tx, oc, splits)
		return err
	})
	return res, err
}

func (h *Handler) placeSplitOrder(ctx context.Context, tx pgx.Tx, oc orderCtx, splits []any) (*response, error) {
	req := oc.req
	items, _ := jsrow.Marshal(req.Get("items"))
	splitJSON, _ := jsrow.Marshal(splits)
	tax := 0.0
	if domain.Truthy(req.Get("include_tax")) {
		tax = req.NumOr0("tax_amount")
	}
	var raw []byte
	err := savepointQuery(ctx, tx, func(q database.Querier) error {
		return q.QueryRow(ctx, `SELECT * FROM "pos_create_split_order_transaction"(
			"p_order_type" := $1, "p_customer_id" := $2, "p_cashier_id" := $3, "p_server_id" := $4, "p_table_id" := $5,
			"p_subtotal" := $6, "p_discount_amount" := $7, "p_discount_reason" := $8, "p_tax_amount" := $9,
			"p_service_charge_amount" := $10, "p_total_amount" := $11, "p_notes" := $12, "p_special_requests" := $13,
			"p_items" := $14::jsonb, "p_splits" := $15::jsonb, "p_branch_id" := $16)`,
			jsonScalar(req.Get("order_type")), truthyScalar(req.Get("customer_id")), oc.cashierID, truthyScalar(req.Get("server_id")),
			truthyScalar(req.Get("table_id")), req.NumOr0("subtotal"), req.NumOr0("discount_amount"), truthyScalar(req.Get("discount_reason")),
			tax, req.NumOr0("service_charge_amount"), req.NumOr0("total_amount"), truthyScalar(req.Get("notes")),
			truthyScalar(req.Get("special_requests")), string(items), string(splitJSON), truthyScalar(req.Get("branch_id"))).Scan(&raw)
	})
	if err != nil {
		h.log.Error("RPC split error", "error", err)
		return nil, fail(500, kit.ErrorMessage(err))
	}
	result, _ := jsrow.ParseObject(jsrow.NormalizeJSON(raw))
	if result == nil || result.Get("success") != true {
		msg := "Split order creation failed"
		if result != nil && result.Str("error") != "" {
			msg = result.Str("error")
		}
		return nil, fail(400, msg)
	}
	orderID := result.Str("order_id")
	if shift := req.Str("shift_id"); shift != "" {
		bestEffort(ctx, tx, `UPDATE pos.pos_orders SET shift_id = $1 WHERE id = $2`, shift, orderID)
	}
	bestEffort(ctx, tx, `UPDATE pos.pos_orders SET guest_count = $1 WHERE id = $2`, domain.NormalizeGuestCount(req.Get("guest_count")), orderID)
	company, defBranch := h.p.Directory.Venue(ctx, tx)
	branch := firstStr(req.Str("branch_id"), defBranch)
	bestEffort(ctx, tx, `UPDATE pos.pos_orders SET company_id = $1, branch_id = $2, warehouse_id = $3, sold_from = $4 WHERE id = $5`,
		nilIfEmpty(company), nilIfEmpty(branch), oc.sellWarehouse, oc.soldFrom, orderID)
	h.ensureQueueNumber(ctx, tx, orderID, "", company, branch)
	h.backfillItemStations(ctx, tx, orderID)
	complete, err := jsrow.QueryOne(ctx, tx, `SELECT *, `+embedCustomer+`, `+embedItems+`, `+embedSplitsAll+` FROM "pos"."pos_orders" WHERE "id" = $1`, orderID)
	if err != nil {
		return nil, err
	}
	var data any = complete
	if complete == nil {
		data = rawJSON(jsrow.NormalizeJSON(raw))
	}
	return &response{status: 201, body: jsrow.Object("success", true, "data", data)}, nil
}

// ensureQueueNumber is ensureQueueNumber: keep a set queue number, else
// allocate one and store it ("" when allocation failed).
func (h *Handler) ensureQueueNumber(ctx context.Context, q database.Querier, orderID, existing, company, branch string) string {
	if !domain.ShouldAllocateQueueNumber(existing) {
		return domain.Trim(existing)
	}
	queue := h.allocateQueueNumber(ctx, q, company, branch)
	if queue == "" {
		return ""
	}
	if err := savepointQuery(ctx, q, func(q database.Querier) error {
		_, err := q.Exec(ctx, `UPDATE pos.pos_orders SET queue_number = $1 WHERE id = $2`, queue, orderID)
		return err
	}); err != nil {
		h.log.Error("[pos] ensureQueueNumber update", "error", err)
		return ""
	}
	return queue
}

// backfillItemStations is backfillMissingItemStations.
func (h *Handler) backfillItemStations(ctx context.Context, q database.Querier, orderID string) {
	items, err := jsrow.Query(ctx, q, `SELECT id, product_id, product_name, kitchen_notes, station, kitchen_status FROM pos.pos_order_items WHERE order_id = $1`, orderID)
	if err != nil || len(items) == 0 {
		return
	}
	var missing []*jsrow.Row
	var pids []string
	for _, it := range items {
		if domain.Trim(it.Str("station")) == "" {
			missing = append(missing, it)
			if pid := it.Str("product_id"); pid != "" {
				pids = append(pids, pid)
			}
		}
	}
	if len(missing) == 0 {
		return
	}
	stations := map[string]string{}
	if len(pids) > 0 {
		rows, _ := jsrow.Query(ctx, q, `SELECT id, station FROM pos.pos_products WHERE id = ANY($1::uuid[])`, pids)
		for _, r := range rows {
			stations[r.Str("id")] = r.Str("station")
		}
	}
	for _, it := range missing {
		station := kdomainNormalize(stations[it.Str("product_id")], it.Str("product_name"), it.Str("kitchen_notes"))
		status := it.Str("kitchen_status")
		if status == "" {
			status = "pending"
		}
		bestEffort(ctx, q, `UPDATE pos.pos_order_items SET station = $1, kitchen_status = $2 WHERE id = $3`, station, status, it.Str("id"))
	}
}
