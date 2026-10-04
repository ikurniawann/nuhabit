package posops

import (
	"context"

	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/platform/database"
)

// reservationFilter is GET /api/pos/reservations' filters (nil = none).
type reservationFilter struct {
	Date, Status, TableID *string
}

func listReservations(ctx context.Context, q database.Querier, f reservationFilter) ([]*Obj, error) {
	var clauses []string
	var args []any
	add := func(column string, v string, cast string) {
		args = append(args, v)
		clauses = append(clauses, column+" = $"+strconv.Itoa(len(args))+cast)
	}
	if f.Date != nil {
		add("reservation_date", *f.Date, "::text::date")
	}
	if f.Status != nil {
		add("status", *f.Status, "")
	}
	if f.TableID != nil {
		add("table_id", *f.TableID, "::text::uuid")
	}
	where := ""
	if len(clauses) > 0 {
		where = " WHERE " + strings.Join(clauses, " AND ")
	}
	return QueryObjs(ctx, q, `SELECT * FROM pos.pos_reservations`+where+` ORDER BY reservation_date ASC, time_slot ASC`, args...)
}

// tableNumberOf is the embedded {table_number} of a reservation, nil when
// the lookup finds nothing or fails (the TS ignores the error).
func tableNumberOf(ctx context.Context, q database.Querier, tableID any) *Obj {
	row, err := QueryObj(ctx, q, `SELECT table_number FROM pos.pos_tables WHERE id = $1::text::uuid`, tableID)
	if err != nil {
		return nil
	}
	return row
}

// reservationTaken reports a non-cancelled reservation of the table in the
// slot; a failing lookup counts as free, like the TS.
func reservationTaken(ctx context.Context, q database.Querier, tableID, date any, slot string) bool {
	row, err := QueryObj(ctx, q, `SELECT id FROM pos.pos_reservations
		WHERE table_id = $1::text::uuid AND reservation_date = $2::text::date AND time_slot = $3::text::time
		  AND status <> 'cancelled'`, tableID, date, slot)
	return err == nil && row != nil
}

// newReservation is the insert payload of POST /api/pos/reservations;
// values are node-postgres text parameters.
type newReservation struct {
	TableID, CustomerID, CustomerName, CustomerPhone any
	Date, TimeSlot, Duration, PaxCount               any
	SpecialRequests                                  any
	Deposit                                          float64
	Notes                                            any
}

func insertReservation(ctx context.Context, q database.Querier, n newReservation) (*Obj, error) {
	return QueryObj(ctx, q, `INSERT INTO pos.pos_reservations
		(table_id, customer_id, customer_name, customer_phone, reservation_date, time_slot, duration_minutes,
		 pax_count, special_requests, deposit_amount, status, notes)
		VALUES ($1::text::uuid, $2::text::uuid, $3, $4, $5::text::date, $6::text::time, $7::text::int,
		 $8::text::int, $9, $10, 'pending', $11)
		RETURNING *`,
		n.TableID, n.CustomerID, n.CustomerName, n.CustomerPhone, n.Date, n.TimeSlot, n.Duration,
		n.PaxCount, n.SpecialRequests, n.Deposit, n.Notes)
}

// assignQueueNumber gives the reservation the next per-date queue number
// under a per-date advisory lock; the unique index is the last fence.
func assignQueueNumber(ctx context.Context, q database.Querier, id string, date any) (*int, error) {
	if _, err := q.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext('pos-res-queue-' || $1::text::date::text))`, date); err != nil {
		return nil, err
	}
	var n *int
	err := q.QueryRow(ctx, `UPDATE pos.pos_reservations r
		   SET queue_number = sub.next_number
		  FROM (
		    SELECT COALESCE(MAX(queue_number), 0) + 1 AS next_number
		      FROM pos.pos_reservations
		     WHERE reservation_date::date = $2::text::date
		       AND id <> $1::uuid
		  ) sub
		 WHERE r.id = $1::uuid
		 RETURNING r.queue_number`, id, date).Scan(&n)
	if database.IsNoRows(err) {
		return nil, nil
	}
	return n, err
}

// updateReservation writes the given columns (in order) and returns the
// row; with no column it fails like the QueryBuilder's empty SET.
func updateReservation(ctx context.Context, q database.Querier, id string, cols []string, vals []any) (*Obj, error) {
	if len(cols) == 0 {
		return nil, plainError(`syntax error at or near "WHERE"`)
	}
	sets := make([]string, len(cols))
	args := []any{id}
	for i, c := range cols {
		args = append(args, vals[i])
		sets[i] = c + " = $" + strconv.Itoa(len(args))
	}
	return QueryObj(ctx, q, `UPDATE pos.pos_reservations SET `+strings.Join(sets, ", ")+
		` WHERE id = $1::text::uuid RETURNING *`, args...)
}

// setTableStatus frees or occupies a table. The TS ignores its errors, so
// it runs in a savepoint that a failure rolls back alone.
func setTableStatus(ctx context.Context, db database.DB, tableID any, status string, clearOrder bool) {
	sql := `UPDATE pos.pos_tables SET status = $2::pos_table_status, updated_at = now() WHERE id = $1::text::uuid`
	if clearOrder {
		sql = `UPDATE pos.pos_tables SET status = $2::pos_table_status, current_order_id = NULL WHERE id = $1::text::uuid`
	}
	_ = database.WithTx(ctx, db, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx, sql, tableID, status)
		return err
	})
}

// seatReservationRow is the reservation the seat route validates.
type seatReservationRow struct {
	Status, TableID, CustomerID, CustomerName, TimeSlot *string
	PaxCount                                            *int
}

func loadReservationForSeat(ctx context.Context, q database.Querier, id string) (*seatReservationRow, error) {
	var r seatReservationRow
	err := q.QueryRow(ctx, `SELECT status, table_id::text, customer_id::text, customer_name, time_slot::text, pax_count
		FROM pos.pos_reservations WHERE id = $1::text::uuid`, id).
		Scan(&r.Status, &r.TableID, &r.CustomerID, &r.CustomerName, &r.TimeSlot, &r.PaxCount)
	if err != nil {
		return nil, err
	}
	return &r, nil
}

// seatTableRow is the table the seat route validates.
type seatTableRow struct {
	IsActive *bool
}

func loadTableForSeat(ctx context.Context, q database.Querier, id string) (*seatTableRow, error) {
	var t seatTableRow
	if err := q.QueryRow(ctx, `SELECT is_active FROM pos.pos_tables WHERE id = $1::text::uuid`, id).Scan(&t.IsActive); err != nil {
		return nil, err
	}
	return &t, nil
}

func markSeated(ctx context.Context, q database.Querier, id, tableID string) (*Obj, error) {
	return QueryObj(ctx, q, `UPDATE pos.pos_reservations SET status = 'seated', table_id = $2::text::uuid, updated_at = now()
		WHERE id = $1::text::uuid RETURNING *`, id, tableID)
}

// plainError is an error whose message the route renders as-is.
type plainError string

func (e plainError) Error() string { return string(e) }
