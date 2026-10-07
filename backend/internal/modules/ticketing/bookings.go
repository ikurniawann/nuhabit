package ticketing

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strings"

	"github.com/jackc/pgx/v5"

	contract "nuhabit/backend/internal/contracts/ticketing"
	"nuhabit/backend/internal/modules/ticketing/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/outbox"
)

// Website bookings at the dashboard and the loket (bookings-admin-server.ts):
// list, lookup by code, detail, refund note / alert, cancel and WhatsApp
// resend. Releasing the promo a cancelled or expired booking used belongs
// to the promo context, so it is an outbox event.

const bookingNotFound = "Booking tidak ditemukan"

// ListBookings is listBookings.
func (s *Service) ListBookings(ctx context.Context, v Venue, date, status, q string, page, limit float64) (listResult, error) {
	conds := []string{"b.branch_id = $1", "b.company_id = $2"}
	args := []any{v.BranchID, v.CompanyID}
	if domain.IsValidCalendarDate(date) {
		args = append(args, date)
		conds = append(conds, fmt.Sprintf("b.visit_date = $%d", len(args)))
	}
	if slices.Contains(domain.BookingStatuses, status) {
		args = append(args, status)
		conds = append(conds, fmt.Sprintf("b.status = $%d", len(args)))
	}
	if q != "" {
		args = append(args, "%"+q+"%")
		n := len(args)
		conds = append(conds, fmt.Sprintf("(b.booking_code ILIKE $%d OR b.customer_name ILIKE $%d OR b.customer_phone ILIKE $%d)", n, n, n))
	}
	lim, off := pageArgs(page, limit)
	args = append(args, lim, off)
	rows, err := queryRows(ctx, s.db, fmt.Sprintf(`SELECT b.id, b.booking_code, b.visit_date::text AS visit_date,
		  b.customer_name, b.customer_phone, b.status, b.total,
		  b.paid_at::text AS paid_at, b.used_at::text AS used_at,
		  b.visit_id, b.refund_note, b.webhook_alert,
		  b.created_at::text AS created_at,
		  COUNT(*) OVER() AS total_count
		FROM ticketing.ticket_bookings b
		WHERE %s
		ORDER BY b.created_at DESC
		LIMIT $%d OFFSET $%d`, strings.Join(conds, " AND "), len(args)-1, len(args)), args...)
	if err != nil {
		return listResult{}, err
	}
	res := splitTotal(rows)
	for _, r := range res.Items {
		r.ToNum("total")
	}
	return res, nil
}

// bookingItems is loadBookingItems; full keeps the variant and product ids
// (the lookup), otherwise publicItem's shape.
func bookingItems(ctx context.Context, q database.Querier, bookingID string, full bool) ([]*Row, error) {
	rows, err := queryRows(ctx, q, `SELECT variant_id, ticket_product_id, product_name, variant_name,
		  qty, unit_price, season_kind, subtotal
		FROM ticketing.ticket_booking_items
		WHERE booking_id = $1
		ORDER BY product_name, variant_name`, bookingID)
	if err != nil {
		return nil, err
	}
	for _, r := range rows {
		r.ToNum("unit_price", "subtotal")
		if !full {
			r.Del("variant_id")
			r.Del("ticket_product_id")
		}
	}
	return rows, nil
}

// expireBookingIfDue is expireBookingIfDue: a stale unpaid booking turns
// 'kedaluwarsa' when touched, and its promo hold is released.
func (s *Service) expireBookingIfDue(ctx context.Context, v Venue, bookingID, bookingCode string) (bool, error) {
	expired := false
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `UPDATE ticketing.ticket_bookings
			SET status = 'kedaluwarsa', updated_at = now()
			WHERE id = $1 AND status = 'menunggu-bayar'
			  AND expires_at IS NOT NULL AND expires_at < now()`, bookingID)
		if err != nil || tag.RowsAffected() == 0 {
			return err
		}
		expired = true
		return publishRelease(ctx, tx, contract.TopicBookingExpired, v, bookingID, bookingCode)
	})
	return expired, err
}

func publishRelease(ctx context.Context, q database.Querier, topic string, v Venue, bookingID, bookingCode string) error {
	return outbox.Publish(ctx, q, topic, bookingID, contract.BookingReleased{
		BookingID: bookingID, BookingCode: bookingCode, CompanyID: v.CompanyID, BranchID: v.BranchID,
		PromoContextType: contract.PromoContextTicketBooking,
	})
}

func forfeitDays(ctx context.Context, q database.Querier, v Venue) (*int, int, error) {
	var days *int
	grace := 30
	err := q.QueryRow(ctx, `SELECT booking_forfeit_days, slot_grace_minutes FROM ticketing.ticket_settings
		WHERE branch_id = $1 AND company_id = $2`, v.BranchID, v.CompanyID).Scan(&days, &grace)
	if err != nil && !database.IsNoRows(err) {
		return nil, 0, err
	}
	return days, grace, nil
}

// LookupBooking is lookupBooking: the loket scans or types a code. Only
// lazy expiry and lazy forfeit change state.
func (s *Service) LookupBooking(ctx context.Context, v Venue, code string) (*Row, error) {
	b, err := queryRow(ctx, s.db, `SELECT id, booking_code, visit_date::text AS visit_date, customer_name,
		  customer_phone, status, total, paid_at::text AS paid_at,
		  used_at::text AS used_at, visit_id, gift_recipient_name
		FROM ticketing.ticket_bookings
		WHERE branch_id = $1 AND company_id = $2 AND booking_code = $3`, v.BranchID, v.CompanyID, code)
	if err != nil {
		return nil, err
	}
	if b == nil {
		return nil, httpx.NotFound("Booking " + code + " tidak ditemukan di venue ini")
	}
	id, visitDate := b.Str("id"), b.Str("visit_date")
	status := b.Str("status")
	if status == "menunggu-bayar" {
		expired, err := s.expireBookingIfDue(ctx, v, id, b.Str("booking_code"))
		if err != nil {
			return nil, err
		}
		if expired {
			status = "kedaluwarsa"
		}
	}
	days, _, err := forfeitDays(ctx, s.db, v)
	if err != nil {
		return nil, err
	}
	today := s.today()
	if status == "terbayar" && domain.IsForfeitDue(visitDate, today, days) {
		tag, err := s.db.Exec(ctx, `UPDATE ticketing.ticket_bookings
			SET status = 'hangus', forfeited_at = now(), updated_at = now()
			WHERE id = $1 AND status = 'terbayar' AND visit_id IS NULL`, id)
		if err != nil {
			return nil, err
		}
		if tag.RowsAffected() > 0 {
			status = "hangus"
		}
	}
	items, err := bookingItems(ctx, s.db, id, true)
	if err != nil {
		return nil, err
	}
	guests, err := queryRows(ctx, s.db, `SELECT g.id, g.guest_name, g.position, g.variant_id,
		  i.product_name, i.variant_name
		FROM ticketing.ticket_booking_guests g
		JOIN ticketing.ticket_booking_items i ON i.id = g.booking_item_id
		WHERE g.booking_id = $1
		ORDER BY g.position`, id)
	if err != nil {
		return nil, err
	}
	return object(
		"id", id,
		"booking_code", b.Get("booking_code"),
		"visit_date", visitDate,
		"customer_name", b.Get("customer_name"),
		"customer_phone", b.Get("customer_phone"),
		"gift_recipient_name", b.Get("gift_recipient_name"),
		"status", status,
		"total", b.Num("total"),
		"paid_at", b.Get("paid_at"),
		"used_at", b.Get("used_at"),
		"visit_id", b.Get("visit_id"),
		"redeemable", status == "terbayar" && domain.RedeemWindowStatus(visitDate, today, days) == domain.RedeemAllowed,
		"today", today,
		"items", items,
		"guests", guests,
	), nil
}

// BookingDetail is getBookingDetail.
func (s *Service) BookingDetail(ctx context.Context, v Venue, id string) (*Row, error) {
	b, err := queryRow(ctx, s.db, `SELECT id, booking_code, visit_date::text AS visit_date, customer_name,
		  customer_phone, status, total, xendit_invoice_url,
		  paid_at::text AS paid_at, expires_at::text AS expires_at,
		  used_at::text AS used_at, visit_id, refund_note, webhook_alert,
		  created_at::text AS created_at
		FROM ticketing.ticket_bookings
		WHERE id = $1 AND branch_id = $2 AND company_id = $3`, id, v.BranchID, v.CompanyID)
	if err != nil {
		return nil, err
	}
	if b == nil {
		return nil, httpx.NotFound(bookingNotFound)
	}
	items, err := bookingItems(ctx, s.db, id, false)
	if err != nil {
		return nil, err
	}
	guests, err := queryRows(ctx, s.db, `SELECT g.guest_name, g.position, i.variant_name
		FROM ticketing.ticket_booking_guests g
		JOIN ticketing.ticket_booking_items i ON i.id = g.booking_item_id
		WHERE g.booking_id = $1
		ORDER BY g.position`, id)
	if err != nil {
		return nil, err
	}
	return b.ToNum("total").Set("items", items).Set("guests", guests), nil
}

// UpdateBookingNotes is updateBookingNotes: store a manual refund note
// and/or clear the webhook alert.
func (s *Service) UpdateBookingNotes(ctx context.Context, v Venue, id string, refundNote *string, clearAlert bool) (string, error) {
	sets := []string{"updated_at = now()"}
	args := []any{id, v.BranchID, v.CompanyID}
	if refundNote != nil {
		args = append(args, *refundNote)
		sets = append(sets, fmt.Sprintf("refund_note = $%d", len(args)))
	}
	if clearAlert {
		sets = append(sets, "webhook_alert = NULL")
	}
	var updated string
	err := s.db.QueryRow(ctx, `UPDATE ticketing.ticket_bookings SET `+strings.Join(sets, ", ")+`
		WHERE id = $1 AND branch_id = $2 AND company_id = $3
		RETURNING id::text`, args...).Scan(&updated)
	if database.IsNoRows(err) {
		return "", httpx.NotFound(bookingNotFound)
	}
	return updated, err
}

// CancelBooking is cancelBooking: only unpaid or paid bookings cancel, a
// paid one needs a refund note, and the status transition is atomic (a
// lost race with the webhook or a redeem is a 409).
func (s *Service) CancelBooking(ctx context.Context, v Venue, id string, refundNote *string) (string, error) {
	var status, code string
	err := s.db.QueryRow(ctx, `SELECT status, booking_code FROM ticketing.ticket_bookings
		WHERE id = $1 AND branch_id = $2 AND company_id = $3`, id, v.BranchID, v.CompanyID).Scan(&status, &code)
	if database.IsNoRows(err) {
		return "", httpx.NotFound(bookingNotFound)
	}
	if err != nil {
		return "", err
	}
	if status == "terbayar" && refundNote == nil {
		return "", httpx.BadRequest("Booking sudah terbayar — wajib isi catatan refund (uang dikembalikan di luar sistem)")
	}
	err = s.inTx(ctx, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx, `UPDATE ticketing.ticket_bookings
			SET status = 'dibatalkan', refund_note = COALESCE($4, refund_note), updated_at = now()
			WHERE id = $1 AND branch_id = $2 AND company_id = $3
			  AND status IN ('menunggu-bayar', 'terbayar')`, id, v.BranchID, v.CompanyID, refundNote)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return httpx.Conflict("Booking " + code + " tidak bisa dibatalkan dari status sekarang")
		}
		return publishRelease(ctx, tx, contract.TopicBookingCancelled, v, id, code)
	})
	return code, err
}

// ResendBookingWa is resendBookingWa: the paid message again (and the gift
// e-ticket to its recipient); only paid bookings.
func (s *Service) ResendBookingWa(ctx context.Context, v Venue, id string) (code, phone string, err error) {
	var b domain.PaidBooking
	var status string
	err = s.db.QueryRow(ctx, `SELECT booking_code, access_token, visit_date::text, customer_name, customer_phone,
		  status, total::float8, COALESCE(discount_amount, 0)::float8, gift_recipient_name, gift_recipient_phone
		FROM ticketing.ticket_bookings
		WHERE id = $1 AND branch_id = $2 AND company_id = $3`, id, v.BranchID, v.CompanyID).Scan(
		&b.BookingCode, &b.AccessToken, &b.VisitDate, &b.CustomerName, &phone, &status, &b.Total, &b.Discount,
		&b.GiftRecipientName, &b.GiftRecipientPhone)
	if database.IsNoRows(err) {
		return "", "", httpx.NotFound(bookingNotFound)
	}
	if err != nil {
		return "", "", err
	}
	if status != "terbayar" {
		return "", "", httpx.Conflict(`Booking berstatus "` + status + `" — hanya booking terbayar yang dikirimi ulang`)
	}
	sent := s.ports.Messenger.SendText(ctx, phone, domain.BookingPaidMessage(s.ports.AppOrigin, b))
	if b.GiftRecipientPhone != nil && *b.GiftRecipientPhone != "" && b.GiftRecipientName != nil && *b.GiftRecipientName != "" {
		if err := s.ports.Messenger.SendText(ctx, *b.GiftRecipientPhone, domain.BookingGiftMessage(s.ports.AppOrigin, b)); err != nil {
			s.log.ErrorContext(ctx, "ticketing: kirim WA hadiah gagal", "booking_id", id, "error", err)
		}
	}
	if sent != nil {
		s.log.ErrorContext(ctx, "ticketing: kirim WA booking gagal", "booking_id", id, "error", sent)
		if errors.Is(sent, ErrMessengerNotConfigured) {
			return "", "", httpx.Status(http.StatusBadGateway, "WA gateway belum dikonfigurasi — cek Settings → WhatsApp Gateway")
		}
		return "", "", httpx.Status(http.StatusBadGateway, "Gagal mengirim WA — cek koneksi gateway")
	}
	return b.BookingCode, phone, nil
}
