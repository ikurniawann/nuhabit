package domain

import (
	"strings"
)

// Blackout is a date range (inclusive) without coach leave, for one branch
// or, with BranchID nil, for every branch.
type Blackout struct {
	ID       string  `json:"id"`
	BranchID *string `json:"branch_id"`
	DateFrom string  `json:"date_from"`
	DateTo   string  `json:"date_to"`
	Reason   string  `json:"reason"`
}

// MaxBlackoutDays is the longest blackout range, in calendar days.
const MaxBlackoutDays = 31

// MinOverrideReason is the shortest reason for approving leave on a blackout.
const MinOverrideReason = 10

// ValidateBlackout returns the problem with a new range, "" when valid.
func ValidateBlackout(from, to, reason string) string {
	if !ValidDate(from) || !ValidDate(to) {
		return "Tanggal tidak valid"
	}
	span := DaysBetween(from, to)
	switch {
	case span < 0:
		return "Tanggal selesai tidak boleh sebelum tanggal mulai"
	case span >= MaxBlackoutDays:
		return "Satu blackout paling lama 31 hari"
	case len([]rune(strings.TrimSpace(reason))) < 3:
		return "Alasan blackout wajib diisi"
	}
	return ""
}

// BlackoutConflicts are the blackouts overlapping a leave from start to end
// for a leave type whose rule respects blackouts.
func BlackoutConflicts(rule NoticeRule, blackouts []Blackout, start, end string) []Blackout {
	if !rule.Blackout {
		return nil
	}
	var out []Blackout
	for _, b := range blackouts {
		if b.DateFrom <= end && b.DateTo >= start {
			out = append(out, b)
		}
	}
	return out
}

// DescribeBlackouts is "2026-11-01 s.d. 2026-11-02 (HYROX Jakarta)" joined by "; ".
func DescribeBlackouts(list []Blackout) string {
	parts := make([]string, len(list))
	for i, b := range list {
		r := b.DateFrom
		if b.DateTo != b.DateFrom {
			r += " s.d. " + b.DateTo
		}
		parts[i] = r + " (" + b.Reason + ")"
	}
	return strings.Join(parts, "; ")
}

// BlackoutRefusal is the message for a request on a blackout without an
// exception request.
func BlackoutRefusal(leaveType string, conflicts []Blackout) string {
	return label(leaveType) + " tidak bisa diambil di tanggal blackout: " + DescribeBlackouts(conflicts) +
		". Pilih tanggal lain, atau ajukan dengan permintaan pengecualian ke Program Director."
}
