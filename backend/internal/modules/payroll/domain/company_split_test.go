package domain

import (
	"reflect"
	"testing"
)

func TestSplitRunByCompany(t *testing.T) {
	slips := []RunSlipShare{
		{EmployeeID: "e1", Gross: 10000000, Net: 9000000, Pph21: 250000, BpjsTkEmployer: 400000.1, BpjsKesEmployer: 400000},
		{EmployeeID: "e2", Gross: 5000000, Net: 4800000, Pph21: 0, BpjsTkEmployer: 200000.2, BpjsKesEmployer: 200000},
		{EmployeeID: "e3", Gross: 3000000, Net: 3000000},
		{EmployeeID: "e4", Gross: 1000000, Net: 900000, Pph21: 10000},
	}
	loans := map[string]float64{"e1": 500000, "e3": 100000}
	companies := map[string]string{"e1": "c-b", "e2": "c-b", "e3": "c-a"}

	got := SplitRunByCompany(slips, loans, companies)
	want := []CompanyTotals{
		{CompanyID: "c-a", Gross: 3000000, Net: 3000000, LoanDeduction: 100000},
		{CompanyID: "c-b", Gross: 15000000, Net: 13800000, Pph21: 250000, LoanDeduction: 500000, BpjsTkEmployer: 600000.3, BpjsKesEmployer: 600000},
		{CompanyID: "", Gross: 1000000, Net: 900000, Pph21: 10000},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("split\n got %+v\nwant %+v", got, want)
	}
	if got := SplitRunByCompany(nil, nil, nil); len(got) != 0 {
		t.Fatalf("empty run %+v", got)
	}
}
