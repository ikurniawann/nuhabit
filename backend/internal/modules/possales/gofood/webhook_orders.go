package gofood

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/possales/gofood/domain"
	"nuhabit/backend/internal/platform/database"
)

// The GoBiz webhook (integrations module) records GoFood orders through
// these writes of lib/gobiz/service.ts: the gofood_orders upsert of one
// event, the auto-accept claim and the cancel/complete of the POS order.
// They run on the caller's database because the webhook answer reports
// their result.

// OrderUpsert is the gofood_orders write of upsertGofoodOrderFromEvent.
type OrderUpsert struct {
	Status           string
	GofoodOrderID    string
	GofoodOrderType  string
	OutletID         *string
	OrderTotal       float64
	Currency         string
	CustomerName     *string
	DriverName       *string
	Pin              *string
	CutleryRequested bool
	TakeawayCharges  float64
	CancelReason     *string
	// Items and Unmapped are JSON arrays; nil on an update keeps the stored ones.
	Items, Unmapped []byte
	RawPayload      []byte
	// AwaitingSince and Venue are used on insert only.
	AwaitingSince *time.Time
	Venue         Venue
}

// UpsertedOrder is the part of the written row the webhook reads back.
type UpsertedOrder struct {
	ID              string
	GofoodOrderID   string
	GofoodOrderType string
	Status          string
	PosOrderID      *string
	CancelReason    *string
}

// StoredOrder is a gofood_orders row found by its GoFood order number.
type StoredOrder struct {
	ID     string
	Status string
	// HasItems is false while items is still the empty array.
	HasItems bool
}

const upsertReturning = ` RETURNING id::text, gofood_order_id, gofood_order_type, status, pos_order_id::text, cancel_reason`

func scanUpserted(row pgx.Row) (*UpsertedOrder, error) {
	var o UpsertedOrder
	if err := row.Scan(&o.ID, &o.GofoodOrderID, &o.GofoodOrderType, &o.Status, &o.PosOrderID, &o.CancelReason); err != nil {
		return nil, err
	}
	return &o, nil
}

// FindByGofoodID is the stored order of a GoFood order number (nil = none).
func FindByGofoodID(ctx context.Context, q database.Querier, gofoodOrderID string) (*StoredOrder, error) {
	var o StoredOrder
	err := q.QueryRow(ctx, `SELECT id::text, status, items <> '[]'::jsonb FROM pos.gofood_orders WHERE gofood_order_id = $1`, gofoodOrderID).
		Scan(&o.ID, &o.Status, &o.HasItems)
	if database.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &o, nil
}

// InsertOrder stores the first event of a GoFood order.
func InsertOrder(ctx context.Context, q database.Querier, w OrderUpsert) (*UpsertedOrder, error) {
	return scanUpserted(q.QueryRow(ctx, `INSERT INTO pos.gofood_orders (
         gofood_order_id, gofood_order_type, outlet_id, status, order_total, currency,
         customer_name, driver_name, pin, cutlery_requested, takeaway_charges,
         items, unmapped_items, raw_payload, awaiting_since, cancel_reason, company_id, branch_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`+upsertReturning,
		w.GofoodOrderID, w.GofoodOrderType, w.OutletID, w.Status, w.OrderTotal, w.Currency,
		w.CustomerName, w.DriverName, w.Pin, w.CutleryRequested, w.TakeawayCharges,
		w.Items, w.Unmapped, w.RawPayload, w.AwaitingSince, w.CancelReason, w.Venue.CompanyID, w.Venue.BranchID))
}

// UpdateOrder applies a later event: status, the driver and customer
// details it carries, and the first-reached timestamps.
func UpdateOrder(ctx context.Context, q database.Querier, id string, w OrderUpsert) (*UpsertedOrder, error) {
	return scanUpserted(q.QueryRow(ctx, `UPDATE pos.gofood_orders SET
       status = $2,
       driver_name = COALESCE($3, driver_name),
       customer_name = COALESCE($4, customer_name),
       pin = COALESCE($5, pin),
       order_total = CASE WHEN $6 > 0 THEN $6 ELSE order_total END,
       items = CASE WHEN $7::jsonb IS NOT NULL THEN $7::jsonb ELSE items END,
       unmapped_items = CASE WHEN $8::jsonb IS NOT NULL THEN $8::jsonb ELSE unmapped_items END,
       raw_payload = $9,
       awaiting_since = CASE WHEN $2 = 'awaiting_acceptance' AND awaiting_since IS NULL THEN now() ELSE awaiting_since END,
       cancelled_at = CASE WHEN $2 = 'cancelled' AND cancelled_at IS NULL THEN now() ELSE cancelled_at END,
       completed_at = CASE WHEN $2 = 'completed' AND completed_at IS NULL THEN now() ELSE completed_at END,
       accepted_at = CASE WHEN $2 = 'accepted' AND accepted_at IS NULL THEN now() ELSE accepted_at END,
       cancel_reason = COALESCE($10, cancel_reason),
       updated_at = now()
     WHERE id = $1`+upsertReturning,
		id, w.Status, w.DriverName, w.CustomerName, w.Pin, int64(w.OrderTotal), w.Items, w.Unmapped, w.RawPayload, w.CancelReason))
}

// ClaimAutoAccept moves awaiting_acceptance to accepted atomically, so a
// duplicate event cannot accept twice; false when another claim won.
func ClaimAutoAccept(ctx context.Context, q database.Querier, id string) (bool, error) {
	tag, err := q.Exec(ctx, `UPDATE pos.gofood_orders SET status = 'accepted', accepted_at = now(), updated_at = now()
     WHERE id = $1 AND status = 'awaiting_acceptance'`, id)
	return tag.RowsAffected() > 0, err
}

// ReleaseAutoAccept undoes the claim after GoBiz refused, keeping the error.
func ReleaseAutoAccept(ctx context.Context, q database.Querier, id, message string) error {
	_, err := q.Exec(ctx, `UPDATE pos.gofood_orders SET status = 'awaiting_acceptance', accepted_at = NULL, last_error = $2, updated_at = now() WHERE id = $1`, id, message)
	return err
}

// SetPosOrderStatus is setPosOrderStatus: cancel or complete the linked
// POS order unless it is already final, with a status-history row stamped
// at, in one transaction.
func SetPosOrderStatus(ctx context.Context, db database.DB, posOrderID, status, note string, at time.Time) error {
	return database.WithTx(ctx, db, func(tx pgx.Tx) error {
		var current string
		err := tx.QueryRow(ctx, `SELECT status::text FROM pos.pos_orders WHERE id = $1 FOR UPDATE`, posOrderID).Scan(&current)
		if database.IsNoRows(err) {
			return nil
		}
		if err != nil || domain.TerminalPosStatus(current) {
			return err
		}
		stamp := "completed_at"
		if status == "cancelled" {
			stamp = "cancelled_at"
		}
		if _, err := tx.Exec(ctx, `UPDATE pos.pos_orders SET status = $2::pos_order_status, `+stamp+` = now(), updated_at = now() WHERE id = $1`,
			posOrderID, status); err != nil {
			return err
		}
		if status == "cancelled" {
			if _, err := tx.Exec(ctx, `UPDATE pos.pos_order_items SET kitchen_status = 'cancelled', updated_at = now() WHERE order_id = $1`, posOrderID); err != nil {
				return err
			}
		}
		_, err = tx.Exec(ctx, `INSERT INTO pos.pos_order_status_history (order_id, from_status, to_status, changed_by, notes, changed_at)
			VALUES ($1, $2::pos_order_status, $3::pos_order_status, $4, $5, $6)`,
			posOrderID, current, status, fallbackCashierID, note, at)
		return err
	})
}
