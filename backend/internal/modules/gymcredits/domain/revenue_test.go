package domain

import (
	"testing"
	"time"
)

func TestPassRevenueDue(t *testing.T) {
	start := time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)
	end := start.Add(28 * day)
	eq(t, PassRevenueDue(2_800_000, start, end, start.Add(-day)), 0.0)
	eq(t, PassRevenueDue(2_800_000, start, end, start), 100_000.0)
	eq(t, PassRevenueDue(2_800_000, start, end, start.Add(9*day)), 1_000_000.0)
	eq(t, PassRevenueDue(1_000_000, start, end, start.Add(2*day)), 107_142.86)
	eq(t, PassRevenueDue(2_800_000, start, end, end.Add(-day)), 2_800_000.0)
	eq(t, PassRevenueDue(2_800_000, start, end, end.Add(5*day)), 2_800_000.0)
}
