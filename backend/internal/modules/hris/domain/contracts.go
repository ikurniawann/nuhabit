package domain

import (
	"fmt"
	"math"
	"strings"
	"time"
)

// Indonesian employment contract rules (UU 13/2003 jo. UU Cipta Kerja +
// PP 35/2021): a PKWT needs an end date, no probation, at most 60 months in
// total and a pro-rata compensation; a PKWTT may have up to 3 months of
// probation. Port of lib/hris/contracts.ts and contracts-list.ts.

const (
	PkwtMaxTotalMonths      = 60
	PkwttMaxProbationMonths = 3
)

// parseContractDate reads a contract date: "YYYY-MM-DD" or a full ISO
// timestamp, as new Date(value) would; ok=false is an invalid date.
func parseContractDate(s string) (time.Time, bool) {
	if s == "" {
		return time.Time{}, false
	}
	if DateRe.MatchString(s) && jsDateValid(s) {
		var y, m, d int
		fmt.Sscanf(s, "%d-%d-%d", &y, &m, &d)
		return time.Date(y, time.Month(m), d, 0, 0, 0, 0, time.UTC), true
	}
	for _, layout := range []string{time.RFC3339Nano, "2006-01-02T15:04:05", "2006-01-02T15:04"} {
		if t, err := time.Parse(layout, s); err == nil {
			return t.UTC(), true
		}
	}
	return time.Time{}, false
}

// MonthsWorked: whole calendar months plus remaining days / 30, rounded to
// two decimals; 0 for an invalid or reversed range.
func MonthsWorked(start, end string) float64 {
	s, ok1 := parseContractDate(start)
	e, ok2 := parseContractDate(end)
	if !ok1 || !ok2 || !e.After(s) {
		return 0
	}
	months := (e.Year()-s.Year())*12 + int(e.Month()) - int(s.Month())
	days := e.Day() - s.Day()
	if days < 0 {
		months--
		days += 30
	}
	return Round2(float64(months) + float64(days)/30)
}

// ComputeKompensasi (PP 35/2021 Pasal 16): months / 12 × monthly wage,
// nothing under one month, rounded to the rupiah.
func ComputeKompensasi(monthlyWage float64, start, end string) float64 {
	if !IsFinite(monthlyWage) || monthlyWage <= 0 {
		return 0
	}
	months := MonthsWorked(start, end)
	if months < 1 {
		return 0
	}
	return JSRound(months / 12 * monthlyWage)
}

// ContractDates is the date part of a contract.
type ContractDates struct {
	ContractType     string
	StartDate        string
	EndDate          *string
	ProbationEndDate *string
}

func nonEmpty(s *string) bool { return s != nil && *s != "" }

// ValidateContractDates returns the error messages (empty = valid).
func ValidateContractDates(in ContractDates) []string {
	errs := []string{}
	start, ok := parseContractDate(in.StartDate)
	if !ok {
		return append(errs, "Tanggal mulai kontrak tidak valid.")
	}
	var end, probation *time.Time
	if nonEmpty(in.EndDate) {
		if t, ok := parseContractDate(*in.EndDate); ok {
			end = &t
		} else {
			errs = append(errs, "Tanggal berakhir kontrak tidak valid.")
		}
	}
	if nonEmpty(in.ProbationEndDate) {
		if t, ok := parseContractDate(*in.ProbationEndDate); ok {
			probation = &t
		}
	}
	if end != nil && !end.After(start) {
		errs = append(errs, "Tanggal berakhir harus setelah tanggal mulai.")
	}
	if in.ContractType == "pkwt" {
		if end == nil {
			errs = append(errs, "PKWT wajib memiliki tanggal berakhir (perjanjian waktu tertentu).")
		}
		if nonEmpty(in.ProbationEndDate) {
			errs = append(errs, "PKWT tidak boleh memiliki masa percobaan — batal demi hukum (PP 35/2021).")
		}
	} else if probation != nil {
		if !probation.After(start) {
			errs = append(errs, "Akhir masa percobaan harus setelah tanggal mulai.")
		} else if probation.After(start.AddDate(0, PkwttMaxProbationMonths, 0)) {
			errs = append(errs, "Masa percobaan PKWTT maksimal 3 bulan (UU 13/2003 Pasal 60).")
		}
	}
	return errs
}

// ContractPeriod is one PKWT of the chain.
type ContractPeriod struct {
	StartDate string
	EndDate   *string
}

// PkwtChainTotalMonths sums the chain's months (periods without an end are
// skipped).
func PkwtChainTotalMonths(periods []ContractPeriod) float64 {
	total := 0.0
	for _, p := range periods {
		if p.EndDate != nil {
			total += MonthsWorked(p.StartDate, *p.EndDate)
		}
	}
	return Round2(total)
}

// ValidatePkwtTotal enforces the 60 month PKWT cap; "" passes.
func ValidatePkwtTotal(existingMonths, newMonths float64) string {
	total := existingMonths + newMonths
	if total <= PkwtMaxTotalMonths {
		return ""
	}
	return fmt.Sprintf("Total durasi PKWT karyawan ini akan menjadi %d bulan — "+
		"melebihi batas 5 tahun (%d bulan) sesuai PP 35/2021. "+
		"Pertimbangkan konversi ke PKWTT (karyawan tetap).", int(JSRound(total)), PkwtMaxTotalMonths)
}

// AddMonthsISO adds months, clamping the day to the target month's end.
func AddMonthsISO(dateISO string, months int) string {
	t, _ := time.Parse(DateLayout, dateISO)
	first := time.Date(t.Year(), t.Month()+time.Month(months), 1, 0, 0, 0, 0, time.UTC)
	last := first.AddDate(0, 1, -1).Day()
	return time.Date(first.Year(), first.Month(), min(t.Day(), last), 0, 0, 0, 0, time.UTC).Format(DateLayout)
}

var romanMonths = []string{"I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"}

// RomanMonth maps 1..12 to roman numerals.
func RomanMonth(month int) string {
	if month >= 1 && month <= 12 {
		return romanMonths[month-1]
	}
	return fmt.Sprint(month)
}

// BuildContractNumber is "0001/PKWT/VII/2026" for the given (local) date.
func BuildContractNumber(contractType string, seq int, date time.Time) string {
	return fmt.Sprintf("%04d/%s/%s/%d", seq, strings.ToUpper(contractType), RomanMonth(int(date.Month())), date.Year())
}

// EmploymentStatusOnActivate is the employee status a contract sets when it
// becomes active.
func EmploymentStatusOnActivate(contractType string, probationEnd *string, today string) string {
	if contractType == "pkwt" {
		return "contract"
	}
	if probationEnd != nil && *probationEnd >= today {
		return "probation"
	}
	return "permanent"
}

// RenewalStartDate is the day after the previous contract ends.
func RenewalStartDate(endDate string) string { return AddDaysISO(endDate, 1) }

/* ── Contract list query (lib/hris/contracts-list) ───────────────────── */

// ContractSortColumns whitelists ORDER BY columns.
var ContractSortColumns = map[string]string{
	"end_date":        "c.end_date",
	"start_date":      "c.start_date",
	"employee_name":   "e.full_name",
	"contract_number": "c.contract_number",
	"created_at":      "c.created_at",
}

// ContractListParams is the parsed GET /api/hris/contracts query.
type ContractListParams struct {
	Status         *string
	ContractType   *string
	Search         *string
	ExpiringWithin *int
	SortBy         string
	SortOrder      string
	Page           int
	Limit          int
}

var contractStatuses = map[string]bool{"draft": true, "active": true, "ended": true, "terminated": true, "converted": true}

// truncClamp is clamp(Math.trunc(Number(raw)), lo, hi) or def when not finite.
func truncClamp(raw string, lo, hi, def int) int {
	f := JSNumber(raw)
	if !IsFinite(f) {
		return def
	}
	return Clamp(int(math.Max(math.Min(math.Trunc(f), 1e9), -1e9)), lo, hi)
}

// Query is the subset of url.Values the parsers read: get returns the value
// and whether the key was present.
type Query func(key string) (string, bool)

// ParseContractListParams is parseContractListParams.
func ParseContractListParams(q Query) ContractListParams {
	p := ContractListParams{SortBy: "end_date", SortOrder: "asc", Page: 1, Limit: 15}
	status, ok := q("status")
	if !ok {
		status = "active"
	}
	if status != "all" {
		if !contractStatuses[status] {
			status = "active"
		}
		p.Status = &status
	}
	if t, _ := q("type"); t == "pkwt" || t == "pkwtt" {
		p.ContractType = &t
	}
	if s, _ := q("search"); JSTrim(s) != "" {
		trimmed := JSTrim(s)
		p.Search = &trimmed
	}
	if days, ok := q("days"); ok {
		if f := JSNumber(days); IsFinite(f) {
			n := truncClamp(days, 1, 365, 1)
			p.ExpiringWithin = &n
		}
	}
	if s, _ := q("sort_by"); ContractSortColumns[s] != "" {
		p.SortBy = s
	}
	if o, _ := q("sort_order"); o == "desc" {
		p.SortOrder = "desc"
	}
	if page, ok := q("page"); ok {
		p.Page = truncClamp(page, 1, 100000, 1)
	}
	if limit, ok := q("limit"); ok {
		p.Limit = truncClamp(limit, 1, 100, 15)
	}
	return p
}

// ClampExpiringDays: 1..90, default 30 when missing or not a number.
func ClampExpiringDays(raw string, present bool) int {
	if !present {
		return 30
	}
	return truncClamp(raw, 1, 90, 30)
}
