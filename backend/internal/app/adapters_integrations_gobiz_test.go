package app

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"nuhabit/backend/internal/modules/integrations/gobiz"
	"nuhabit/backend/internal/platform/auth"
	gobizapi "nuhabit/backend/internal/platform/gobiz"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/testutil"
)

type allowGuard struct{}

func (allowGuard) RequireMenuPrefix(*http.Request, ...string) (*auth.User, error) {
	return &auth.User{ID: "staff-1"}, nil
}

type gobizRoutes []module.Route

func (r gobizRoutes) Name() string           { return "gobiz" }
func (r gobizRoutes) Routes() []module.Route { return r }

// TestGobizAdapters runs the webhook and the catalog sync on the real
// adapters (pos-sales GoFood service, ported gofood_orders SQL, pos-ops
// catalog reads) in a rolled-back transaction.
func TestGobizAdapters(t *testing.T) {
	ctx := context.Background()
	tx := testutil.Tx(t)
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := tx.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	scalar := func(sql string, args ...any) string {
		t.Helper()
		var v *string
		if err := tx.QueryRow(ctx, sql, args...).Scan(&v); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
		if v == nil {
			return ""
		}
		return *v
	}

	var pushed []byte
	gb := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		switch {
		case r.URL.Path == "/token":
			_, _ = io.WriteString(w, `{"access_token":"T","expires_in":3599}`)
		case strings.HasSuffix(r.URL.Path, "/v1/catalog"):
			pushed = body
			_, _ = io.WriteString(w, `{"success":true}`)
		default:
			_, _ = io.WriteString(w, `{"success":true,"data":{}}`)
		}
	}))
	defer gb.Close()

	exec(`DELETE FROM configuration.app_settings WHERE key LIKE 'gobiz\_%'`)
	exec(`INSERT INTO configuration.app_settings (key, value) VALUES
		('gobiz_client_id','cid'), ('gobiz_client_secret','sec'), ('gobiz_outlet_id','G1'), ('gobiz_webhook_token','hook-token'),
		('gobiz_auto_accept','true'), ('gobiz_api_base_url',$1), ('gobiz_oauth_url',$2)`, gb.URL, gb.URL+"/token")
	exec(`INSERT INTO pos.sales_channels (code, name, markup_percent, rounding_step, rounding_mode, is_active)
		VALUES ('gofood', 'GoFood', 20, 1000, 'up', true)
		ON CONFLICT (code) DO UPDATE SET markup_percent = 20, rounding_step = 1000, rounding_mode = 'up', is_active = true`)
	sku := "GBZ-" + testutil.RandomHex(4)
	product := scalar(`INSERT INTO pos.pos_products (sku, name, base_price, station, sales_channels) VALUES ($1, 'Kopi GoBiz', 25000, 'bar', '{gofood}') RETURNING id::text`, sku)
	variant := scalar(`INSERT INTO pos.pos_product_variants (product_id, name, group_name) VALUES ($1, 'Large', 'Ukuran') RETURNING id::text`, product)
	group := scalar(`INSERT INTO pos.pos_modifier_groups (name, min_selection, max_selection) VALUES ('Tambahan', 0, 2) RETURNING id::text`)
	modifier := scalar(`INSERT INTO pos.pos_modifiers (group_id, name, price_adjustment) VALUES ($1, 'Extra shot', 5000) RETURNING id::text`, group)
	exec(`INSERT INTO pos.pos_product_modifiers (product_id, modifier_group_id) VALUES ($1, $2)`, product, group)

	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	ports := newIntegrationsGobizPorts(module.Deps{Now: time.Now, Log: log})
	mux := testutil.Mux(gobizRoutes(gobiz.NewHandler(tx, allowGuard{}, ports, gobizapi.NewClient(nil, nil), nil, log, "https://pos.test").Routes()))
	post := func(target, body string) map[string]any {
		t.Helper()
		rec, out := testutil.Do(t, mux, testutil.Request("POST", target, body))
		if rec.Code != 200 {
			t.Fatalf("%s: %d %s", target, rec.Code, rec.Body)
		}
		return out
	}
	event := func(name, id, order, extra string) string {
		return `{"header":{"event_name":"gofood.order.` + name + `","event_id":"` + id + `"},"body":{"service_type":"gofood",` +
			`"customer":{"name":"Budi"},"order":{"order_number":"` + order + `","order_total":72000,"pin":"1234"` + extra + `}}}`
	}
	gofoodID := "F-" + testutil.RandomHex(4)
	items := `,"order_items":[{"id":"i1","external_id":"` + product + `","name":"Kopi","quantity":2,"price":36000,` +
		`"variants":[{"external_id":"` + variant + `"},{"external_id":"` + modifier + `","name":"Extra shot"}]},` +
		`{"id":"i2","external_id":"nope","name":"Misterius","quantity":1,"price":0}]`

	out := post("/api/integrations/gobiz/webhook/hook-token", event("awaiting_merchant_acceptance", "e1-"+gofoodID, gofoodID, items))
	if out["data"].(map[string]any)["result"] != "auto_accepted" {
		t.Fatalf("auto accept: %v", out)
	}
	var status, posOrderID, mapped, unmapped string
	if err := tx.QueryRow(ctx, `SELECT status, pos_order_id::text, items::text, unmapped_items::text FROM pos.gofood_orders WHERE gofood_order_id = $1`, gofoodID).
		Scan(&status, &posOrderID, &mapped, &unmapped); err != nil {
		t.Fatal(err)
	}
	var lines []map[string]any
	_ = json.Unmarshal([]byte(mapped), &lines)
	// The add-on is priced at the GoFood markup (5000 × 1,2 → 6000).
	if status != "accepted" || posOrderID == "" || len(lines) != 1 || lines[0]["variant_name"] != "Large" ||
		lines[0]["product_sku"] != sku || lines[0]["station"] != "bar" ||
		!strings.Contains(mapped, `"modifiers": [{"name": "Extra shot", "group": "Tambahan", "price": 6000}]`) ||
		!strings.Contains(unmapped, `"reason": "product_not_found"`) {
		t.Fatalf("gofood row %s %q\n%s\n%s", status, posOrderID, mapped, unmapped)
	}
	if got := scalar(`SELECT status::text || ' ' || total_amount::text FROM pos.pos_orders WHERE id = $1`, posOrderID); got != "confirmed 72000.00" {
		t.Fatalf("pos order %s", got)
	}

	// Acceptance echoed by GoBiz: the POS order already exists.
	out = post("/api/integrations/gobiz/webhook/hook-token", event("merchant_accepted", "e2-"+gofoodID, gofoodID, ""))
	if out["data"].(map[string]any)["result"] != "accepted_synced" {
		t.Fatalf("accepted: %v", out)
	}
	out = post("/api/integrations/gobiz/webhook/hook-token", event("cancelled", "e3-"+gofoodID, gofoodID, `,"cancellation_detail":{"reason":"Habis"}`))
	if out["data"].(map[string]any)["result"] != "cancelled" {
		t.Fatalf("cancelled: %v", out)
	}
	if got := scalar(`SELECT o.status::text || ' ' || h.notes FROM pos.pos_orders o
		JOIN pos.pos_order_status_history h ON h.order_id = o.id AND h.to_status = 'cancelled' WHERE o.id = $1`, posOrderID); got != "cancelled GoFood "+gofoodID+" dibatalkan: Habis" {
		t.Fatalf("pos cancel %s", got)
	}
	if got := scalar(`SELECT status || ' ' || cancel_reason FROM pos.gofood_orders WHERE gofood_order_id = $1`, gofoodID); got != "cancelled Habis" {
		t.Fatalf("gofood cancel %s", got)
	}

	// Catalog sync reads the product with its variant and add-on group.
	post("/api/settings/gobiz/actions", `{"action":"sync_catalog"}`)
	var payload struct {
		Menus []struct {
			MenuItems []struct {
				ExternalID string   `json:"external_id"`
				Price      float64  `json:"price"`
				Categories []string `json:"variant_category_external_ids"`
			} `json:"menu_items"`
		} `json:"menus"`
	}
	if err := json.Unmarshal(pushed, &payload); err != nil {
		t.Fatal(err)
	}
	found := false
	for _, m := range payload.Menus {
		for _, it := range m.MenuItems {
			if it.ExternalID == product {
				found = true
				if it.Price != 30000 || strings.Join(it.Categories, ",") != "vc:"+product+",mg:"+group {
					t.Fatalf("item %+v", it)
				}
			}
		}
	}
	if !found {
		t.Fatal("product missing from the pushed catalog")
	}
}
