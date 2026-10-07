package ticketing

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/ticketing/domain"
	"nuhabit/backend/internal/platform/database"
)

// Gate taps (gate-server.ts) and season pass entry (season-pass-server.ts
// processPassTap). Every tap, granted or not, is logged in the same
// transaction, so a rejection still commits its log row.

// GateTap is processGateTap. The visit band and its visit are locked
// FOR UPDATE OF vb, v: two taps of one band serialize, so the first-entry
// charge is written once and "sekali-masuk" re-entry is refused.
func (s *Service) GateTap(ctx context.Context, v Venue, uid, gateLabel string) (*Row, error) {
	var out *Row
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		var err error
		out, err = s.gateTap(ctx, tx, v, uid, gateLabel)
		return err
	})
	return out, err
}

type activeVisitBand struct {
	visitBandID, visitID, variantID string
	guestName                       *string
	ticketProductID, ticketTypeName string
	reEntryPolicy                   string
	entered                         bool
	contactName, paymentMode        string
	creditLimit                     *float64
	channelID                       *string
	visitStatus                     string
	allocatedPrice                  *float64
	memberLabel, bundleProductID    *string
}

func (s *Service) gateTap(ctx context.Context, tx pgx.Tx, v Venue, uid, gateLabel string) (*Row, error) {
	logTap := func(bandID, visitID *string, result string) error {
		_, err := tx.Exec(ctx, `INSERT INTO ticketing.ticket_gate_events
			(company_id, branch_id, band_uid, band_id, visit_id, gate_label, result, created_by)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
			v.CompanyID, v.BranchID, uid, bandID, visitID, gateLabel, result, v.UserID)
		return err
	}
	// reply logs the tap and returns the outcome in the TS key order.
	reply := func(bandID, visitID *string, result string, ok bool, kv ...any) (*Row, error) {
		if err := logTap(bandID, visitID, result); err != nil {
			return nil, err
		}
		return object(append([]any{"result", result, "ok", ok}, kv...)...), nil
	}

	var bandID string
	var bandLabel *string
	err := tx.QueryRow(ctx, `SELECT id::text, label FROM ticketing.ticket_bands
		WHERE branch_id = $1 AND company_id = $2 AND nfc_uid = $3`, v.BranchID, v.CompanyID, uid).Scan(&bandID, &bandLabel)
	if database.IsNoRows(err) {
		return reply(nil, nil, "ditolak-gelang-tak-dikenal", false, "reason", "Gelang tidak terdaftar di registry venue")
	}
	if err != nil {
		return nil, err
	}
	band := &bandID

	// Staff band: free access, no charge, unlimited re-entry; an inactive
	// (resigned) employee is refused even when the pairing was not revoked.
	staff, err := s.staffOnBand(ctx, tx, v, bandID)
	if err != nil {
		return nil, err
	}
	if staff != nil {
		if staff.IsActive {
			return reply(band, nil, "masuk-karyawan", true,
				"contact_name", staff.FullName, "ticket_type_name", "Akses Karyawan", "band_label", bandLabel, "charged_amount", 0)
		}
		return reply(band, nil, "ditolak-karyawan-nonaktif", false,
			"reason", "Karyawan sudah nonaktif — cabut pairing gelang di Pengaturan Tiket",
			"contact_name", staff.FullName, "ticket_type_name", "Akses Karyawan", "band_label", bandLabel)
	}

	var vb activeVisitBand
	err = tx.QueryRow(ctx, `SELECT vb.id::text, vb.visit_id::text, vb.variant_id::text, vb.guest_name,
		        tp.id::text, tp.name || ' — ' || pv.name, tp.re_entry_policy, vb.entered_at IS NOT NULL,
		        v.contact_name, v.payment_mode, v.credit_limit::float8, v.channel_id::text, v.status,
		        vb.allocated_price::float8, vb.member_label, vb.bundle_product_id::text
		   FROM ticketing.ticket_visit_bands vb
		   JOIN ticketing.ticket_visits v ON v.id = vb.visit_id
		   JOIN ticketing.ticket_product_variants pv ON pv.id = vb.variant_id
		   JOIN ticketing.ticket_products tp ON tp.id = pv.ticket_product_id
		  WHERE vb.band_id = $1 AND vb.status = 'aktif'
		  ORDER BY vb.created_at DESC
		  LIMIT 1
		  FOR UPDATE OF vb, v`, bandID).Scan(
		&vb.visitBandID, &vb.visitID, &vb.variantID, &vb.guestName, &vb.ticketProductID, &vb.ticketTypeName,
		&vb.reEntryPolicy, &vb.entered, &vb.contactName, &vb.paymentMode, &vb.creditLimit, &vb.channelID,
		&vb.visitStatus, &vb.allocatedPrice, &vb.memberLabel, &vb.bundleProductID)
	found := err == nil
	if err != nil && !database.IsNoRows(err) {
		return nil, err
	}
	if !found || vb.visitStatus != "open" {
		var visitID *string
		if found {
			visitID = &vb.visitID
		}
		return reply(band, visitID, "ditolak-tanpa-kunjungan", false,
			"reason", "Gelang tidak terikat kunjungan terbuka — daftar di loket dulu", "band_label", bandLabel)
	}
	visit := &vb.visitID
	who := []any{"contact_name", vb.contactName, "ticket_type_name", vb.ticketTypeName}
	guest := append(append([]any{}, who...), "guest_name", vb.guestName, "band_label", bandLabel)
	with := func(base []any, kv ...any) []any { return append(append([]any{}, base...), kv...) }

	// Re-entry follows the ticket's own policy.
	if vb.entered {
		if vb.reEntryPolicy == "bebas-keluar-masuk" {
			return reply(band, visit, "masuk-lagi", true, guest...)
		}
		return reply(band, visit, "ditolak-sudah-masuk", false,
			with([]any{"reason", "Tiket sudah dipakai masuk (kebijakan sekali masuk)"}, guest...)...)
	}

	markEntered := func() error {
		_, err := tx.Exec(ctx, `UPDATE ticketing.ticket_visit_bands SET entered_at = now(), updated_at = now() WHERE id = $1`, vb.visitBandID)
		return err
	}

	// A redeemed website booking was charged at redeem time; the first tap
	// only marks the entry.
	var isBooking bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM ticketing.ticket_bookings
		WHERE visit_id = $1 AND branch_id = $2 AND company_id = $3)`, vb.visitID, v.BranchID, v.CompanyID).Scan(&isBooking); err != nil {
		return nil, err
	}
	if isBooking {
		if err := markEntered(); err != nil {
			return nil, err
		}
		return reply(band, visit, "masuk", true, with(guest, "charged_amount", 0)...)
	}

	if vb.channelID == nil {
		return reply(band, visit, "ditolak-tanpa-kanal", false,
			with([]any{"reason", "Kunjungan tanpa kanal penjualan — hubungi supervisor"}, who...)...)
	}
	charge, reason, err := s.ticketCharge(ctx, tx, v, vb, *vb.channelID, s.today())
	if err != nil {
		return nil, err
	}
	if reason != "" {
		return reply(band, visit, "ditolak-harga-belum-diisi", false, with([]any{"reason", reason}, who...)...)
	}

	// Price 0 is a legitimate comp ticket: entry without a ledger line.
	if charge.amount == 0 {
		if err := markEntered(); err != nil {
			return nil, err
		}
		return reply(band, visit, "masuk", true, with(who, "band_label", bandLabel, "charged_amount", 0)...)
	}

	lines, err := visitCharges(ctx, tx, vb.visitID)
	if err != nil {
		return nil, err
	}
	if why := domain.CanCharge(vb.paymentMode, summarize(lines, nil), charge.amount, vb.creditLimit); why != "" {
		result := "ditolak-plafon"
		if vb.paymentMode == "prepaid" {
			result = "ditolak-saldo-kurang"
		}
		return reply(band, visit, result, false, with([]any{"reason", why}, who...)...)
	}

	priceContext, _ := json.Marshal(charge.context)
	if _, err := tx.Exec(ctx, `INSERT INTO ticketing.ticket_visit_charges
		(company_id, branch_id, visit_id, band_id, charge_type, direction, description, amount, price_context, created_by)
		VALUES ($1, $2, $3, $4, 'tiket', 'debit', $5, $6, $7, $8)`,
		v.CompanyID, v.BranchID, vb.visitID, bandID, charge.description, charge.amount, string(priceContext), v.UserID); err != nil {
		return nil, err
	}
	if err := markEntered(); err != nil {
		return nil, err
	}
	return reply(band, visit, "masuk", true, with(guest, "charged_amount", charge.amount)...)
}

func (s *Service) staffOnBand(ctx context.Context, q database.Querier, v Venue, bandID string) (*Employee, error) {
	var employeeID string
	err := q.QueryRow(ctx, `SELECT employee_id::text FROM ticketing.ticket_staff_passes
		WHERE band_id = $1 AND branch_id = $2 AND company_id = $3 AND is_active = true
		LIMIT 1`, bandID, v.BranchID, v.CompanyID).Scan(&employeeID)
	if database.IsNoRows(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	found, err := s.ports.Employees.Find(ctx, q, []string{employeeID}, "")
	if err != nil || len(found) == 0 {
		return nil, err
	}
	return &found[0], nil
}

type ticketCharge struct {
	amount      float64
	description string
	context     map[string]any
}

// ticketCharge is resolveTicketCharge: a bundle member charges its price
// allocated at registration, anything else resolves today's price.
func (s *Service) ticketCharge(ctx context.Context, q database.Querier, v Venue, vb activeVisitBand, channelID, visitDate string) (ticketCharge, string, error) {
	if vb.allocatedPrice != nil {
		label := vb.ticketTypeName
		if vb.memberLabel != nil {
			label = *vb.memberLabel
		}
		return ticketCharge{
			amount:      *vb.allocatedPrice,
			description: "Tiket " + label + " (alokasi paket, " + visitDate + ")",
			context: map[string]any{
				"ticket_product_id": vb.ticketProductID, "variant_id": vb.variantID, "bundle_product_id": vb.bundleProductID,
				"allocated": true, "channel_id": channelID, "visit_date": visitDate,
			},
		}, "", nil
	}
	res, err := resolveVariantPriceOnDate(ctx, q, v, vb.variantID, channelID, visitDate)
	if err != nil {
		return ticketCharge{}, "", err
	}
	if !res.OK {
		if res.Reason == domain.ReasonDateBlocked {
			return ticketCharge{}, "Tanggal ini diblok untuk kanal kunjungan — hubungi supervisor", nil
		}
		return ticketCharge{}, "Harga " + vb.ticketTypeName + " belum diisi — lengkapi di Master Ticket", nil
	}
	return ticketCharge{
		amount:      res.Price,
		description: "Tiket " + vb.ticketTypeName + " (" + res.SeasonKind + ", " + visitDate + ")",
		context: map[string]any{
			"ticket_product_id": vb.ticketProductID, "variant_id": vb.variantID, "season_kind": res.SeasonKind,
			"channel_id": channelID, "visit_date": visitDate,
		},
	}, "", nil
}

// PassTap is processPassTap: the pass row is locked FOR UPDATE OF sp, so
// concurrent taps of one pass serialize; the partial unique index on
// granted once_per_day entries is the backstop.
func (s *Service) PassTap(ctx context.Context, v Venue, code, gateLabel string) (*Row, error) {
	var out *Row
	err := s.inTx(ctx, func(tx pgx.Tx) error {
		var err error
		out, err = s.passTap(ctx, tx, v, code, gateLabel)
		return err
	})
	return out, err
}

type passRow struct {
	id, passCode, holderName, status, entryPolicy string
	validFrom, validUntil                         *string
	quotaTotal                                    *int
	quotaUsed                                     int
	bandUID                                       *string
	productID, productName                        string
}

func (s *Service) passTap(ctx context.Context, tx pgx.Tx, v Venue, code, gateLabel string) (*Row, error) {
	notPass := object("ok", false, "result", "bukan-pass", "reason", "Kode tidak dikenal sebagai Season Pass")
	column, key, found := domain.PassLookupKey(code)
	if !found {
		return notPass, nil
	}
	var p passRow
	err := tx.QueryRow(ctx, `SELECT sp.id::text, sp.pass_code, sp.holder_name, sp.status, sp.entry_policy,
		        sp.valid_from::text, sp.valid_until::text, sp.visit_quota_total, sp.visit_quota_used,
		        sp.band_uid, sp.ticket_product_id::text, tp.name
		   FROM ticketing.ticket_season_passes sp
		   JOIN ticketing.ticket_products tp ON tp.id = sp.ticket_product_id
		  WHERE sp.branch_id = $1 AND sp.company_id = $2 AND `+column+` = $3
		  LIMIT 1 FOR UPDATE OF sp`, v.BranchID, v.CompanyID, key).Scan(
		&p.id, &p.passCode, &p.holderName, &p.status, &p.entryPolicy, &p.validFrom, &p.validUntil,
		&p.quotaTotal, &p.quotaUsed, &p.bandUID, &p.productID, &p.productName)
	if database.IsNoRows(err) {
		return notPass, nil
	}
	if err != nil {
		return nil, err
	}

	today := s.today()
	logEntry := func(result string) error {
		_, err := tx.Exec(ctx, `INSERT INTO ticketing.ticket_pass_entries
			(company_id, branch_id, season_pass_id, entry_date, entry_policy, gate_label, band_uid, result, created_by)
			VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
			v.CompanyID, v.BranchID, p.id, today, p.entryPolicy, gateLabel, p.bandUID, result, v.UserID)
		return err
	}
	holder := []any{"holder_name", p.holderName, "pass_code", p.passCode, "ticket_type_name", p.productName}
	deny := func(result, reason string) (*Row, error) {
		if err := logEntry(result); err != nil {
			return nil, err
		}
		return object(append([]any{"ok", false, "result", result, "reason", reason}, holder...)...), nil
	}
	grant := func(extra ...any) (*Row, error) {
		if err := logEntry("granted"); err != nil {
			return nil, err
		}
		kv := append([]any{"ok", true, "result", "granted"}, holder...)
		kv = append(kv, "valid_until", p.validUntil, "entry_policy", p.entryPolicy)
		return object(append(kv, extra...)...), nil
	}

	if p.status != "active" {
		reason := "Pass berstatus " + p.status
		if p.status == "pending" {
			reason = "Pass belum aktif (menunggu pembayaran)"
		}
		return deny("denied_inactive", reason)
	}
	if (p.validFrom != nil && *p.validFrom != "" && today < *p.validFrom) || (p.validUntil != nil && *p.validUntil != "" && today > *p.validUntil) {
		return deny("denied_expired", "Pass di luar masa berlaku")
	}
	var blackout bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM ticketing.ticket_product_dates
		WHERE ticket_product_id = $1 AND date_kind = 'blackout'
		  AND is_active = true AND $2::date BETWEEN start_date AND end_date)`, p.productID, today).Scan(&blackout); err != nil {
		return nil, err
	}
	if blackout {
		return deny("denied_blackout", "Tanggal ini blackout untuk pass ini")
	}

	switch p.entryPolicy {
	case "limited_visits":
		total := deref(p.quotaTotal)
		if p.quotaUsed >= total {
			return deny("denied_quota", "Jatah kunjungan sudah habis")
		}
		if _, err := tx.Exec(ctx, `UPDATE ticketing.ticket_season_passes
			SET visit_quota_used = visit_quota_used + 1, updated_at = now() WHERE id = $1`, p.id); err != nil {
			return nil, err
		}
		return grant("remaining_quota", total-p.quotaUsed-1)
	case "once_per_day":
		var dup bool
		if err := tx.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM ticketing.ticket_pass_entries
			WHERE season_pass_id = $1 AND entry_date = $2 AND result = 'granted')`, p.id, today).Scan(&dup); err != nil {
			return nil, err
		}
		if dup {
			return deny("denied_duplicate", "Pass sudah dipakai masuk hari ini")
		}
	}
	return grant()
}
