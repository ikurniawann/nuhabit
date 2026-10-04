package domain

import (
	"errors"
	"fmt"
	"slices"
	"strconv"
	"strings"
	"time"
)

// PromotableStatuses are the candidate statuses that may become employees.
var PromotableStatuses = []string{"hired", "talent_pool"}

// IsPromotable reports whether a candidate status can be promoted.
func IsPromotable(status string) bool { return slices.Contains(PromotableStatuses, status) }

// EmploymentStatuses are the employment statuses a promotion accepts.
var EmploymentStatuses = []string{"probation", "contract", "permanent", "internship"}

// Contract draft defaults (lib/hris/contracts.ts).
const (
	DefaultPkwtMonths       = 12
	PkwttMaxProbationMonths = 3
)

// DraftDates is the automatic contract draft a promotion creates.
type DraftDates struct {
	ContractType     string // "pkwt" or "pkwtt"
	StartDate        string
	EndDate          *string
	ProbationEndDate *string
}

// ErrInvalidDate is a join date addMonthsIso cannot read (a RangeError in TS).
var ErrInvalidDate = errors.New("invalid join date")

// DraftFromEmploymentStatus is draftContractFromEmploymentStatus: contract →
// PKWT 12 months, probation → PKWTT with a 3 month probation, permanent →
// PKWTT; anything else gets no draft (nil).
func DraftFromEmploymentStatus(employmentStatus, joinDate string) (*DraftDates, error) {
	switch employmentStatus {
	case "contract":
		end, err := AddMonthsISO(joinDate, DefaultPkwtMonths)
		if err != nil {
			return nil, err
		}
		return &DraftDates{ContractType: "pkwt", StartDate: joinDate, EndDate: &end}, nil
	case "probation":
		end, err := AddMonthsISO(joinDate, PkwttMaxProbationMonths)
		if err != nil {
			return nil, err
		}
		return &DraftDates{ContractType: "pkwtt", StartDate: joinDate, ProbationEndDate: &end}, nil
	case "permanent":
		return &DraftDates{ContractType: "pkwtt", StartDate: joinDate}, nil
	}
	return nil, nil
}

// AddMonthsISO adds months to a YYYY-MM-DD date, clamping the day to the end
// of the target month (31 Jan + 1 month = 28/29 Feb).
func AddMonthsISO(dateISO string, months int) (string, error) {
	parts := strings.Split(dateISO, "-")
	nums := make([]int, 3)
	for i := range nums {
		if i >= len(parts) {
			return "", ErrInvalidDate
		}
		p := JSTrim(parts[i])
		if p == "" {
			continue // Number("") is 0
		}
		n, err := strconv.Atoi(p)
		if err != nil {
			return "", ErrInvalidDate
		}
		nums[i] = n
	}
	year, month, day := nums[0], nums[1], nums[2]
	target := month - 1 + months
	lastDay := time.Date(year, time.Month(target+2), 0, 0, 0, 0, 0, time.UTC).Day()
	return time.Date(year, time.Month(target+1), min(day, lastDay), 0, 0, 0, 0, time.UTC).Format("2006-01-02"), nil
}

var romanMonths = []string{"I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"}

// ContractNumber is buildContractNumber: "0001/PKWT/VII/2026".
func ContractNumber(contractType string, seq int, date time.Time) string {
	return fmt.Sprintf("%04d/%s/%s/%d", seq, strings.ToUpper(contractType), romanMonths[date.Month()-1], date.Year())
}
