package kit

import (
	"testing"
	"time"
)

func TestRateLimiterFixedWindow(t *testing.T) {
	now := time.Date(2026, 10, 4, 10, 0, 0, 0, time.UTC)
	l := NewRateLimiter(func() time.Time { return now })
	for i := 0; i < 3; i++ {
		if !l.Allow("k", 3) {
			t.Fatalf("hit %d refused", i)
		}
	}
	if l.Allow("k", 3) {
		t.Fatal("4th hit allowed")
	}
	if !l.Allow("other", 3) {
		t.Fatal("keys share a bucket")
	}
	now = now.Add(61 * time.Second)
	if !l.Allow("k", 3) {
		t.Fatal("window did not reset")
	}
}
