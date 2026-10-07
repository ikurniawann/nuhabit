package gofood

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"nuhabit/backend/internal/modules/possales/gofood/domain"
	"nuhabit/backend/internal/modules/possales/internal/jsrow"
	"nuhabit/backend/internal/platform/database"
)

// orderSelect is ORDER_SELECT: every gofood_orders column (money re-read as
// float so it serializes as a number) plus the linked POS order's number,
// queue number and status.
const orderSelect = `
  SELECT g.*, g.order_total::float AS order_total, g.takeaway_charges::float AS takeaway_charges,
         o.order_number AS pos_order_number, o.queue_number AS pos_queue_number, o.status::text AS pos_status
  FROM pos.gofood_orders g
  LEFT JOIN pos.pos_orders o ON o.id = g.pos_order_id`

// orderBy reads one order by g.id, g.gofood_order_id or g.pos_order_id.
func orderBy(ctx context.Context, q database.Querier, column, value string) (*jsrow.Row, error) {
	return jsrow.QueryOne(ctx, q, orderSelect+" WHERE "+column+" = $1", value)
}

// activeStatuses is the "active" filter of listGofoodOrders.
const activeStatuses = `('created','awaiting_acceptance','accepted','driver_otw_pickup','driver_arrived','placed')`

// listOrders is listGofoodOrders. limit is the JS number as node-postgres
// sends it; the text cast keeps PostgreSQL's error for "NaN" or "2.5".
func listOrders(ctx context.Context, q database.Querier, status, limit string) ([]*jsrow.Row, error) {
	switch status {
	case "active":
		return jsrow.Query(ctx, q, orderSelect+` WHERE g.status IN `+activeStatuses+` ORDER BY g.created_at DESC LIMIT $1::text::bigint`, limit)
	case "":
		return jsrow.Query(ctx, q, orderSelect+` ORDER BY g.created_at DESC LIMIT $1::text::bigint`, limit)
	}
	return jsrow.Query(ctx, q, orderSelect+` WHERE g.status = $1 ORDER BY g.created_at DESC LIMIT $2::text::bigint`, status, limit)
}

// insertPosOrder writes the pos_orders row, its items and the first status
// history row of ensurePosOrderForGofood, and returns the order id.
func insertPosOrder(ctx context.Context, tx pgx.Tx, row *jsrow.Row, lines []mappedLine, unmappedCount int, venue Venue, now time.Time) (string, error) {
	var orderNumber string
	if err := tx.QueryRow(ctx, `SELECT public.generate_order_number()`).Scan(&orderNumber); err != nil {
		return "", queryBuilderError{err}
	}
	// allocateQueueNumber logs and returns null on failure; the savepoint
	// keeps that failure from aborting the order.
	var queueNumber *string
	_ = database.WithTx(ctx, tx, func(sp pgx.Tx) error {
		return sp.QueryRow(ctx, `SELECT public.generate_queue_number($1::uuid, $2::uuid)`, venue.CompanyID, venue.BranchID).Scan(&queueNumber)
	})

	subtotal := 0.0
	for _, l := range lines {
		subtotal += l.UnitPrice * l.Quantity
	}
	total := row.Num("order_total")
	if total <= 0 {
		total = subtotal
	}
	otherCharges := max(0, total-subtotal)
	breakdown := "[]"
	if otherCharges > 0 {
		b, _ := json.Marshal([]any{jsrow.Object("code", "GOFOOD", "name", "Biaya GoFood", "kind", "fee", "amount", otherCharges)})
		breakdown = string(b)
	}
	gofoodID, orderType := row.Str("gofood_order_id"), row.Str("gofood_order_type")
	cutlery, _ := row.Get("cutlery_requested").(bool)
	notes := domain.PosOrderNotes(domain.NotesInput{
		GofoodOrderID: gofoodID, GofoodOrderType: orderType, Pin: row.Str("pin"),
		CustomerName: row.Str("customer_name"), Cutlery: cutlery, UnmappedCount: unmappedCount,
	})

	var orderID string
	err := tx.QueryRow(ctx, `INSERT INTO pos.pos_orders (
		order_number, queue_number, order_type, status, payment_status, customer_id, cashier_id, table_id,
		subtotal, discount_amount, tax_amount, service_charge_amount, other_charges_amount, charges_breakdown,
		total_amount, payment_method, payment_method_code, payment_method_name, amount_paid, ark_coins_used,
		notes, special_requests, ordered_at, confirmed_at, company_id, branch_id
	) VALUES ($1, $2, 'delivery', 'confirmed', 'paid', NULL, $3, NULL,
		$4, 0, 0, 0, $5, $6::jsonb,
		$7, NULL, 'gofood', 'GoFood', $7, 0,
		$8, $9, $10, $10, $11, $12)
	RETURNING id::text`,
		orderNumber, queueNumber, fallbackCashierID,
		subtotal, otherCharges, breakdown,
		total,
		notes, "GoFood "+gofoodID+"; type="+orderType, now, venue.CompanyID, venue.BranchID,
	).Scan(&orderID)
	if err != nil {
		return "", queryBuilderError{err}
	}

	for _, l := range lines {
		variants := "[]"
		if l.VariantName != nil && *l.VariantName != "" {
			b, _ := json.Marshal([]any{jsrow.Object("name", *l.VariantName)})
			variants = string(b)
		}
		modifiers := string(l.Modifiers)
		if modifiers == "" || modifiers == "null" {
			modifiers = "[]"
		}
		kitchenNotes := "GoFood " + gofoodID
		if l.Notes != nil && *l.Notes != "" {
			kitchenNotes += " · " + *l.Notes
		}
		amount := l.UnitPrice * l.Quantity
		if _, err := tx.Exec(ctx, `INSERT INTO pos.pos_order_items (
			order_id, product_id, product_name, product_sku, variants, modifiers, quantity, unit_price,
			subtotal, total_amount, kitchen_notes, station, kitchen_status, xp_earned, inventory_deducted
		) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $9, $10, $11, 'pending', 0, false)`,
			orderID, l.ProductID, l.ProductName, l.ProductSKU, variants, modifiers, l.Quantity, l.UnitPrice,
			amount, kitchenNotes, l.Station); err != nil {
			return "", queryBuilderError{err}
		}
	}

	// The TS ignores the result of this insert.
	_ = database.WithTx(ctx, tx, func(sp pgx.Tx) error {
		_, err := sp.Exec(ctx, `INSERT INTO pos.pos_order_status_history (order_id, from_status, to_status, changed_by, notes)
			VALUES ($1, NULL, 'confirmed', $2, $3)`, orderID, fallbackCashierID, "Created from GoFood "+gofoodID)
		return err
	})
	return orderID, nil
}

// errorMessage is `error.message` as the TS routes see it: node-postgres
// errors carry only the server message.
func errorMessage(err error) string {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Message
	}
	return err.Error()
}
