package posops

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/posops/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/members"
)

// ListReservations mirrors GET /api/pos/reservations: rows by date and
// slot, the date as YYYY-MM-DD, with the table number and the customer.
func (s *Service) ListReservations(ctx context.Context, f reservationFilter) ([]*Obj, error) {
	rows, err := listReservations(ctx, s.db, f)
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		if d, ok := row.Get("reservation_date").(httpx.JSTime); ok {
			row.Set("reservation_date", time.Time(d).UTC().Format("2006-01-02"))
		}
		s.embedReservationRefs(ctx, row)
	}
	return rows, nil
}

// embedReservationRefs adds table {table_number} and customer {name, phone}.
func (s *Service) embedReservationRefs(ctx context.Context, row *Obj) {
	var table, customer any
	if id := row.Get("table_id"); domain.Truthy(id) {
		if t := tableNumberOf(ctx, s.db, id); t != nil {
			table = t
		}
	}
	if id, ok := row.Get("customer_id").(string); ok && id != "" {
		if m, err := members.Get(ctx, s.db, id); err == nil && m != nil {
			customer = NewObj("name", m.Name, "phone", m.Phone)
		}
	}
	row.Set("table", table).Set("customer", customer)
}

// CreateReservation mirrors POST /api/pos/reservations; the queue number is
// assigned in its own transaction and a failure there keeps the booking.
func (s *Service) CreateReservation(ctx context.Context, body any) (*Obj, error) {
	slot := domain.NormalizeTimeSlot(field(body, "time_slot"))
	date := field(body, "reservation_date")
	pax := field(body, "pax_count")
	if !domain.Truthy(date) || slot == "" || !domain.Truthy(pax) {
		return nil, fail(http.StatusBadRequest, "Date, time slot, and party size are required")
	}
	name := field(body, "customer_name")
	if !domain.Truthy(name) || domain.TrimJS(domain.String(name)) == "" {
		return nil, fail(http.StatusBadRequest, "Customer name is required")
	}
	tableID := field(body, "table_id")
	if domain.Truthy(tableID) && reservationTaken(ctx, s.db, nodeParam(tableID), nodeParam(date), slot) {
		return nil, fail(http.StatusConflict, "Table is already reserved for this time slot")
	}

	n := newReservation{
		TableID:      truthyParam(tableID),
		CustomerID:   truthyParam(field(body, "customer_id")),
		CustomerName: domain.TrimJS(domain.String(name)),
		Date:         nodeParam(date),
		TimeSlot:     slot,
		Duration:     nodeParam(defaultTo(field(body, "duration_minutes"), json.Number("120"))),
		PaxCount:     domain.FormatNumber(domain.Number(pax)),
		Notes:        truthyParam(field(body, "notes")),
		Deposit:      domain.ToNumber(defaultTo(field(body, "deposit_amount"), json.Number("0"))),
	}
	if phone := field(body, "customer_phone"); domain.Truthy(phone) {
		n.CustomerPhone = domain.TrimJS(domain.String(phone))
	}
	n.SpecialRequests = truthyParam(field(body, "special_requests"))

	row, err := insertReservation(ctx, s.db, n)
	if err != nil {
		return nil, err
	}
	var queue *int
	err = database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		queue, err = assignQueueNumber(ctx, tx, row.Str("id"), nodeParam(date))
		return err
	})
	if err != nil {
		s.log.ErrorContext(ctx, "[pos] reservation queue number error", "error", err)
	} else if queue != nil {
		row.Set("queue_number", *queue)
	}
	s.embedReservationRefs(ctx, row)
	return row, nil
}

// truthyParam is `value || null` as a query parameter.
func truthyParam(v any) any {
	if !domain.Truthy(v) {
		return nil
	}
	return nodeParam(v)
}

// defaultTo is a destructuring default: only undefined takes it.
func defaultTo(v, def any) any {
	if domain.IsUndef(v) {
		return def
	}
	return v
}

// UpdateReservation mirrors PATCH /api/pos/reservations/{id}: truthy
// fields change, the status stamps its time, and the table follows.
func (s *Service) UpdateReservation(ctx context.Context, id string, body any) (*Obj, error) {
	status := field(body, "status")
	var cols []string
	var vals []any
	for _, key := range []string{"status", "notes", "special_requests"} {
		if v := field(body, key); domain.Truthy(v) {
			cols, vals = append(cols, key), append(vals, nodeParam(v))
		}
	}
	if col := domain.ReservationStampColumn(status); col != "" {
		cols, vals = append(cols, col), append(vals, s.now())
	}
	row, err := updateReservation(ctx, s.db, id, cols, vals)
	if err != nil {
		return nil, err
	}
	if row == nil {
		return nil, plainError("No rows found")
	}
	if tableStatus := domain.ReservationTableStatus(status); tableStatus != "" && domain.Truthy(row.Get("table_id")) {
		setTableStatus(ctx, s.db, row.Get("table_id"), tableStatus, true)
	}
	return row, nil
}

// SeatReservation mirrors POST /api/pos/reservations/{id}/seat: a pending
// or confirmed reservation opens an empty dine-in bill on a free table.
// The bill, the reservation and the table change in one transaction (the
// TS wrote them one by one), because the response returns the new order.
func (s *Service) SeatReservation(ctx context.Context, cashierID, id string, body any) (*Obj, error) {
	res, err := loadReservationForSeat(ctx, s.db, id)
	if err != nil {
		return nil, fail(http.StatusNotFound, "Reservation not found")
	}
	status := ""
	if res.Status != nil {
		status = *res.Status
	}
	if status := strings.ToLower(status); status != "pending" && status != "confirmed" {
		return nil, fail(http.StatusBadRequest, "Only pending or confirmed reservations can be seated")
	}
	if body == nil { // a JSON null body: body.table_id throws
		return nil, &jsError{msg: "Cannot read properties of null (reading 'table_id')"}
	}
	requested := field(body, "table_id")
	tableID := ""
	switch {
	case domain.Truthy(requested):
		tableID = domain.TrimJS(domain.String(requested))
	case res.TableID != nil:
		tableID = domain.TrimJS(*res.TableID)
	}
	if tableID == "" {
		return nil, fail(http.StatusBadRequest, "table_id is required")
	}
	table, err := loadTableForSeat(ctx, s.db, tableID)
	if err != nil {
		return nil, fail(http.StatusNotFound, "Table not found")
	}
	if table.IsActive != nil && !*table.IsActive {
		return nil, fail(http.StatusBadRequest, "Table is inactive")
	}
	if busy, err := s.ports.Sales.TableHasActiveOrder(ctx, s.db, tableID, ""); err == nil && busy {
		return nil, fail(http.StatusConflict, "Table is occupied")
	}
	number, err := s.ports.Sales.NextOrderNumber(ctx, s.db)
	if err != nil {
		return nil, fail(http.StatusInternalServerError, "Failed to generate order number")
	}

	var out *Obj
	err = database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
		order, err := s.ports.Sales.OpenTableBill(ctx, tx, OpenTableBill{
			OrderNumber: number, CustomerID: nonEmptyPtr(res.CustomerID), CashierID: cashierID, TableID: tableID,
			GuestCount: domain.NormalizeGuestCount(res.PaxCount), Notes: domain.SeatNotes(res.CustomerName, res.TimeSlot),
		})
		if err != nil {
			return fail(http.StatusInternalServerError, pgMessage(err))
		}
		reservation, err := markSeated(ctx, tx, id, tableID)
		if err != nil {
			return err
		}
		setTableStatus(ctx, tx, tableID, "occupied", false)
		out = NewObj("reservation", reservation, "order", order, "message", "Guest seated")
		return nil
	})
	return out, err
}
