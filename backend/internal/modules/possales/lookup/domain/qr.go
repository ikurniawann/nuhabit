// Package domain holds the pure rules of the POS lookups: member QR checks
// (port of the QR section of lib/crm/engagement/rules.ts) and the season
// pass member discount (app/api/pos/pass-lookup/route.ts).
package domain

import (
	"strconv"
	"time"
)

// WIB is Asia/Jakarta (UTC+7, no DST); a fixed zone needs no tzdata.
var WIB = time.FixedZone("WIB", 7*3600)

// QrProblem is why a member QR is refused; "" means the QR is valid.
type QrProblem string

const (
	QrNotFound QrProblem = "not_found"
	QrExpired  QrProblem = "expired"
	QrConsumed QrProblem = "consumed"
)

// QrProblemLabel is QR_PROBLEM_LABEL, the reason the cashier reads out.
var QrProblemLabel = map[QrProblem]string{
	QrNotFound: "QR tidak dikenal",
	QrExpired:  "QR kedaluwarsa, minta member membuka ulang kartunya",
	QrConsumed: "QR sudah dipakai",
}

// QrToken is a crm.member_qr_tokens row.
type QrToken struct {
	ExpiresAt  time.Time
	ConsumedAt *time.Time
}

// CheckQrToken is checkQrToken: unknown, then consumed, then expired. Times
// compare in milliseconds like JS Dates.
func CheckQrToken(t *QrToken, now time.Time) QrProblem {
	switch {
	case t == nil:
		return QrNotFound
	case t.ConsumedAt != nil:
		return QrConsumed
	case t.ExpiresAt.UnixMilli() < now.UnixMilli():
		return QrExpired
	}
	return ""
}

var (
	wibWeekdays = [...]string{"Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"}
	wibMonths   = [...]string{"Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"}
)

// FormatWib is formatWib: toLocaleString("id-ID") with a short weekday,
// day, short month and 24-hour time in Asia/Jakarta ("Min, 4 Okt, 14.05").
func FormatWib(t time.Time) string {
	w := t.In(WIB)
	return wibWeekdays[w.Weekday()] + ", " + strconv.Itoa(w.Day()) + " " + wibMonths[w.Month()-1] + ", " + w.Format("15.04")
}

// VisitRecordedBody is the body of the "visit_recorded" notification a
// member gets after a successful scan.
func VisitRecordedBody(name *string, at time.Time) string {
	greeting := ""
	if name != nil && *name != "" {
		greeting = ", " + *name
	}
	return "Terima kasih sudah mampir" + greeting + ". Kunjungan " + FormatWib(at) + " sudah tercatat."
}
