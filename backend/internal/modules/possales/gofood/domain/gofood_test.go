package domain

import "testing"

func TestPosOrderNotes(t *testing.T) {
	// mapping.test.ts "menyusun catatan kasir/dapur"
	got := PosOrderNotes(NotesInput{GofoodOrderID: "F-1", GofoodOrderType: "pickup", Pin: "9999", CustomerName: "Budi", UnmappedCount: 1})
	want := "GoFood F-1 · Pickup · PIN 9999 · Pelanggan: Budi · 1 item TIDAK terpetakan — cek halaman GoFood"
	if got != want {
		t.Fatalf("got %q", got)
	}
	if got := PosOrderNotes(NotesInput{GofoodOrderID: "F-2", GofoodOrderType: "delivery", Cutlery: true}); got != "GoFood F-2 · Delivery · Minta alat makan" {
		t.Fatalf("got %q", got)
	}
}

func TestStatusRules(t *testing.T) {
	cases := []struct {
		status                       string
		accept, reject, notify, term bool
	}{
		{"created", true, true, false, false},
		{"awaiting_acceptance", true, true, false, false},
		{"accepted", false, true, true, false},
		{"driver_arrived", false, false, true, false},
		{"completed", false, false, false, true},
		{"cancelled", false, false, false, true},
	}
	for _, c := range cases {
		if CanAccept(c.status) != c.accept || CanReject(c.status) != c.reject ||
			NotifiesFoodReady(c.status) != c.notify || TerminalPosStatus(c.status) != c.term {
			t.Errorf("%s: rules differ", c.status)
		}
	}
	if !TerminalPosStatus("voided") || !TerminalPosStatus("merged") {
		t.Error("voided/merged are terminal for pos_orders")
	}
}

func TestListLimit(t *testing.T) {
	for in, want := range map[string]string{
		"": "50", "10": "10", "0": "1", "-5": "1", "999": "200", " 7 ": "7", "0x10": "16",
		"2.5": "2.5", "abc": "NaN", "Infinity": "200", "inf": "NaN", "1e2": "100", "1_0": "NaN",
	} {
		if got := ListLimit(in); got != want {
			t.Errorf("ListLimit(%q) = %q, want %q", in, got, want)
		}
	}
}
