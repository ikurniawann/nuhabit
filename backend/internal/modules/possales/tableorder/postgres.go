package tableorder

import (
	"context"
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/possales/ports"
	"nuhabit/backend/internal/platform/database"
)

// SQL on the tables pos-sales owns (pos_orders, pos_order_items,
// pos_order_status_history).

// fallbackCashierID is FALLBACK_CASHIER_ID: the actor of self-orders.
const fallbackCashierID = "00000000-0000-0000-0000-000000000001"

// savepoint runs fn in a savepoint when q is a transaction (a pool gets its
// own transaction), so a failure the TS ignores leaves the caller's
// transaction usable.
func savepoint(ctx context.Context, q database.Querier, fn func(database.Querier) error) error {
	if tb, ok := q.(database.TxBeginner); ok {
		return database.WithTx(ctx, tb, func(tx pgx.Tx) error { return fn(tx) })
	}
	return fn(q)
}

func nullable(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// allocateQueueNumber is allocateQueueNumber: generate_queue_number, nil on
// failure (logged by the caller in TS, swallowed here).
func allocateQueueNumber(ctx context.Context, q database.Querier, companyID, branchID string) *string {
	var queue *string
	err := savepoint(ctx, q, func(q database.Querier) error {
		return q.QueryRow(ctx, `SELECT public.generate_queue_number(p_company_id := $1::uuid, p_branch_id := $2::uuid)`,
			nullable(companyID), nullable(branchID)).Scan(&queue)
	})
	if err != nil {
		return nil
	}
	return queue
}

func generateOrderNumber(ctx context.Context, q database.Querier) (string, error) {
	var n string
	err := q.QueryRow(ctx, `SELECT public.generate_order_number()`).Scan(&n)
	return n, err
}

// newOrder is the pos_orders insert of POST /api/table-order/orders.
type newOrder struct {
	OrderNumber, OrderType, Status, PaymentStatus string
	QueueNumber, CustomerID, TableID              *string
	ContactName, ContactPhone, PaymentMethod      *string
	CompanyID, BranchID                           *string
	Subtotal, Discount, Tax, Service, Other       float64
	Breakdown                                     any
	Total, AmountPaid, ArkCoinsUsed               float64
	Notes, SpecialRequests                        string
	OrderedAt                                     time.Time
}

func insertOrder(ctx context.Context, q database.Querier, o newOrder) (string, error) {
	breakdown, err := json.Marshal(o.Breakdown)
	if err != nil {
		return "", err
	}
	var id string
	err = q.QueryRow(ctx, `INSERT INTO pos.pos_orders
	   (order_number, queue_number, order_type, status, payment_status, customer_id, cashier_id, table_id,
	    subtotal, discount_amount, tax_amount, service_charge_amount, other_charges_amount, charges_breakdown,
	    total_amount, payment_method, amount_paid, ark_coins_used, notes, special_requests, ordered_at,
	    contact_name, contact_phone, company_id, branch_id)
	 VALUES ($1, $2, $3::pos_order_type, $4::pos_order_status, $5::pos_payment_status, $6::uuid, $7, $8,
	    $9, $10, $11, $12, $13, $14::jsonb, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24::uuid, $25::uuid)
	 RETURNING id::text`,
		o.OrderNumber, o.QueueNumber, o.OrderType, o.Status, o.PaymentStatus, o.CustomerID, fallbackCashierID, o.TableID,
		o.Subtotal, o.Discount, o.Tax, o.Service, o.Other, string(breakdown),
		o.Total, o.PaymentMethod, o.AmountPaid, o.ArkCoinsUsed, o.Notes, o.SpecialRequests, o.OrderedAt,
		o.ContactName, o.ContactPhone, o.CompanyID, o.BranchID).Scan(&id)
	return id, err
}

// orderItem is one pos_order_items row as the route inserts it.
type orderItem struct {
	ProductID, ProductName, ProductSKU string
	Variants, Modifiers                any
	Quantity                           int
	UnitPrice, Total                   float64
	KitchenNotes, Station              string
	XPEarned                           int
}

func insertItems(ctx context.Context, q database.Querier, orderID string, items []orderItem) error {
	for _, it := range items {
		variants, _ := json.Marshal(it.Variants)
		modifiers, _ := json.Marshal(it.Modifiers)
		_, err := q.Exec(ctx, `INSERT INTO pos.pos_order_items
		   (order_id, product_id, product_name, product_sku, variants, modifiers, quantity, unit_price, subtotal,
		    total_amount, kitchen_notes, station, kitchen_status, xp_earned, inventory_deducted)
		 VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10, $11, $12, 'pending', $13, false)`,
			orderID, it.ProductID, it.ProductName, it.ProductSKU, string(variants), string(modifiers), it.Quantity,
			it.UnitPrice, it.Total, it.Total, it.KitchenNotes, it.Station, it.XPEarned)
		if err != nil {
			return err
		}
	}
	return nil
}

// insertHistory writes the creation history row; the TS ignores its error.
func insertHistory(ctx context.Context, q database.Querier, orderID, status, notes string) {
	_ = savepoint(ctx, q, func(q database.Querier) error {
		_, err := q.Exec(ctx, `INSERT INTO pos.pos_order_status_history (order_id, from_status, to_status, changed_by, notes)
		   VALUES ($1, NULL, $2::pos_order_status, $3, $4)`, orderID, status, fallbackCashierID, notes)
		return err
	})
}

// orderRow is OrderRow of GET /api/table-order/orders/[id].
type orderRow struct {
	ID                      string
	OrderNumber             string
	QueueNumber             *string
	Status, PaymentStatus   string
	PaymentMethod           *string
	OrderType               *string
	Subtotal, Discount      float64
	Tax, Service, Other     float64
	Total                   float64
	Breakdown               []byte
	SpecialRequests         *string
	OrderedAt               *time.Time
	XenditQRID, XenditExtID *string
	ProofUploadedAt         *time.Time
}

func loadOrder(ctx context.Context, q database.Querier, id string) (*orderRow, error) {
	var o orderRow
	err := q.QueryRow(ctx, `SELECT id::text, order_number, queue_number, status::text, payment_status::text,
            payment_method::text, order_type::text, subtotal::float8, COALESCE(discount_amount, 0)::float8,
            tax_amount::float8, service_charge_amount::float8, COALESCE(other_charges_amount, 0)::float8,
            total_amount::float8, charges_breakdown, special_requests, ordered_at, xendit_qr_id, xendit_external_id,
            payment_proof_uploaded_at
     FROM pos.pos_orders WHERE id = $1 LIMIT 1`, id).Scan(&o.ID, &o.OrderNumber, &o.QueueNumber, &o.Status,
		&o.PaymentStatus, &o.PaymentMethod, &o.OrderType, &o.Subtotal, &o.Discount, &o.Tax, &o.Service, &o.Other,
		&o.Total, &o.Breakdown, &o.SpecialRequests, &o.OrderedAt, &o.XenditQRID, &o.XenditExtID, &o.ProofUploadedAt)
	if database.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &o, nil
}

// itemRow is ItemRow of the status route.
type itemRow struct {
	ID, ProductName     string
	Variants, Modifiers []byte
	Quantity            float64
	UnitPrice, Total    float64
	Station             *string
	KitchenStatus       *string
	XPEarned            int
}

func loadItems(ctx context.Context, q database.Querier, orderID string) ([]itemRow, error) {
	rows, err := q.Query(ctx, `SELECT id::text, product_name, variants, modifiers, COALESCE(quantity, 0)::float8,
            unit_price::float8, total_amount::float8, station, kitchen_status::text, COALESCE(xp_earned, 0)::int
     FROM pos.pos_order_items WHERE order_id = $1 ORDER BY created_at, id`, orderID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (itemRow, error) {
		var it itemRow
		err := r.Scan(&it.ID, &it.ProductName, &it.Variants, &it.Modifiers, &it.Quantity, &it.UnitPrice, &it.Total,
			&it.Station, &it.KitchenStatus, &it.XPEarned)
		return it, err
	})
}

// setXenditIDs stores the QR id and/or reference (nil leaves a column as is).
func setXenditIDs(ctx context.Context, q database.Querier, orderID string, qrID, externalID *string) error {
	_, err := q.Exec(ctx, `UPDATE pos.pos_orders
	   SET xendit_qr_id = COALESCE($2, xendit_qr_id), xendit_external_id = COALESCE($3, xendit_external_id), updated_at = now()
	 WHERE id = $1`, orderID, qrID, externalID)
	return err
}

func setSpecialRequests(ctx context.Context, q database.Querier, orderID, value string) {
	_, _ = q.Exec(ctx, `UPDATE pos.pos_orders SET special_requests = $2, updated_at = now() WHERE id = $1`, orderID, value)
}

// settleRow is what settleOrderQrisPayment reads of the order.
type settleRow struct {
	PaymentStatus, CashierID        string
	Total                           float64
	CustomerID, CompanyID, BranchID *string
	QueueNumber, CheckoutID         *string
}

// lockSettleRow reads the order for settlement (nil when missing), locking
// it so a concurrent poll and webhook settle once.
func lockSettleRow(ctx context.Context, q database.Querier, orderID string) (*settleRow, error) {
	var s settleRow
	err := q.QueryRow(ctx, `SELECT payment_status::text, COALESCE(cashier_id::text, ''), COALESCE(total_amount, 0)::float8,
            customer_id::text, company_id::text, branch_id::text, queue_number, checkout_id::text
     FROM pos.pos_orders WHERE id = $1 FOR UPDATE`, orderID).Scan(&s.PaymentStatus, &s.CashierID, &s.Total,
		&s.CustomerID, &s.CompanyID, &s.BranchID, &s.QueueNumber, &s.CheckoutID)
	if database.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &s, nil
}

func markPaidByQris(ctx context.Context, q database.Querier, orderID string, total float64) error {
	_, err := q.Exec(ctx, `UPDATE pos.pos_orders
	   SET payment_status = 'paid', payment_method = 'qris', amount_paid = $2, updated_at = now() WHERE id = $1`, orderID, total)
	return err
}

// setQueueNumber stores an allocated queue number; ensureQueueNumber
// ignores a failed update.
func setQueueNumber(ctx context.Context, q database.Querier, orderID, queue string) {
	_ = savepoint(ctx, q, func(q database.Querier) error {
		_, err := q.Exec(ctx, `UPDATE pos.pos_orders SET queue_number = $2 WHERE id = $1`, orderID, queue)
		return err
	})
}

// xpItems reads the lines awardCrmXpForPosOrder gets on settlement.
func xpItems(ctx context.Context, q database.Querier, orderID string) ([]ports.XPItem, error) {
	rows, err := q.Query(ctx, `SELECT product_id::text, quantity::float8, unit_price::float8, subtotal::float8, total_amount::float8
     FROM pos.pos_order_items WHERE order_id = $1`, orderID)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, func(r pgx.CollectableRow) (ports.XPItem, error) {
		var it ports.XPItem
		var productID *string
		err := r.Scan(&productID, &it.Quantity, &it.UnitPrice, &it.Subtotal, &it.TotalAmount)
		if productID != nil {
			it.ProductID = *productID
		}
		return it, err
	})
}
