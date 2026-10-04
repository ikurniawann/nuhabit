package domain

import (
	"math"
	"strings"
	"time"
)

// jpMinSalary is the Jaminan Pensiun participation threshold.
const jpMinSalary = 5_000_000

// Input is PayrollInput in lib/payroll/calculator.ts. Optional TS fields
// are pointers only where `undefined` falls back to a config value.
type Input struct {
	EmployeeID  string
	PeriodMonth int
	PeriodYear  int

	BaseSalary          float64
	FixedAllowance      float64
	VariableAllowance   float64
	TransportAllowance  float64
	MealAllowance       float64
	HousingAllowance    float64
	OvertimeHours       float64
	OvertimeRate        *float64 // nil: config.OvertimeMultiplier
	OvertimeHolidayHrs  float64
	OvertimeHolidayRate *float64 // nil: config.OvertimeHolidayMult
	Bonus               float64

	WorkingDays     float64
	PresentDays     float64
	LateDays        float64
	LateMinutes     float64
	UnpaidLeaveDays float64

	LoanDeduction float64
	LoanBreakdown []LoanInstallmentDetail

	JoinDate         string // YYYY-MM-DD
	EmploymentStatus string
	ContractType     *string // pkwt | pkwtt, nil without a contract record
	ProrateFactor    *float64
	PTKPStatus       string
	IsTaxable        bool

	BpjsTkEnrolled  bool
	BpjsKesEnrolled bool
	TaperaEnrolled  bool

	IncludeThr bool
}

// Result is PayrollResult.
type Result struct {
	BaseSalary, FixedAllowance, VariableAllowance, TransportAllowance float64
	MealAllowance, HousingAllowance, OvertimePay, Thr, Bonus          float64
	OtherEarning, GrossSalary                                         float64

	BpjsTkJhtDeduction, BpjsTkJpDeduction, BpjsKesDeduction, TaperaDeduction float64
	Pph21Deduction, UnpaidLeaveDeduction, LateDeduction, LoanDeduction       float64
	OtherDeduction, TotalDeductions                                          float64

	OvertimeHours float64
	NetSalary     float64

	BpjsTkJhtEmployer, BpjsTkJpEmployer, BpjsTkJkkEmployer, BpjsTkJkmEmployer float64
	BpjsKesEmployer, TaperaEmployer, TotalEmployerContribution                float64

	TaxableIncome, PTKPAmount, Pph21Annual, Pph21Monthly float64
}

// PTKPAmount is getPTKPAmount: unknown statuses fall back to TK/0.
func PTKPAmount(status string, c Config) float64 {
	if v, ok := c.PTKP[strings.ToUpper(status)]; ok {
		return v
	}
	return c.PTKP["TK/0"]
}

// PPh21 is calculatePPh21ETR: progressive tax on annual taxable income
// after PTKP, PKP rounded down to whole thousands.
func PPh21(annualTaxable float64, status string, c Config) (annual, monthly float64) {
	pkp := math.Floor(math.Max(0, annualTaxable-PTKPAmount(status, c))/1000) * 1000
	tax, remaining := 0.0, pkp
	for _, b := range c.Brackets {
		if remaining <= 0 {
			break
		}
		tax += math.Min(remaining, b.Width) * b.Rate
		remaining -= b.Width
	}
	return Round(tax), Round(tax / 12)
}

// BPJS is calculateBPJS, rounded per component.
type BPJS struct {
	Employee struct{ TkJht, TkJp, Kes, Tapera, Total float64 }
	Employer struct{ TkJht, TkJp, TkJkk, TkJkm, Kes, Tapera, Total float64 }
}

// CalculateBPJS computes employee deductions and employer contributions on
// the monthly basis (BPJS TK and Kes capped separately).
func CalculateBPJS(monthly float64, tk, kes, tapera bool, c Config) BPJS {
	r := c.Rates
	tkBase := math.Min(monthly, c.CapBpjsTk)
	kesBase := math.Min(monthly, c.CapBpjsKes)
	on := func(enrolled bool, v float64) float64 {
		if enrolled {
			return v
		}
		return 0
	}
	jht := on(tk, tkBase*r.BpjsTkJht)
	jp := on(tk && monthly >= jpMinSalary, tkBase*r.BpjsTkJp)
	kesE := on(kes, kesBase*r.BpjsKes)
	tap := on(tapera, tkBase*r.Tapera)

	jhtR := on(tk, tkBase*r.BpjsTkJhtEmployer)
	jpR := on(tk, tkBase*r.BpjsTkJpEmployer)
	jkk := on(tk, tkBase*r.BpjsTkJkkEmployer)
	jkm := on(tk, tkBase*r.BpjsTkJkmEmployer)
	kesR := on(kes, kesBase*r.BpjsKesEmployer)
	tapR := on(tapera, tkBase*r.TaperaEmployer)

	var b BPJS
	b.Employee.TkJht, b.Employee.TkJp, b.Employee.Kes, b.Employee.Tapera = Round(jht), Round(jp), Round(kesE), Round(tap)
	b.Employee.Total = Round(jht + jp + kesE + tap)
	b.Employer.TkJht, b.Employer.TkJp, b.Employer.TkJkk, b.Employer.TkJkm = Round(jhtR), Round(jpR), Round(jkk), Round(jkm)
	b.Employer.Kes, b.Employer.Tapera = Round(kesR), Round(tapR)
	b.Employer.Total = Round(jhtR + jpR + jkk + jkm + kesR + tapR)
	return b
}

// THR is calculateTHR: full base salary when joined before the period year,
// otherwise prorated by 30-day months worked until 31 December.
func THR(base float64, joinDate string, periodYear int) float64 {
	join, err := time.Parse("2006-01-02", joinDate)
	if err != nil {
		// new Date("garbage") is Invalid Date: every comparison is false and
		// the month count is NaN, so Math.round(NaN) propagates.
		return math.NaN()
	}
	if join.Before(time.Date(periodYear, 1, 1, 0, 0, 0, 0, time.UTC)) {
		return base
	}
	dec31 := time.Date(periodYear, 12, 31, 0, 0, 0, 0, time.UTC)
	months := math.Floor(float64(dec31.Sub(join).Milliseconds()) / (1000 * 60 * 60 * 24 * 30))
	return Round(base * math.Min(12, math.Max(1, months)) / 12)
}

// Overtime is calculateOvertime.
func Overtime(hours, hourlyRate, multiplier float64) float64 {
	return Round(hours * hourlyRate * multiplier)
}

// UnpaidLeave is calculateUnpaidLeave.
func UnpaidLeave(base, workingDays, days float64) float64 {
	if workingDays <= 0 {
		return 0
	}
	return Round(base / workingDays * days)
}

// LateDeduction is calculateLateDeduction.
func LateDeduction(minutes, days float64, c Config) float64 {
	switch c.LateMode {
	case "per_minute":
		return Round(minutes * c.LateAmount)
	case "flat":
		return Round(days * c.LateAmount)
	}
	return 0
}

// JabatanExpense is calculateJabatanExpense.
func JabatanExpense(annualGross float64, c Config) float64 {
	return math.Min(annualGross*c.JabatanPercentage, c.JabatanMaxPerYear)
}

// Calculate is calculatePayroll.
func Calculate(in Input, c Config) Result {
	overtimeRate := c.OvertimeMultiplier
	if in.OvertimeRate != nil {
		overtimeRate = *in.OvertimeRate
	}
	holidayRate := c.OvertimeHolidayMult
	if in.OvertimeHolidayRate != nil {
		holidayRate = *in.OvertimeHolidayRate
	}
	factor := 1.0
	if in.ProrateFactor != nil {
		factor = *in.ProrateFactor
	}
	factor = math.Min(1, math.Max(0, factor))
	fullBase := in.BaseSalary
	base := Round(fullBase * factor)

	hourly := 0.0
	if c.OvertimeHourlyDivisor > 0 {
		hourly = fullBase / c.OvertimeHourlyDivisor
	}
	overtimePay := Overtime(in.OvertimeHours, hourly, overtimeRate) + Overtime(in.OvertimeHolidayHrs, hourly, holidayRate)

	thr := 0.0
	if in.IncludeThr && (in.ContractType != nil || in.EmploymentStatus == "permanent") {
		thr = THR(fullBase, in.JoinDate, in.PeriodYear)
	}

	fixed := Round(in.FixedAllowance * factor)
	variable := Round(in.VariableAllowance * factor)
	transport := Round(in.TransportAllowance * factor)
	meal := Round(in.MealAllowance * factor)
	housing := Round(in.HousingAllowance * factor)

	gross := base + fixed + variable + transport + meal + housing + overtimePay + thr + in.Bonus

	b := CalculateBPJS(base+fixed, in.BpjsTkEnrolled, in.BpjsKesEnrolled, in.TaperaEnrolled, c)
	unpaid := UnpaidLeave(base, in.WorkingDays, in.UnpaidLeaveDays)
	late := LateDeduction(in.LateMinutes, in.LateDays, c)

	annualGross := gross * 12
	taxable := math.Max(0, annualGross-b.Employee.Total*12-JabatanExpense(annualGross, c))
	pphAnnual, pph := 0.0, 0.0
	if in.IsTaxable {
		pphAnnual, pph = PPh21(taxable, in.PTKPStatus, c)
	}

	total := b.Employee.TkJht + b.Employee.TkJp + b.Employee.Kes + b.Employee.Tapera +
		pph + unpaid + late + in.LoanDeduction
	net := gross - total
	employer := b.Employer.Total

	return Result{
		BaseSalary: Round(base), FixedAllowance: fixed, VariableAllowance: variable,
		TransportAllowance: transport, MealAllowance: meal, HousingAllowance: housing,
		OvertimePay: Round(overtimePay), Thr: Round(thr), Bonus: Round(in.Bonus),
		OtherEarning: 0, GrossSalary: Round(gross),

		BpjsTkJhtDeduction: b.Employee.TkJht, BpjsTkJpDeduction: b.Employee.TkJp,
		BpjsKesDeduction: b.Employee.Kes, TaperaDeduction: Round(b.Employee.Tapera),
		Pph21Deduction: Round(pph), UnpaidLeaveDeduction: Round(unpaid),
		LateDeduction: Round(late), LoanDeduction: Round(in.LoanDeduction),
		OtherDeduction: 0, TotalDeductions: Round(total),

		OvertimeHours: in.OvertimeHours,
		NetSalary:     Round(net),

		BpjsTkJhtEmployer: b.Employer.TkJht, BpjsTkJpEmployer: b.Employer.TkJp,
		BpjsTkJkkEmployer: b.Employer.TkJkk, BpjsTkJkmEmployer: b.Employer.TkJkm,
		BpjsKesEmployer: b.Employer.Kes, TaperaEmployer: b.Employer.Tapera,
		TotalEmployerContribution: Round(employer),

		TaxableIncome: Round(taxable), PTKPAmount: PTKPAmount(in.PTKPStatus, c),
		Pph21Annual: Round(pphAnnual), Pph21Monthly: Round(pph),
	}
}

// RunTotals is the payroll_runs total columns (sumRunTotals).
type RunTotals struct {
	TotalGross        float64 `json:"total_gross"`
	TotalDeductions   float64 `json:"total_deductions"`
	TotalNet          float64 `json:"total_net"`
	TotalBjtkEmployee float64 `json:"total_bjtk_employee"`
	TotalBjtkEmployer float64 `json:"total_bjtk_employer"`
	TotalPph21        float64 `json:"total_pph21"`
}

// SumRunTotals adds the per-employee results.
func SumRunTotals(results []Result) RunTotals {
	var t RunTotals
	for _, r := range results {
		t.TotalGross += r.GrossSalary
		t.TotalDeductions += r.TotalDeductions
		t.TotalNet += r.NetSalary
		t.TotalBjtkEmployee += r.BpjsTkJhtDeduction + r.BpjsTkJpDeduction + r.BpjsKesDeduction + r.TaperaDeduction
		t.TotalBjtkEmployer += r.TotalEmployerContribution
		t.TotalPph21 += r.Pph21Deduction
	}
	return t
}
