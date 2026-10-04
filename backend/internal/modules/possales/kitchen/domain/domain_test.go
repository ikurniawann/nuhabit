package domain

import (
	"encoding/json"
	"testing"
	"time"
)

func TestResolvePosStation(t *testing.T) { // kitchen-station.test.ts
	cases := []struct{ explicit, kategori, want string }{
		{"bar", "Makanan", "bar"},
		{"Kitchen", "", "kitchen"},
		{"dessert", "Minuman", "dessert"},
		{"", "Minuman", "bar"},
		{"", "Coffee", "bar"},
		{"", "Roti & Cake", "bakery"},
		{"  ", "Makanan", "kitchen"},
		{"kasir", "Minuman", "bar"},
		{"unknown", "Snack", "kitchen"},
	}
	for _, c := range cases {
		if got := ResolvePosStation(c.explicit, c.kategori); got != c.want {
			t.Errorf("ResolvePosStation(%q, %q) = %q, want %q", c.explicit, c.kategori, got, c.want)
		}
	}
}

func TestNormalizeStation(t *testing.T) {
	cases := []struct{ station, name, notes, want string }{
		{" BAR ", "Nasi Goreng", "", "bar"},
		{"photobooth", "Es Teh", "", "photobooth"},
		{"", "Es Teh Manis", "", "bar"},
		{"", "Nasi Goreng", "less ice", "bar"}, // "less" contains "es"
		{"", "Nasi Goreng", "tanpa sambal", "kitchen"},
		{"", "Nasi Goreng", "pakai es", "bar"},
		{"", "Croissant", "", "bakery"},
		{"", "Ice Cream Vanilla", "", "bakery"},
		{"", "Kues Lapis", "", "bar"}, // "es" wins over "kue": bar is tested first
		{"", "Nasi Goreng", "", "kitchen"},
		{"kasir", "", "", "kitchen"}, // one-argument call: unknown station falls back to kitchen
	}
	for _, c := range cases {
		if got := NormalizeStation(c.station, c.name, c.notes); got != c.want {
			t.Errorf("NormalizeStation(%q, %q, %q) = %q, want %q", c.station, c.name, c.notes, got, c.want)
		}
	}
}

func TestMapOrderStatusToKitchenStatus(t *testing.T) { // kds-status.test.ts
	cases := map[string]string{
		"confirmed": "confirmed", "preparing": "preparing", "completed": "served",
		"": "pending", "READY": "ready", "voided": "pending", "cancelled": "cancelled",
	}
	for in, want := range cases {
		if got := MapOrderStatusToKitchenStatus(in); got != want {
			t.Errorf("MapOrderStatusToKitchenStatus(%q) = %q, want %q", in, got, want)
		}
	}
}

func items(pairs ...string) []KitchenItem {
	var out []KitchenItem
	for i := 0; i+1 < len(pairs); i += 2 {
		out = append(out, KitchenItem{Station: pairs[i], KitchenStatus: pairs[i+1]})
	}
	return out
}

func TestDeriveStationStatus(t *testing.T) {
	mixed := items("kitchen", "ready", "kitchen", "pending", "bar", "preparing")
	cases := []struct {
		name    string
		items   []KitchenItem
		station string
		want    string
	}{
		{"least advanced kitchen item", mixed, "kitchen", "pending"},
		{"bar only", mixed, "bar", "preparing"},
		{"all stations", mixed, "", "pending"},
		{"no active items", items("kitchen", "served", "bar", "pending"), "kitchen", "served"},
		{"null status is pending", items("kitchen", "", "kitchen", "ready"), "", "pending"},
		{"merchandise ignored", items("merchandise", "pending", "kitchen", "ready"), "", "ready"},
		{"station case-insensitive", items("Kitchen", "Preparing"), "KITCHEN", "preparing"},
		{"empty", nil, "", "served"},
	}
	for _, c := range cases {
		if got := DeriveStationStatus(c.items, c.station); got != c.want {
			t.Errorf("%s: got %q, want %q", c.name, got, c.want)
		}
	}
}

func TestDeriveOrderKitchenStatus(t *testing.T) {
	cases := []struct {
		name               string
		items              []KitchenItem
		payment            string
		wantOrder, wantKit string
	}{
		{"kitchen workflow independent from payment", items("kitchen", "preparing", "bar", "pending"), "paid", "pending", "pending"},
		{"served and paid completes", items("kitchen", "served", "bar", "served"), "paid", "completed", "served"},
		{"served but unpaid", items("kitchen", "served", "bar", "served"), "unpaid", "served", "served"},
		{"partial ready stays preparing", items("kitchen", "ready", "kitchen", "preparing", "bar", "ready"), "paid", "preparing", "preparing"},
		{"every active item ready", items("kitchen", "ready", "bar", "ready", "kitchen", "served"), "unpaid", "ready", "ready"},
		{"merchandise ignored", items("merchandise", "pending", "kitchen", "ready"), "paid", "ready", "ready"},
		{"no F&B items, paid", items("merchandise", "pending"), "PAID", "completed", "served"},
		{"no F&B items, unpaid", nil, "unpaid", "pending", "served"},
	}
	for _, c := range cases {
		order, kit := DeriveOrderKitchenStatus(c.items, c.payment)
		if order != c.wantOrder || kit != c.wantKit {
			t.Errorf("%s: got (%q, %q), want (%q, %q)", c.name, order, kit, c.wantOrder, c.wantKit)
		}
	}
}

func TestPrintQueueRules(t *testing.T) {
	stations := map[string]string{"bar": "bar", " Dessert ": "dessert", "": "kitchen", "kasir": "kitchen", "photobooth": "photobooth"}
	for in, want := range stations {
		if got := QueueStation(in); got != want {
			t.Errorf("QueueStation(%q) = %q, want %q", in, got, want)
		}
	}
	statuses := map[string]string{"PRINTED": "printed", " failed ": "failed", "done": "", "": ""}
	for in, want := range statuses {
		if got := QueueStatus(in); got != want {
			t.Errorf("QueueStatus(%q) = %q, want %q", in, got, want)
		}
	}
	patch := []struct{ action, status, want string }{
		{"mark_printing", "failed", "printing"},
		{"mark_printed", "", "printed"},
		{"mark_failed", "", "failed"},
		{"retry", "", "pending"},
		{"cancel", "", "cancelled"},
		{"explode", "Printed", "printed"},
		{"", "nope", ""},
	}
	for _, c := range patch {
		if got := ResolvePatchStatus(c.action, c.status); got != c.want {
			t.Errorf("ResolvePatchStatus(%q, %q) = %q, want %q", c.action, c.status, got, c.want)
		}
	}
}

func ptr(s string) *string { return &s }

func TestBuildKitchenPrintJobs(t *testing.T) {
	now := time.Date(2026, 10, 4, 3, 4, 5, 678_000_000, time.UTC)
	order := PrintOrder{ID: "o1", OrderNumber: "ORD-1", OrderType: "dine_in", TableID: ptr("T1"), RequestedAt: now}
	rows := BuildKitchenPrintJobs(order, []PrintItem{
		{ID: ptr("i1"), ProductID: ptr("p1"), ProductName: ptr("Nasi Goreng"), ProductSKU: ptr("NG"), Quantity: 2, UnitPrice: 25000, TotalAmount: 50000, KitchenNotes: "pedas"},
		{ID: ptr("i2"), ProductName: ptr("Es Teh"), Variants: json.RawMessage(`[{"name":"Large"}]`), Modifiers: json.RawMessage(`null`)},
		{ID: ptr("i3"), ProductName: ptr("Kaos"), Station: "merchandise"},
		{ProductName: ptr("Mie Ayam"), Station: "kitchen", Variants: json.RawMessage(`false`)},
	})
	if len(rows) != 2 {
		t.Fatalf("want 2 jobs (kitchen, bar), got %d", len(rows))
	}
	if rows[0].Station != "kitchen" || rows[0].JobType != "kitchen_ticket" || rows[0].Status != "pending" || rows[0].OrderID != "o1" {
		t.Errorf("kitchen row = %+v", rows[0])
	}
	if rows[1].Station != "bar" || rows[1].JobType != "bar_ticket" {
		t.Errorf("bar row = %+v", rows[1])
	}
	got, _ := json.Marshal(rows[0].Payload)
	want := `{"order_id":"o1","order_number":"ORD-1","queue_number":null,"order_type":"dine_in","table_id":"T1","station":"kitchen","requested_at":"2026-10-04T03:04:05.678Z","items":[` +
		`{"id":"i1","product_id":"p1","product_name":"Nasi Goreng","product_sku":"NG","variants":[],"modifiers":[],"quantity":2,"unit_price":25000,"total_amount":50000,"notes":"pedas"},` +
		`{"product_id":null,"product_name":"Mie Ayam","product_sku":null,"variants":[],"modifiers":[],"quantity":1,"unit_price":0,"total_amount":0,"notes":""}]}`
	if string(got) != want {
		t.Errorf("kitchen payload\n got %s\nwant %s", got, want)
	}
	bar, _ := json.Marshal(rows[1].Payload.Items)
	if string(bar) != `[{"id":"i2","product_id":null,"product_name":"Es Teh","product_sku":null,"variants":[{"name":"Large"}],"modifiers":[],"quantity":1,"unit_price":0,"total_amount":0,"notes":""}]` {
		t.Errorf("bar items = %s", bar)
	}

	queued := BuildKitchenPrintJobs(PrintOrder{ID: "o2", QueueNumber: "A07"}, []PrintItem{{ProductName: ptr("Roti")}})
	if q := queued[0].Payload.QueueNumber; q == nil || *q != "A07" || queued[0].Station != "bakery" {
		t.Errorf("queued = %+v", queued[0])
	}
	if BuildKitchenPrintJobs(order, []PrintItem{{Station: "photobooth"}}) != nil {
		t.Error("photobooth-only order must build no jobs")
	}
}
