package domain

import (
	"strconv"
	"time"
)

// MemberRescheduleProblem explains why a member may not move their session
// from startsAt to newStart at now, "" when they may. The move must happen
// before the free cancellation deadline, at most RescheduleLimit times per
// session (moved is how often it was moved already), and the new start must
// be one a member could request now.
func MemberRescheduleProblem(status Status, startsAt, newStart, now time.Time, moved int, rules Rules) string {
	if p := rescheduleProblem(status, startsAt, now, moved, rules); p != "" {
		return p
	}
	if newStart.Equal(startsAt) {
		return "Pilih jam yang berbeda"
	}
	return RequestProblem(newStart, now, rules)
}

// CanMemberReschedule reports whether the member may still move the session
// to some other time, for the member app to show the option.
func CanMemberReschedule(status Status, startsAt, now time.Time, moved int, rules Rules) bool {
	return rescheduleProblem(status, startsAt, now, moved, rules) == ""
}

func rescheduleProblem(status Status, startsAt, now time.Time, moved int, rules Rules) string {
	if !status.Open() {
		return "Sesi PT sudah ditutup"
	}
	if rules.RescheduleLimit <= 0 {
		return "Ubah jadwal PT hanya bisa lewat staf atau coach"
	}
	if moved >= rules.RescheduleLimit {
		return "Sesi PT ini sudah dipindahkan " + strconv.Itoa(rules.RescheduleLimit) + " kali, batas maksimal"
	}
	deadline := startsAt.Add(-time.Duration(rules.CancellationDeadlineHours) * time.Hour)
	if now.After(deadline) {
		return "Batas ubah jadwal sudah lewat (" + strconv.Itoa(rules.CancellationDeadlineHours) + " jam sebelum mulai)"
	}
	return ""
}
