package sales

import (
	"context"
	"errors"
	"math"
	"net/http"
	"slices"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/contracts/possales"
	"nuhabit/backend/internal/modules/possales/domain"
	"nuhabit/backend/internal/modules/possales/internal/jsrow"
	"nuhabit/backend/internal/modules/possales/internal/kit"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/database"
)

func family(r *jsrow.Row) domain.BillFamily {
	return domain.BillFamily{CheckoutID: r.Str("checkout_id"), SoldFrom: r.Str("sold_from")}
}

func hasUnpaidSplits(ctx context.Context, q database.Querier, orderID string) (bool, error) {
	var n int
	err := q.QueryRow(ctx, `SELECT count(*)::int FROM pos.pos_order_splits WHERE order_id = $1 AND status <> 'cancelled' AND LOWER(COALESCE(status::text, '')) <> 'paid'`, orderID).Scan(&n)
	return n > 0, err
}

// logItemMove is logOrderItemMove: best-effort audit row.
func (h *Handler) logItemMove(ctx context.Context, q database.Querier, action, sourceID, sourceNumber, targetID, targetNumber string, items []map[string]any, movedBy string) {
	payload, _ := jsrow.Marshal(items)
	if err := savepointQuery(ctx, q, func(q database.Querier) error {
		_, err := q.Exec(ctx, `INSERT INTO pos.pos_order_item_move_logs
         (action, source_order_id, source_order_number, target_order_id, target_order_number, items, moved_by)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)`, action, sourceID, nilIfEmpty(sourceNumber), targetID, nilIfEmpty(targetNumber), string(payload), nilIfEmpty(movedBy))
		return err
	}); err != nil {
		h.log.Error("[pos] gagal menulis audit item-move", "action", action, "source", sourceID, "target", targetID, "error", err)
	}
}

func moveSnapshot(r *jsrow.Row, qty, total float64) map[string]any {
	return map[string]any{"id": r.Get("id"), "product_name": r.Get("product_name"), "quantity": qty, "unit_price": r.Num("unit_price"), "total_amount": total}
}

// releaseTableIfIdle publishes "available" for a table without other active orders.
func releaseTableIfIdle(ctx context.Context, tx pgx.Tx, tableID, exceptOrderID string) error {
	var other bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM pos.pos_orders WHERE table_id = $1 AND id <> $2
		AND status IN ('pending', 'confirmed', 'preparing', 'ready', 'served'))`, tableID, exceptOrderID).Scan(&other); err != nil {
		return err
	}
	if other {
		return nil
	}
	return publish(ctx, tx, possales.TopicTableStatusChanged, tableID, possales.TableStatusChanged{TableID: tableID, Status: "available"})
}

/* ── POST /api/pos/orders/{id}/merge ─────────────────────────────────── */

func (h *Handler) mergeOrders(w http.ResponseWriter, r *http.Request) error {
	user, err := kit.PosUser(h.auth, r)
	if err != nil {
		return err
	}
	res, err := h.mergeUseCase(r, user)
	return h.writeOutcome(w, res, err, "Merge error")
}

const mergeColumns = `id, order_number, status, payment_status, amount_paid, table_id, discount_amount, tax_amount, checkout_id, sold_from, company_id, branch_id`

func (h *Handler) mergeUseCase(r *http.Request, user *auth.User) (*response, error) {
	ctx := r.Context()
	body, err := readObj(r)
	if err != nil {
		return nil, err
	}
	sourceID := r.PathValue("id")
	if !body.Truthy("target_order_id") {
		return nil, fail(400, "Target order required")
	}
	targetID := body.Str("target_order_id")
	if sourceID == targetID {
		return nil, fail(400, "Cannot merge order with itself")
	}
	load := func(id string) *jsrow.Row {
		var row *jsrow.Row
		_ = savepointQuery(ctx, h.db, func(q database.Querier) error {
			var err error
			row, err = jsrow.QueryOne(ctx, q, `SELECT `+mergeColumns+` FROM pos.pos_orders WHERE id = $1`, id)
			return err
		})
		if row == nil {
			return nil
		}
		if in, _ := h.pins.orderInUserScope(ctx, user.ID, orderScope{CompanyID: row.Str("company_id"), BranchID: row.Str("branch_id")}); !in {
			return nil
		}
		return row
	}
	source, target := load(sourceID), load(targetID)
	if pin := body.Get("supervisor_pin"); !domain.IsNullish(pin) && domain.Trim(domain.String(pin)) != "" {
		var scoped *orderScope
		if source != nil && target != nil {
			scoped = &orderScope{CompanyID: source.Str("company_id"), BranchID: source.Str("branch_id")}
		}
		a, err := h.pins.approveOrder(ctx, user.ID, sourceID, scoped, domain.String(pin))
		if err != nil {
			return nil, err
		}
		if a.Approver == nil {
			return nil, rejection(a, "Invalid supervisor PIN")
		}
	}
	if source == nil || target == nil {
		return nil, fail(404, "Order not found")
	}
	blocked := []string{"completed", "cancelled", "voided", "merged"}
	if slices.Contains(blocked, source.Str("status")) {
		return nil, fail(400, "Source order cannot be merged")
	}
	if slices.Contains(blocked, target.Str("status")) {
		return nil, fail(400, "Target order cannot receive merge")
	}
	if b := domain.BillBlocksItemMoves(source.Str("payment_status"), source.Num("amount_paid")); b != "" {
		return nil, fail(400, "Bill "+source.Str("order_number")+" "+b+" — tidak bisa digabung")
	}
	if b := domain.BillBlocksItemMoves(target.Str("payment_status"), target.Num("amount_paid")); b != "" {
		return nil, fail(400, "Bill tujuan "+target.Str("order_number")+" "+b+" — tidak bisa menerima gabungan")
	}
	if !domain.CanAppendTransferItems(family(source), family(target)) {
		return nil, fail(400, "Tidak bisa merge tagihan stall ke kasir pusat")
	}
	if unpaid, err := hasUnpaidSplits(ctx, h.db, sourceID); err != nil {
		return nil, err
	} else if unpaid {
		return nil, fail(400, "Finish or cancel unpaid splits before merging")
	}
	if unpaid, err := hasUnpaidSplits(ctx, h.db, targetID); err != nil {
		return nil, err
	} else if unpaid {
		return nil, fail(400, "Target bill has unpaid splits")
	}
	err = database.WithTx(ctx, h.db, func(tx pgx.Tx) error {
		items, err := jsrow.Query(ctx, tx, `SELECT id, product_name, quantity, unit_price, total_amount FROM pos.pos_order_items WHERE order_id = $1`, sourceID)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE pos.pos_order_items SET order_id = $1 WHERE order_id = $2`, targetID, sourceID); err != nil {
			return err
		}
		now := h.clock()
		if _, err := tx.Exec(ctx, `UPDATE pos.pos_orders SET
			subtotal = (SELECT COALESCE(SUM(COALESCE(subtotal, 0)), 0) FROM pos.pos_order_items WHERE order_id = $1),
			total_amount = (SELECT COALESCE(SUM(COALESCE(total_amount, 0)), 0) FROM pos.pos_order_items WHERE order_id = $1),
			discount_amount = $2, tax_amount = $3, updated_at = $4 WHERE id = $1`,
			targetID, target.Num("discount_amount")+source.Num("discount_amount"), target.Num("tax_amount")+source.Num("tax_amount"), now); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE pos.pos_orders
       SET merged_from_orders = array_append(COALESCE(merged_from_orders, '{}'), $1::uuid),
           updated_at = NOW()
       WHERE id = $2`, sourceID, targetID); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `UPDATE pos.pos_orders SET status = 'merged', merged_to_order_id = $2, payment_status = 'refunded', updated_at = $3 WHERE id = $1`,
			sourceID, targetID, now); err != nil {
			return err
		}
		if t := source.Str("table_id"); t != "" {
			if err := releaseTableIfIdle(ctx, tx, t, sourceID); err != nil {
				return err
			}
		}
		moved := make([]map[string]any, len(items))
		for i, it := range items {
			moved[i] = moveSnapshot(it, it.Num("quantity"), it.Num("total_amount"))
		}
		h.logItemMove(ctx, tx, "merge", sourceID, source.Str("order_number"), targetID, target.Str("order_number"), moved, user.ID)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return &response{status: 200, body: jsrow.Object("success", true, "data",
		jsrow.Object("source_order_id", sourceID, "target_order_id", targetID, "message", "Orders merged successfully"))}, nil
}

/* ── POST /api/pos/orders/{id}/transfer-items ────────────────────────── */

func (h *Handler) transferItems(w http.ResponseWriter, r *http.Request) error {
	user, err := kit.PosUser(h.auth, r)
	if err != nil {
		return err
	}
	res, err := h.transferUseCase(r, user)
	return h.writeOutcomeOr(w, res, err, "Transfer items error", "Transfer items failed")
}

func (h *Handler) transferUseCase(r *http.Request, user *auth.User) (*response, error) {
	ctx := r.Context()
	body, err := readObj(r)
	if err != nil {
		return nil, err
	}
	sourceID := r.PathValue("id")
	if !body.Truthy("target_table_id") {
		return nil, fail(400, "target_table_id is required")
	}
	tableID := body.Str("target_table_id")
	rawItems, ok := body.List("items")
	if !ok || len(rawItems) == 0 {
		return nil, fail(400, "items are required")
	}
	var res *response
	err = database.WithTx(ctx, h.db, func(tx pgx.Tx) error {
		var err error
		res, err = h.transferTx(ctx, tx, user, sourceID, tableID, rawItems)
		return err
	})
	return res, err
}

func (h *Handler) transferTx(ctx context.Context, tx pgx.Tx, user *auth.User, sourceID, tableID string, rawItems []any) (*response, error) {
	var source *jsrow.Row
	_ = savepointQuery(ctx, tx, func(q database.Querier) error {
		var err error
		source, err = jsrow.QueryOne(ctx, q, `SELECT id, order_number, status, payment_status, amount_paid, table_id, discount_amount, tax_amount, company_id, branch_id, checkout_id, sold_from
			FROM pos.pos_orders WHERE id = $1`, sourceID)
		return err
	})
	if source == nil {
		return nil, fail(404, "Source order not found")
	}
	if !slices.Contains(activeStatuses, source.Str("status")) {
		return nil, fail(400, "Source order cannot transfer items")
	}
	if b := domain.BillBlocksItemMoves(source.Str("payment_status"), source.Num("amount_paid")); b != "" {
		return nil, fail(400, "Bill "+source.Str("order_number")+" "+b+" — item tidak bisa dipindah")
	}
	if unpaid, err := hasUnpaidSplits(ctx, tx, sourceID); err != nil {
		return nil, err
	} else if unpaid {
		return nil, fail(400, "Finish or cancel unpaid splits before moving items")
	}
	// pos_tables belongs to pos-ops; this is a read of its row.
	var table *jsrow.Row
	_ = savepointQuery(ctx, tx, func(q database.Querier) error {
		var err error
		table, err = jsrow.QueryOne(ctx, q, `SELECT id, status, is_active FROM pos.pos_tables WHERE id = $1`, tableID)
		return err
	})
	if table == nil {
		return nil, fail(404, "Target table not found")
	}
	if table.Get("is_active") == false {
		return nil, fail(400, "Target table is inactive")
	}
	if t := source.Str("table_id"); t != "" && t == tableID {
		return nil, fail(400, "Cannot transfer to the same table")
	}
	candidates, err := jsrow.Query(ctx, tx, `SELECT id, order_number, status, payment_status, amount_paid, checkout_id, sold_from FROM pos.pos_orders
		WHERE table_id = $1 AND status IN ('pending', 'confirmed', 'preparing', 'ready', 'served') ORDER BY ordered_at DESC`, tableID)
	if err != nil {
		candidates = nil
	}
	var compatible *jsrow.Row
	for _, c := range candidates {
		if domain.CanAppendTransferItems(family(source), family(c)) {
			compatible = c
			break
		}
	}
	targetID, targetNumber, created := "", "", false
	if compatible != nil {
		if b := domain.BillBlocksItemMoves(compatible.Str("payment_status"), compatible.Num("amount_paid")); b != "" {
			return nil, fail(400, "Bill tujuan "+compatible.Str("order_number")+" "+b+" — tidak bisa menerima item")
		}
		targetID, targetNumber = compatible.Str("id"), compatible.Str("order_number")
		if unpaid, err := hasUnpaidSplits(ctx, tx, targetID); err != nil {
			return nil, err
		} else if unpaid {
			return nil, fail(400, "Target bill has unpaid splits")
		}
	} else {
		number, err := rpcText(ctx, tx, `SELECT * FROM "generate_order_number"()`)
		if err != nil {
			return nil, fail(500, "Failed to generate order number")
		}
		queue := h.allocateQueueNumber(ctx, tx, source.Str("company_id"), source.Str("branch_id"))
		soldFrom := "stall"
		if source.Str("sold_from") == "central" {
			soldFrom = "central"
		}
		err = tx.QueryRow(ctx, `INSERT INTO pos.pos_orders (order_number, queue_number, order_type, status, payment_status, company_id, branch_id,
			cashier_id, table_id, sold_from, checkout_id, subtotal, discount_amount, tax_amount, service_charge_amount, total_amount,
			payment_method, amount_paid, ark_coins_used, ordered_at, notes)
			VALUES ($1, $2, 'dine_in', 'pending', 'unpaid', $3, $4, $5, $6, $7, NULL, 0, 0, 0, 0, 0, NULL, 0, 0, $8, 'Created via Move Items') RETURNING id::text`,
			number, nilIfEmpty(queue), nilIfEmpty(source.Str("company_id")), nilIfEmpty(source.Str("branch_id")), user.ID, tableID, soldFrom, h.clock()).Scan(&targetID)
		if err != nil {
			return nil, fail(500, kit.ErrorMessage(err))
		}
		targetNumber, created = number, true
		if err := publish(ctx, tx, possales.TopicTableStatusChanged, tableID, possales.TableStatusChanged{TableID: tableID, Status: "occupied"}); err != nil {
			return nil, err
		}
	}

	var ids []string
	for _, raw := range rawItems {
		m, _ := raw.(map[string]any)
		if id := domain.Obj(m).Str("order_item_id"); id != "" {
			ids = append(ids, id)
		}
	}
	rows, err := jsrow.Query(ctx, tx, `SELECT * FROM pos.pos_order_items WHERE order_id = $1 AND id = ANY($2::uuid[])`, sourceID, ids)
	if err != nil {
		return nil, err
	}
	byID := map[string]*jsrow.Row{}
	for _, row := range rows {
		byID[row.Str("id")] = row
	}
	var moved []map[string]any
	for _, raw := range rawItems {
		m, _ := raw.(map[string]any)
		req := domain.Obj(m)
		itemID := req.Str("order_item_id")
		qty := math.Floor(req.NumOr0("qty"))
		row := byID[itemID]
		if row == nil {
			return nil, fail(400, "Item not found on source: "+itemID)
		}
		available := row.Num("quantity")
		if qty < 1 || qty > available {
			return nil, fail(400, "Invalid qty for "+firstStr(row.Str("product_name"), itemID))
		}
		unit := row.Num("unit_price")
		unitTotal := unit
		lineValue := domain.Or(row.Num("total_amount"), row.Num("subtotal"))
		if available > 0 {
			unitTotal = lineValue / available
		}
		moved = append(moved, moveSnapshot(row, qty, unitTotal*qty))
		if qty == available {
			if _, err := tx.Exec(ctx, `UPDATE pos.pos_order_items SET order_id = $1 WHERE id = $2`, targetID, row.Str("id")); err != nil {
				return nil, err
			}
			continue
		}
		remain := available - qty
		if _, err := tx.Exec(ctx, `UPDATE pos.pos_order_items SET quantity = $1, subtotal = $2, total_amount = $3 WHERE id = $4`,
			remain, unit*remain, unitTotal*remain, row.Str("id")); err != nil {
			return nil, err
		}
		kitchenStatus := firstStr(row.Str("kitchen_status"), "pending")
		cols := `order_id, product_id, product_name, product_sku, variants, modifiers, quantity, unit_price, subtotal, total_amount, station, kitchen_status, kitchen_notes`
		vals := `$1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10, $11, $12, $13`
		args := []any{targetID, row.Get("product_id"), row.Get("product_name"), row.Get("product_sku"), jsonOrEmptyArray(rawAny(row, "variants")),
			jsonOrEmptyArray(rawAny(row, "modifiers")), qty, unit, unit * qty, unitTotal * qty, row.Get("station"), kitchenStatus, row.Get("kitchen_notes")}
		if row.Get("cost_price") != nil {
			cost := row.Num("cost_price")
			cols += `, cost_price, cost_total, gross_profit`
			vals += `, $14, $15, $16`
			args = append(args, cost, cost*qty, unitTotal*qty-cost*qty)
		}
		if _, err := tx.Exec(ctx, `INSERT INTO pos.pos_order_items (`+cols+`) VALUES (`+vals+`)`, args...); err != nil {
			return nil, err
		}
	}
	sourceCount, err := recalculateOrderTotals(ctx, tx, sourceID, h.clock())
	if err != nil {
		return nil, err
	}
	if _, err := recalculateOrderTotals(ctx, tx, targetID, h.clock()); err != nil {
		return nil, err
	}
	h.logItemMove(ctx, tx, "transfer", sourceID, source.Str("order_number"), targetID, targetNumber, moved, user.ID)
	if sourceCount == 0 {
		if _, err := tx.Exec(ctx, `UPDATE pos.pos_orders SET status = 'cancelled', updated_at = $2 WHERE id = $1`, sourceID, h.clock()); err != nil {
			return nil, err
		}
		if t := source.Str("table_id"); t != "" {
			if err := releaseTableIfIdle(ctx, tx, t, sourceID); err != nil {
				return nil, err
			}
		}
	}
	return &response{status: 200, body: jsrow.Object("success", true, "data", jsrow.Object(
		"source_order_id", sourceID, "target_order_id", targetID, "created_target", created, "message", "Items transferred successfully"))}, nil
}

// rawAny is the raw JSON value of a column (nil when NULL).
func rawAny(r *jsrow.Row, key string) any {
	if r.Get(key) == nil {
		return nil
	}
	return r.Get(key)
}

// recalculateOrderTotals re-derives subtotal/total from the lines; an order
// left without lines is zeroed. It returns the line count.
func recalculateOrderTotals(ctx context.Context, tx pgx.Tx, orderID string, now any) (int, error) {
	items, err := jsrow.Query(ctx, tx, `SELECT subtotal, total_amount FROM pos.pos_order_items WHERE order_id = $1`, orderID)
	if err != nil {
		return 0, err
	}
	order, err := jsrow.QueryOne(ctx, tx, `SELECT id, discount_amount, tax_amount, service_charge_amount FROM pos.pos_orders WHERE id = $1`, orderID)
	if err != nil {
		return 0, err
	}
	if order == nil {
		return 0, errors.New("No rows found")
	}
	sub, total := 0.0, 0.0
	for _, it := range items {
		sub += it.Num("subtotal")
		total += it.Num("total_amount")
	}
	empty := len(items) == 0
	newTotal := total
	if newTotal == 0 {
		newTotal = sub + order.Num("tax_amount") + order.Num("service_charge_amount") - order.Num("discount_amount")
	}
	keep := func(key string) any {
		if empty {
			return 0
		}
		if v := order.Get(key); v != nil && order.Num(key) != 0 {
			return v
		}
		return 0
	}
	if empty {
		newTotal = 0
	}
	_, err = tx.Exec(ctx, `UPDATE pos.pos_orders SET subtotal = $2, total_amount = $3, discount_amount = $4, tax_amount = $5, service_charge_amount = $6, updated_at = $7 WHERE id = $1`,
		orderID, sub, newTotal, keep("discount_amount"), keep("tax_amount"), keep("service_charge_amount"), now)
	return len(items), err
}
