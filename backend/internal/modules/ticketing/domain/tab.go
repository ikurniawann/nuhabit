package domain

// Two-way tab ledger (tab.ts): debit = charges (tiket/fnb/denda/koreksi/
// refund-deposit), kredit = money in (deposit/pembayaran) plus promo
// discounts. Amounts are positive; direction carries the sign.

// Charge directions.
const (
	Debit  = "debit"
	Kredit = "kredit"
)

// TabEntry is one ledger line.
type TabEntry struct {
	Direction string
	Amount    float64
}

// TabSummary is computeTabSummary's result.
type TabSummary struct {
	Debit       float64 `json:"debit"`
	Kredit      float64 `json:"kredit"`
	Outstanding float64 `json:"outstanding"`
	Saldo       float64 `json:"saldo"`
}

// ComputeTabSummary sums both sides, rounded to 2dp.
func ComputeTabSummary(entries []TabEntry) TabSummary {
	var debit, kredit float64
	for _, e := range entries {
		if e.Direction == Debit {
			debit += e.Amount
		} else {
			kredit += e.Amount
		}
	}
	debit, kredit = Round2(debit), Round2(kredit)
	return TabSummary{Debit: debit, Kredit: kredit, Outstanding: Round2(debit - kredit), Saldo: Round2(kredit - debit)}
}

// CanCharge is canCharge: "" when a new debit of amount is allowed,
// otherwise the rejection reason.
func CanCharge(paymentMode string, summary TabSummary, amount float64, creditLimit *float64) string {
	amount = Round2(amount)
	if amount <= 0 {
		return "Nominal charge harus > 0"
	}
	if paymentMode == "prepaid" {
		if Round2(summary.Saldo-amount) < 0 {
			return "Saldo tidak cukup (saldo " + FormatRupiah(summary.Saldo) + ") — silakan top-up dulu"
		}
		return ""
	}
	if creditLimit != nil && Round2(summary.Outstanding+amount) > *creditLimit {
		return "Melewati plafon tagihan " + FormatRupiah(*creditLimit) + " — silakan bayar parsial di kasir"
	}
	return ""
}

// SettlementPlan is settlementPlan's result.
type SettlementPlan struct {
	AmountDue    float64 `json:"amountDue"`
	RefundAmount float64 `json:"refundAmount"`
}

// PlanSettlement is settlementPlan: what closes the ledger.
func PlanSettlement(summary TabSummary) SettlementPlan {
	switch {
	case summary.Outstanding > 0:
		return SettlementPlan{AmountDue: summary.Outstanding}
	case summary.Outstanding < 0:
		return SettlementPlan{RefundAmount: Round2(-summary.Outstanding)}
	}
	return SettlementPlan{}
}
