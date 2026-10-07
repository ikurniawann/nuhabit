package domain

import (
	"testing"
	"time"
)

// attempt-limit.test.ts (pure part)
var (
	testPolicy = AttemptPolicy{MaxFailures: 3, Window: 10 * time.Minute, Lockout: 15 * time.Minute}
	t0         = time.Date(2026, 10, 4, 10, 0, 0, 0, time.UTC)
)

func at(ms int64) time.Time { return t0.Add(time.Duration(ms) * time.Millisecond) }

func TestApplyFailureLocksAtMax(t *testing.T) {
	s := ApplyFailure(nil, t0, testPolicy)
	s = ApplyFailure(&s, at(1000), testPolicy)
	if ActiveLock(&s, at(1000)) != nil {
		t.Fatalf("locked after 2 failures: %+v", s)
	}
	s = ApplyFailure(&s, at(2000), testPolicy)
	if s.Failures != 3 {
		t.Errorf("failures = %d, want 3", s.Failures)
	}
	lock := ActiveLock(&s, at(2000))
	if lock == nil || !lock.Equal(at(2000).Add(testPolicy.Lockout)) {
		t.Errorf("lock = %v, want %v", lock, at(2000).Add(testPolicy.Lockout))
	}
	if !s.WindowStarted.Equal(t0) {
		t.Errorf("window should keep its start, got %v", s.WindowStarted)
	}
}

func TestApplyFailureWindowExpiry(t *testing.T) {
	old := ApplyFailure(nil, t0, testPolicy)
	old = ApplyFailure(&old, at(1000), testPolicy)
	next := ApplyFailure(&old, at(int64(testPolicy.Window/time.Millisecond)+5000), testPolicy)
	if next.Failures != 1 || next.LockedUntil != nil {
		t.Errorf("expired window should restart: %+v", next)
	}
	// Exactly at the window edge still counts (strictly greater expires).
	edge := ApplyFailure(&old, t0.Add(testPolicy.Window), testPolicy)
	if edge.Failures != 3 {
		t.Errorf("edge of window: %+v", edge)
	}
}

func TestApplyFailureExpiredLock(t *testing.T) {
	until := at(60000)
	locked := AttemptState{Failures: 3, WindowStarted: t0, LockedUntil: &until}
	if ActiveLock(&locked, at(61000)) != nil {
		t.Errorf("expired lock still active")
	}
	if got := ApplyFailure(&locked, at(61000), testPolicy); got.Failures != 1 || got.LockedUntil != nil {
		t.Errorf("expired lock should restart count: %+v", got)
	}
	if ActiveLock(&locked, until) != nil {
		t.Errorf("lock ending now is not active (strictly greater)")
	}
	if ActiveLock(nil, t0) != nil || ActiveLock(&AttemptState{}, t0) != nil {
		t.Errorf("no state or no lock must be nil")
	}
}

func TestApplyFailureKeepsActiveLockBelowMax(t *testing.T) {
	until := at(10 * 60000)
	s := AttemptState{Failures: 1, WindowStarted: t0, LockedUntil: &until}
	got := ApplyFailure(&s, at(1000), AttemptPolicy{MaxFailures: 5, Window: 10 * time.Minute, Lockout: time.Minute})
	if got.Failures != 2 || got.LockedUntil == nil || !got.LockedUntil.Equal(until) {
		t.Errorf("active lock should carry over: %+v", got)
	}
}

func TestMinutesUntil(t *testing.T) {
	cases := []struct {
		until time.Time
		want  int
	}{
		{at(61000), 2},
		{at(1000), 1},
		{at(60000), 1},
		{at(-5000), 1},
		{at(7 * 60000), 7},
	}
	for _, c := range cases {
		if got := MinutesUntil(c.until, t0); got != c.want {
			t.Errorf("MinutesUntil(%v) = %d, want %d", c.until.Sub(t0), got, c.want)
		}
	}
}

func TestSupervisorPinPolicyAndMessage(t *testing.T) {
	if SupervisorPinPolicy.MaxFailures != 5 || SupervisorPinPolicy.Lockout != 15*time.Minute || SupervisorPinPolicy.Window != 15*time.Minute {
		t.Errorf("policy = %+v", SupervisorPinPolicy)
	}
	if got := SupervisorPinLockedMessage(7); got != "Terlalu banyak percobaan PIN supervisor. Coba lagi dalam 7 menit." {
		t.Errorf("message = %q", got)
	}
}

// supervisor-pin.test.ts
func TestIsValidPosPin(t *testing.T) {
	cases := map[string]bool{
		"1234":    true,
		"123456":  true,
		"123":     false,
		"1234567": false,
		"12a4":    false,
		"":        false,
		"12 34":   false,
		"1234\n":  false,
		"١٢٣٤":    false,
	}
	for in, want := range cases {
		if got := IsValidPosPin(in); got != want {
			t.Errorf("IsValidPosPin(%q) = %v, want %v", in, got, want)
		}
	}
}
