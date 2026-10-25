package settings

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Midtrans next to Xendit: its own fields, one active gateway at a time,
// and the key check against a stand-in of api.sandbox.midtrans.com.
func TestMidtransGateway(t *testing.T) {
	f := newFixture(t)
	f.exec(`INSERT INTO configuration.payment_gateways (provider, display_name, is_active, environment, metadata)
		VALUES ('xendit', 'Xendit', true, 'live', '{}'), ('midtrans', 'Midtrans', false, 'sandbox', '{"supports":["qris"]}')
		ON CONFLICT (provider) DO UPDATE SET is_active = EXCLUDED.is_active, environment = EXCLUDED.environment,
		  secret_key = CASE WHEN EXCLUDED.provider = 'xendit' THEN 'xnd_live_key' END,
		  public_key = NULL, webhook_secret = NULL, callback_url = NULL, metadata = EXCLUDED.metadata`)
	f.exec(`UPDATE configuration.payment_gateways SET secret_key = 'xnd_live_key' WHERE provider = 'xendit'`)
	put := func(body map[string]any) response {
		return f.do("PUT", "/api/settings/payment-gateways", body, "admin", true)
	}

	expect(t, f.do("POST", "/api/settings/payment-gateways/midtrans/test", nil, "admin", true), 400,
		`{"success":false,"error":"Simpan server key Midtrans dulu sebelum tes koneksi"}`)
	expect(t, f.do("POST", "/api/settings/payment-gateways/xendit/test", nil, "admin", true), 400,
		`{"success":false,"error":"Tes koneksi hanya tersedia untuk Midtrans"}`)
	if res := f.do("POST", "/api/settings/payment-gateways/midtrans/test", nil, "admin", false); res.Status != 403 {
		t.Fatalf("no menu = %d", res.Status)
	}

	saved := put(map[string]any{"provider": "midtrans", "is_active": true, "environment": "sandbox",
		"secret_key": " SB-Mid-server-abcdefgh ", "public_key": "SB-Mid-client-12345678", "merchant_id": " G123456 "})
	d := saved.data()
	if saved.Status != 200 || d["secret_key_masked"] != "SB-M********efgh" || d["public_key_masked"] != "SB-M********5678" ||
		d["merchant_id"] != "G123456" || d["webhook_path"] != "/api/payments/midtrans/webhook" || d["is_active"] != true || d["coming_soon"] != false {
		t.Fatalf("save = %s", saved.Raw)
	}
	// Activating Midtrans deactivated Xendit; its keys stay.
	var xenditActive bool
	var xenditKey string
	_ = f.tx.QueryRow(context.Background(), `SELECT is_active, secret_key FROM configuration.payment_gateways WHERE provider = 'xendit'`).Scan(&xenditActive, &xenditKey)
	if xenditActive || xenditKey != "xnd_live_key" {
		t.Fatalf("xendit after midtrans activation: active=%v key=%q", xenditActive, xenditKey)
	}
	list := f.do("GET", "/api/settings/payment-gateways", nil, "admin", true)
	for _, raw := range list.Body["data"].([]any) {
		row := raw.(map[string]any)
		if row["provider"] == "xendit" && (row["is_active"] != false || row["webhook_path"] != "/api/payments/xendit/webhook") {
			t.Fatalf("xendit row = %v", row)
		}
	}
	// A blank merchant id clears it; omitting it keeps it.
	put(map[string]any{"provider": "midtrans", "is_active": true, "environment": "sandbox"})
	if d := put(map[string]any{"provider": "midtrans", "is_active": true, "environment": "sandbox", "merchant_id": ""}).data(); d["merchant_id"] != nil {
		t.Fatalf("merchant after clear = %v", d["merchant_id"])
	}

	// Key check: the stand-in accepts the saved key only.
	var auth []string
	standIn := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth = append(auth, r.Header.Get("Authorization"))
		if !strings.HasPrefix(r.URL.Path, "/v2/nuhabit-ping-") {
			t.Errorf("path %s", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Basic U0ItTWlkLXNlcnZlci1hYmNkZWZnaDo=" {
			w.WriteHeader(401)
			_ = json.NewEncoder(w).Encode(map[string]any{"status_code": "401"})
			return
		}
		w.WriteHeader(404)
		_ = json.NewEncoder(w).Encode(map[string]any{"status_code": "404", "status_message": "Transaction doesn't exist."})
	}))
	defer standIn.Close()
	f.env["MIDTRANS_API_BASE_URL"] = standIn.URL
	expect(t, f.do("POST", "/api/settings/payment-gateways/midtrans/test", nil, "admin", true), 200,
		`{"success":true,"data":{"provider":"midtrans","environment":"sandbox"},"message":"Server key Midtrans diterima (sandbox)"}`)
	put(map[string]any{"provider": "midtrans", "is_active": true, "environment": "sandbox", "secret_key": "SB-Mid-server-wrong"})
	res := f.do("POST", "/api/settings/payment-gateways/midtrans/test", nil, "admin", true)
	if res.Status != 400 || !strings.Contains(res.Raw, "Server key ditolak Midtrans (401)") {
		t.Fatalf("wrong key = %s", res.Raw)
	}
	if len(auth) != 2 {
		t.Fatalf("probe calls = %d", len(auth))
	}

	// Switching back to Xendit deactivates Midtrans.
	put(map[string]any{"provider": "xendit", "is_active": true, "environment": "live"})
	var midtransActive bool
	_ = f.tx.QueryRow(context.Background(), `SELECT is_active FROM configuration.payment_gateways WHERE provider = 'midtrans'`).Scan(&midtransActive)
	if midtransActive {
		t.Fatal("midtrans still active after xendit activation")
	}
}
