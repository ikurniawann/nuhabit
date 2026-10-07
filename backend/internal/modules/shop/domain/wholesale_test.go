package domain

import (
	"testing"
	"time"
)

func TestPreorderOpen(t *testing.T) {
	now := time.Date(2026, 10, 7, 23, 30, 0, 0, time.UTC) // 8 Oct 06:30 in Jakarta
	day := func(y int, m time.Month, d int) *time.Time {
		t := time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
		return &t
	}
	if !PreorderOpen(0, day(2026, 10, 8), now) {
		t.Error("today (Jakarta) still sells")
	}
	if PreorderOpen(0, day(2026, 10, 7), now) {
		t.Error("yesterday (Jakarta) is closed")
	}
	if PreorderOpen(3, day(2026, 12, 1), now) {
		t.Error("stock on hand is a plain sale")
	}
	if PreorderOpen(0, nil, now) {
		t.Error("no date, no pre-order")
	}
}

func TestWholesaleUnitPrice(t *testing.T) {
	override := 80000.0
	if got := WholesaleUnitPrice(100000, &override, 50); got != 80000 {
		t.Errorf("override wins: %v", got)
	}
	if got := WholesaleUnitPrice(100000, nil, 12.5); got != 87500 {
		t.Errorf("discount: %v", got)
	}
	if got := WholesaleUnitPrice(99999, nil, 33); got != 66999 {
		t.Errorf("rounded to rupiah: %v", got)
	}
	if got := WholesaleUnitPrice(100000, nil, 150); got != 0 {
		t.Errorf("discount capped at 100: %v", got)
	}
}

func TestWholesaleOrderError(t *testing.T) {
	lines := []WholesaleLine{
		{Name: "Kaos", Quantity: 12, MinQty: 12, Subtotal: 960000},
		{Name: "Topi", Quantity: 5, MinQty: 6, Subtotal: 250000},
	}
	if got := WholesaleOrderError(lines, 0); got != "Minimum order for Topi is 6 pcs" {
		t.Errorf("min qty: %q", got)
	}
	lines[1].Quantity = 6
	if got := WholesaleOrderError(lines, 1500000); got != "Minimum order value is Rp 1.500.000" {
		t.Errorf("min order: %q", got)
	}
	if got := WholesaleOrderError(lines, 1210000); got != "" {
		t.Errorf("passes: %q", got)
	}
}
