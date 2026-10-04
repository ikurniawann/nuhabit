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

func str(s string) *string { return &s }

func TestConfigFromSettings(t *testing.T) {
	c := ConfigFromSettings(map[string]*string{})
	if c.Enabled || c.Environment != Sandbox || c.IsConfigured() ||
		c.APIBase != "https://api.partner-sandbox.gobiz.co.id" || c.OAuthURL != "https://integration-goauth.gojekapi.com/oauth2/token" {
		t.Fatalf("defaults: %+v", c)
	}
	c = ConfigFromSettings(map[string]*string{
		"gobiz_enabled": str("true"), "gobiz_environment": str("production"),
		"gobiz_client_id": str(" cid "), "gobiz_client_secret": str("sec"), "gobiz_outlet_id": str("G1"),
		"gobiz_auto_accept": str("TRUE"), "gobiz_api_base_url": str(" https://x.test/ "), "gobiz_oauth_url": str("  "),
	})
	if !c.Enabled || c.Environment != Production || !c.IsConfigured() || c.ClientID != "cid" || c.AutoAccept ||
		c.APIBase != "https://x.test" || c.OAuthURL != "https://accounts.go-jek.com/oauth2/token" {
		t.Fatalf("overrides: %+v", c)
	}
	if NormalizeEnvironment("staging") != Sandbox {
		t.Fatal("unknown environment should be sandbox")
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

func TestPadReason(t *testing.T) {
	for in, want := range map[string]string{" Habis ": "Habis", "a": "a..", "": "...", "ok ": "ok."} {
		if got := PadReason(in); got != want {
			t.Errorf("PadReason(%q) = %q, want %q", in, got, want)
		}
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
