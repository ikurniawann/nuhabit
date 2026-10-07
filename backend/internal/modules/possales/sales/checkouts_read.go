package sales

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/possales/domain"
	"nuhabit/backend/internal/modules/possales/internal/jsrow"
	"nuhabit/backend/internal/modules/possales/internal/kit"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/scope"
)

// getCheckout is GET /api/pos/checkouts/{id}: the checkout plus the items of
// its unpaid children.
func (h *Handler) getCheckout(w http.ResponseWriter, r *http.Request) error {
	if _, err := kit.PosUser(h.auth, r); err != nil {
		return err
	}
	ctx := r.Context()
	id := domain.Trim(r.PathValue("id"))
	if id == "" {
		return kit.Fail(w, 400, "Checkout tidak valid")
	}
	fail := func(err error) error {
		h.log.Error("[pos] get checkout error", "error", err)
		return kit.Fail(w, 500, "Unknown error") // shim error objects
	}
	checkout, err := jsrow.QueryOne(ctx, h.db, `SELECT id, checkout_number, queue_number, table_id, payment_status, payment_method, customer_id, notes, total_amount, subtotal, xendit_qr_id, xendit_external_id
		FROM pos.pos_checkouts WHERE id = $1`, id)
	if err != nil {
		return fail(err)
	}
	if checkout == nil {
		return kit.Fail(w, 404, "Checkout tidak ditemukan")
	}
	orders, err := jsrow.Query(ctx, h.db, `SELECT "id", "order_number", "order_type", "table_id", "customer_id", "notes", "total_amount", "payment_status", "status", "warehouse_id", `+embedItems+`
		FROM "pos"."pos_orders" WHERE "checkout_id" = $1 AND "payment_status" <> $2`, id, "paid")
	if err != nil {
		return fail(err)
	}
	data := checkout.Clone()
	orderType := any("dine_in")
	if len(orders) > 0 && orders[0].Str("order_type") != "" {
		orderType = orders[0].Get("order_type")
	}
	data.Set("order_type", orderType)
	ids := make([]string, len(orders))
	items := []*jsrow.Row{}
	for i, o := range orders {
		ids[i] = o.Str("id")
		raw, _ := o.Get("items").(json.RawMessage)
		rows, _ := jsrow.ParseArray(raw)
		for _, it := range rows {
			it.Set("order_id", o.Get("id"))
			it.Set("warehouse_id", o.Get("warehouse_id"))
			items = append(items, it)
		}
	}
	data.Set("order_ids", ids)
	data.Set("items", items)
	return httpx.Data(w, 200, data)
}

// scopeFilter is the company/branch filter of a scoped cashier ("" = none).
func (h *Handler) scopeFilter(ctx context.Context, userID string) (string, string, error) {
	s, err := scope.Load(ctx, h.db, userID)
	if err != nil || s.Unscoped {
		return "", "", err
	}
	return deref(s.CompanyID), deref(s.BranchID), nil
}

// cancelCheckout is POST /api/pos/checkouts/{id}/cancel.
func (h *Handler) cancelCheckout(w http.ResponseWriter, r *http.Request) error {
	user, err := kit.PosUser(h.auth, r)
	if err != nil {
		return err
	}
	ctx := r.Context()
	id := domain.Trim(r.PathValue("id"))
	if id == "" {
		return kit.Fail(w, 400, "Checkout tidak valid")
	}
	company, branch, err := h.scopeFilter(ctx, user.ID)
	if err == nil {
		err = database.WithTx(ctx, h.db, func(tx pgx.Tx) error {
			return cancelChildlessCheckout(ctx, tx, id, company, branch)
		})
	}
	if ce, ok := err.(*domain.CheckoutError); ok {
		return kit.Fail(w, ce.Status, ce.Message)
	}
	if err != nil {
		h.log.Error("[pos] cancel checkout error", "error", err)
		return kit.Fail(w, 500, kit.ErrorMessage(err))
	}
	return httpx.Data(w, 200, jsrow.Object("checkout_id", id))
}

// unpaidScopeSQL is unpaidCheckoutScopeSql.
func unpaidScopeSQL(company, branch string, start int) (string, []any) {
	sql := ""
	var args []any
	if company != "" {
		sql += " AND company_id = $" + itoa(start)
		args = append(args, company)
		start++
	}
	if branch != "" {
		sql += " AND branch_id = $" + itoa(start)
		args = append(args, branch)
	}
	return sql, args
}

// cancelChildlessCheckout is checkout/cancel.ts (inside the caller's tx).
func cancelChildlessCheckout(ctx context.Context, tx pgx.Tx, id, company, branch string) error {
	scoped, args := unpaidScopeSQL(company, branch, 2)
	var rowID, payment string
	var notes *string
	err := tx.QueryRow(ctx, `SELECT id::text, payment_status::text, notes FROM pos.pos_checkouts WHERE id = $1`+scoped+` FOR UPDATE`,
		append([]any{id}, args...)...).Scan(&rowID, &payment, &notes)
	if database.IsNoRows(err) {
		return &domain.CheckoutError{Status: 404, Message: "Checkout tidak ditemukan"}
	}
	if err != nil {
		return err
	}
	if domain.IsCancelledCheckout(deref(notes)) {
		return nil
	}
	var children int
	if err := tx.QueryRow(ctx, `SELECT COUNT(*)::int AS n FROM pos.pos_orders WHERE checkout_id = $1`, id).Scan(&children); err != nil {
		return err
	}
	if msg := domain.CanCancelChildlessCheckout(payment, children, deref(notes)); msg != "" {
		return domain.Reject(msg)
	}
	_, err = tx.Exec(ctx, `UPDATE pos.pos_checkouts SET table_id = $2, notes = $3, updated_at = now() WHERE id = $1`, id, nil, domain.CheckoutCancelledNote)
	return err
}
