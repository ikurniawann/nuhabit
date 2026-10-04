package ticketing

import (
	"context"
	"math"
	"strings"

	"github.com/jackc/pgx/v5"

	contract "nuhabit/backend/internal/contracts/ticketing"
	"nuhabit/backend/internal/modules/ticketing/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/validate"
)

// Xendit invoice callbacks (PAID/EXPIRED) for website bookings and season
// passes (xendit-webhook-server.ts). Transitions are guarded UPDATEs, so a
// repeated callback is acknowledged without a second effect; WhatsApp is
// best effort.

const (
	bookingInvoicePrefix = "tkt-booking-"
	passInvoicePrefix    = "tkt-pass-"
)

// InvoiceCallback is xenditCallbackSchema.
type InvoiceCallback struct {
	ID         string
	ExternalID string
	Status     string
	PaidAt     *string
	Amount     *float64
}

// InvoiceAck is the body acknowledged to Xendit (always 200).
type InvoiceAck struct {
	Success bool `json:"success"`
	Ignored bool `json:"ignored,omitempty"`
}

var (
	ackOK      = InvoiceAck{Success: true}
	ackIgnored = InvoiceAck{Success: true, Ignored: true}
)

// IsTicketingInvoice reports whether an external_id belongs to a booking or
// a season pass.
func IsTicketingInvoice(externalID string) bool {
	return strings.HasPrefix(externalID, bookingInvoicePrefix) || strings.HasPrefix(externalID, passInvoicePrefix)
}

func isPaid(status string) bool { return status == "PAID" || status == "SETTLED" }

// SettleInvoice is handleTicketingInvoiceCallback on db (a pool or the
// caller's transaction): routes the callback by external_id prefix; other
// products and malformed ids are acknowledged as ignored.
func (s *Service) SettleInvoice(ctx context.Context, db database.DB, cb InvoiceCallback) (InvoiceAck, error) {
	svc := s
	if db != nil {
		c := *s
		c.db = db
		svc = &c
	}
	switch {
	case strings.HasPrefix(cb.ExternalID, passInvoicePrefix):
		id := strings.TrimPrefix(cb.ExternalID, passInvoicePrefix)
		if !validate.IsUUID(id) {
			return ackIgnored, nil
		}
		return svc.settlePass(ctx, id, cb)
	case strings.HasPrefix(cb.ExternalID, bookingInvoicePrefix):
		id := strings.TrimPrefix(cb.ExternalID, bookingInvoicePrefix)
		if !validate.IsUUID(id) {
			return ackIgnored, nil
		}
		return svc.settleBooking(ctx, id, cb)
	}
	return ackIgnored, nil
}

// settlePass activates a paid pass: valid from the payment day for
// validity_months.
func (s *Service) settlePass(ctx context.Context, id string, cb InvoiceCallback) (InvoiceAck, error) {
	if cb.Status == "EXPIRED" {
		_, err := s.db.Exec(ctx, `UPDATE ticketing.ticket_season_passes
			SET status = 'cancelled', updated_at = now()
			WHERE id = $1::uuid AND status = 'pending'`, id)
		return ackOK, err
	}
	if !isPaid(cb.Status) {
		return ackIgnored, nil
	}
	var months int
	var unitPrice float64
	err := s.db.QueryRow(ctx, `SELECT pc.validity_months, sp.unit_price::float8
		FROM ticketing.ticket_season_passes sp
		JOIN ticketing.ticket_pass_configs pc ON pc.ticket_product_id = sp.ticket_product_id
		WHERE sp.id = $1::uuid`, id).Scan(&months, &unitPrice)
	if database.IsNoRows(err) {
		return ackIgnored, nil
	}
	if err != nil {
		return InvoiceAck{}, err
	}
	if cb.Amount != nil && *cb.Amount < math.Floor(unitPrice) {
		s.log.Error("[pass] webhook PAID nominal janggal — diabaikan", "pass", id, "price", unitPrice, "amount", *cb.Amount)
		return ackIgnored, nil
	}
	today := s.today()
	var code, token, name, validUntil string
	var phone *string
	err = s.db.QueryRow(ctx, `UPDATE ticketing.ticket_season_passes
		SET status = 'active', paid_at = COALESCE($2::timestamptz, now()),
		    valid_from = $3, valid_until = $4, activated_at = now(),
		    xendit_invoice_id = COALESCE(xendit_invoice_id, $5), updated_at = now()
		WHERE id = $1::uuid AND status = 'pending'
		RETURNING pass_code, access_token, holder_name, holder_phone, valid_until::text`,
		id, cb.PaidAt, today, domain.AddMonthsISO(today, months), cb.ID).Scan(&code, &token, &name, &phone, &validUntil)
	if database.IsNoRows(err) {
		return ackOK, nil
	}
	if err != nil {
		return InvoiceAck{}, err
	}
	if phone != nil && *phone != "" {
		msg := "*Season Pass aktif* ✅\n\n" +
			"Kode pass: *" + code + "*\n" +
			"Atas nama: " + name + "\n" +
			"Berlaku s/d: " + domain.FormatDate(validUntil) + "\n\n" +
			"Tunjukkan / scan QR di halaman ini saat masuk:\n" + s.ports.AppOrigin + "/pass/status/" + token
		s.sendBestEffort(ctx, "[pass] kirim WA gagal", *phone, msg)
	}
	return ackOK, nil
}

func (s *Service) sendBestEffort(ctx context.Context, logMsg, target, message string) {
	if err := s.ports.Messenger.SendText(ctx, target, message); err != nil {
		s.log.Error(logMsg, "error", err)
	}
}

func (s *Service) setWebhookAlert(ctx context.Context, id, alert string) error {
	_, err := s.db.Exec(ctx, `UPDATE ticketing.ticket_bookings
		SET webhook_alert = $2, updated_at = now()
		WHERE id = $1::uuid`, id, alert)
	return err
}

func (s *Service) settleBooking(ctx context.Context, id string, cb InvoiceCallback) (InvoiceAck, error) {
	if cb.Status == "EXPIRED" {
		err := s.inTx(ctx, func(tx pgx.Tx) error {
			var code, company, branch string
			err := tx.QueryRow(ctx, `UPDATE ticketing.ticket_bookings
				SET status = 'kedaluwarsa', updated_at = now()
				WHERE id = $1::uuid AND status = 'menunggu-bayar'
				RETURNING booking_code, company_id::text, branch_id::text`, id).Scan(&code, &company, &branch)
			if database.IsNoRows(err) {
				return nil
			}
			if err != nil {
				return err
			}
			// The promo hold goes back (the stored-value subscriber).
			return publishRelease(ctx, tx, contract.TopicBookingExpired, Venue{CompanyID: company, BranchID: branch}, id, code)
		})
		return ackOK, err
	}
	if !isPaid(cb.Status) {
		return ackIgnored, nil
	}
	// The amount, when sent, must cover total − promo (1 rupiah rounding
	// tolerance); an underpayment is not marked paid but flagged on the
	// dashboard, and still acknowledged so Xendit stops retrying.
	if cb.Amount != nil {
		var total, discount float64
		err := s.db.QueryRow(ctx, `SELECT total::float8, discount_amount::float8
			FROM ticketing.ticket_bookings WHERE id = $1::uuid`, id).Scan(&total, &discount)
		if err != nil && !database.IsNoRows(err) {
			return InvoiceAck{}, err
		}
		if err == nil {
			payable := total - discount
			if *cb.Amount < math.Floor(payable) {
				s.log.Error("[booking] webhook PAID nominal janggal — diabaikan", "booking", id, "payable", payable, "amount", *cb.Amount)
				return ackIgnored, s.setWebhookAlert(ctx, id, "Xendit melapor PAID dengan nominal "+domain.FormatRupiah(*cb.Amount)+
					" — kurang dari tagihan booking "+domain.FormatRupiah(payable)+". Pembayaran TIDAK ditandai lunas; periksa dashboard Xendit.")
			}
		}
	}
	return ackOK, s.markBookingPaid(ctx, id, cb)
}

// markBookingPaid is markBookingPaid: money beats the expiry guess, so a
// lazily expired booking is revived; a cancelled one is not (a person
// decided) but flagged for a manual refund.
func (s *Service) markBookingPaid(ctx context.Context, id string, cb InvoiceCallback) error {
	b := domain.PaidBooking{}
	var phone string
	err := s.db.QueryRow(ctx, `UPDATE ticketing.ticket_bookings
		SET status = 'terbayar', paid_at = COALESCE($2::timestamptz, now()),
		    xendit_invoice_id = COALESCE(xendit_invoice_id, $3),
		    updated_at = now()
		WHERE id = $1::uuid AND status IN ('menunggu-bayar', 'kedaluwarsa')
		RETURNING booking_code, access_token, visit_date::text, customer_name, customer_phone,
		  total::float8, COALESCE(discount_amount, 0)::float8, gift_recipient_name, gift_recipient_phone`,
		id, cb.PaidAt, cb.ID).Scan(&b.BookingCode, &b.AccessToken, &b.VisitDate, &b.CustomerName, &phone,
		&b.Total, &b.Discount, &b.GiftRecipientName, &b.GiftRecipientPhone)
	if database.IsNoRows(err) {
		var status string
		err := s.db.QueryRow(ctx, `SELECT status FROM ticketing.ticket_bookings WHERE id = $1::uuid`, id).Scan(&status)
		if err != nil && !database.IsNoRows(err) {
			return err
		}
		if status == "dibatalkan" {
			s.log.Error("[booking] PAID diterima utk booking DIBATALKAN — perlu refund manual", "booking", id)
			return s.setWebhookAlert(ctx, id, "Pembayaran Xendit MASUK untuk booking yang sudah DIBATALKAN — uang diterima tanpa tiket. Perlu refund manual; catat di Catatan Refund.")
		}
		return nil
	}
	if err != nil {
		return err
	}
	// The promo use becomes final (held → captured), idempotent and best
	// effort in its own savepoint.
	if err := s.inTx(ctx, func(tx pgx.Tx) error {
		return s.ports.Public.Promo.Capture(ctx, tx, contract.PromoContextTicketBooking, id)
	}); err != nil {
		s.log.Error("[booking] capture promo error", "error", err)
	}
	s.sendBestEffort(ctx, "[booking] kirim WA gagal", phone, domain.BookingPaidMessage(s.ports.AppOrigin, b))
	if b.GiftRecipientPhone != nil && *b.GiftRecipientPhone != "" && b.GiftRecipientName != nil && *b.GiftRecipientName != "" {
		s.sendBestEffort(ctx, "[booking] kirim WA hadiah gagal", *b.GiftRecipientPhone, domain.BookingGiftMessage(s.ports.AppOrigin, b))
	}
	return nil
}
