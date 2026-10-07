package domain

import (
	"math"
	"regexp"
	"strings"
)

// Member bills (lib/pos/member-bill.ts), the deposit model: instalments
// are recorded on the member's account without pointing at an order; once
// the deposits cover EVERY open order, those orders close together.

// MemberBillPaymentMethod is the payment_method of orders closed through a
// member bill, MemberBillPaymentLabel its label.
const (
	MemberBillPaymentMethod = "member_bill"
	MemberBillPaymentLabel  = "Tagihan Member"
)

// IsMemberBillHandler: the POS handlers an instalment may use.
func IsMemberBillHandler(handler string) bool {
	return handler == "cash" || handler == "qris" || handler == "credit"
}

var (
	focCodeRe = regexp.MustCompile(`^foc$|^free[_-]?of[_-]?charge$`)
	focNameRe = regexp.MustCompile(`(?i)^\s*f\.?\s?o\.?\s?c\.?\s*$|free\s*of\s*charge`)
)

// IsFocPaymentMethod mirrors isFocPaymentMethod.
func IsFocPaymentMethod(code, name string) bool {
	c := strings.ToLower(strings.TrimSpace(code))
	if c != "" && focCodeRe.MatchString(c) {
		return true
	}
	return name != "" && focNameRe.MatchString(name)
}

// IsMemberBillMethod: a regular handler that is not FOC (free).
func IsMemberBillMethod(handler, code, name string) bool {
	return IsMemberBillHandler(handler) && !IsFocPaymentMethod(code, name)
}

// MemberBillBaseMethod is cashierMethodFromHandler for the bill handlers.
func MemberBillBaseMethod(handler string) string {
	switch handler {
	case "credit":
		return "credit_card"
	case "qris":
		return "qris"
	}
	return "cash"
}

// MemberBillBalance is computeMemberBillBalance's result.
type MemberBillBalance struct {
	OpenTotal   float64 `json:"openTotal"`
	Credit      float64 `json:"credit"`
	Outstanding float64 `json:"outstanding"`
	Surplus     float64 `json:"surplus"`
	CanSettle   bool    `json:"canSettle"`
}

// ComputeMemberBillBalance: open orders against the unused deposits.
func ComputeMemberBillBalance(openTotal, paymentsTotal, settledTotal float64) MemberBillBalance {
	open := RoundIdr(math.Max(0, openTotal))
	credit := RoundIdr(math.Max(0, paymentsTotal-settledTotal))
	diff := RoundIdr(open - credit)
	return MemberBillBalance{
		OpenTotal: open, Credit: credit,
		Outstanding: math.Max(0, diff), Surplus: math.Max(0, -diff),
		CanSettle: open > 0 && diff <= 0,
	}
}

// ValidateMemberBillAmount: > 0, whole rupiah, not above the outstanding
// bill; "" means valid.
func ValidateMemberBillAmount(amount, outstanding float64) string {
	switch {
	case math.IsNaN(amount) || math.IsInf(amount, 0) || amount <= 0:
		return "Nominal bayar harus lebih dari 0"
	case JSRound(amount) != amount:
		return "Nominal bayar harus bilangan rupiah bulat"
	case outstanding <= 0:
		return "Tidak ada sisa tagihan untuk dibayar"
	case amount > outstanding+0.005:
		return "Nominal melebihi sisa tagihan"
	}
	return ""
}

// MemberDepositEvent is the deposit journal event of a base method, ""
// when it posts none.
func MemberDepositEvent(baseMethod string) string {
	switch strings.ToLower(baseMethod) {
	case "cash":
		return "POS_MEMBER_DEPOSIT_CASH"
	case "qris":
		return "POS_MEMBER_DEPOSIT_QRIS"
	case "credit_card", "credit", "debit":
		return "POS_MEMBER_DEPOSIT_CARD"
	}
	return ""
}
