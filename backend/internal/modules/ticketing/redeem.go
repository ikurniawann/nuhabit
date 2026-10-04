package ticketing

import (
	"context"
	"encoding/json"
	"math"
	"strconv"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/ticketing/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
)

// Booking redemption at the loket (booking-redeem-server.ts): every guest
// gets exactly one NFC band, the booking becomes a PREPAID visit with the
// snapshotted ticket debits and an equal Xendit payment (net 0). The
// booking is locked FOR UPDATE and terbayar→digunakan happens once, so a
// second redeem (Go or TS) gets a 409.

// RedeemBand pairs one band with one booking guest.
type RedeemBand struct {
	NfcUID  string
	GuestID string
}

type lockedBooking struct {
	id, code, visitDate, customerName, customerPhone, status string
	total                                                    float64
	slotLabel, slotStart, slotEnd                            *string
	discount                                                 *float64
	promoCode                                                *string
}

type redeemGuest struct {
	id, name, variantID, productID, productName, variantName, seasonKind string
	unitPrice                                                            float64
	bundleProductID                                                      *string
	bundleUnitNo                                                         *int
	allocatedPrice                                                       *string
	allocatedValue                                                       *float64
	memberLabel                                                          *string
}

// price is guestPrice: a bundle member's allocated share, else the unit price.
func (g redeemGuest) price() float64 {
	if g.allocatedValue != nil {
		return *g.allocatedValue
	}
	return g.unitPrice
}

func lockBooking(ctx context.Context, q database.Querier, v Venue, id string) (lockedBooking, error) {
	var b lockedBooking
	err := q.QueryRow(ctx, `SELECT id::text, booking_code, visit_date::text, customer_name, customer_phone, status,
		  total::float8, slot_label, slot_start_time::text, slot_end_time::text, discount_amount::float8, promo_code
		FROM ticketing.ticket_bookings
		WHERE id = $1 AND branch_id = $2 AND company_id = $3
		FOR UPDATE`, id, v.BranchID, v.CompanyID).Scan(
		&b.id, &b.code, &b.visitDate, &b.customerName, &b.customerPhone, &b.status, &b.total,
		&b.slotLabel, &b.slotStart, &b.slotEnd, &b.discount, &b.promoCode)
	if database.IsNoRows(err) {
		return b, httpx.NotFound("Booking tidak ditemukan di venue ini")
	}
	if err != nil {
		return b, err
	}
	if b.status == "digunakan" {
		return b, httpx.Conflict("Booking " + b.code + " SUDAH dipakai — tidak bisa dua kali")
	}
	if b.status != "terbayar" {
		return b, httpx.Conflict("Booking " + b.code + ` berstatus "` + b.status + `" — hanya booking terbayar yang bisa di-redeem`)
	}
	return b, nil
}

// assertRedeemWindow is assertRedeemWindow: visit day through visit day +
// booking_forfeit_days; slotted bookings only within slot ± grace on the
// visit day itself.
func (s *Service) assertRedeemWindow(ctx context.Context, q database.Querier, v Venue, b lockedBooking) error {
	days, grace, err := forfeitDays(ctx, q, v)
	if err != nil {
		return err
	}
	today := s.today()
	visitDay := domain.FormatDate(b.visitDate)
	switch domain.RedeemWindowStatus(b.visitDate, today, days) {
	case domain.RedeemNotYet:
		return httpx.Conflict("Booking untuk tanggal " + visitDay + " — belum bisa dipakai (hari ini " + domain.FormatDate(today) + ")")
	case domain.RedeemPast:
		// The rollback below discards this, like the TS: the watcher or a
		// lookup persists the forfeit.
		if days != nil {
			if _, err := q.Exec(ctx, `UPDATE ticketing.ticket_bookings
				SET status = 'hangus', forfeited_at = now(), updated_at = now()
				WHERE id = $1 AND status = 'terbayar' AND visit_id IS NULL`, b.id); err != nil {
				return err
			}
			return httpx.Conflict("Masa berlaku booking habis (tanggal " + visitDay + " + " + strconv.Itoa(*days) + " hari) — tiket hangus")
		}
		return httpx.Conflict("Booking untuk tanggal " + visitDay + " — hanya bisa dipakai pada hari-H (hari ini " + domain.FormatDate(today) + ")")
	}
	if b.slotStart != nil && b.slotEnd != nil && *b.slotStart != "" && *b.slotEnd != "" && today == b.visitDate {
		now := domain.NowJakartaTime(s.now())
		status := domain.SlotWindowStatus(now, *b.slotStart, *b.slotEnd, grace)
		if status != domain.SlotOK {
			rng := clock(*b.slotStart) + "–" + clock(*b.slotEnd)
			label := deref(b.slotLabel)
			graceText := strconv.Itoa(grace)
			if status == domain.SlotTooEarly {
				return httpx.Conflict("Belum masuk jam slot " + label + " (" + rng + ", toleransi " + graceText + " mnt) — sekarang " + now)
			}
			return httpx.Conflict("Jam slot " + label + " (" + rng + ") sudah lewat (toleransi " + graceText + " mnt) — sekarang " + now)
		}
	}
	return nil
}

// clock is time.slice(0, 5).
func clock(t string) string {
	if len(t) > 5 {
		return t[:5]
	}
	return t
}

// RedeemBooking is redeemBooking; it returns the new visit id and the
// booking code.
func (s *Service) RedeemBooking(ctx context.Context, v Venue, id string, bands []RedeemBand) (string, string, error) {
	raws := make([]string, len(bands))
	for i, b := range bands {
		raws[i] = b.NfcUID
	}
	uids, err := requireDistinctNfcUIDs(raws)
	if err != nil {
		return "", "", err
	}
	var visitID, code string
	err = s.inTx(ctx, func(tx pgx.Tx) error {
		b, err := lockBooking(ctx, tx, v, id)
		if err != nil {
			return err
		}
		code = b.code
		if err := s.assertRedeemWindow(ctx, tx, v, b); err != nil {
			return err
		}
		guests, err := bookingGuests(ctx, tx, b.id)
		if err != nil {
			return err
		}
		if len(guests) == 0 {
			return httpx.Conflict("Booking tanpa daftar anggota — hubungi supervisor")
		}
		byID := map[string]redeemGuest{}
		guestIDs := make([]string, len(guests))
		for i, g := range guests {
			byID[g.id] = g
			guestIDs[i] = g.id
		}
		bandGuests := make([]string, len(bands))
		for i, rb := range bands {
			bandGuests[i] = rb.GuestID
		}
		if reason, guestID := domain.MatchRedeemGuests(guestIDs, bandGuests); reason != "" {
			name := "?"
			if g, ok := byID[guestID]; ok {
				name = g.name
			}
			switch reason {
			case domain.GuestForeign:
				return httpx.BadRequest("Ada gelang yang dipasangkan ke anggota di luar booking ini")
			case domain.GuestDouble:
				return httpx.BadRequest(`Anggota "` + name + `" dipasangkan dua gelang`)
			}
			return httpx.BadRequest(`Anggota "` + name + `" belum dapat gelang`)
		}

		var channelID string
		err = tx.QueryRow(ctx, `SELECT id::text FROM ticketing.ticket_channels
			WHERE branch_id = $1 AND company_id = $2 AND is_online = true AND is_active = true
			ORDER BY sort_order LIMIT 1`, v.BranchID, v.CompanyID).Scan(&channelID)
		if database.IsNoRows(err) {
			return httpx.BadRequest("Kanal website tidak aktif — hubungi supervisor")
		}
		if err != nil {
			return err
		}
		bandIDs, err := lockAvailableBands(ctx, tx, v, uids)
		if err != nil {
			return err
		}

		// The ledger must net to zero: Σ ticket debits = booking total.
		debitSum := 0.0
		for _, rb := range bands {
			debitSum += byID[rb.GuestID].price()
		}
		if math.Abs(debitSum-b.total) > 0.01 {
			return httpx.Conflict("Total booking (" + domain.FormatNumber(b.total) + ") tidak cocok dengan jumlah harga tiket (" +
				domain.FormatNumber(debitSum) + ") — hubungi supervisor")
		}

		if err := tx.QueryRow(ctx, `INSERT INTO ticketing.ticket_visits
			(company_id, branch_id, contact_name, contact_phone, channel_id, payment_mode, credit_limit, created_by)
			VALUES ($1, $2, $3, $4, $5, 'prepaid', NULL, $6)
			RETURNING id::text`, v.CompanyID, v.BranchID, b.customerName, b.customerPhone, channelID, v.UserID).Scan(&visitID); err != nil {
			return err
		}
		for i, rb := range bands {
			bandID := bandIDs[uids[i]]
			g := byID[rb.GuestID]
			if _, err := tx.Exec(ctx, `INSERT INTO ticketing.ticket_visit_bands
				(company_id, branch_id, visit_id, band_id, variant_id, guest_name, bundle_product_id, bundle_unit_no, allocated_price, member_label)
				VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
				v.CompanyID, v.BranchID, visitID, bandID, g.variantID, g.name, g.bundleProductID, g.bundleUnitNo, g.allocatedPrice, g.memberLabel); err != nil {
				return err
			}
			if _, err := tx.Exec(ctx, `UPDATE ticketing.ticket_bands SET status = 'dipakai', updated_at = now() WHERE id = $1`, bandID); err != nil {
				return err
			}
			price := g.price()
			if price <= 0 {
				continue // free tickets have no ledger line (amount > 0 constraint)
			}
			label := g.productName + " — " + g.variantName
			if g.memberLabel != nil {
				label = *g.memberLabel
			}
			priceContext, _ := json.Marshal(map[string]any{
				"booking_id": b.id, "booking_guest_id": rb.GuestID, "ticket_product_id": g.productID,
				"variant_id": g.variantID, "bundle_product_id": g.bundleProductID, "season_kind": g.seasonKind,
				"channel_id": channelID, "visit_date": b.visitDate,
			})
			if _, err := tx.Exec(ctx, `INSERT INTO ticketing.ticket_visit_charges
				(company_id, branch_id, visit_id, band_id, charge_type, direction, description, amount, price_context, created_by)
				VALUES ($1, $2, $3, $4, 'tiket', 'debit', $5, $6, $7, $8)`,
				v.CompanyID, v.BranchID, visitID, bandID,
				"Tiket "+label+" ("+g.seasonKind+", "+b.visitDate+") — booking "+b.code+", a.n. "+g.name,
				price, string(priceContext), v.UserID); err != nil {
				return err
			}
		}

		// With a promo the visit still nets to zero: ticket debits = gross
		// total; credits = the money paid plus a non-cash 'diskon' line.
		discount := deref(b.discount)
		if paid := domain.Round2(b.total - discount); paid > 0 {
			if _, err := tx.Exec(ctx, `INSERT INTO ticketing.ticket_visit_charges
				(company_id, branch_id, visit_id, charge_type, direction, description, amount, payment_method, created_by)
				VALUES ($1, $2, $3, 'pembayaran', 'kredit', $4, $5, 'xendit', $6)`,
				v.CompanyID, v.BranchID, visitID, "Pembayaran booking "+b.code+" (Xendit, prepaid online)", paid, v.UserID); err != nil {
				return err
			}
		}
		if discount > 0 {
			if _, err := tx.Exec(ctx, `INSERT INTO ticketing.ticket_visit_charges
				(company_id, branch_id, visit_id, charge_type, direction, description, amount, created_by)
				VALUES ($1, $2, $3, 'diskon', 'kredit', $4, $5, $6)`,
				v.CompanyID, v.BranchID, visitID, "Potongan promo "+deref(b.promoCode)+" — booking "+b.code, discount, v.UserID); err != nil {
				return err
			}
		}
		_, err = tx.Exec(ctx, `UPDATE ticketing.ticket_bookings
			SET status = 'digunakan', used_at = now(), visit_id = $2, updated_at = now()
			WHERE id = $1 AND status = 'terbayar'`, b.id, visitID)
		return err
	})
	return visitID, code, err
}

func bookingGuests(ctx context.Context, q database.Querier, bookingID string) ([]redeemGuest, error) {
	var out []redeemGuest
	err := scanAll(ctx, q, `SELECT g.id::text, g.guest_name, g.variant_id::text,
		  i.ticket_product_id::text, i.product_name, i.variant_name, i.unit_price::float8, i.season_kind,
		  g.bundle_product_id::text, g.bundle_unit_no, g.allocated_price::text, g.allocated_price::float8, g.member_label
		FROM ticketing.ticket_booking_guests g
		JOIN ticketing.ticket_booking_items i ON i.id = g.booking_item_id
		WHERE g.booking_id = $1
		ORDER BY g.position`, []any{bookingID}, func(scan func(...any) error) error {
		var g redeemGuest
		err := scan(&g.id, &g.name, &g.variantID, &g.productID, &g.productName, &g.variantName, &g.unitPrice,
			&g.seasonKind, &g.bundleProductID, &g.bundleUnitNo, &g.allocatedPrice, &g.allocatedValue, &g.memberLabel)
		out = append(out, g)
		return err
	})
	return out, err
}
