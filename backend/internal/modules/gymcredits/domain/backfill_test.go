package domain

import (
	"testing"
	"time"
)

func TestPlanBackfillMirrorsFIFO(t *testing.T) {
	t0 := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	lots := []Lot{
		{ID: "late", PackageID: "p", Credits: 5, ExpiresAt: t0.Add(60 * day), CreatedAt: t0},
		{ID: "early", PackageID: "p", Credits: 2, ExpiresAt: t0.Add(30 * day), CreatedAt: t0.Add(time.Hour)},
	}
	entries := []Entry{
		{ID: "top1", Type: TopUp, Amount: 5, LotID: "late", CreatedAt: t0},
		{ID: "top2", Type: TopUp, Amount: 2, LotID: "early", CreatedAt: t0.Add(time.Hour)},
		// Three credits from the pool: two drain the early lot, one comes off the late lot.
		{ID: "d1", Type: ClassDeduction, Amount: -3, SourceID: "b1", CreatedAt: t0.Add(2 * time.Hour)},
		// The booking is cancelled: credits go back where they came from, last lot first.
		{ID: "r1", Type: Refund, Amount: 1, SourceID: "b1", CreatedAt: t0.Add(3 * time.Hour)},
		// A pinned deduction after the pool entries.
		{ID: "d2", Type: ClassDeduction, Amount: -1, LotID: "late", SourceID: "b2", CreatedAt: t0.Add(4 * time.Hour)},
		{ID: "adj", Type: Adjustment, Amount: -1, CreatedAt: t0.Add(5 * time.Hour)},
	}
	plan := PlanBackfill(lots, entries, nil)
	if !plan.Consistent || len(plan.Unpinned) != 0 {
		t.Fatalf("plan = %+v", plan)
	}
	want := []Pin{
		{"d1", "early", 2}, {"d1", "late", 1},
		{"r1", "late", 1},
		{"adj", "late", 1},
	}
	if len(plan.Pins) != len(want) {
		t.Fatalf("pins = %+v", plan.Pins)
	}
	for i, p := range want {
		if plan.Pins[i] != p {
			t.Fatalf("pin %d = %+v, want %+v", i, plan.Pins[i], p)
		}
	}
	after := ApplyPins(entries, plan.Pins)
	if len(after) != len(entries)+1 || RemainingIn(LotRemainders(lots, after), "late") != 3 || RemainingIn(LotRemainders(lots, after), "early") != 0 {
		t.Fatalf("after = %+v", LotRemainders(lots, after))
	}
	for _, e := range after {
		if e.LotID == "" {
			t.Fatalf("entry %s still unpinned", e.ID)
		}
	}
}

func TestPlanBackfillKeepsReversedEntriesWhole(t *testing.T) {
	t0 := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	lots := []Lot{
		{ID: "a", Credits: 1, ExpiresAt: t0.Add(10 * day), CreatedAt: t0},
		{ID: "b", Credits: 3, ExpiresAt: t0.Add(20 * day), CreatedAt: t0},
	}
	entries := []Entry{
		{ID: "ta", Type: TopUp, Amount: 1, LotID: "a", CreatedAt: t0},
		{ID: "tb", Type: TopUp, Amount: 3, LotID: "b", CreatedAt: t0},
		// Would split over a and b, but it was reversed: left alone, as is its reversal.
		{ID: "d", Type: ClassDeduction, Amount: -2, SourceID: "x", CreatedAt: t0.Add(time.Hour)},
		{ID: "rev", Type: Reversal, Amount: 2, ReversesEntryID: "d", CreatedAt: t0.Add(2 * time.Hour)},
		// Fits one lot, so it is pinned together with its reversal.
		{ID: "d2", Type: ClassDeduction, Amount: -1, SourceID: "y", CreatedAt: t0.Add(3 * time.Hour)},
		{ID: "rev2", Type: Reversal, Amount: 1, ReversesEntryID: "d2", CreatedAt: t0.Add(4 * time.Hour)},
	}
	plan := PlanBackfill(lots, entries, map[string]bool{"d": true, "d2": true})
	if !plan.Consistent || len(plan.Unpinned) != 2 || plan.Unpinned[0] != "d" || plan.Unpinned[1] != "rev" {
		t.Fatalf("plan = %+v", plan)
	}
	if len(plan.Pins) != 2 || plan.Pins[0] != (Pin{"d2", "a", 1}) || plan.Pins[1] != (Pin{"rev2", "a", 1}) {
		t.Fatalf("pins = %+v", plan.Pins)
	}
}
