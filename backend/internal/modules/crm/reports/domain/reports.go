// Package domain holds the pure parts of the fixed CRM reports
// (lib/crm/reports.ts): the report period and the row mappers.
package domain

import (
	"math"
	"regexp"
	"strconv"
	"time"
)

// Period mirrors ReportPeriod: FromISO inclusive, ToISO exclusive.
type Period struct {
	FromISO  string
	ToISO    string
	FromDate string
	ToDate   string
	From, To time.Time
}

var datePattern = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

const maxPeriodDays = 366

// parseJSDate is `new Date("YYYY-MM-DDT00:00:00.000Z")` in V8: month 1-12
// and day 1-31 are accepted, out-of-month days roll over (Feb 30 = Mar 2).
func parseJSDate(s string) (time.Time, bool) {
	y, _ := strconv.Atoi(s[0:4])
	m, _ := strconv.Atoi(s[5:7])
	d, _ := strconv.Atoi(s[8:10])
	if m < 1 || m > 12 || d < 1 || d > 31 {
		return time.Time{}, false
	}
	return time.Date(y, time.Month(m), d, 0, 0, 0, 0, time.UTC), true
}

// ResolvePeriod mirrors resolveReportPeriod: default from the first of the
// current UTC month to today (UTC); invalid, reversed or > 366 days is nil.
func ResolvePeriod(fromParam, toParam string, now time.Time) *Period {
	now = now.UTC()
	from := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
	to := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
	for _, p := range []struct {
		raw string
		dst *time.Time
	}{{fromParam, &from}, {toParam, &to}} {
		if p.raw == "" {
			continue
		}
		if !datePattern.MatchString(p.raw) {
			return nil
		}
		t, ok := parseJSDate(p.raw)
		if !ok {
			return nil
		}
		*p.dst = t
	}
	if from.After(to) || to.Sub(from) > maxPeriodDays*24*time.Hour {
		return nil
	}
	toExclusive := to.Add(24 * time.Hour)
	iso := func(t time.Time) string { return t.Format("2006-01-02T15:04:05.000Z") }
	return &Period{
		FromISO: iso(from), ToISO: iso(toExclusive),
		FromDate: from.Format("2006-01-02"), ToDate: to.Format("2006-01-02"),
		From: from, To: toExclusive,
	}
}

// AsText mirrors asText: a non-empty string, else the fallback (a Date or
// number is not a string, so it falls back too).
func AsText(v any, fallback string) string {
	if s, ok := v.(string); ok && s != "" {
		return s
	}
	return fallback
}

// Reconciliation mirrors VenueReconciliationRow.
type Reconciliation struct {
	CompanyID      *string `json:"company_id"`
	BranchID       *string `json:"branch_id"`
	CompanyName    string  `json:"company_name"`
	BranchName     string  `json:"branch_name"`
	TopupAmount    float64 `json:"topup_amount"`
	BonusAmount    float64 `json:"bonus_amount"`
	FocTopupAmount float64 `json:"foc_topup_amount"`
	SpendAmount    float64 `json:"spend_amount"`
	OtherAmount    float64 `json:"other_amount"`
	TopupCount     float64 `json:"topup_count"`
	FocTopupCount  float64 `json:"foc_topup_count"`
	PaymentCount   float64 `json:"payment_count"`
	NetFlow        float64 `json:"net_flow"`
}

// Totals mirrors ReconciliationTotals.
type Totals struct {
	TopupAmount    float64 `json:"topup_amount"`
	BonusAmount    float64 `json:"bonus_amount"`
	FocTopupAmount float64 `json:"foc_topup_amount"`
	SpendAmount    float64 `json:"spend_amount"`
	NetFlow        float64 `json:"net_flow"`
}

// NetFlow is topup + bonus + foc - spend.
func NetFlow(topup, bonus, foc, spend float64) float64 { return topup + bonus + foc - spend }

// SumReconciliation mirrors sumReconciliation.
func SumReconciliation(rows []Reconciliation) Totals {
	var t Totals
	for _, r := range rows {
		t.TopupAmount += r.TopupAmount
		t.BonusAmount += r.BonusAmount
		t.FocTopupAmount += r.FocTopupAmount
		t.SpendAmount += r.SpendAmount
		t.NetFlow += r.NetFlow
	}
	return t
}

// Round2 mirrors the CS report's toNum: null stays null, else
// Math.round(Number(v) * 100) / 100.
func Round2(v *float64) *float64 {
	if v == nil {
		return nil
	}
	x := jsRound(*v*100) / 100
	return &x
}

// jsRound is Math.round.
func jsRound(v float64) float64 { return math.Floor(v + 0.5) }
