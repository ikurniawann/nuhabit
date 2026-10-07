package ticketing

import (
	"errors"
	"math"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"time"

	"nuhabit/backend/internal/modules/ticketing/domain"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/validate"
)

// Operator routes: bookings, gate, visits, season passes, tab, occupancy
// and the report. Each handler keeps the TS order of guard, rate limit,
// id check and body validation, since that order decides which error wins.

var (
	required     = validate.Rule{}
	optional     = validate.Rule{Optional: true}
	optionalNull = validate.Rule{Optional: true, Nullable: true}
	hasDefault   = validate.Rule{HasDefault: true}
	cashMethods  = []string{"cash", "qris", "card"}
	maxAmount    = validate.NumOpts{Positive: true, Max: validate.Bound(1_000_000_000)}
)

func trimmed(min, max int) validate.StrOpts { return validate.StrOpts{Trim: true, Min: min, Max: max} }

// query is URLSearchParams.get(key) ?? fallback.
func query(q url.Values, key, fallback string) string {
	if vals, ok := q[key]; ok {
		return vals[0]
	}
	return fallback
}

func queryTrim(q url.Values, key string) string { return validate.JSTrim(query(q, key, "")) }

// requireBookingID is requireBookingId: not a UUID is a 404.
func requireBookingID(id string) error {
	if !validate.IsUUID(id) {
		return httpx.NotFound("Booking tidak dikenal")
	}
	return nil
}

// requireNfcUID is requireNfcUid.
func requireNfcUID(raw, msg string) (string, error) {
	uid := domain.NormalizeNfcUID(raw)
	if !domain.IsValidNfcUID(uid) {
		return "", httpx.BadRequest(msg)
	}
	return uid, nil
}

// ── Bookings ─────────────────────────────────────────────────────────────

func (h *handler) listBookings(w http.ResponseWriter, r *http.Request, v Venue) error {
	q := r.URL.Query()
	page, limit := readPage(q, 50)
	res, err := h.svc.ListBookings(r.Context(), v, query(q, "date", ""), query(q, "status", ""), queryTrim(q, "q"), page, limit)
	if err != nil {
		return err
	}
	return paginated(w, res.Items, page, limit, res.Total)
}

func (h *handler) lookupBooking(w http.ResponseWriter, r *http.Request, v Venue) error {
	if err := h.limit(r.Context(), v, "ticketing-booking-lookup", 60, "Terlalu banyak pencarian — tunggu sebentar"); err != nil {
		return err
	}
	code := domain.NormalizeBookingCode(query(r.URL.Query(), "code", ""))
	if code == "" {
		return httpx.BadRequest("Kode booking tidak valid (format BK-XXXXXX)")
	}
	b, err := h.svc.LookupBooking(r.Context(), v, code)
	if err != nil {
		return err
	}
	return ok(w, b)
}

func (h *handler) bookingDetail(w http.ResponseWriter, r *http.Request, v Venue) error {
	id := r.PathValue("id")
	if err := requireBookingID(id); err != nil {
		return err
	}
	b, err := h.svc.BookingDetail(r.Context(), v, id)
	if err != nil {
		return err
	}
	return ok(w, b)
}

func (h *handler) updateBookingNotes(w http.ResponseWriter, r *http.Request, v Venue) error {
	if err := h.limit(r.Context(), v, "ticketing-booking-refund-note", 20, "Terlalu banyak aksi — coba lagi sebentar"); err != nil {
		return err
	}
	id := r.PathValue("id")
	if err := requireBookingID(id); err != nil {
		return err
	}
	f, err := readForm(r)
	if err != nil {
		return err
	}
	note := f.Str("refund_note", optional, trimmed(1, 500))
	clear := false
	if raw, sent, done := f.Take("clear_webhook_alert", "true", optional); sent && !done {
		clear = raw == true
		if !clear {
			f.Fail("clear_webhook_alert", "invalid_value", "Invalid input: expected true")
		}
	}
	if !f.Valid() || (note == nil && !clear) {
		return httpx.BadRequest("Catatan refund wajib diisi (maks 500 karakter)")
	}
	updated, err := h.svc.UpdateBookingNotes(r.Context(), v, id, note, clear)
	if err != nil {
		return err
	}
	msg := "Catatan refund tersimpan"
	if clear && note == nil {
		msg = "Alert ditandai selesai"
	}
	return ok(w, object("id", updated), msg)
}

func (h *handler) cancelBooking(w http.ResponseWriter, r *http.Request, v Venue) error {
	if err := h.limit(r.Context(), v, "ticketing-booking-cancel", 20, "Terlalu banyak aksi — coba lagi sebentar"); err != nil {
		return err
	}
	id := r.PathValue("id")
	if err := requireBookingID(id); err != nil {
		return err
	}
	f, err := readForm(r)
	if err != nil {
		return err
	}
	note := f.Str("refund_note", optionalNull, trimmed(0, 500))
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	code, err := h.svc.CancelBooking(r.Context(), v, id, orNil(note))
	if err != nil {
		return err
	}
	return ok(w, object("id", id), "Booking "+code+" dibatalkan")
}

func (h *handler) redeemBooking(w http.ResponseWriter, r *http.Request, v Venue) error {
	if err := h.limit(r.Context(), v, "ticketing-booking-redeem", 20, "Terlalu banyak redeem — coba lagi sebentar"); err != nil {
		return err
	}
	id := r.PathValue("id")
	if err := requireBookingID(id); err != nil {
		return err
	}
	f, err := readForm(r)
	if err != nil {
		return err
	}
	var bands []RedeemBand
	items := f.List("bands", required, 20, func(list *validate.Form, i int, raw any) {
		item := list.Item(i, raw)
		bands = append(bands, RedeemBand{
			NfcUID:  deref(item.Str("nfc_uid", required, trimmed(1, 80))),
			GuestID: deref(item.UUID("guest_id", required)),
		})
	})
	if items != nil && len(items) < 1 {
		f.Fail("bands", "too_small", "Too small: expected array to have >=1 items")
	}
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	visitID, code, err := h.svc.RedeemBooking(r.Context(), v, id, bands)
	if err != nil {
		return err
	}
	return ok(w, object("visit_id", visitID), "Booking "+code+" di-redeem — gelang siap dipakai")
}

func (h *handler) resendBookingWa(w http.ResponseWriter, r *http.Request, v Venue) error {
	if err := h.limit(r.Context(), v, "ticketing-booking-resend", 10, "Terlalu sering kirim ulang — tunggu sebentar"); err != nil {
		return err
	}
	id := r.PathValue("id")
	if err := requireBookingID(id); err != nil {
		return err
	}
	code, phone, err := h.svc.ResendBookingWa(r.Context(), v, id)
	if err != nil {
		return err
	}
	return ok(w, object("booking_code", code), "WA terkirim ulang ke "+phone)
}

// ── Gate ─────────────────────────────────────────────────────────────────

func (h *handler) gateTap(w http.ResponseWriter, r *http.Request, v Venue) error {
	if err := h.limit(r.Context(), v, "ticketing-gate", 120, "Terlalu banyak tap — tunggu sebentar"); err != nil {
		return err
	}
	f, err := readForm(r)
	if err != nil {
		return err
	}
	rawUID := f.Str("nfc_uid", required, trimmed(1, 80))
	gate := f.Str("gate_label", optional, trimmed(0, 60))
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	uid, err := requireNfcUID(*rawUID, "UID gelang tidak valid")
	if err != nil {
		return err
	}
	out, err := h.svc.GateTap(r.Context(), v, uid, trimmedOr(gate, "gate-1"))
	if err != nil {
		return err
	}
	return ok(w, out)
}

func (h *handler) passTap(w http.ResponseWriter, r *http.Request, v Venue) error {
	if err := h.limit(r.Context(), v, "ticketing-pass-gate", 120, "Terlalu banyak scan — tunggu sebentar"); err != nil {
		return err
	}
	f, err := readForm(r)
	if err != nil {
		return err
	}
	code := f.Str("code", required, trimmed(1, 120))
	gate := f.Str("gate_label", optional, trimmed(0, 60))
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	out, err := h.svc.PassTap(r.Context(), v, *code, trimmedOr(gate, "gate-pass"))
	if err != nil {
		return err
	}
	return ok(w, out)
}

// ── Visits ───────────────────────────────────────────────────────────────

func (h *handler) listVisits(w http.ResponseWriter, r *http.Request, v Venue) error {
	q := r.URL.Query()
	status := query(q, "status", "")
	if !slices.Contains(VisitStatuses, status) {
		status = "open"
	}
	page, limit := readPage(q, 50)
	res, err := h.svc.ListVisits(r.Context(), v, status, queryTrim(q, "q"), page, limit)
	if err != nil {
		return err
	}
	return paginated(w, res.Items, page, limit, res.Total)
}

func parsePayment(f *validate.Form) DepositInput {
	return DepositInput{
		Method: deref(f.Enum("method", required, cashMethods)),
		Amount: deref(f.Num("amount", required, maxAmount)),
	}
}

func (h *handler) registerVisit(w http.ResponseWriter, r *http.Request, v Venue) error {
	if err := h.limit(r.Context(), v, "ticketing-register", 20, "Terlalu banyak registrasi — coba lagi sebentar"); err != nil {
		return err
	}
	f, err := readForm(r)
	if err != nil {
		return err
	}
	in := RegisterVisitInput{
		ContactName:  deref(f.Str("contact_name", required, trimmed(1, 150))),
		ContactPhone: f.Str("contact_phone", optionalNull, trimmed(0, 30)),
		PaymentMode:  deref(f.Enum("payment_mode", required, []string{"postpaid", "prepaid"})),
		CreditLimit:  f.Num("credit_limit", optionalNull, validate.NumOpts{Min: validate.Bound(0), Max: validate.Bound(1_000_000_000)}),
	}
	if _, present, done := f.Take("deposit", "object", optionalNull); present && !done {
		dep := f.Child("deposit")
		// The deposit object reads amount then method (schema order).
		d := DepositInput{Amount: deref(dep.Num("amount", required, maxAmount)), Method: deref(dep.Enum("method", required, cashMethods))}
		in.Deposit = &d
	}
	f.List("bands", hasDefault, 50, func(list *validate.Form, i int, raw any) {
		item := list.Item(i, raw)
		in.Bands = append(in.Bands, BandVariant{
			NfcUID:    deref(item.Str("nfc_uid", required, trimmed(1, 80))),
			VariantID: deref(item.UUID("variant_id", required)),
		})
	})
	f.List("bundles", hasDefault, 10, func(list *validate.Form, i int, raw any) {
		item := list.Item(i, raw)
		b := BundlePurchase{BundleVariantID: deref(item.UUID("bundle_variant_id", required))}
		uids := item.List("band_uids", required, 20, func(l *validate.Form, j int, raw any) {
			s, _ := l.CheckString(j, raw, trimmed(1, 80))
			b.BandUIDs = append(b.BandUIDs, s)
		})
		if uids != nil && len(uids) < 1 {
			item.Fail("band_uids", "too_small", "Too small: expected array to have >=1 items")
		}
		in.Bundles = append(in.Bundles, b)
	})
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	id, err := h.svc.RegisterVisit(r.Context(), v, in)
	if err != nil {
		return err
	}
	return ok(w, object("id", id), "Kunjungan terdaftar")
}

func (h *handler) visitDetail(w http.ResponseWriter, r *http.Request, v Venue) error {
	out, err := h.svc.VisitDetail(r.Context(), v, r.PathValue("id"))
	if err != nil {
		return err
	}
	return ok(w, out)
}

func (h *handler) topUpDeposit(w http.ResponseWriter, r *http.Request, v Venue) error {
	if err := h.limit(r.Context(), v, "ticketing-topup", 20, "Terlalu banyak top-up — coba lagi sebentar"); err != nil {
		return err
	}
	id := r.PathValue("id")
	f, err := readForm(r)
	if err != nil {
		return err
	}
	amount := f.Num("amount", required, maxAmount)
	method := f.Enum("method", required, cashMethods)
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	if err := h.svc.TopUpDeposit(r.Context(), v, id, *amount, *method); err != nil {
		return err
	}
	return ok(w, object("id", id), "Top-up tersimpan")
}

func (h *handler) settleVisit(w http.ResponseWriter, r *http.Request, v Venue) error {
	if err := h.limit(r.Context(), v, "ticketing-settle", 20, "Terlalu banyak settlement — coba lagi sebentar"); err != nil {
		return err
	}
	id := r.PathValue("id")
	f, err := readForm(r)
	if err != nil {
		return err
	}
	in := SettleInput{VisitBandID: f.UUID("visit_band_id", optionalNull)}
	f.List("payments", optional, 5, func(list *validate.Form, i int, raw any) {
		in.Payments = append(in.Payments, parsePayment(list.Item(i, raw)))
	})
	in.RefundMethod = f.Enum("refund_method", optional, cashMethods)
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	out, err := h.svc.SettleVisit(r.Context(), v, id, in)
	if err != nil {
		return err
	}
	return ok(w, out, "Settlement berhasil")
}

func (h *handler) voidCharge(w http.ResponseWriter, r *http.Request, v Venue) error {
	if err := h.limit(r.Context(), v, "ticketing-void", 20, "Terlalu banyak void — coba lagi sebentar"); err != nil {
		return err
	}
	id, chargeID := r.PathValue("id"), r.PathValue("chargeId")
	f, err := readForm(r)
	if err != nil {
		return err
	}
	reason := f.Str("reason", required, trimmed(3, 200))
	if !f.Valid() {
		return httpx.BadRequest("Alasan void wajib diisi (min 3 karakter)")
	}
	if err := h.svc.VoidCharge(r.Context(), v, id, chargeID, *reason); err != nil {
		return err
	}
	return ok(w, object("id", chargeID), "Tagihan di-void")
}

func (h *handler) markBandLost(w http.ResponseWriter, r *http.Request, v Venue) error {
	if err := h.limit(r.Context(), v, "ticketing-band-lost", 20, "Terlalu banyak aksi — coba lagi sebentar"); err != nil {
		return err
	}
	out, err := h.svc.MarkBandLost(r.Context(), v, r.PathValue("id"), r.PathValue("bandId"))
	if err != nil {
		return err
	}
	return ok(w, out, "Gelang ditandai hilang — tagihannya tetap tertagih saat settlement")
}

// ── Season passes ────────────────────────────────────────────────────────

func (h *handler) listSeasonPasses(w http.ResponseWriter, r *http.Request, v Venue) error {
	rows, err := h.svc.ListSeasonPasses(r.Context(), v, queryTrim(r.URL.Query(), "q"))
	if err != nil {
		return err
	}
	return ok(w, rows)
}

func (h *handler) issueSeasonPass(w http.ResponseWriter, r *http.Request, v Venue) error {
	f, err := readForm(r)
	if err != nil {
		return err
	}
	in := IssuePassInput{
		TicketProductID: deref(f.UUID("ticket_product_id", required)),
		HolderName:      deref(f.Str("holder_name", required, trimmed(2, 120))),
		HolderPhone:     f.Str("holder_phone", optionalNull, trimmed(0, 25)),
		BandUID:         f.Str("band_uid", optionalNull, trimmed(0, 64)),
	}
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	pass, err := h.svc.IssueSeasonPass(r.Context(), v, in)
	if err != nil {
		return err
	}
	return ok(w, pass, "Pass "+pass.Str("pass_code")+" diterbitkan")
}

func (h *handler) passOptions(w http.ResponseWriter, r *http.Request, v Venue) error {
	rows, err := h.svc.PassOptions(r.Context(), v)
	if err != nil {
		return err
	}
	return ok(w, rows)
}

func (h *handler) renewSeasonPass(w http.ResponseWriter, r *http.Request, v Venue) error {
	out, err := h.svc.RenewSeasonPass(r.Context(), v, r.PathValue("id"))
	if err != nil {
		return err
	}
	return ok(w, out, "Pass diperpanjang s/d "+domain.FormatDate(out.Str("valid_until")))
}

// ── Tab, occupancy, report ───────────────────────────────────────────────

func (h *handler) tabCheck(w http.ResponseWriter, r *http.Request, v Venue) error {
	if err := h.limit(r.Context(), v, "ticketing-tab-check", 60, "Terlalu banyak pengecekan — tunggu sebentar"); err != nil {
		return err
	}
	f, err := readForm(r)
	if err != nil {
		return err
	}
	rawUID := f.Str("nfc_uid", required, trimmed(1, 80))
	amount := f.Num("amount", required, validate.NumOpts{Min: validate.Bound(0), Max: validate.Bound(1_000_000_000)})
	if err := f.Err("Validation failed"); err != nil {
		return err
	}
	uid, err := requireNfcUID(*rawUID, "UID gelang tidak valid")
	if err != nil {
		return err
	}
	out, err := h.svc.TabCheck(r.Context(), v, uid, *amount)
	if err != nil {
		return err
	}
	return ok(w, out)
}

func (h *handler) tabStats(w http.ResponseWriter, r *http.Request, v Venue) error {
	out, err := h.svc.TabStats(r.Context(), v)
	if err != nil {
		return err
	}
	return ok(w, out)
}

// maxRangeDays bounds the occupancy and report ranges.
const maxRangeDays = 92

func (h *handler) occupancy(w http.ResponseWriter, r *http.Request, v Venue) error {
	q := r.URL.Query()
	from, to := query(q, "from", ""), query(q, "to", "")
	if msg := domain.DateRangeError(from, to, maxRangeDays); msg != "" {
		return httpx.BadRequest(msg)
	}
	days, err := h.svc.Occupancy(r.Context(), v, from, to)
	if err != nil {
		return err
	}
	return ok(w, object("days", days))
}

// jsAddDays is addDaysIso on any string: Date.UTC over the first three
// "-" parts, ok=false when that is an Invalid Date (toISOString throws).
func jsAddDays(iso string, days int) (string, bool) {
	parts := strings.Split(iso, "-")
	if len(parts) < 3 {
		return "", false
	}
	var n [3]float64
	for i := range n {
		n[i] = domain.JSNumber(parts[i])
		if math.IsNaN(n[i]) || math.IsInf(n[i], 0) {
			return "", false
		}
	}
	t := time.Date(int(n[0]), time.Month(int(n[1])), int(n[2])+days, 0, 0, 0, 0, time.UTC)
	return t.Format("2006-01-02"), true
}

// errInvalidDate is addDaysIso's RangeError on a "to" that is no date.
var errInvalidDate = errors.New("ticketing: invalid report end date")

func (h *handler) report(w http.ResponseWriter, r *http.Request, v Venue) error {
	q := r.URL.Query()
	to := query(q, "to", h.svc.today())
	from, sent := q["from"]
	start := ""
	if sent {
		start = from[0]
	} else {
		var valid bool
		if start, valid = jsAddDays(to, -6); !valid {
			return errInvalidDate
		}
	}
	if msg := domain.DateRangeError(start, to, maxRangeDays); msg != "" {
		return httpx.BadRequest(msg)
	}
	rep, err := h.svc.Report(r.Context(), v, start, to)
	if err != nil {
		return err
	}
	return ok(w, rep)
}
