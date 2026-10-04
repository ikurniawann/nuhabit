package domain

import (
	"cmp"
	"slices"

	"nuhabit/backend/internal/platform/jsmath"
)

// RunSlipShare is what one payroll slip contributes to the run's journals.
type RunSlipShare struct {
	EmployeeID                      string
	Gross, Net, Pph21               float64
	BpjsTkEmployer, BpjsKesEmployer float64
}

// CompanyTotals is one company's share of a paid run. CompanyID is "" for
// the employees whose company is unknown.
type CompanyTotals struct {
	CompanyID                       string
	Gross, Net, Pph21               float64
	LoanDeduction                   float64
	BpjsTkEmployer, BpjsKesEmployer float64
}

// SplitRunByCompany groups a paid run's slips by each employee's company
// (companies maps employee id to company id) and adds the loan installments
// settled per employee. Groups are ordered by company id, the employees
// without a company last; amounts are rounded to cents.
func SplitRunByCompany(slips []RunSlipShare, loans map[string]float64, companies map[string]string) []CompanyTotals {
	byCompany := map[string]*CompanyTotals{}
	for _, s := range slips {
		id := companies[s.EmployeeID]
		g := byCompany[id]
		if g == nil {
			g = &CompanyTotals{CompanyID: id}
			byCompany[id] = g
		}
		g.Gross += s.Gross
		g.Net += s.Net
		g.Pph21 += s.Pph21
		g.LoanDeduction += loans[s.EmployeeID]
		g.BpjsTkEmployer += s.BpjsTkEmployer
		g.BpjsKesEmployer += s.BpjsKesEmployer
	}
	out := make([]CompanyTotals, 0, len(byCompany))
	for _, g := range byCompany {
		for _, v := range []*float64{&g.Gross, &g.Net, &g.Pph21, &g.LoanDeduction, &g.BpjsTkEmployer, &g.BpjsKesEmployer} {
			*v = jsmath.RoundTo(*v, 2)
		}
		out = append(out, *g)
	}
	slices.SortFunc(out, func(a, b CompanyTotals) int {
		if (a.CompanyID == "") != (b.CompanyID == "") {
			if a.CompanyID == "" {
				return 1
			}
			return -1
		}
		return cmp.Compare(a.CompanyID, b.CompanyID)
	})
	return out
}
