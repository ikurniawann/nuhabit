package kitchen

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"
	"time"

	"nuhabit/backend/internal/modules/possales/kitchen/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/testutil"
)

type testModule struct{ h *Handler }

func (testModule) Name() string             { return "pos-sales" }
func (m testModule) Routes() []module.Route { return m.h.Routes() }

// Tickets are dated 2091-01-01 00:00Z so the date filter isolates them from
// whatever the local database holds; the clock sits 20.5 minutes later.
var (
	orderedAt = time.Date(2091, 1, 1, 0, 0, 0, 0, time.UTC)
	pinned    = orderedAt.Add(20*time.Minute + 30*time.Second)
)

type fixture struct {
	t   *testing.T
	tx  database.DB
	mux *http.ServeMux
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	deps := testutil.Deps(t, func() time.Time { return pinned })
	tx := testutil.Tx(t)
	h := NewWithPorts(deps, Ports{Tables: TablesSQL{DB: tx}})
	h.db = tx
	return &fixture{t: t, tx: tx, mux: testutil.Mux(testModule{h})}
}

func (f *fixture) do(r *http.Request, staff *testutil.Staff) (int, string) {
	f.t.Helper()
	if staff != nil {
		testutil.AsStaff(r, *staff)
	}
	rec, _ := testutil.Do(f.t, f.mux, r)
	return rec.Code, rec.Body.String()
}

func (f *fixture) scalar(sql string, args ...any) string {
	f.t.Helper()
	var s string
	if err := f.tx.QueryRow(context.Background(), sql, args...).Scan(&s); err != nil {
		f.t.Fatalf("%s: %v", sql, err)
	}
	return s
}

// order inserts a pos_orders row and returns its id.
func (f *fixture) order(number, status, tableID string) string {
	f.t.Helper()
	var table any
	if tableID != "" {
		table = tableID
	}
	return f.scalar(`INSERT INTO pos.pos_orders (order_number, status, cashier_id, ordered_at, table_id, queue_number)
		VALUES ($1, $2::pos_order_status, gen_random_uuid(), $3, $4, NULL) RETURNING id::text`, number, status, orderedAt, table)
}

func (f *fixture) item(orderID, name, station, kitchenStatus, notes, variants string) {
	f.t.Helper()
	var st, ks, kn any
	if station != "" {
		st = station
	}
	if kitchenStatus != "" {
		ks = kitchenStatus
	}
	if notes != "" {
		kn = notes
	}
	f.scalar(`INSERT INTO pos.pos_order_items (order_id, product_name, product_sku, quantity, unit_price, subtotal, total_amount,
		station, kitchen_status, kitchen_notes, variants)
		VALUES ($1::uuid, $2, 'SKU', 2, 15000, 30000, 30000, $3, $4, $5, $6::jsonb) RETURNING id::text`,
		orderID, name, st, ks, kn, variants)
}

func kitchenStaff(t *testing.T) testutil.Staff {
	return testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{"pos.kitchen": nil}})
}

const window = "date_from=2091-01-01T00:00:00Z&date_to=2091-01-02T00:00:00Z"

func TestKDS(t *testing.T) {
	f := newFixture(t)
	staff := kitchenStaff(t)

	tableID := f.scalar(`INSERT INTO pos.pos_tables (table_number, capacity, qr_code) VALUES ('T-9', 4, 'QR-9') RETURNING id::text`)
	a := f.order("KDS-A-"+testutil.RandomHex(3), "preparing", tableID)
	f.item(a, "Nasi Goreng", "", "ready", "pedas", `[{"name":"Large"},{"name":""},{"price":1}]`)
	f.item(a, "Es Teh", "", "", "", `[]`)                       // bar by name; status from the order
	f.item(a, "Kaos", "merchandise", "pending", "", `[]`)       // not F&B
	f.item(a, "Mie Ayam", "kitchen", "served", "", `[]`)        // terminal
	b := f.order("KDS-B-"+testutil.RandomHex(3), "pending", "") // only merchandise: dropped
	f.item(b, "Kaos", "merchandise", "pending", "", `[]`)
	done := f.order("KDS-C-"+testutil.RandomHex(3), "completed", "")
	f.item(done, "Nasi", "kitchen", "pending", "", `[]`)

	t.Run("403 without the kitchen grant", func(t *testing.T) { // route.test.ts
		other := testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{"pos.cashier": nil}})
		code, body := f.do(testutil.Request("GET", "/api/pos/kds", nil), &other)
		if code != 403 || body != `{"success":false,"error":"Insufficient permissions"}` {
			t.Fatalf("got %d %s", code, body)
		}
		code, _ = f.do(testutil.Request("GET", "/api/pos/kds", nil), nil)
		if code != 401 {
			t.Fatalf("no session: got %d", code)
		}
	})

	t.Run("all stations", func(t *testing.T) {
		code, body := f.do(testutil.Request("GET", "/api/pos/kds?"+window, nil), &staff)
		if code != 200 {
			t.Fatalf("got %d %s", code, body)
		}
		want := `{"success":true,"data":[{"id":"` + a + `","order_number":"` + f.scalar(`SELECT order_number FROM pos.pos_orders WHERE id = $1::uuid`, a) +
			`","queue_number":null,"checkout_id":null,"warehouse_id":null,"status":"preparing","payment_status":"unpaid","order_type":"dine_in",` +
			`"table_id":"` + tableID + `","notes":null,"special_requests":null,"ordered_at":"2091-01-01T00:00:00.000Z","confirmed_at":null,"pos_order_items":[`
		if !strings.HasPrefix(body, want) {
			t.Fatalf("prefix mismatch\n got %s\nwant %s", body, want)
		}
		var resp struct {
			Count int `json:"count"`
			Data  []struct {
				StationStatus string           `json:"station_status"`
				Status        string           `json:"status"`
				TableLabel    any              `json:"table_label"`
				WaitSeconds   int              `json:"wait_seconds"`
				WaitMinutes   int              `json:"wait_minutes"`
				IsOverdue     bool             `json:"is_overdue"`
				IsUrgent      bool             `json:"is_urgent"`
				Items         []map[string]any `json:"pos_order_items"`
			} `json:"data"`
		}
		if err := json.Unmarshal([]byte(body), &resp); err != nil {
			t.Fatal(err)
		}
		if resp.Count != 1 || len(resp.Data) != 1 {
			t.Fatalf("want only order A, got %s", body)
		}
		o := resp.Data[0]
		if o.StationStatus != "preparing" || o.Status != "preparing" || o.TableLabel != "T-9" ||
			o.WaitSeconds != 1230 || o.WaitMinutes != 20 || !o.IsOverdue || !o.IsUrgent || len(o.Items) != 2 {
			t.Fatalf("order = %+v", o)
		}
		if !strings.Contains(body, `"variants":[{"name":"Large"},{"name":""},{"price":1}],"modifiers":[],"quantity":2,"unit_price":15000,"kitchen_notes":"pedas","station":"kitchen","kitchen_status":"ready",`) ||
			!strings.Contains(body, `"variant_info":"Large","modifier_info":"","notes":"pedas"}`) ||
			!strings.Contains(body, `"product_name":"Es Teh"`) || !strings.Contains(body, `"station":"bar","kitchen_status":"preparing"`) {
			t.Fatalf("items = %s", body)
		}
		if !strings.HasSuffix(body, `"station_status":"preparing","table_label":"T-9","wait_seconds":1230,"wait_minutes":20,"is_overdue":true,"is_urgent":true}],"count":1}`) {
			t.Fatalf("tail = %s", body)
		}
	})

	t.Run("station filter rewrites status", func(t *testing.T) {
		_, body := f.do(testutil.Request("GET", "/api/pos/kds?station=KITCHEN&"+window, nil), &staff)
		if !strings.Contains(body, `"status":"ready"`) || !strings.Contains(body, `"station_status":"ready"`) || strings.Contains(body, "Es Teh") {
			t.Fatalf("kitchen = %s", body)
		}
		_, body = f.do(testutil.Request("GET", "/api/pos/kds?station=dessert&"+window, nil), &staff)
		if body != `{"success":true,"data":[],"count":0}` {
			t.Fatalf("dessert = %s", body)
		}
	})

	t.Run("query errors leak the PostgreSQL message", func(t *testing.T) {
		code, body := f.do(testutil.Request("GET", "/api/pos/kds?branch_id=nope", nil), &staff)
		if code != 500 || body != `{"success":false,"error":"invalid input syntax for type uuid: \"nope\""}` {
			t.Fatalf("got %d %s", code, body)
		}
		code, body = f.do(testutil.Request("GET", "/api/pos/kds?limit=abc", nil), &staff)
		if code != 500 || body != `{"success":false,"error":"invalid input syntax for type bigint: \"NaN\""}` {
			t.Fatalf("got %d %s", code, body)
		}
	})
}

func TestPrintJobs(t *testing.T) {
	f := newFixture(t)
	t.Setenv("POS_PRINT_WORKER_TOKEN", " worker-secret ")
	order := f.order("PJ-"+testutil.RandomHex(3), "pending", "T-1")
	worker := func(r *http.Request) *http.Request {
		r.Header.Set("X-POS-Print-Worker-Token", "worker-secret")
		return r
	}

	t.Run("auth", func(t *testing.T) { // route.test.ts
		code, body := f.do(testutil.Request("POST", "/api/pos/print-jobs", map[string]any{"order_id": order}), nil)
		if code != 401 || body != `{"success":false,"error":"Authentication required"}` {
			t.Fatalf("no auth: %d %s", code, body)
		}
		r := testutil.Request("POST", "/api/pos/print-jobs", map[string]any{"order_id": order})
		r.Header.Set("X-POS-Print-Worker-Token", "worker-secreX")
		if code, _ := f.do(r, nil); code != 401 {
			t.Fatalf("wrong token: %d", code)
		}
		code, body = f.do(worker(testutil.Request("POST", "/api/pos/print-jobs", map[string]any{})), nil)
		if code != 400 || body != `{"success":false,"error":"order_id is required"}` {
			t.Fatalf("missing order_id: %d %s", code, body)
		}
		cashier := testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{"pos.cashier": nil}})
		code, _ = f.do(testutil.Request("GET", "/api/pos/print-jobs?limit=1", nil), &cashier)
		if code != 200 {
			t.Fatalf("POS session: %d", code)
		}
	})

	var id string
	t.Run("create", func(t *testing.T) {
		code, body := f.do(worker(testutil.Request("POST", "/api/pos/print-jobs",
			`{"order_id":"`+order+`","station":" BAR ","payload":{"items":[{"qty":1.50}]}}`)), nil)
		if code != 201 {
			t.Fatalf("got %d %s", code, body)
		}
		id = f.scalar(`SELECT id::text FROM pos.pos_print_jobs WHERE order_id = $1::uuid`, order)
		want := `{"success":true,"data":{"id":"` + id + `","order_id":"` + order + `","station":"bar","job_type":"bar_ticket","status":"pending","payload":{"items":[{"qty":1.5}]},"attempts":0,"last_error":null,"requested_at":"`
		if !strings.HasPrefix(body, want) {
			t.Fatalf("got %s\nwant prefix %s", body, want)
		}
		code, body = f.do(worker(testutil.Request("POST", "/api/pos/print-jobs", "")), nil)
		if code != 500 || body != `{"success":false,"error":"Unexpected end of JSON input"}` {
			t.Fatalf("empty body: %d %s", code, body)
		}
	})

	t.Run("list", func(t *testing.T) {
		code, body := f.do(worker(testutil.Request("GET", "/api/pos/print-jobs?status=PENDING&station=bar", nil)), nil)
		if code != 200 || !strings.Contains(body, `"id":"`+id+`"`) ||
			!strings.Contains(body, `"order":{"order_number":"`) || !strings.Contains(body, `"table_id":"T-1"`) {
			t.Fatalf("got %d %s", code, body)
		}
		_, body = f.do(worker(testutil.Request("GET", "/api/pos/print-jobs?station=kitchen", nil)), nil)
		if strings.Contains(body, id) {
			t.Fatalf("kitchen filter returned the bar job: %s", body)
		}
		code, body = f.do(worker(testutil.Request("GET", "/api/pos/print-jobs?limit=-5", nil)), nil)
		if code != 500 || body != `{"success":false,"error":"Unknown error"}` {
			t.Fatalf("negative limit: %d %s", code, body)
		}
	})

	t.Run("patch", func(t *testing.T) {
		patch := func(body any) (int, string) {
			return f.do(worker(testutil.Request("PATCH", "/api/pos/print-jobs/"+id, body)), nil)
		}
		if code, body := patch(map[string]any{"status": "done"}); code != 400 || body != `{"success":false,"error":"Invalid print job status"}` {
			t.Fatalf("invalid: %d %s", code, body)
		}
		if code, body := patch("not json"); code != 400 {
			t.Fatalf("bad JSON reads as {}: %d %s", code, body)
		}
		patch(map[string]any{"action": "mark_printing"})
		code, body := patch(map[string]any{"status": "printing"})
		if code != 200 || !strings.Contains(body, `"status":"printing","payload":{"items":[{"qty":1.5}]},"attempts":2,"last_error":null`) {
			t.Fatalf("printing: %d %s", code, body)
		}
		_, body = patch(map[string]any{"action": "mark_failed", "error": "Paper out"})
		if !strings.Contains(body, `"status":"failed"`) || !strings.Contains(body, `"last_error":"Paper out"`) {
			t.Fatalf("failed: %s", body)
		}
		_, body = patch(map[string]any{"action": "mark_printed"})
		stamp := `"2091-01-01T00:20:30.000Z"`
		if !strings.Contains(body, `"last_error":null`) || !strings.Contains(body, `"printed_at":`+stamp) || !strings.Contains(body, `"updated_at":`+stamp) {
			t.Fatalf("printed: %s", body)
		}
		_, body = patch(map[string]any{"action": "retry"})
		if !strings.Contains(body, `"status":"pending"`) || !strings.Contains(body, `"requested_at":`+stamp+`,"printed_at":null`) {
			t.Fatalf("retry: %s", body)
		}
		code, body = f.do(worker(testutil.Request("PATCH", "/api/pos/print-jobs/00000000-0000-4000-8000-000000000000", map[string]any{"action": "cancel"})), nil)
		if code != 500 || body != `{"success":false,"error":"Unknown error"}` {
			t.Fatalf("missing job: %d %s", code, body)
		}
		// Last: a failed INSERT aborts the test transaction.
		code, body = f.do(worker(testutil.Request("POST", "/api/pos/print-jobs", `{"order_id":"`+order+`","station":"bar"}`)), nil)
		if code != 500 || body != `{"success":false,"error":"Unknown error"}` {
			t.Fatalf("duplicate open job: %d %s", code, body)
		}
	})
}

func TestInsertPrintJobs(t *testing.T) {
	f := newFixture(t)
	order := f.order("IPJ-"+testutil.RandomHex(3), "pending", "")
	name := "Es Teh"
	rows := domain.BuildKitchenPrintJobs(domain.PrintOrder{ID: order, OrderNumber: "IPJ", OrderType: "dine_in", RequestedAt: pinned},
		[]domain.PrintItem{{ProductName: &name, Quantity: 1, UnitPrice: 8000}})
	if err := InsertPrintJobs(context.Background(), f.tx, rows); err != nil {
		t.Fatal(err)
	}
	got := f.scalar(`SELECT station || '|' || job_type || '|' || status || '|' || (payload->>'requested_at') || '|' || (payload->'items'->0->>'unit_price')
		FROM pos.pos_print_jobs WHERE order_id = $1::uuid`, order)
	if got != "bar|bar_ticket|pending|2091-01-01T00:20:30.000Z|8000" {
		t.Fatalf("got %s", got)
	}
}
