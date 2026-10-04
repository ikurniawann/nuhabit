package domain

import (
	"fmt"
	"sort"
)

// Fiscal period statuses.
const (
	PeriodOpen   = "OPEN"
	PeriodClosed = "CLOSED"
)

// PeriodInput is one period of a fiscal year payload.
type PeriodInput struct {
	PeriodNo  int
	Name      string
	StartDate string // YYYY-MM-DD
	EndDate   string
	Status    string
}

// OpenSequenceViolation enforces "period N may be OPEN only when every
// earlier period is CLOSED" (findOpenSequenceViolation). It returns the
// first violation message, or "".
func OpenSequenceViolation(periods []PeriodInput) string {
	sorted := append([]PeriodInput(nil), periods...)
	sort.SliceStable(sorted, func(i, j int) bool { return sorted[i].PeriodNo < sorted[j].PeriodNo })
	for _, p := range sorted {
		if p.Status != PeriodOpen {
			continue
		}
		var prev *PeriodInput
		for i := range sorted {
			if sorted[i].PeriodNo < p.PeriodNo && sorted[i].Status == PeriodOpen {
				prev = &sorted[i]
			}
		}
		if prev != nil {
			name := ""
			if prev.Name != "" {
				name = " (" + prev.Name + ")"
			}
			return fmt.Sprintf("Tidak bisa OPEN period %d: period %d%s belum CLOSED. Tutup period sebelumnya terlebih dahulu.",
				p.PeriodNo, prev.PeriodNo, name)
		}
	}
	return ""
}

// ValidateFiscalYear mirrors the store checks before a fiscal year is saved
// (end >= start, then validatePeriods). It returns the 400 message or "".
func ValidateFiscalYear(start, end string, periods []PeriodInput) string {
	if end < start {
		return "end_date harus >= start_date"
	}
	if len(periods) < 1 || len(periods) > 12 {
		return "Fiscal year harus punya 1–12 period"
	}
	seen := map[int]bool{}
	for _, p := range periods {
		if p.PeriodNo < 1 || p.PeriodNo > 12 {
			return "period_no harus antara 1–12"
		}
		if seen[p.PeriodNo] {
			return fmt.Sprintf("period_no %d duplikat", p.PeriodNo)
		}
		seen[p.PeriodNo] = true
		if p.EndDate < p.StartDate {
			return fmt.Sprintf("Period %d: end_date < start_date", p.PeriodNo)
		}
		if p.StartDate < start || p.EndDate > end {
			return fmt.Sprintf("Period %d harus berada dalam rentang fiscal year", p.PeriodNo)
		}
		if p.Status != PeriodOpen && p.Status != PeriodClosed {
			return fmt.Sprintf("Period %d: status tidak valid", p.PeriodNo)
		}
	}
	return OpenSequenceViolation(periods)
}

// HasOpenPeriod reports whether any period is OPEN.
func HasOpenPeriod(periods []PeriodInput) bool {
	for _, p := range periods {
		if p.Status == PeriodOpen {
			return true
		}
	}
	return false
}

// CloseBlockers lists why a period cannot be closed (getPeriodClosePreview).
func CloseBlockers(periodName, status string, yearActive bool, draftCount int) []string {
	blockers := []string{}
	if status == PeriodClosed {
		blockers = append(blockers, "Period "+periodName+" sudah CLOSED")
	}
	if !yearActive {
		blockers = append(blockers, "Fiscal year tidak aktif")
	}
	if draftCount > 0 {
		blockers = append(blockers, fmt.Sprintf("Masih ada %d jurnal DRAFT. Posting atau hapus dulu sebelum closing.", draftCount))
	}
	return blockers
}
