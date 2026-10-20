package domain

import (
	"cmp"
	"slices"
)

// SaleRow is the paid sales of one package, method and branch on one local day.
type SaleRow struct {
	Day         string
	PackageID   string
	PackageName string
	Kind        string
	Method      string
	BranchID    string
	BranchName  string
	Sales       int
	Gross       float64
}

// RefundRow is the refunds of one local day.
type RefundRow struct {
	Day    string
	Count  int
	Amount float64
}

// RevenueTotals sums the period.
type RevenueTotals struct {
	Sales   int     `json:"sales"`
	Gross   float64 `json:"gross"`
	Refunds int     `json:"refunds"`
	Refund  float64 `json:"refund_amount"`
	Net     float64 `json:"net"`
}

// RevenueDay is one local day of the revenue chart.
type RevenueDay struct {
	Day    string  `json:"day"`
	Sales  int     `json:"sales"`
	Gross  float64 `json:"gross"`
	Refund float64 `json:"refund_amount"`
	Net    float64 `json:"net"`
}

// RevenueGroup is a package, payment method or branch over the period.
type RevenueGroup struct {
	Key   string  `json:"key"`
	Name  string  `json:"name"`
	Kind  string  `json:"kind,omitempty"`
	Sales int     `json:"sales"`
	Gross float64 `json:"gross"`
	Share float64 `json:"share"`
}

// RevenueReport is package and pass sales over the period.
type RevenueReport struct {
	// Timezone is the zone the report's days read in.
	Timezone   string         `json:"timezone"`
	Totals     RevenueTotals  `json:"totals"`
	PerDay     []RevenueDay   `json:"per_day"`
	PerPackage []RevenueGroup `json:"per_package"`
	PerMethod  []RevenueGroup `json:"per_method"`
	PerBranch  []RevenueGroup `json:"per_branch"`
}

// NoBranchName labels sales without a branch.
const NoBranchName = "Tanpa cabang"

// RollUpRevenue folds sale and refund rows into the report. Sales count on
// the day they were paid, refunds on the day they were refunded.
func RollUpRevenue(sales []SaleRow, refunds []RefundRow, p Period) RevenueReport {
	perDay := make([]RevenueDay, 0, p.Days())
	index := map[string]int{}
	for i, key := range p.DayKeys() {
		perDay = append(perDay, RevenueDay{Day: key})
		index[key] = i
	}
	packages, methods, branches := map[string]*RevenueGroup{}, map[string]*RevenueGroup{}, map[string]*RevenueGroup{}
	var totals RevenueTotals
	for _, s := range sales {
		totals.Sales += s.Sales
		totals.Gross += s.Gross
		if i, ok := index[s.Day]; ok {
			perDay[i].Sales += s.Sales
			perDay[i].Gross += s.Gross
		}
		addSale(packages, s.PackageID, s.PackageName, s.Kind, s)
		addSale(methods, s.Method, s.Method, "", s)
		branchName := s.BranchName
		if s.BranchID == "" {
			branchName = NoBranchName
		}
		addSale(branches, s.BranchID, branchName, "", s)
	}
	for _, r := range refunds {
		totals.Refunds += r.Count
		totals.Refund += r.Amount
		if i, ok := index[r.Day]; ok {
			perDay[i].Refund += r.Amount
		}
	}
	for i := range perDay {
		perDay[i].Net = perDay[i].Gross - perDay[i].Refund
	}
	totals.Net = totals.Gross - totals.Refund
	return RevenueReport{
		Timezone:   p.ZoneName(),
		Totals:     totals,
		PerDay:     perDay,
		PerPackage: byGross(packages, totals.Gross),
		PerMethod:  byGross(methods, totals.Gross),
		PerBranch:  byGross(branches, totals.Gross),
	}
}

func addSale(m map[string]*RevenueGroup, key, name, kind string, s SaleRow) {
	g := m[key]
	if g == nil {
		g = &RevenueGroup{Key: key, Name: name, Kind: kind}
		m[key] = g
	}
	g.Sales += s.Sales
	g.Gross += s.Gross
}

func byGross(m map[string]*RevenueGroup, total float64) []RevenueGroup {
	out := make([]RevenueGroup, 0, len(m))
	for _, g := range m {
		if total > 0 {
			g.Share = g.Gross / total
		}
		out = append(out, *g)
	}
	slices.SortFunc(out, func(a, b RevenueGroup) int {
		return cmp.Or(cmp.Compare(b.Gross, a.Gross), cmp.Compare(a.Name, b.Name))
	})
	return out
}
