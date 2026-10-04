package domain

import "testing"

func TestShareOfGross(t *testing.T) {
	for _, c := range []struct {
		amount, gross float64
		want          any
	}{
		{100_000, 5_000_000, "2,0%"},
		{-612_500, 5_000_000, "12,3%"}, // 12.25 rounds half up like Intl
		{1_000, 5_000_000, "<0,1%"},
		{60_000_000, 5_000_000, "1.200,0%"},
		{0, 5_000_000, nil},
		{100, 0, nil},
	} {
		var got any
		if p := ShareOfGross(c.amount, c.gross); p != nil {
			got = *p
		}
		if got != c.want {
			t.Errorf("ShareOfGross(%v, %v) = %v, want %v", c.amount, c.gross, got, c.want)
		}
	}
}

func TestLoanInstallmentLabel(t *testing.T) {
	s := func(v string) *string { return &v }
	tenor := 3
	for want, d := range map[string]LoanInstallmentDetail{
		"Cicilan Kasbon (2/3)":     {LoanType: s("kasbon"), InstallmentNo: 2, TenorMonths: &tenor},
		"Cicilan Pinjaman Darurat": {LoanType: s("emergency")},
		"Cicilan koperasi (1/3)":   {LoanType: s("koperasi"), InstallmentNo: 1, TenorMonths: &tenor},
		"Cicilan Pinjaman":         {},
	} {
		if got := LoanInstallmentLabel(d); got != want {
			t.Errorf("%q, want %q", got, want)
		}
	}
}

func TestPayslipFileName(t *testing.T) {
	for want, in := range map[string]struct {
		name        string
		month, year int
	}{
		"Slip-Gaji-Budi-Santoso-Juni-2026.pdf":    {"Budi Santoso", 6, 2026},
		"Slip-Gaji-Zoe-Nunez-O-CEO-Juni-2026.pdf": {"  Zoë  Ñúñez-Ö (CEO) ", 6, 2026},
		"Slip-Gaji-Karyawan-13-2026.pdf":          {"日本", 13, 2026},
	} {
		if got := PayslipFileName(in.name, in.month, in.year); got != want {
			t.Errorf("%q, want %q", got, want)
		}
	}
}
