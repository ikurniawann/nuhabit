package domain

import (
	"strings"
	"time"
)

// Status is a member's standing, set by managers.
type Status string

const (
	StatusActive Status = "active"
	// StatusSuspended freezes tier perks, XP and the leaderboard until a
	// date. The member can still book and enter.
	StatusSuspended Status = "suspended"
	// StatusBanned freezes the same and also stops booking and gate entry.
	StatusBanned Status = "banned"
)

// Statuses lists every status in declaration order.
var Statuses = []Status{StatusActive, StatusSuspended, StatusBanned}

// StatusLabel is the Indonesian label staff see.
var StatusLabel = map[Status]string{
	StatusActive:    "Aktif",
	StatusSuspended: "Ditangguhkan",
	StatusBanned:    "Diblokir",
}

// Standing is the stored status of a member; the zero value is active.
type Standing struct {
	Status         Status     `json:"status"`
	Reason         *string    `json:"reason"`
	SuspendedUntil *time.Time `json:"suspended_until"`
}

// Effective is the status at now: a suspension ends on its date.
func (s Standing) Effective(now time.Time) Status {
	switch {
	case s.Status == StatusBanned:
		return StatusBanned
	case s.Status == StatusSuspended && s.SuspendedUntil != nil && now.Before(*s.SuspendedUntil):
		return StatusSuspended
	}
	return StatusActive
}

// Frozen: no tier perks, no XP and no leaderboard place.
func (s Standing) Frozen(now time.Time) bool { return s.Effective(now) != StatusActive }

// Banned: the member may not book or pass the gate.
func (s Standing) Banned(now time.Time) bool { return s.Effective(now) == StatusBanned }

// StatusChange is what a manager asks for.
type StatusChange struct {
	Status         Status
	Reason         string
	SuspendedUntil *time.Time
}

// Validate returns the message to show when the change cannot be made: a
// suspension or ban needs a reason, a suspension an end in the future.
func (c StatusChange) Validate(now time.Time) string {
	reason := strings.TrimSpace(c.Reason)
	switch c.Status {
	case StatusActive:
		return ""
	case StatusSuspended:
		if c.SuspendedUntil == nil || !c.SuspendedUntil.After(now) {
			return "Tanggal akhir penangguhan harus di masa depan"
		}
	case StatusBanned:
	default:
		return "Status tidak dikenal"
	}
	if reason == "" {
		return "Alasan wajib diisi"
	}
	if len([]rune(reason)) > 500 {
		return "Alasan maksimal 500 karakter"
	}
	return ""
}

// Normalized is the change as stored: a reason and an end date only where
// the status uses them.
func (c StatusChange) Normalized() Standing {
	out := Standing{Status: c.Status}
	if c.Status == StatusActive {
		return out
	}
	reason := strings.TrimSpace(c.Reason)
	out.Reason = &reason
	if c.Status == StatusSuspended {
		out.SuspendedUntil = c.SuspendedUntil
	}
	return out
}
