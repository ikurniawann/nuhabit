package ticketing

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"

	contract "nuhabit/backend/internal/contracts/ticketing"
	"nuhabit/backend/internal/modules/ticketing/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/jsmath"
)

// The public prepaid booking (booking-create-server.ts) and its status page
// (getPublicBookingStatus). Prices are re-computed from the server catalog;
// without Xendit the route answers 503 before any insert.

const notFound = "Not found"

// BookingInput is createBookingSchema after parsing.
type BookingInput struct {
	VisitDate          string
	CustomerName       string
	CustomerPhone      string
	SlotID             *string
	PromoCode          *string
	GiftRecipientName  *string
	GiftRecipientPhone *string
	Items              []domain.CartItem
}

type preparedBooking struct {
	venue     *PublicVenue
	phone     string
	giftPhone *string
	cart      domain.PricedCart
}

// prepareBooking validates the input and re-prices the cart (no writes).
func (s *Service) prepareBooking(ctx context.Context, slug string, in BookingInput) (*preparedBooking, error) {
	if msg := domain.VisitDateWindowError(in.VisitDate, s.today()); msg != "" {
		return nil, httpx.BadRequest(msg)
	}
	phone := domain.NormalizePhoneDigits(in.CustomerPhone)
	if phone == "" {
		return nil, httpx.BadRequest("Nomor WhatsApp tidak valid")
	}
	var giftPhone *string
	if in.GiftRecipientName != nil || in.GiftRecipientPhone != nil {
		if in.GiftRecipientName == nil || in.GiftRecipientPhone == nil {
			return nil, httpx.BadRequest("Nama dan nomor WA penerima hadiah wajib diisi")
		}
		g := domain.NormalizePhoneDigits(*in.GiftRecipientPhone)
		if g == "" {
			return nil, httpx.BadRequest("Nomor WA penerima hadiah tidak valid")
		}
		giftPhone = &g
	}
	seen := map[string]bool{}
	for _, it := range in.Items {
		if seen[it.VariantID] {
			return nil, httpx.BadRequest("Varian duplikat dalam pesanan")
		}
		seen[it.VariantID] = true
	}
	if !s.ports.Public.Payments.Configured() {
		return nil, httpx.Status(503, "Pembayaran online belum tersedia — silakan beli di loket")
	}
	venue, err := s.resolvePublicVenue(ctx, slug)
	if err != nil {
		return nil, err
	}
	if venue == nil {
		return nil, httpx.NotFound(notFound)
	}
	// A venue with slots needs one; a venue without slots refuses one.
	slots, err := loadActiveSlots(ctx, s.db, venue.Venue)
	if err != nil {
		return nil, err
	}
	if len(slots) > 0 && in.SlotID == nil {
		return nil, httpx.BadRequest("Pilih slot waktu kunjungan dulu")
	}
	if len(slots) == 0 && in.SlotID != nil {
		return nil, httpx.BadRequest("Venue ini tidak memakai slot waktu — muat ulang halaman")
	}
	catalog, err := s.buildPublicCatalog(ctx, venue, in.VisitDate)
	if err != nil {
		return nil, err
	}
	cart, msg := domain.PriceBookingCart(catalog, in.Items, in.CustomerName)
	if msg != "" {
		return nil, httpx.BadRequest(msg)
	}
	return &preparedBooking{venue: venue, phone: phone, giftPhone: giftPhone, cart: cart}, nil
}

// insertBooking writes the booking, items and guests in one transaction
// under the daily and slot capacity guards, holding the promo code.
func (s *Service) insertBooking(ctx context.Context, tx pgx.Tx, in BookingInput, p *preparedBooking, code, token string, expiresAt time.Time) (id string, discount float64, err error) {
	v := p.venue.Venue
	if err := assertCapacityAvailable(ctx, tx, v, in.VisitDate, p.cart.TotalQty); err != nil {
		return "", 0, err
	}
	var slot *bookingSlot
	if in.SlotID != nil {
		if slot, err = loadActiveSlot(ctx, tx, v, *in.SlotID); err != nil {
			return "", 0, err
		}
		if slot == nil {
			return "", 0, httpx.BadRequest("Slot waktu tidak tersedia lagi — muat ulang halaman")
		}
		if err := assertSlotCapacity(ctx, tx, v, in.VisitDate, slot, p.cart.TotalQty); err != nil {
			return "", 0, err
		}
	}
	var slotID, slotLabel, slotStart, slotEnd, giftName *string
	if slot != nil {
		slotID, slotLabel, slotStart, slotEnd = &slot.ID, &slot.Label, &slot.StartTime, &slot.EndTime
	}
	if p.giftPhone != nil {
		giftName = in.GiftRecipientName
	}
	err = tx.QueryRow(ctx, `INSERT INTO ticketing.ticket_bookings
		  (company_id, branch_id, booking_code, access_token, visit_date,
		   customer_name, customer_phone, status, total, expires_at,
		   slot_id, slot_label, slot_start_time, slot_end_time,
		   gift_recipient_name, gift_recipient_phone)
		VALUES ($1,$2,$3,$4,$5,$6,$7,'menunggu-bayar',$8,$9,$10,$11,$12,$13,$14,$15)
		RETURNING id::text`,
		v.CompanyID, v.BranchID, code, token, in.VisitDate, in.CustomerName, p.phone, p.cart.Total, expiresAt,
		slotID, slotLabel, slotStart, slotEnd, giftName, p.giftPhone).Scan(&id)
	if err != nil {
		return "", 0, err
	}

	// The promo hold runs in the same transaction; the booking total stays
	// gross and the discount is stored apart (Xendit bills total − discount).
	if in.PromoCode != nil {
		discount, err = s.ports.Public.Promo.Hold(ctx, tx, PromoCheck{
			CompanyID: v.CompanyID, BranchID: v.BranchID, Code: *in.PromoCode, Channel: "ticketing_online",
			Subtotal: p.cart.Total, Phone: &p.phone,
		}, contract.PromoContextTicketBooking, id)
		if err != nil {
			return "", 0, err
		}
		if _, err := tx.Exec(ctx, `UPDATE ticketing.ticket_bookings
			SET discount_amount = $2, promo_code = $3, updated_at = now()
			WHERE id = $1`, id, discount, strings.ToUpper(*in.PromoCode)); err != nil {
			return "", 0, err
		}
	}

	insertGuest := func(itemID, variantID string, position int, bundleProduct *string, unitNo *int, price *float64, label *string) error {
		_, err := tx.Exec(ctx, `INSERT INTO ticketing.ticket_booking_guests
			  (company_id, branch_id, booking_id, booking_item_id,
			   variant_id, guest_name, position, bundle_product_id,
			   bundle_unit_no, allocated_price, member_label)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
			v.CompanyID, v.BranchID, id, itemID, variantID, p.cart.GuestNames[position-1], position,
			bundleProduct, unitNo, price, label)
		return err
	}
	position, bundleUnit := 0, 0
	for _, item := range p.cart.Items {
		var itemID string
		if err := tx.QueryRow(ctx, `INSERT INTO ticketing.ticket_booking_items
			  (company_id, branch_id, booking_id, ticket_product_id,
			   variant_id, product_name, variant_name, qty, unit_price,
			   season_kind, subtotal)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
			RETURNING id::text`, v.CompanyID, v.BranchID, id, item.ProductID, item.VariantID, item.ProductName,
			item.VariantName, item.Qty, item.Price, item.SeasonKind, item.Subtotal).Scan(&itemID); err != nil {
			return "", 0, err
		}
		if item.ProductKind == "bundle" && item.Members != nil {
			// A bundle explodes into one guest per member with a prorated
			// price (the shares sum to the bundle price).
			weights := make([]*float64, len(item.Members))
			for i, m := range item.Members {
				weights[i] = m.WeightPrice
			}
			shares := domain.AllocateBundlePrice(item.Price, weights)
			for range item.Qty {
				bundleUnit++
				for mi, m := range item.Members {
					position++
					unit, share, label := bundleUnit, shares[mi], item.ProductName+" — "+m.MemberLabel
					if err := insertGuest(itemID, m.ComponentVariantID, position, &item.ProductID, &unit, &share, &label); err != nil {
						return "", 0, err
					}
				}
			}
			continue
		}
		for range item.Qty {
			position++
			if err := insertGuest(itemID, item.VariantID, position, nil, nil, nil, nil); err != nil {
				return "", 0, err
			}
		}
	}
	return id, discount, nil
}

// BookingCreated is createPublicBooking's result.
type BookingCreated struct {
	BookingCode    string  `json:"booking_code"`
	AccessToken    string  `json:"access_token"`
	StatusURL      string  `json:"status_url"`
	InvoiceURL     string  `json:"invoice_url"`
	Total          float64 `json:"total"`
	DiscountAmount float64 `json:"discount_amount"`
	Payable        float64 `json:"payable"`
	ExpiresAt      string  `json:"expires_at"`
}

// CreatePublicBooking is createPublicBooking: insert (retrying a booking
// code collision), then the Xendit invoice for total − discount. A failed
// invoice cancels the booking cleanly and releases the promo hold.
func (s *Service) CreatePublicBooking(ctx context.Context, slug string, in BookingInput, baseURL string) (*BookingCreated, error) {
	p, err := s.prepareBooking(ctx, slug, in)
	if err != nil {
		return nil, err
	}
	token := domain.GenerateAccessToken()
	expiresAt := s.now().Add(invoiceExpiryHours * time.Hour)
	var id, code string
	var discount float64
	for attempt := 0; attempt < 3 && id == ""; attempt++ {
		code = domain.GenerateBookingCode()
		err = database.WithTx(ctx, s.db, func(tx pgx.Tx) error {
			var err error
			id, discount, err = s.insertBooking(ctx, tx, in, p, code, token, expiresAt)
			return err
		})
		if err != nil {
			id = ""
			if database.IsUniqueViolation(err) && attempt < 2 {
				continue // code collision: try another
			}
			return nil, err
		}
	}
	if id == "" {
		return nil, errors.New("Gagal mengalokasikan kode booking")
	}

	statusURL := baseURL + "/booking/status/" + token
	total := p.cart.Total
	invoice, err := s.ports.Public.Payments.CreateInvoice(ctx, InvoiceRequest{
		ExternalID:  bookingInvoicePrefix + id,
		Amount:      jsmath.Round(total - discount),
		PayerName:   in.CustomerName,
		Description: "Tiket " + code + " — kunjungan " + in.VisitDate,
		RedirectURL: statusURL,
	})
	if err == nil {
		_, err = s.db.Exec(ctx, `UPDATE ticketing.ticket_bookings
			SET xendit_invoice_id = $2, xendit_invoice_url = $3,
			    expires_at = $4, updated_at = now()
			WHERE id = $1`, id, invoice.ID, invoice.URL, invoice.ExpiresAt)
	}
	if err != nil {
		s.log.Error("[booking] invoice error", "error", err)
		cancelErr := s.inTx(ctx, func(tx pgx.Tx) error {
			tag, err := tx.Exec(ctx, `UPDATE ticketing.ticket_bookings
				SET status = 'dibatalkan', refund_note = 'pembuatan-invoice-gagal', updated_at = now()
				WHERE id = $1 AND status = 'menunggu-bayar'`, id)
			if err != nil || tag.RowsAffected() == 0 || discount <= 0 {
				return err
			}
			// The promo hold goes back (its use returns to the code).
			return publishRelease(ctx, tx, contract.TopicBookingCancelled, p.venue.Venue, id, code)
		})
		if cancelErr != nil {
			return nil, cancelErr
		}
		return nil, httpx.Status(502, "Pembayaran sedang gangguan — coba lagi")
	}
	return &BookingCreated{
		BookingCode: code, AccessToken: token, StatusURL: statusURL, InvoiceURL: invoice.URL,
		Total: total, DiscountAmount: discount, Payable: domain.Round2(total - discount),
		ExpiresAt: invoice.ExpiresAt.UTC().Format(httpx.JSTimeLayout),
	}, nil
}

// PublicBookingStatus is getPublicBookingStatus by capability token (nil
// when unknown). Looking at a stale unpaid booking expires it.
func (s *Service) PublicBookingStatus(ctx context.Context, token string) (*Row, error) {
	b, err := queryRow(ctx, s.db, `SELECT id, company_id::text AS company_id, branch_id::text AS branch_id,
		  booking_code, visit_date::text AS visit_date, customer_name,
		  status, total, discount_amount, promo_code, xendit_invoice_url,
		  gift_recipient_name,
		  slot_label, slot_start_time::text AS slot_start_time,
		  slot_end_time::text AS slot_end_time,
		  expires_at::text AS expires_at, paid_at::text AS paid_at,
		  used_at::text AS used_at
		FROM ticketing.ticket_bookings
		WHERE access_token = $1`, token)
	if err != nil || b == nil {
		return nil, err
	}
	id, code := b.Str("id"), b.Str("booking_code")
	status := b.Str("status")
	if status == "menunggu-bayar" {
		expired, err := s.expireBookingIfDue(ctx, Venue{CompanyID: b.Str("company_id"), BranchID: b.Str("branch_id")}, id, code)
		if err != nil {
			return nil, err
		}
		if expired {
			status = "kedaluwarsa"
		}
	}
	items, err := bookingItems(ctx, s.db, id, false)
	if err != nil {
		return nil, err
	}
	guests, err := queryRows(ctx, s.db, `SELECT g.guest_name, i.variant_name
		FROM ticketing.ticket_booking_guests g
		JOIN ticketing.ticket_booking_items i ON i.id = g.booking_item_id
		WHERE g.booking_id = $1
		ORDER BY g.position`, id)
	if err != nil {
		return nil, err
	}
	total, discount := b.Num("total"), b.Num("discount_amount")
	var invoiceURL any
	if status == "menunggu-bayar" {
		invoiceURL = b.Get("xendit_invoice_url")
	}
	return object(
		"booking_code", code,
		"visit_date", b.Get("visit_date"),
		"customer_name", b.Get("customer_name"),
		"status", status,
		"total", total,
		"discount_amount", discount,
		"promo_code", b.Get("promo_code"),
		"gift_recipient_name", b.Get("gift_recipient_name"),
		"payable", domain.Round2(total-discount),
		"slot_label", b.Get("slot_label"),
		"slot_start_time", clockOrNil(b.Get("slot_start_time")),
		"slot_end_time", clockOrNil(b.Get("slot_end_time")),
		"invoice_url", invoiceURL,
		"expires_at", b.Get("expires_at"),
		"paid_at", b.Get("paid_at"),
		"used_at", b.Get("used_at"),
		"items", items,
		"guests", guests,
	), nil
}

// clockOrNil is `time?.slice(0, 5) ?? null`.
func clockOrNil(v any) any {
	if s, ok := v.(string); ok {
		return clock(s)
	}
	return nil
}
