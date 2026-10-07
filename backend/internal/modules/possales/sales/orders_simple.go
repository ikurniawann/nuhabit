package sales

import (
	"fmt"
	"math"
	"net/http"
	"slices"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/possales/domain"
	"nuhabit/backend/internal/modules/possales/internal/jsrow"
	"nuhabit/backend/internal/modules/possales/internal/kit"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/validate"
)

var activeStatuses = []string{"pending", "confirmed", "preparing", "ready", "served"}

// acceptOrder is POST /api/pos/orders/{id}/accept (self-order "Dibuat").
func (h *Handler) acceptOrder(w http.ResponseWriter, r *http.Request) error {
	user, err := h.auth.RequireMenuPrefix(r, iam.Pos...)
	if err != nil {
		return err
	}
	orderID := domain.Trim(r.PathValue("id"))
	if !validate.IsUUID(orderID) {
		return kit.Fail(w, 400, "Order tidak valid")
	}
	ctx := r.Context()
	fail := func(err error) error {
		h.log.Error("[pos/orders/accept] gagal", "error", err)
		return kit.Fail(w, 500, "Gagal memproses pesanan")
	}
	var status, payment string
	var special *string
	err = h.db.QueryRow(ctx, `SELECT status::text, special_requests, payment_status::text FROM pos.pos_orders WHERE id = $1 LIMIT 1`, orderID).
		Scan(&status, &special, &payment)
	if database.IsNoRows(err) {
		return kit.Fail(w, 404, "Order tidak ditemukan")
	}
	if err != nil {
		return fail(err)
	}
	if !domain.IsSelfOrder(deref(special)) {
		return kit.Fail(w, 409, "Bukan pesanan self-order")
	}
	if status != "pending" {
		return kit.Fail(w, 409, "Pesanan sudah berstatus "+status)
	}
	var updated string
	err = database.WithTx(ctx, h.db, func(tx pgx.Tx) error {
		err := tx.QueryRow(ctx, `UPDATE pos.pos_orders
			SET status = 'confirmed'::pos_order_status, confirmed_at = now(), updated_at = now()
			WHERE id = $1 AND status = 'pending'::pos_order_status
			RETURNING id::text`, orderID).Scan(&updated)
		if database.IsNoRows(err) {
			return nil
		}
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `INSERT INTO pos.pos_order_status_history (order_id, from_status, to_status, changed_by, notes)
			VALUES ($1, 'pending', 'confirmed', $2, 'Dibuat oleh kasir (notifikasi self-order)')`, orderID, user.ID)
		return err
	})
	if err != nil {
		return fail(err)
	}
	if updated == "" {
		return kit.Fail(w, 409, "Pesanan sudah diproses kasir lain")
	}
	return httpx.Data(w, 200, jsrow.Object("id", orderID, "status", "confirmed", "payment_status", payment))
}

// preSettle is POST /api/pos/orders/{id}/pre-settle.
func (h *Handler) preSettle(w http.ResponseWriter, r *http.Request) error {
	if _, err := kit.PosUser(h.auth, r); err != nil {
		return err
	}
	ctx := r.Context()
	orderID := r.PathValue("id")
	order, err := jsrow.QueryOne(ctx, h.db, `SELECT id, status, payment_status, table_id FROM pos.pos_orders WHERE id = $1`, orderID)
	if err != nil || order == nil {
		return kit.Fail(w, 404, "Order not found")
	}
	if !slices.Contains(activeStatuses, order.Str("status")) {
		return kit.Fail(w, 409, "Order is not active")
	}
	if order.Str("payment_status") == "paid" {
		return kit.Fail(w, 409, "Order is already paid")
	}
	now := h.clock()
	data, err := jsrow.QueryOne(ctx, h.db, `UPDATE pos.pos_orders SET pre_settled_at = $2, updated_at = $2 WHERE id = $1
		RETURNING id, order_number, table_id, pre_settled_at, payment_status, status`, orderID, now)
	if err != nil {
		h.log.Error("[pre-settle] failed", "error", err)
		return kit.Fail(w, 500, "Failed to mark pre settlement")
	}
	return httpx.DataMessage(w, 200, data, "Pre settlement marked")
}

// moveTable is PATCH /api/pos/orders/{id}/table.
func (h *Handler) moveTable(w http.ResponseWriter, r *http.Request) error {
	if _, err := kit.PosUser(h.auth, r); err != nil {
		return err
	}
	ctx := r.Context()
	fail := func(err error) error {
		h.log.Error("Move table error", "error", err)
		return kit.Fail(w, 500, "Move table failed")
	}
	body, err := readObj(r)
	if err != nil {
		return kit.Fail(w, 500, kit.ErrorMessage(err))
	}
	orderID := r.PathValue("id")
	order, err := jsrow.QueryOne(ctx, h.db, `SELECT id, status, table_id, checkout_id, payment_status FROM pos.pos_orders WHERE id = $1`, orderID)
	if err != nil || order == nil {
		return kit.Fail(w, 404, "Order not found")
	}
	if !slices.Contains(activeStatuses, order.Str("status")) {
		return kit.Fail(w, 400, "Cannot move finished order")
	}
	var newTable any
	if body.Truthy("table_id") {
		newTable = body.Get("table_id")
	}
	orderType := body.Get("order_type")
	now := h.clock()
	set := `updated_at = $2, table_id = $3`
	args := []any{nil, now, jsonScalar(newTable)}
	if domain.Truthy(orderType) {
		set += `, order_type = $4`
		args = append(args, jsonScalar(orderType))
	}
	err = database.WithTx(ctx, h.db, func(tx pgx.Tx) error {
		if checkoutID := order.Str("checkout_id"); checkoutID != "" {
			args[0] = checkoutID
			if _, err := tx.Exec(ctx, `UPDATE pos.pos_orders SET `+set+` WHERE checkout_id = $1 AND payment_status <> 'paid'
				AND status IN ('pending', 'confirmed', 'preparing', 'ready', 'served')`, args...); err != nil {
				return err
			}
			_, err := tx.Exec(ctx, `UPDATE pos.pos_checkouts SET updated_at = $2, table_id = $3 WHERE id = $1 AND payment_status <> 'paid'`, checkoutID, now, args[2])
			return err
		}
		args[0] = orderID
		_, err := tx.Exec(ctx, `UPDATE pos.pos_orders SET `+set+` WHERE id = $1`, args...)
		return err
	})
	if err != nil {
		return fail(err)
	}
	data := jsrow.Object("order_id", orderID, "new_table_id", newTable)
	if domain.Truthy(orderType) {
		data.Set("new_order_type", orderType)
	}
	data.Set("message", "Order moved successfully")
	return httpx.Data(w, 200, data)
}

// jsonScalar turns a decoded JSON value into a SQL parameter the way
// node-postgres would send it (numbers and booleans as text).
func jsonScalar(v any) any {
	switch x := v.(type) {
	case nil, domain.Undefined:
		return nil
	case string:
		return x
	}
	return domain.String(v)
}

/* ── split bills ─────────────────────────────────────────────────────── */

// rpcJSON calls a jsonb-returning DB function the way the TS rpc shim
// does and returns its normalized JSON.
func (h *Handler) rpcJSON(r *http.Request, q database.Querier, sql string, args ...any) (jsonRawRow, error) {
	var raw []byte
	if err := savepointQuery(r.Context(), q, func(q database.Querier) error {
		return q.QueryRow(r.Context(), sql, args...).Scan(&raw)
	}); err != nil {
		return nil, err
	}
	return jsrow.NormalizeJSON(raw), nil
}

type jsonRawRow = []byte

// listSplits is GET /api/pos/orders/{id}/splits.
func (h *Handler) listSplits(w http.ResponseWriter, r *http.Request) error {
	if _, err := kit.PosUser(h.auth, r); err != nil {
		return err
	}
	data, err := h.rpcJSON(r, h.db, `SELECT * FROM "pos_get_order_splits"("p_order_id" := $1)`, r.PathValue("id"))
	if err != nil {
		h.log.Error("Error fetching splits", "error", err)
		return kit.Fail(w, 500, kit.ErrorMessage(err))
	}
	return httpx.Data(w, 200, rawJSON(data))
}

// rawJSON embeds pre-rendered JSON (null when empty).
type rawJSON []byte

func (r rawJSON) MarshalJSON() ([]byte, error) {
	if len(r) == 0 {
		return []byte("null"), nil
	}
	return r, nil
}

// cancelSplit is PATCH /api/pos/orders/{id}/splits/{splitId}.
func (h *Handler) cancelSplit(w http.ResponseWriter, r *http.Request) error {
	user, err := kit.PosUser(h.auth, r)
	if err != nil {
		return err
	}
	data, err := h.rpcJSON(r, h.db, `SELECT * FROM "pos_cancel_split"("p_split_id" := $1, "p_cashier_id" := $2)`, r.PathValue("splitId"), user.ID)
	if err != nil {
		h.log.Error("RPC cancel split error", "error", err)
		return kit.Fail(w, 500, kit.ErrorMessage(err))
	}
	res, _ := jsrow.ParseObject(data)
	if res == nil || res.Get("success") != true {
		msg := "Cancel failed"
		if res != nil && res.Str("error") != "" {
			msg = res.Str("error")
		}
		return kit.Fail(w, 400, msg)
	}
	return httpx.Data(w, 200, rawJSON(data))
}

// createSplits is POST /api/pos/orders/{id}/splits.
func (h *Handler) createSplits(w http.ResponseWriter, r *http.Request) error {
	if _, err := kit.PosUser(h.auth, r); err != nil {
		return err
	}
	ctx := r.Context()
	id := r.PathValue("id")
	fail500 := func(err error) error {
		h.log.Error("Error creating order splits", "error", err)
		return kit.Fail(w, 500, kit.ErrorMessage(err))
	}
	body, err := readObj(r)
	if err != nil {
		return fail500(err)
	}
	rawSplits, _ := body.List("splits")
	splits := make([]domain.Obj, 0, len(rawSplits))
	for _, s := range rawSplits {
		m, _ := s.(map[string]any)
		splits = append(splits, m)
	}
	if len(splits) < 2 {
		return kit.Fail(w, 400, "Minimal 2 split diperlukan")
	}
	order, err := jsrow.QueryOne(ctx, h.db, `SELECT id, order_number, status, payment_status, total_amount FROM pos.pos_orders WHERE id = $1`, id)
	if err != nil {
		return kit.Fail(w, 404, kit.ErrorMessage(err))
	}
	if order == nil {
		return kit.Fail(w, 404, "No rows found")
	}
	if slices.Contains([]string{"completed", "cancelled", "voided", "merged"}, order.Str("status")) {
		return kit.Fail(w, 400, "Order sudah tidak bisa di-split")
	}
	if order.Str("payment_status") == "paid" {
		return kit.Fail(w, 400, "Order sudah lunas")
	}
	var existing int
	if err := h.db.QueryRow(ctx, `SELECT count(*)::int FROM pos.pos_order_splits WHERE order_id = $1 AND status <> 'cancelled'`, id).Scan(&existing); err != nil {
		return kit.Fail(w, 500, kit.ErrorMessage(err))
	}
	if existing > 0 {
		return kit.Fail(w, 400, "Order ini sudah memiliki split bill")
	}
	items, err := jsrow.Query(ctx, h.db, `SELECT id, quantity, unit_price FROM pos.pos_order_items WHERE order_id = $1 ORDER BY created_at ASC`, id)
	if err != nil {
		return kit.Fail(w, 500, kit.ErrorMessage(err))
	}
	orderTotal := order.Num("total_amount")
	splitTotal := 0.0
	for _, s := range splits {
		splitTotal += domain.ToNumber(s.Get("total_amount"), 0)
	}
	if domain.RoundHalfUp(splitTotal) != domain.RoundHalfUp(orderTotal) {
		return kit.Fail(w, 400, fmt.Sprintf("Total split %s tidak sama dengan total order %s", domain.NumberString(splitTotal), domain.NumberString(orderTotal)))
	}

	// The TS inserts split by split without a transaction; a failure halfway
	// returns 500 and leaves earlier splits. Here the whole set is atomic.
	var inserted []*jsrow.Row
	var failMsg string
	err = database.WithTx(ctx, h.db, func(tx pgx.Tx) error {
		for i, s := range splits {
			label := domain.StrOr(s.Get("label"), fmt.Sprintf("Split %d", i+1))
			var customer any
			if s.Truthy("customer_id") {
				customer = jsonScalar(s.Get("customer_id"))
			}
			row, err := jsrow.QueryOne(ctx, tx, `INSERT INTO pos.pos_order_splits
				(order_id, split_index, label, subtotal, tax_amount, discount_amount, total_amount, customer_id, status)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
				RETURNING id, split_index, label, total_amount, status`,
				id, i+1, label, domain.ToNumber(s.Get("subtotal"), 0), domain.ToNumber(s.Get("tax_amount"), 0),
				domain.ToNumber(s.Get("discount_amount"), 0), domain.ToNumber(s.Get("total_amount"), 0), customer)
			if err != nil {
				failMsg = kit.ErrorMessage(err)
				return err
			}
			inserted = append(inserted, row)
			splitItems, _ := s.List("items")
			for _, rawItem := range splitItems {
				item, _ := rawItem.(map[string]any)
				it := domain.Obj(item)
				idx := domain.Number(it.Get("order_item_index"))
				if !domain.Finite(idx) || idx < 0 || idx != math.Trunc(idx) || int(idx) >= len(items) {
					continue
				}
				orderItem := items[int(idx)]
				qty := math.Max(0, math.Floor(domain.Or0(domain.ToNumber(it.Get("quantity"), 0))))
				if qty <= 0 {
					continue
				}
				unit := domain.Or(domain.ToNumber(it.Get("unit_price"), 0), domain.ToNumber(orderItem.Get("unit_price"), 0))
				if _, err := tx.Exec(ctx, `INSERT INTO pos.pos_order_split_items (split_id, order_item_id, quantity, subtotal, total_amount)
					VALUES ($1, $2, $3, $4, $5)`, row.Str("id"), orderItem.Str("id"), qty, unit*qty, unit*qty); err != nil {
					failMsg = kit.ErrorMessage(err)
					return err
				}
			}
		}
		status := order.Str("status")
		if status == "" {
			status = "pending"
		}
		// pos_order_status_history has no status/reason columns, so this TS
		// insert fails (unchecked); bestEffort keeps that outcome.
		bestEffort(ctx, tx, `INSERT INTO pos.pos_order_status_history (order_id, status, reason) VALUES ($1, $2, $3)`,
			id, status, fmt.Sprintf("Split bill dibuat: %d bill(s)", len(splits)))
		return nil
	})
	if err != nil {
		if failMsg == "" {
			failMsg = kit.ErrorMessage(err)
		}
		return kit.Fail(w, 500, failMsg)
	}
	return httpx.Data(w, 200, jsrow.Object(
		"order_id", id,
		"order_number", order.Get("order_number"),
		"split_count", len(inserted),
		"splits", inserted,
	))
}
