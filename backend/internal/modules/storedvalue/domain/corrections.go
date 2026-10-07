package domain

import (
	"fmt"
	"math"
	"strings"

	"nuhabit/backend/internal/platform/validate"
)

// Admin wallet corrections (lib/wallet/corrections.ts): manual adjustment,
// entry reversal, top-up refund. The server applies the result inside a
// transaction with the member row locked.

const (
	maxAdjustmentIdr = 100_000_000
	minReasonLength  = 5
)

// RefundMethods is REFUND_METHODS.
var RefundMethods = []string{"cash", "transfer", "other"}

func checkReason(reason string) string {
	if validate.UTF16Len(validate.JSTrim(reason)) < minReasonLength {
		return fmt.Sprintf("Alasan wajib diisi (minimal %d karakter)", minReasonLength)
	}
	return ""
}

func wouldGoNegative(balance, delta float64) string {
	if RoundIdr(balance+delta) < 0 {
		return "Saldo member tidak cukup: koreksi ini membuat saldo minus"
	}
	return ""
}

func firstProblem(problems ...string) string {
	for _, p := range problems {
		if p != "" {
			return p
		}
	}
	return ""
}

// ValidateAdjustment returns the signed delta, or the rejection message.
func ValidateAdjustment(amount float64, reason string, balance float64) (float64, string) {
	a := RoundIdr(amount)
	if math.IsNaN(a) || math.IsInf(a, 0) || a == 0 {
		return 0, "Nominal penyesuaian tidak boleh 0"
	}
	if math.Abs(a) > maxAdjustmentIdr {
		return 0, "Nominal penyesuaian melebihi batas Rp 100.000.000"
	}
	if p := firstProblem(checkReason(reason), wouldGoNegative(balance, a)); p != "" {
		return 0, p
	}
	return a, ""
}

var notReversible = map[string]string{
	"reversal":     "Entri pembatalan tidak bisa dibatalkan lagi",
	"topup_refund": "Refund top-up tidak bisa dibatalkan; gunakan penyesuaian manual",
}

// ValidateReversal returns the reversing delta and the lot it unpins, or
// the rejection message.
func ValidateReversal(entry LedgerRow, reason string, balance float64, alreadyReversed bool) (float64, []LotAllocation, string) {
	if msg, blocked := notReversible[entry.Type]; blocked {
		return 0, nil, msg
	}
	if !IsCompleted(entry.Status) {
		return 0, nil, "Hanya entri berstatus selesai yang bisa dibatalkan"
	}
	if alreadyReversed {
		return 0, nil, "Entri ini sudah pernah dibatalkan"
	}
	if truthy(entry.Metadata["refunded_at"]) {
		return 0, nil, "Top-up ini sudah direfund"
	}
	original := SignedDelta(entry)
	if original == 0 {
		return 0, nil, "Entri tanpa nominal tidak bisa dibatalkan"
	}
	delta := RoundIdr(-original)
	allocations := []LotAllocation{}
	if IsLotRow(entry) {
		allocations = []LotAllocation{{LotID: entry.ID, Amount: original}}
	}
	if p := firstProblem(checkReason(reason), wouldGoNegative(balance, delta)); p != "" {
		return 0, nil, p
	}
	return delta, allocations, ""
}

// TopupRefund is a validated top-up refund.
type TopupRefund struct {
	RemoveIdr   float64
	RefundIdr   float64
	Manual      bool
	Allocations []LotAllocation
}

// ValidateTopupRefund: the top-up credit plus its bonus leave the balance;
// the price paid is returned outside the system. Xendit QRIS has no refund
// API, so a QRIS top-up is always a manual refund.
func ValidateTopupRefund(topup LedgerRow, paymentMethod *string, bonus *LedgerRow, balance float64, alreadyRefunded, alreadyReversed bool, method, reason string) (TopupRefund, string) {
	if topup.Type != "topup" {
		return TopupRefund{}, "Hanya entri top-up yang bisa direfund"
	}
	if !IsCompleted(topup.Status) {
		return TopupRefund{}, "Top-up belum selesai; batalkan transaksi pending dari kasir"
	}
	pm := ""
	if paymentMethod != nil {
		pm = strings.ToLower(*paymentMethod)
	}
	if pm == "foc" {
		return TopupRefund{}, "Top-up FOC tidak dibayar; gunakan pembatalan entri"
	}
	if alreadyRefunded || truthy(topup.Metadata["refunded_at"]) {
		return TopupRefund{}, "Top-up ini sudah direfund"
	}
	if alreadyReversed {
		return TopupRefund{}, "Top-up ini sudah dibatalkan"
	}
	validMethod := false
	for _, m := range RefundMethods {
		if m == method {
			validMethod = true
		}
	}
	if !validMethod {
		return TopupRefund{}, "Metode refund tidak valid"
	}
	topupIdr := SignedDelta(topup)
	bonusIdr := 0.0
	if bonus != nil && IsCompleted(bonus.Status) {
		bonusIdr = SignedDelta(*bonus)
	}
	removeIdr := RoundIdr(topupIdr + bonusIdr)
	allocations := []LotAllocation{{LotID: topup.ID, Amount: topupIdr}}
	if bonus != nil && bonusIdr > 0 {
		allocations = append(allocations, LotAllocation{LotID: bonus.ID, Amount: bonusIdr})
	}
	if p := firstProblem(checkReason(reason), wouldGoNegative(balance, -removeIdr)); p != "" {
		return TopupRefund{}, p
	}
	return TopupRefund{RemoveIdr: removeIdr, RefundIdr: topupIdr, Manual: pm == "qris", Allocations: allocations}, ""
}

// truthy is JS truthiness for a decoded JSON value.
func truthy(v any) bool {
	switch x := v.(type) {
	case nil:
		return false
	case bool:
		return x
	case string:
		return x != ""
	case float64:
		return x != 0 && !math.IsNaN(x)
	}
	return true
}
