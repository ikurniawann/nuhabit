package domain

import (
	"fmt"
	"math"
	"regexp"
	"time"
)

// AttemptPolicy is lib/security/attempt-limit.ts AttemptPolicy.
type AttemptPolicy struct {
	MaxFailures int
	Window      time.Duration
	Lockout     time.Duration
}

// SupervisorPinPolicy: 5 wrong PINs in 15 minutes lock for 15 minutes.
var SupervisorPinPolicy = AttemptPolicy{MaxFailures: 5, Window: 15 * time.Minute, Lockout: 15 * time.Minute}

// SupervisorPinScope is the attempt_limits scope of supervisor PINs.
const SupervisorPinScope = "pos_supervisor_pin"

// AttemptState is one auth.attempt_limits row.
type AttemptState struct {
	Failures      int
	WindowStarted time.Time
	LockedUntil   *time.Time
}

// ActiveLock is the lock end still in force, or nil.
func ActiveLock(s *AttemptState, now time.Time) *time.Time {
	if s == nil || s.LockedUntil == nil || !s.LockedUntil.After(now) {
		return nil
	}
	return s.LockedUntil
}

// ApplyFailure is applyFailure: the state after one more failure.
func ApplyFailure(s *AttemptState, now time.Time, p AttemptPolicy) AttemptState {
	lockExpired := s != nil && s.LockedUntil != nil && ActiveLock(s, now) == nil
	windowExpired := s == nil || now.Sub(s.WindowStarted) > p.Window
	fresh := s == nil || windowExpired || lockExpired
	next := AttemptState{Failures: 1, WindowStarted: now}
	if !fresh {
		next = AttemptState{Failures: s.Failures + 1, WindowStarted: s.WindowStarted, LockedUntil: s.LockedUntil}
	}
	if next.Failures >= p.MaxFailures {
		until := now.Add(p.Lockout)
		next.LockedUntil = &until
	} else if fresh {
		next.LockedUntil = nil
	}
	return next
}

// MinutesUntil rounds the remaining lock up to whole minutes (at least 1).
func MinutesUntil(until, now time.Time) int {
	m := int(math.Ceil(float64(until.Sub(now).Milliseconds()) / 60000))
	if m < 1 {
		return 1
	}
	return m
}

// SupervisorPinLockedMessage is the 429 body of a locked PIN.
func SupervisorPinLockedMessage(minutes int) string {
	return fmt.Sprintf("Terlalu banyak percobaan PIN supervisor. Coba lagi dalam %d menit.", minutes)
}

var posPinPattern = regexp.MustCompile(`^\d{4,6}$`)

// IsValidPosPin: 4–6 digits.
func IsValidPosPin(pin string) bool { return posPinPattern.MatchString(pin) }
