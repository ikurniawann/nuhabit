package domain

import (
	"fmt"
	"regexp"
	"strings"

	"nuhabit/backend/internal/platform/validate"
)

// Member NFC cards and balance refunds (lib/pos/card-unlink.ts,
// lib/pos/member-refund.ts, lib/pos/nfc-uid.ts).

// Refund wallet row: the balance leaves the member (money goes out).
const (
	RefundWalletType   = "withdrawal"
	RefundWalletMethod = "refund"
)

// ValidateCardUnlink checks the cashier's unlink reason; problem is "" when
// valid and notes is nil when empty.
func ValidateCardUnlink(reason, notes any) (string, *string, string) {
	r := validate.JSTrim(JSStringOrEmpty(reason))
	switch r {
	case "lost", "returned", "other":
	default:
		return "", nil, "Alasan unlink wajib dipilih (hilang / dikembalikan / lainnya)"
	}
	n := validate.JSTrim(JSStringOrEmpty(notes))
	if r == "other" && validate.UTF16Len(n) < 3 {
		return "", nil, "Tuliskan keterangan alasannya (minimal 3 karakter)"
	}
	if validate.UTF16Len(n) > 500 {
		return "", nil, "Keterangan maksimal 500 karakter"
	}
	if n == "" {
		return r, nil, ""
	}
	return r, &n, ""
}

// NormalizeNotes is normalizeNotes (max 500): trimmed, empty is nil.
func NormalizeNotes(input any) (*string, string) {
	n := validate.JSTrim(JSStringOrEmpty(input))
	if validate.UTF16Len(n) > 500 {
		return nil, "Keterangan maksimal 500 karakter"
	}
	if n == "" {
		return nil, ""
	}
	return &n, ""
}

// JSStringOrEmpty is String(v ?? "").
func JSStringOrEmpty(v any) string {
	switch x := v.(type) {
	case nil:
		return ""
	case map[string]any:
		return "[object Object]"
	case []any:
		parts := make([]string, len(x))
		for i, item := range x {
			parts[i] = JSStringOrEmpty(item)
		}
		return strings.Join(parts, ",")
	case fmt.Stringer:
		return x.String()
	}
	return JSString(v)
}

// BuildRefundWalletNotes is buildRefundWalletNotes.
func BuildRefundWalletNotes(approverName, requestID string) string {
	if approverName == "" {
		approverName = "supervisor"
	}
	short := requestID
	if len(short) > 8 {
		short = short[:8]
	}
	return "Refund saldo member (kartu dilepas) — disetujui " + approverName + " · permintaan " + short
}

// RefundCompletedMessage is refundCompletedMessage.
func RefundCompletedMessage(name, phone *string, amount float64) string {
	who := "member"
	if name != nil && *name != "" {
		who = *name
	} else if phone != nil && *phone != "" {
		who = *phone
	}
	return "Refund " + who + " selesai — " + FormatRupiah(amount) + " dikembalikan, saldo member kini Rp0"
}

var nonAlnum = regexp.MustCompile(`[^a-zA-Z0-9]`)

// NormalizeNfcUID is normalizeNfcUid.
func NormalizeNfcUID(v string) string {
	return strings.ToUpper(nonAlnum.ReplaceAllString(strings.TrimSpace(v), ""))
}
