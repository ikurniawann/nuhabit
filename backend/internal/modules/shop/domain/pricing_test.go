package domain

import (
	"testing"
	"time"
)

func TestPriceWithSale(t *testing.T) {
	now := time.Date(2026, 10, 10, 12, 0, 0, 0, time.UTC)
	future, past := now.Add(time.Hour), now.Add(-time.Minute)
	sale := func(price float64, until *time.Time) Sale { return Sale{Price: &price, Until: until} }
	check := func(name string, got Pricing, price float64, compareAt float64, percent int) {
		t.Helper()
		if got.Price != price {
			t.Errorf("%s: price = %v, want %v", name, got.Price, price)
		}
		if compareAt == 0 && (got.CompareAt != nil || got.Percent != nil) {
			t.Errorf("%s: expected no sale, got %v %v", name, got.CompareAt, got.Percent)
		}
		if compareAt != 0 && (got.CompareAt == nil || *got.CompareAt != compareAt || got.Percent == nil || *got.Percent != percent) {
			t.Errorf("%s: compareAt/percent = %v %v, want %v %v", name, got.CompareAt, got.Percent, compareAt, percent)
		}
	}
	check("open-ended sale", PriceWithSale(50000, 50000, sale(40000, nil), now), 40000, 50000, 20)
	check("sale ending later", PriceWithSale(50000, 50000, sale(40000, &future), now), 40000, 50000, 20)
	check("expired sale", PriceWithSale(50000, 50000, sale(40000, &past), now), 50000, 0, 0)
	check("no sale", PriceWithSale(50000, 50000, Sale{}, now), 50000, 0, 0)
	check("sale not below the price", PriceWithSale(50000, 50000, sale(50000, nil), now), 50000, 0, 0)
	check("percent rounds half up", PriceWithSale(30000, 30000, sale(20000, nil), now), 20000, 30000, 33)
	check("percent rounds .5 up", PriceWithSale(40000, 40000, sale(35000, nil), now), 35000, 40000, 13)
	// A SKU priced above the product keeps the percentage, to the rupiah.
	check("sku override", PriceWithSale(65000, 50000, sale(40000, nil), now), 52000, 65000, 20)
	check("sku override rounds", PriceWithSale(65000, 30000, sale(20000, nil), now), 43333, 65000, 33)
}

func TestStockBadges(t *testing.T) {
	now := time.Date(2026, 10, 10, 12, 0, 0, 0, time.UTC)
	for _, c := range []struct {
		stock     float64
		threshold int
		want      bool
	}{{3, 3, true}, {1, 3, true}, {4, 3, false}, {0, 3, false}, {2, 0, false}} {
		if LowStock(c.stock, c.threshold) != c.want {
			t.Errorf("LowStock(%v, %d) != %v", c.stock, c.threshold, c.want)
		}
	}
	recent, old := now.Add(-6*24*time.Hour), now.Add(-8*24*time.Hour)
	if !BackInStock(2, &recent, now) || BackInStock(2, &old, now) || BackInStock(0, &recent, now) || BackInStock(2, nil, now) {
		t.Error("BackInStock")
	}
}
