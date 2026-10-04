package domain

// Report balance rules (reports-store.ts, cash-bank-store.ts,
// beginning-balance-store.ts).

// AsNormal maps a stored normal_balance to DEBIT/CREDIT.
func AsNormal(v string) string {
	if v == Credit {
		return Credit
	}
	return Debit
}

// Balance is computeBalance: signed by the normal side, contra flips.
func Balance(debit, credit float64, normal string, isContra bool) float64 {
	raw := debit - credit
	if normal != Debit {
		raw = credit - debit
	}
	if isContra {
		raw = -raw
	}
	return Round2(raw)
}

// SignedDelta is one line's effect on a running balance.
func SignedDelta(side string, amount float64, normal string, isContra bool) float64 {
	increase := (normal == Debit && side == Debit) || (normal == Credit && side == Credit)
	delta := -amount
	if increase {
		delta = amount
	}
	if isContra {
		delta = -delta
	}
	return delta
}

// TrialBalanceColumns puts the net in the debit or the credit column.
func TrialBalanceColumns(debit, credit float64) (float64, float64) {
	net := Round2(debit - credit)
	switch {
	case net > 0:
		return net, 0
	case net < 0:
		return 0, Round2(-net)
	}
	return 0, 0
}

// IsProfitLossType reports the P&L account types.
func IsProfitLossType(code string) bool {
	switch code {
	case "REVENUE", "COGS", "EXPENSE", "OTHER_INCOME", "OTHER_EXPENSE":
		return true
	}
	return false
}

// EarningsContribution is a P&L account's contribution to equity.
func EarningsContribution(typeCode string, balance float64) float64 {
	if typeCode == "REVENUE" || typeCode == "OTHER_INCOME" {
		return balance
	}
	return -balance
}

// CashFlowContribution is the indirect-lite cash effect of a non-cash
// account's period balance (section() in reports-store.ts).
func CashFlowContribution(typeCode string, balance float64) float64 {
	switch typeCode {
	case "REVENUE", "OTHER_INCOME", "LIABILITY", "EQUITY":
		return balance
	}
	return -balance
}

// OpeningLine is lineFromNet: the single opening line of a net position.
func OpeningLine(debit, credit float64) (side string, amount float64, ok bool) {
	net := Round2(debit - credit)
	switch {
	case net > 0:
		return Debit, net, true
	case net < 0:
		return Credit, Round2(-net), true
	}
	return "", 0, false
}

// BalanceTypeOrder sorts beginning balance lines: assets, liabilities,
// equity, then the rest.
func BalanceTypeOrder(code string) int {
	switch code {
	case "ASSET":
		return 1
	case "LIABILITY":
		return 2
	case "EQUITY":
		return 3
	}
	return 9
}
