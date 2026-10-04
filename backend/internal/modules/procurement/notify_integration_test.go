package procurement_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"nuhabit/backend/internal/app"
	"nuhabit/backend/internal/modules/procurement"
	"nuhabit/backend/internal/platform/outbox"
)

func TestUrgentPrSendsOwnerWhatsApp(t *testing.T) {
	e := newEnv(t)
	f := e.fixtures()
	staff := e.staff(itemsAll)
	var mu sync.Mutex
	var sent []map[string]string
	gateway := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]string
		_ = json.NewDecoder(r.Body).Decode(&body)
		mu.Lock()
		sent = append(sent, body)
		mu.Unlock()
		if r.Header.Get("x-gateway-token") != "tok" || r.URL.Path != "/send" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		_, _ = w.Write([]byte(`{"messageId":"m1"}`))
	}))
	defer gateway.Close()
	for k, v := range map[string]string{
		"wa_notif_config":  `{"enabled":true,"recipients":["0812-3456-7890"],"types":{"prMendesak":true}}`,
		"wa_gateway_url":   gateway.URL,
		"wa_gateway_token": "tok",
	} {
		e.exec(`INSERT INTO configuration.app_settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, k, v)
	}
	bus := outbox.NewBus(nil, nil)
	procurement.Subscribe(bus, app.ProcurementPorts(procurement.Location(""), nil))
	if err := bus.Register(e.ctx, e.tx); err != nil {
		t.Fatal(err)
	}
	r := e.do(&staff, "POST", "/api/purchasing/pr", prBody(f, map[string]any{"priority": "urgent", "action": "submit"}))
	e.expect(r, 201, "")
	for i := 0; i < 2; i++ {
		if _, err := bus.Dispatch(e.ctx, e.tx); err != nil {
			t.Fatal(err)
		}
	}
	// The second dispatch finds nothing due: one alert per PR and status.
	if len(sent) != 1 || sent[0]["target"] != "6281234567890" ||
		!strings.Contains(sent[0]["message"], r.data()["pr_number"].(string)+" diajukan, menunggu persetujuan.") ||
		!strings.Contains(sent[0]["message"], "Total estimasi: *Rp30.000*") || !strings.Contains(sent[0]["message"], "• Gula pasir — 2 kg") {
		t.Fatalf("sent = %v", sent)
	}
	if e.scalar(`SELECT count(*)::int FROM configuration.wa_notif_log WHERE notif_type = 'prMendesak' AND dedup_key = $1`, r.data()["id"].(string)+":pending_head") != int32(1) {
		t.Fatal("dedup claim missing")
	}
}
