package domain

import (
	"math"
	"slices"
)

// Bracket is one PPh 21 layer: Width rupiah (not a cumulative limit) at Rate.
type Bracket struct {
	Width float64
	Rate  float64
}

// Config is PayrollConfig in lib/payroll/config.ts.
type Config struct {
	Rates struct {
		BpjsTkJht, BpjsTkJp, BpjsKes, Tapera                   float64
		BpjsTkJhtEmployer, BpjsTkJpEmployer, BpjsTkJkkEmployer float64
		BpjsTkJkmEmployer, BpjsKesEmployer, TaperaEmployer     float64
	}
	CapBpjsTk, CapBpjsKes  float64
	Brackets               []Bracket
	PTKP                   map[string]float64 // "TK/0" … "K/3"
	JabatanPercentage      float64
	JabatanMaxPerYear      float64
	OvertimeMultiplier     float64
	OvertimeHolidayMult    float64
	OvertimeHourlyDivisor  float64
	LateMode               string // off | per_minute | flat
	LateAmount             float64
	LoanMaxInstallmentPct  float64
	LoanMaxActivePerPerson float64
}

// DefaultConfig is DEFAULT_PAYROLL_CONFIG (2026 rates).
func DefaultConfig() Config {
	var c Config
	c.Rates.BpjsTkJht, c.Rates.BpjsTkJp, c.Rates.BpjsKes, c.Rates.Tapera = 0.02, 0.01, 0.01, 0.025
	c.Rates.BpjsTkJhtEmployer, c.Rates.BpjsTkJpEmployer = 0.037, 0.02
	c.Rates.BpjsTkJkkEmployer, c.Rates.BpjsTkJkmEmployer = 0.0024, 0.003
	c.Rates.BpjsKesEmployer, c.Rates.TaperaEmployer = 0.04, 0.005
	c.CapBpjsTk, c.CapBpjsKes = 10414000, 12000000
	c.Brackets = []Bracket{
		{60_000_000, 0.05}, {190_000_000, 0.15}, {250_000_000, 0.25},
		{4_500_000_000, 0.3}, {math.Inf(1), 0.35},
	}
	c.PTKP = map[string]float64{
		"TK/0": 54_000_000, "TK/1": 58_500_000, "TK/2": 63_000_000, "TK/3": 67_500_000,
		"K/0": 58_500_000, "K/1": 63_000_000, "K/2": 67_500_000, "K/3": 72_000_000,
	}
	c.JabatanPercentage, c.JabatanMaxPerYear = 0.05, 6_000_000
	c.OvertimeMultiplier, c.OvertimeHolidayMult, c.OvertimeHourlyDivisor = 1.5, 2, 173
	c.LateMode, c.LateAmount = "off", 0
	c.LoanMaxInstallmentPct, c.LoanMaxActivePerPerson = 30, 1
	return c
}

// Row is a database row as the TS reads it: a missing key is undefined, a
// nil value is null, numerics are their text.
type Row map[string]any

// num is `toNumber(row?.key, fallback)`: undefined or NaN falls back, null is 0.
func (r Row) num(key string, fallback float64) float64 {
	if r == nil {
		return fallback
	}
	v, ok := r[key]
	if !ok {
		return fallback
	}
	n := JSNumber(v)
	if !Finite(n) {
		return fallback
	}
	return n
}

// fraction is `toFraction(row?.key, fallback)`.
func (r Row) fraction(key string, fallback float64) float64 {
	if r == nil {
		return fallback
	}
	if _, ok := r[key]; !ok {
		return fallback
	}
	n := r.num(key, math.NaN())
	if math.IsNaN(n) {
		return fallback
	}
	return n / 100
}

// CumulativeLimitsToBrackets turns cumulative bracket limits (as stored)
// into layer widths; the layer past the last limit is unbounded.
func CumulativeLimitsToBrackets(limits, rates []float64) []Bracket {
	out := make([]Bracket, 0, len(rates))
	previous := 0.0
	for i, rate := range rates {
		if i >= len(limits) {
			out = append(out, Bracket{math.Inf(1), rate})
			continue
		}
		out = append(out, Bracket{math.Max(0, limits[i]-previous), rate})
		previous = limits[i]
	}
	return out
}

// BuildConfig is loadPayrollConfig over the first payroll_settings row and
// the active payroll_tax_config row of the tax year (either may be nil).
func BuildConfig(settings, taxConfig Row) Config {
	d := DefaultConfig()
	c := d
	taxSource := taxConfig
	if taxSource == nil {
		taxSource = settings
	}
	c.PTKP = map[string]float64{
		"TK/0": taxSource.num("ptkp_tk_0", d.PTKP["TK/0"]),
		"TK/1": taxSource.num("ptkp_tk_1", d.PTKP["TK/1"]),
		"TK/2": taxSource.num("ptkp_tk_2", d.PTKP["TK/2"]),
		"TK/3": taxSource.num("ptkp_tk_3", d.PTKP["TK/3"]),
		"K/0":  taxSource.num("ptkp_k_0", d.PTKP["K/0"]),
		"K/1":  taxSource.num("ptkp_k_1", d.PTKP["K/1"]),
		"K/2":  taxSource.num("ptkp_k_2", d.PTKP["K/2"]),
		"K/3":  taxSource.num("ptkp_k_3", d.PTKP["K/3"]),
	}
	switch {
	case taxConfig != nil:
		c.Brackets = CumulativeLimitsToBrackets(
			[]float64{
				taxConfig.num("bracket_1_limit", 60_000_000),
				taxConfig.num("bracket_2_limit", 250_000_000),
				taxConfig.num("bracket_3_limit", 500_000_000),
				taxConfig.num("bracket_4_limit", 5_000_000_000),
			},
			[]float64{
				taxConfig.fraction("bracket_1_rate", 0.05),
				taxConfig.fraction("bracket_2_rate", 0.15),
				taxConfig.fraction("bracket_3_rate", 0.25),
				taxConfig.fraction("bracket_4_rate", 0.3),
				taxConfig.fraction("bracket_5_rate", 0.35),
			})
	case settings != nil:
		rates := make([]float64, len(d.Brackets))
		for i, b := range d.Brackets {
			rates[i] = b.Rate
		}
		c.Brackets = CumulativeLimitsToBrackets(
			[]float64{
				settings.num("pph21_bracket_1", 60_000_000),
				settings.num("pph21_bracket_2", 250_000_000),
				settings.num("pph21_bracket_3", 500_000_000),
				settings.num("pph21_bracket_4", 5_000_000_000),
			}, rates)
	}
	c.Rates.BpjsTkJht = settings.fraction("bpjs_tk_jht_employee", d.Rates.BpjsTkJht)
	c.Rates.BpjsTkJp = settings.fraction("bpjs_tk_jp_employee", d.Rates.BpjsTkJp)
	c.Rates.BpjsKes = settings.fraction("bpjs_kes_employee", d.Rates.BpjsKes)
	c.Rates.Tapera = settings.fraction("tapera_employee", d.Rates.Tapera)
	c.Rates.BpjsTkJhtEmployer = settings.fraction("bpjs_tk_jht_employer", d.Rates.BpjsTkJhtEmployer)
	c.Rates.BpjsTkJpEmployer = settings.fraction("bpjs_tk_jp_employer", d.Rates.BpjsTkJpEmployer)
	c.Rates.BpjsTkJkkEmployer = settings.fraction("bpjs_tk_jkk", d.Rates.BpjsTkJkkEmployer)
	c.Rates.BpjsTkJkmEmployer = settings.fraction("bpjs_tk_jkm", d.Rates.BpjsTkJkmEmployer)
	c.Rates.BpjsKesEmployer = settings.fraction("bpjs_kes_employer", d.Rates.BpjsKesEmployer)
	c.Rates.TaperaEmployer = settings.fraction("tapera_employer", d.Rates.TaperaEmployer)
	c.CapBpjsKes = settings.num("bpjs_kes_max_upah", d.CapBpjsKes)
	c.JabatanPercentage = taxConfig.fraction("jabatan_expense_percentage", d.JabatanPercentage)
	c.JabatanMaxPerYear = taxConfig.num("jabatan_expense_max", d.JabatanMaxPerYear)
	c.OvertimeMultiplier = settings.num("overtime_multiplier", d.OvertimeMultiplier)
	c.OvertimeHolidayMult = settings.num("overtime_multiplier_holiday", d.OvertimeHolidayMult)
	c.OvertimeHourlyDivisor = settings.num("overtime_hourly_divisor", d.OvertimeHourlyDivisor)
	if mode, ok := settings["late_deduction_mode"].(string); ok && slices.Contains([]string{"off", "per_minute", "flat"}, mode) {
		c.LateMode = mode
	}
	c.LateAmount = settings.num("late_deduction_amount", d.LateAmount)
	c.LoanMaxInstallmentPct = settings.num("loan_max_installment_percent", d.LoanMaxInstallmentPct)
	c.LoanMaxActivePerPerson = settings.num("loan_max_active_per_employee", d.LoanMaxActivePerPerson)
	return c
}
