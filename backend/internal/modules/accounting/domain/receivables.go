package domain

import (
	"fmt"
	"strings"
	"time"
	"unicode/utf16"
)

// AP/AR payment statuses and aging buckets (ap-status.ts).
var AgingBuckets = []string{"current", "1_30", "31_60", "61_90", "90_plus"}

// InvoiceOutstanding is computeInvoiceOutstanding.
func InvoiceOutstanding(total, allocated float64) float64 {
	v := Round2(total) - Round2(allocated)
	if v < 0 || v == 0 {
		return 0
	}
	return v
}

// PaymentStatus is resolvePaymentStatus. Dates are "YYYY-MM-DD", so they
// compare as strings.
func PaymentStatus(total, allocated float64, dueDate *string, today string) string {
	if InvoiceOutstanding(total, allocated) <= 0.009 {
		return "paid"
	}
	pastDue := dueDate != nil && *dueDate != "" && *dueDate < today
	if Round2(allocated) > 0.009 {
		if pastDue {
			return "overdue"
		}
		return "partial"
	}
	if pastDue {
		return "overdue"
	}
	return "unpaid"
}

func parseLocalDate(s string) (time.Time, bool) {
	t, err := time.Parse("2006-01-02T15:04:05", s+"T00:00:00")
	return t, err == nil
}

// DaysPastDue is daysPastDue: negative when not yet due, 0 when either date
// does not parse.
func DaysPastDue(dueDate *string, asOf string) int {
	if dueDate == nil || *dueDate == "" {
		return 0
	}
	due, ok1 := parseLocalDate(*dueDate)
	at, ok2 := parseLocalDate(asOf)
	if !ok1 || !ok2 {
		return 0
	}
	ms := at.Sub(due).Milliseconds()
	days := ms / 86_400_000
	if ms%86_400_000 != 0 && ms < 0 {
		days--
	}
	return int(days)
}

// BucketAging is bucketAging; "" when nothing is outstanding.
func BucketAging(outstanding float64, dueDate *string, asOf string) string {
	if Round2(outstanding) <= 0 {
		return ""
	}
	days := DaysPastDue(dueDate, asOf)
	switch {
	case days <= 0:
		return "current"
	case days <= 30:
		return "1_30"
	case days <= 60:
		return "31_60"
	case days <= 90:
		return "61_90"
	}
	return "90_plus"
}

// VoidReasonMinLength is VOID_REASON_MIN_LENGTH.
const VoidReasonMinLength = 5

// EvaluateApPaymentVoid is evaluateApPaymentVoid; nil when the void may go
// ahead. found=false covers a missing or soft-deleted payment.
func EvaluateApPaymentVoid(found bool, status, reason string) *Rejection {
	if !found {
		return &Rejection{Status: 404, Message: "Pembayaran AP tidak ditemukan"}
	}
	if len(utf16.Encode([]rune(strings.TrimFunc(reason, IsJSSpace)))) < VoidReasonMinLength {
		return &Rejection{Status: 400, Message: fmt.Sprintf("Alasan void wajib diisi (minimal %d karakter)", VoidReasonMinLength)}
	}
	if status == StatusVoid {
		return &Rejection{Status: 409, Message: "Pembayaran ini sudah di-void"}
	}
	if status != StatusPosted {
		return &Rejection{Status: 409, Message: "Hanya pembayaran POSTED yang bisa di-void"}
	}
	return nil
}

// InvoicePaymentSummary is the finance invoicePaymentSummary.
func InvoicePaymentSummary(amount, paid float64) (status string, outstanding float64) {
	switch {
	case amount > 0 && paid >= amount:
		status = "lunas"
	case paid > 0:
		status = "sebagian"
	default:
		status = "belum"
	}
	outstanding = MathRound(float64((amount-paid)*100)) / 100
	if outstanding < 0 || outstanding == 0 {
		outstanding = 0
	}
	return status, outstanding
}
