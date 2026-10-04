package domain

import (
	"crypto/rand"
	"fmt"
	"math/big"
	"regexp"
	"strconv"
	"strings"

	"nuhabit/backend/internal/platform/jsmath"
)

// Reservation statuses (RESERVATION_STATUSES).
const (
	StatusAwaitingPayment = "menunggu-bayar"
	StatusConfirmed       = "terkonfirmasi"
	StatusCheckedIn       = "check-in"
	StatusCheckedOut      = "check-out"
	StatusCancelled       = "dibatalkan"
	StatusNoShow          = "no-show"
)

// StatusLabels is RESERVATION_STATUS_LABELS.
var StatusLabels = map[string]string{
	StatusAwaitingPayment: "Menunggu bayar",
	StatusConfirmed:       "Terkonfirmasi",
	StatusCheckedIn:       "Sedang menginap",
	StatusCheckedOut:      "Selesai",
	StatusCancelled:       "Dibatalkan",
	StatusNoShow:          "Tidak datang",
}

// Sources is RESERVATION_SOURCES.
var Sources = []string{"walk-in", "website", "ota", "telepon", "korporat"}

// FolioChargeTypes is FOLIO_CHARGE_TYPES.
var FolioChargeTypes = []string{"kamar", "extra-bed", "fnb", "aktivitas", "laundry", "denda", "diskon", "pembayaran", "refund"}

// StatusActions is STATUS_ACTIONS mapped to the status each one sets
// (ACTION_TO_STATUS).
var StatusActions = map[string]string{
	"konfirmasi": StatusConfirmed,
	"check-in":   StatusCheckedIn,
	"check-out":  StatusCheckedOut,
	"batal":      StatusCancelled,
	"no-show":    StatusNoShow,
}

// StatusActionNames is STATUS_ACTIONS in schema order (the zod enum).
var StatusActionNames = []string{"konfirmasi", "check-in", "check-out", "batal", "no-show"}

// BlockingStatuses is INVENTORY_BLOCKING_STATUSES: reservations that still
// hold a room.
var BlockingStatuses = []string{StatusAwaitingPayment, StatusConfirmed, StatusCheckedIn}

var transitions = map[string][]string{
	StatusAwaitingPayment: {StatusConfirmed, StatusCancelled},
	StatusConfirmed:       {StatusCheckedIn, StatusCancelled, StatusNoShow},
	StatusCheckedIn:       {StatusCheckedOut},
}

// CanTransition is canTransition.
func CanTransition(from, to string) bool {
	for _, s := range transitions[from] {
		if s == to {
			return true
		}
	}
	return false
}

// TransitionError is the 409 message of a refused transition.
func TransitionError(from, to string) string {
	return fmt.Sprintf(`Tidak bisa mengubah status dari "%s" ke "%s"`, labelOf(from), labelOf(to))
}

// labelOf is RESERVATION_STATUS_LABELS[s] in a template literal
// ("undefined" for an unknown status).
func labelOf(s string) string {
	if l, ok := StatusLabels[s]; ok {
		return l
	}
	return "undefined"
}

// ChargeDirection is chargeDirection: payments, discounts and refunds
// credit the folio, everything else debits it.
func ChargeDirection(chargeType string) string {
	switch chargeType {
	case "pembayaran", "diskon", "refund":
		return "kredit"
	}
	return "debit"
}

const codeCharset = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789" // no I/O/0/1

// GenerateReservationCode is generateReservationCode.
func GenerateReservationCode() string {
	var b strings.Builder
	b.WriteString("RSV-")
	for range 6 {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(codeCharset))))
		if err != nil {
			panic(err)
		}
		b.WriteByte(codeCharset[n.Int64()])
	}
	return b.String()
}

// FolioLine is one folio row's direction and amount.
type FolioLine struct {
	Direction string
	Amount    float64
}

// FolioTotals is folioTotals.
type FolioTotals struct {
	Charges  float64 `json:"charges"`
	Payments float64 `json:"payments"`
	Balance  float64 `json:"balance"`
}

// Totals is folioTotals: charges, payments and balance (> 0 = guest owes).
func Totals(lines []FolioLine) FolioTotals {
	var t FolioTotals
	for _, l := range lines {
		if l.Direction == "debit" {
			t.Charges += l.Amount
		}
	}
	for _, l := range lines {
		if l.Direction == "kredit" {
			t.Payments += l.Amount
		}
	}
	t.Balance = t.Charges - t.Payments
	return t
}

// Balance is folioBalance: a running sum, debit positive.
func Balance(lines []FolioLine) float64 {
	sum := 0.0
	for _, l := range lines {
		if l.Direction == "debit" {
			sum += l.Amount
		} else {
			sum -= l.Amount
		}
	}
	return sum
}

var dateRe = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

// ValidDate reports a YYYY-MM-DD string.
func ValidDate(s string) bool { return dateRe.MatchString(s) }

// ValidateStayDates is validateStayDates: the error message or "".
func ValidateStayDates(checkIn, checkOut string) string {
	if !ValidDate(checkIn) || !ValidDate(checkOut) {
		return "Format tanggal harus YYYY-MM-DD"
	}
	if checkOut <= checkIn {
		return "Tanggal check-out harus setelah check-in"
	}
	return ""
}

// ReservationSummary is reservationSummary.
func ReservationSummary(code, guest string, nights, rooms int, total float64) string {
	return fmt.Sprintf("%s — %s, %d kamar × %d malam, total %s", code, guest, rooms, nights, FormatRupiah(total))
}

// FormatRupiah is formatRupiah: rounded, id-ID thousands dots, "Rp" prefix.
func FormatRupiah(v float64) string {
	n := jsmath.Round(v)
	sign := ""
	if n < 0 {
		sign, n = "-", -n
	}
	digits := strconv.FormatFloat(n, 'f', 0, 64)
	var b strings.Builder
	for i, c := range digits {
		if i > 0 && (len(digits)-i)%3 == 0 {
			b.WriteByte('.')
		}
		b.WriteRune(c)
	}
	return sign + "Rp" + b.String()
}
