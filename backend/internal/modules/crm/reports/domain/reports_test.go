package domain

import (
	"testing"
	"time"
)

func TestResolvePeriod(t *testing.T) {
	now := time.Date(2026, 7, 19, 15, 0, 0, 0, time.UTC)
	p := ResolvePeriod("", "", now)
	if p == nil || p.FromDate != "2026-07-01" || p.ToDate != "2026-07-19" || p.FromISO != "2026-07-01T00:00:00.000Z" || p.ToISO != "2026-07-20T00:00:00.000Z" {
		t.Fatalf("default: %+v", p)
	}
	p = ResolvePeriod("2026-06-01", "2026-06-30", now)
	if p == nil || p.FromDate != "2026-06-01" || p.ToDate != "2026-06-30" || p.ToISO != "2026-07-01T00:00:00.000Z" {
		t.Fatalf("explicit: %+v", p)
	}
	for _, bad := range [][2]string{{"2026/06/01", ""}, {"abc", ""}, {"2026-13-45", ""}, {"2026-07-10", "2026-07-01"}, {"2024-01-01", "2026-07-01"}} {
		if ResolvePeriod(bad[0], bad[1], now) != nil {
			t.Errorf("%v must be rejected", bad)
		}
	}
	p = ResolvePeriod("2026-07-19", "2026-07-19", now)
	if p == nil || p.FromISO != "2026-07-19T00:00:00.000Z" || p.ToISO != "2026-07-20T00:00:00.000Z" {
		t.Fatalf("one day: %+v", p)
	}
	// V8 rolls Feb 30 over to Mar 2.
	if p = ResolvePeriod("2026-02-30", "2026-03-05", now); p == nil || p.FromDate != "2026-03-02" {
		t.Fatalf("rollover: %+v", p)
	}
}

func TestReconciliation(t *testing.T) {
	if NetFlow(1000000, 100000, 0, 400000) != 700000 || NetFlow(0, 0, 0, 25000) != -25000 || NetFlow(500000, 0, 150000, 100000) != 550000 {
		t.Fatal("net flow")
	}
	rows := []Reconciliation{
		{TopupAmount: 600000, BonusAmount: 60000, SpendAmount: 300000, NetFlow: 360000},
		{TopupAmount: 400000, BonusAmount: 40000, SpendAmount: 400000, NetFlow: 40000},
	}
	if got := SumReconciliation(rows); got.TopupAmount != 1000000 || got.BonusAmount != 100000 || got.SpendAmount != 700000 || got.NetFlow != 400000 {
		t.Fatalf("sum %+v", got)
	}
	if SumReconciliation(nil) != (Totals{}) {
		t.Fatal("empty")
	}
	v := 12.345
	if *Round2(&v) != 12.35 || Round2(nil) != nil {
		t.Fatal("round2")
	}
	if AsText(nil, "Customer") != "Customer" || AsText("", "x") != "x" || AsText("a", "x") != "a" || AsText(time.Now(), "") != "" {
		t.Fatal("asText")
	}
}
