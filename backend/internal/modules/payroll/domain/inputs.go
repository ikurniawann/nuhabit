package domain

import "math"

// fallbackWorkingDays applies without any shift pattern or attendance.
const fallbackWorkingDays = 20

// Employee is the employee columns a payroll calculation reads.
type Employee struct {
	ID               string
	EmploymentStatus string
	JoinDate         string // YYYY-MM-DD
}

// Salary is the active employee_salary row. Amounts are numeric text.
type Salary struct {
	BaseSalary, FixedAllowance, VariableAllowance          any
	TransportAllowance, MealAllowance, HousingAllowance    any
	PTKPStatus                                             *string
	IsTaxable, BpjsTkEnrolled, BpjsKesEnrolled, TaperaEnrl *bool
}

// Contract is an employment contract touching the period (newest first).
type Contract struct {
	ContractType *string
	StartDate    *string
	EndDate      *string
}

// Leave is an approved leave overlapping the period.
type Leave struct {
	StartDate, EndDate *string
	LeaveType          string
}

// WorkforceRecords are the HRIS records of one employee for one period:
// attendance, shift pattern, approved overtime, approved leaves, contracts.
type WorkforceRecords struct {
	Attendance []AttendanceRow
	Schedule   []ShiftRow
	Overtime   []OvertimeRequest
	Leaves     []Leave
	Contracts  []Contract
}

// BuildInput is loadEmployeePayrollInput after its queries: working days
// from the shift pattern (then attendance, then 20), contract coverage
// proration, realized overtime split by holidays, late stats, unpaid leave
// clamped to the period and due loan installments.
func BuildInput(emp Employee, salary Salary, rec WorkforceRecords, loans []LoanRow, holidays map[string]bool, month, year int, includeThr bool) Input {
	start, end := PeriodBounds(month, year)

	var schedule []ShiftRow
	for _, r := range rec.Schedule {
		if r.EffectiveFrom != "" && (r.EffectiveTo == nil || *r.EffectiveTo >= start) {
			schedule = append(schedule, r)
		}
	}

	var coverages []DateRange
	var latest *Contract
	for i, c := range rec.Contracts {
		cs := DateText(c.StartDate)
		if cs == nil {
			continue
		}
		cov := Coverage(*cs, DateText(c.EndDate), start, end)
		if cov == nil {
			continue
		}
		coverages = append(coverages, *cov)
		if latest == nil {
			latest = &rec.Contracts[i]
		}
	}
	merged := MergeRanges(coverages)
	hasContract := len(merged) > 0
	partial := hasContract && !(len(merged) == 1 && merged[0].Start == start && merged[0].End == end)

	scheduled, hasSchedule := ScheduledDays(schedule, start, end)
	coveredScheduled, coveredCalendar := 0, 0
	for _, r := range merged {
		n, _ := ScheduledDays(schedule, r.Start, r.End)
		coveredScheduled += n
		coveredCalendar += len(EachDate(r.Start, r.End))
	}
	totalCalendar := len(EachDate(start, end))
	inCoverage := func(d string) bool {
		if !hasContract {
			return true
		}
		for _, r := range merged {
			if d >= r.Start && d <= r.End {
				return true
			}
		}
		return false
	}
	attendanceDays := 0
	for _, a := range rec.Attendance {
		if a.Status != "absent" && (!partial || inCoverage(a.Date)) {
			attendanceDays++
		}
	}

	var workingDays float64
	factor := 1.0
	switch {
	case hasSchedule && scheduled > 0:
		workingDays = float64(scheduled)
		if partial {
			workingDays = float64(coveredScheduled)
			factor = float64(coveredScheduled) / float64(scheduled)
		}
	case attendanceDays > 0:
		workingDays = float64(attendanceDays)
		if partial {
			factor = float64(coveredCalendar) / float64(totalCalendar)
		}
	default:
		workingDays = fallbackWorkingDays
		if partial {
			factor = float64(coveredCalendar) / float64(totalCalendar)
			workingDays = math.Max(1, Round(fallbackWorkingDays*factor))
		}
	}
	if workingDays <= 0 {
		workingDays = fallbackWorkingDays
		if partial {
			workingDays = 1
		}
	}

	present := 0
	for _, a := range rec.Attendance {
		if (a.Status == "present" || a.Status == "late") && (!partial || inCoverage(a.Date)) {
			present++
		}
	}
	lateDays, lateMinutes := LateStats(rec.Attendance)
	ot := SplitOvertime(rec.Overtime, rec.Attendance, holidays)

	unpaid := 0
	for _, l := range rec.Leaves {
		s, e := DateText(l.StartDate), DateText(l.EndDate)
		if l.LeaveType == "unpaid" && s != nil && e != nil {
			unpaid += ClampedLeaveDays(LeaveRange{*s, *e}, start, end)
		}
	}

	var contractType *string
	if latest != nil {
		contractType = latest.ContractType
	}
	ptkp := "TK/0"
	if salary.PTKPStatus != nil && *salary.PTKPStatus != "" {
		ptkp = *salary.PTKPStatus
	}
	orTrue := func(b *bool) bool { return b == nil || *b }

	return Input{
		EmployeeID: emp.ID, PeriodMonth: month, PeriodYear: year,
		BaseSalary:         OrZero(salary.BaseSalary),
		FixedAllowance:     OrZero(salary.FixedAllowance),
		VariableAllowance:  OrZero(salary.VariableAllowance),
		TransportAllowance: OrZero(salary.TransportAllowance),
		MealAllowance:      OrZero(salary.MealAllowance),
		HousingAllowance:   OrZero(salary.HousingAllowance),
		OvertimeHours:      ot.Regular,
		OvertimeHolidayHrs: ot.Holiday,
		WorkingDays:        workingDays,
		PresentDays:        float64(present),
		LateDays:           lateDays,
		LateMinutes:        lateMinutes,
		UnpaidLeaveDays:    float64(unpaid),
		LoanDeduction:      LoanDeductionForPeriod(loans, month, year),
		LoanBreakdown:      LoanInstallmentDetails(loans, month, year),
		JoinDate:           emp.JoinDate,
		EmploymentStatus:   emp.EmploymentStatus,
		ContractType:       contractType,
		ProrateFactor:      &factor,
		PTKPStatus:         ptkp,
		IsTaxable:          orTrue(salary.IsTaxable),
		BpjsTkEnrolled:     orTrue(salary.BpjsTkEnrolled),
		BpjsKesEnrolled:    orTrue(salary.BpjsKesEnrolled),
		TaperaEnrolled:     orTrue(salary.TaperaEnrl),
		IncludeThr:         includeThr,
	}
}
