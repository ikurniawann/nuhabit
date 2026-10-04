package resort

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/testutil"
)

// Integration tests run every write in one rolled-back transaction on a
// fresh (random) venue; handlers get a header-driven guard and a fixed
// venue. TestAuthWiring covers the real platform/auth guard, and
// concurrency_integration_test.go commits its own venue to prove the locks.

type headerGuard struct{}

func (headerGuard) user(r *http.Request) (*auth.User, error) {
	id := r.Header.Get("X-Test-Staff")
	if id == "" {
		return nil, httpx.Unauthorized("")
	}
	return &auth.User{ID: id, FullName: "  Sari  "}, nil
}

func (g headerGuard) RequireMenuPrefix(r *http.Request, _ ...string) (*auth.User, error) {
	return g.user(r)
}

func (g headerGuard) RequireMenuAction(r *http.Request, _ string, _ ...string) (*auth.User, error) {
	return g.user(r)
}

type fixedVenue struct{ company, branch string }

func (f fixedVenue) Resolve(context.Context, string) (string, string, error) {
	return f.company, f.branch, nil
}

type fixture struct {
	t       *testing.T
	svc     *Service
	mux     http.Handler
	staff   string
	company string
	branch  string
}

// newFixture serves the module on a rolled-back transaction. The clock is
// pinned to 2026-10-05 08:00 WIB (a Monday).
func newFixture(t *testing.T) *fixture {
	t.Helper()
	tx := testutil.Tx(t)
	now := func() time.Time { return time.Date(2026, 10, 5, 1, 0, 0, 0, time.UTC) }
	f := &fixture{t: t, staff: newUUID(t), company: newUUID(t), branch: newUUID(t)}
	f.svc = NewService(tx, now)
	f.mux = testutil.Mux(mod{h: &handler{svc: f.svc, guard: headerGuard{}, venues: fixedVenue{f.company, f.branch}, now: now}})
	return f
}

func newUUID(t *testing.T) string {
	t.Helper()
	var id string
	if err := testutil.DB(t).QueryRow(context.Background(), `SELECT gen_random_uuid()::text`).Scan(&id); err != nil {
		t.Fatal(err)
	}
	return id
}

type response struct {
	Status int
	Raw    string
	Body   map[string]any
}

func (r response) data() map[string]any { m, _ := r.Body["data"].(map[string]any); return m }
func (r response) list() []any          { l, _ := r.Body["data"].([]any); return l }

func (f *fixture) call(method, target string, body any) response {
	f.t.Helper()
	req := testutil.Request(method, target, body)
	req.Header.Set("X-Test-Staff", f.staff)
	rec := httptest.NewRecorder()
	f.mux.ServeHTTP(rec, req)
	var out map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	return response{Status: rec.Code, Raw: rec.Body.String(), Body: out}
}

func (f *fixture) ok(r response, status int) response {
	f.t.Helper()
	if r.Status != status {
		f.t.Fatalf("status %d, want %d: %s", r.Status, status, r.Raw)
	}
	return r
}

func (f *fixture) fail(r response, status int, msg string) {
	f.t.Helper()
	if r.Status != status || r.Body["error"] != msg {
		f.t.Fatalf("got %d %s, want %d %q", r.Status, r.Raw, status, msg)
	}
}

func (f *fixture) scalar(sql string, args ...any) string {
	f.t.Helper()
	var out string
	if err := f.svc.db.QueryRow(context.Background(), sql, args...).Scan(&out); err != nil {
		f.t.Fatalf("%s: %v", sql, err)
	}
	return out
}

// cabin creates a room type with n rooms and returns its id and room ids.
func (f *fixture) cabin(code string, rooms ...string) (string, []string) {
	f.t.Helper()
	typeID := f.ok(f.call("POST", "/api/resort/room-types", map[string]any{
		"code": code, "name": "Cabin " + code, "capacity_adults": 2, "extra_bed_capacity": 1,
		"rate_weekday": 1_000_000, "rate_weekend": 1_500_000, "extra_bed_rate": 200_000, "amenities": []string{" wifi ", "air panas"},
	}), 201).data()["id"].(string)
	var ids []string
	for _, c := range rooms {
		ids = append(ids, f.ok(f.call("POST", "/api/resort/rooms", map[string]any{"room_type_id": typeID, "code": c, "name": "Kamar " + c}), 201).data()["id"].(string))
	}
	return typeID, ids
}

func (f *fixture) reserve(typeID string, qty int, extra map[string]any) map[string]any {
	f.t.Helper()
	body := map[string]any{
		"guest_name": "Budi Santoso", "guest_phone": "081234567", "check_in": "2026-10-08", "check_out": "2026-10-10",
		"rooms": []any{map[string]any{"room_type_id": typeID, "qty": qty, "extra_bed": 1}},
	}
	for k, v := range extra {
		body[k] = v
	}
	return f.ok(f.call("POST", "/api/resort/reservations", body), 201).data()
}

func TestCatalog(t *testing.T) {
	f := newFixture(t)
	created := f.ok(f.call("POST", "/api/resort/room-types", map[string]any{"code": " cab ", "name": "Cabin", "rate_weekday": 900000}), 201)
	if created.Body["message"] != "Tipe kamar Cabin dibuat" || created.data()["code"] != "CAB" {
		t.Fatalf("create type: %s", created.Raw)
	}
	typeID := created.data()["id"].(string)
	f.fail(f.call("POST", "/api/resort/room-types", map[string]any{"code": "Cab", "name": "Lain"}), 409, `Kode tipe kamar "Cab" sudah dipakai`)

	bad := f.call("POST", "/api/resort/room-types", map[string]any{"code": "", "name": "X", "capacity_adults": 0})
	issues, _ := bad.Body["details"].([]any)
	if bad.Status != 400 || bad.Body["error"] != "Validation failed" || len(issues) != 2 {
		t.Fatalf("validation: %s", bad.Raw)
	}

	room := f.ok(f.call("POST", "/api/resort/rooms", map[string]any{"room_type_id": typeID, "code": "c-01", "name": "Cabin 01"}), 201)
	if room.Body["message"] != "Kamar Cabin 01 dibuat" || room.data()["code"] != "C-01" {
		t.Fatalf("create room: %s", room.Raw)
	}
	roomID := room.data()["id"].(string)
	f.fail(f.call("POST", "/api/resort/rooms", map[string]any{"room_type_id": newUUID(t), "code": "x", "name": "X"}), 404, "Tipe kamar tidak ditemukan")
	f.fail(f.call("POST", "/api/resort/rooms", map[string]any{"room_type_id": typeID, "code": "C-01", "name": "Lagi"}), 409, `Kode kamar "C-01" sudah dipakai`)

	list := f.ok(f.call("GET", "/api/resort/room-types", nil), 200)
	types := list.data()["types"].([]any)
	first := types[0].(map[string]any)
	if len(types) != 1 || first["room_count"] != float64(1) || first["rate_weekday"] != float64(900000) || first["description"] != nil {
		t.Fatalf("list types: %s", list.Raw)
	}
	if !strings.HasPrefix(list.Raw, `{"success":true,"data":{"types":[{"id":`) || !strings.Contains(list.Raw, `"amenities":[],"is_active":true,"sort_order":0,"room_count":1}`) {
		t.Fatalf("type row order: %s", list.Raw)
	}

	if r := f.ok(f.call("PATCH", "/api/resort/room-types/"+typeID, map[string]any{}), 200); r.Raw != `{"success":true,"data":{"id":"`+typeID+`"}}` {
		t.Fatalf("empty patch: %s", r.Raw)
	}
	patched := f.ok(f.call("PATCH", "/api/resort/room-types/"+typeID, map[string]any{"name": "Cabin Besar", "description": nil, "amenities": []string{"wifi"}}), 200)
	if patched.Body["message"] != "Tipe kamar diperbarui" || patched.data()["name"] != "Cabin Besar" {
		t.Fatalf("patch type: %s", patched.Raw)
	}
	f.fail(f.call("PATCH", "/api/resort/room-types/"+newUUID(t), map[string]any{"name": "X"}), 404, "Tipe kamar tidak ditemukan")

	rp := f.ok(f.call("PATCH", "/api/resort/rooms/"+roomID, map[string]any{"status": "kotor", "notes": nil}), 200)
	if rp.Body["message"] != "Kamar diperbarui" || rp.data()["status"] != "kotor" {
		t.Fatalf("patch room: %s", rp.Raw)
	}
	rooms := f.ok(f.call("GET", "/api/resort/rooms?room_type_id="+typeID, nil), 200).list()
	if r := rooms[0].(map[string]any); len(rooms) != 1 || r["room_type_name"] != "Cabin Besar" || r["guest_name"] != nil {
		t.Fatalf("rooms: %v", rooms)
	}
	if r := f.ok(f.call("DELETE", "/api/resort/rooms/"+roomID, nil), 200); r.Raw != `{"success":true,"message":"Kamar Cabin 01 dihapus"}` {
		t.Fatalf("delete room: %s", r.Raw)
	}
	if r := f.ok(f.call("DELETE", "/api/resort/room-types/"+typeID, nil), 200); r.Body["message"] != "Tipe kamar Cabin Besar dihapus" {
		t.Fatalf("delete type: %s", r.Raw)
	}
	f.fail(f.call("DELETE", "/api/resort/rooms/"+roomID, nil), 404, "Kamar tidak ditemukan")
	// Last: the 22P02 aborts the test transaction.
	f.fail(f.call("PATCH", "/api/resort/room-types/bukan-uuid", map[string]any{"name": "X"}), 400, "Format data tidak valid")
}

func TestReservationLifecycle(t *testing.T) {
	f := newFixture(t)
	typeID, roomIDs := f.cabin("CAB", "C1", "C2")

	f.fail(f.call("GET", "/api/resort/availability?check_in=2026-10-10&check_out=2026-10-10", nil), 400, "Tanggal check-out harus setelah check-in")
	avail := f.ok(f.call("GET", "/api/resort/availability?check_in=2026-10-08&check_out=2026-10-10", nil), 200).data()
	cab := avail["types"].([]any)[0].(map[string]any)
	quote := cab["quote"].(map[string]any)
	// Thursday 1.0m + Friday 1.5m.
	if avail["nights"] != float64(2) || cab["available"] != float64(2) || quote["room_subtotal"] != float64(2_500_000) {
		t.Fatalf("availability: %v", avail)
	}

	created := f.call("POST", "/api/resort/reservations", map[string]any{
		"guest_name": "Budi Santoso", "guest_phone": "081234567", "check_in": "2026-10-08", "check_out": "2026-10-10",
		"discount_amount": 100_000, "rooms": []any{map[string]any{"room_type_id": typeID, "qty": 2, "extra_bed": 1, "room_id": roomIDs[0]}},
	})
	f.ok(created, 201)
	data := created.data()
	id := data["id"].(string)
	code := data["reservation_code"].(string)
	// 2 rooms × 2.5m + 2 extra beds × 200k × 2 nights − 100k.
	if data["nights"] != float64(2) || data["total"] != float64(5_700_000) ||
		created.Body["message"] != code+" — Budi Santoso, 2 kamar × 2 malam, total Rp5.700.000" {
		t.Fatalf("create: %s", created.Raw)
	}
	if got := f.scalar(`SELECT string_agg(charge_type || ':' || direction || ':' || amount::int || ':' || description || ':' || created_by_name, '|' ORDER BY created_at, charge_type DESC)
		FROM resort.folio_charges WHERE reservation_id = $1`, id); got != "kamar:debit:5000000:Kamar 2 unit × 2 malam:Sari|extra-bed:debit:800000:Extra bed × 2 malam:Sari|diskon:kredit:100000:Diskon reservasi:Sari" {
		t.Fatalf("folio: %s", got)
	}
	if got := f.scalar(`SELECT string_agg(COALESCE(room_name, '-') || ':' || nightly_rate::int || ':' || subtotal::int || ':' || guest_name || ':' || (rate_breakdown->1->>'rate'), '|' ORDER BY room_name)
		FROM resort.reservation_rooms WHERE reservation_id = $1`, id); got != "Kamar C1:1250000:2900000:Budi Santoso:1500000|-:1250000:2900000:Budi Santoso:1500000" {
		t.Fatalf("room lines: %s", got)
	}

	f.fail(f.call("POST", "/api/resort/reservations", map[string]any{
		"guest_name": "Ani", "guest_phone": "0812345", "check_in": "2026-10-09", "check_out": "2026-10-11",
		"rooms": []any{map[string]any{"room_type_id": typeID}},
	}), 409, "Cabin CAB: sisa 0 kamar untuk tanggal tersebut, diminta 1")

	detail := f.ok(f.call("GET", "/api/resort/reservations/"+id, nil), 200)
	if !strings.HasPrefix(detail.Raw, `{"success":true,"data":{"id":"`+id+`","company_id":"`+f.company+`","branch_id":"`+f.branch+`","reservation_code":"`+code+`","access_token":"`) ||
		!strings.Contains(detail.Raw, `"check_in":"2026-10-08","check_out":"2026-10-10","nights":2,"adults":2,"children":0,"status":"menunggu-bayar","source":"walk-in","room_total":5000000,"extra_total":800000,"discount_amount":100000,"total":5700000,`) ||
		!strings.HasSuffix(detail.Raw, `"totals":{"charges":5800000,"payments":100000,"balance":5700000}}}`) {
		t.Fatalf("detail: %s", detail.Raw)
	}
	rooms := detail.data()["rooms"].([]any)
	if first := rooms[0].(map[string]any); len(rooms) != 2 || first["nightly_rate"] != float64(1_250_000) || len(first["rate_breakdown"].([]any)) != 2 {
		t.Fatalf("detail rooms: %v", rooms)
	}
	f.fail(f.call("GET", "/api/resort/reservations/"+newUUID(t), nil), 404, "Reservasi tidak ditemukan")

	list := f.ok(f.call("GET", "/api/resort/reservations?status=all&from=2026-10-09&to=2026-10-09&search="+code, nil), 200).list()
	if row := list[0].(map[string]any); len(list) != 1 || row["balance"] != float64(5_700_000) || row["room_count"] != float64(2) || row["room_types"] != "Cabin CAB" {
		t.Fatalf("list: %v", list)
	}
	if empty := f.ok(f.call("GET", "/api/resort/reservations?status=check-in", nil), 200); empty.Raw != `{"success":true,"data":[]}` {
		t.Fatalf("filtered list: %s", empty.Raw)
	}

	if r := f.ok(f.call("PATCH", "/api/resort/reservations/"+id, map[string]any{}), 200); r.Raw != `{"success":true,"data":{"id":"`+id+`"}}` {
		t.Fatalf("empty patch: %s", r.Raw)
	}
	patched := f.ok(f.call("PATCH", "/api/resort/reservations/"+id, map[string]any{"notes": "Datang malam", "guest_email": nil}), 200)
	if patched.Raw != `{"success":true,"data":{"id":"`+id+`","reservation_code":"`+code+`"},"message":"Reservasi diperbarui"}` {
		t.Fatalf("patch: %s", patched.Raw)
	}
	bad := f.call("PATCH", "/api/resort/reservations/"+id, map[string]any{"guest_email": "bukan-email"})
	if bad.Status != 400 || !strings.Contains(bad.Raw, "Invalid email address") {
		t.Fatalf("email: %s", bad.Raw)
	}
	f.fail(f.call("PATCH", "/api/resort/reservations/"+newUUID(t), map[string]any{"notes": "x"}), 404, "Reservasi tidak ditemukan")

	// Front desk: confirm, pay part, check in (the second line needs a room).
	confirm := f.ok(f.call("POST", "/api/resort/reservations/"+id+"/status", map[string]any{"action": "konfirmasi"}), 200)
	if confirm.Raw != `{"success":true,"data":{"id":"`+id+`","status":"terkonfirmasi","code":"`+code+`","guest":"Budi Santoso"},"message":"`+code+` — Budi Santoso: Terkonfirmasi"}` {
		t.Fatalf("confirm: %s", confirm.Raw)
	}
	if f.scalar(`SELECT (paid_at IS NOT NULL)::text FROM resort.reservations WHERE id = $1`, id) != "true" {
		t.Fatal("paid_at not stamped")
	}
	paid := f.ok(f.call("POST", "/api/resort/reservations/"+id+"/charges", map[string]any{"charge_type": "pembayaran", "description": "DP transfer", "amount": 5_000_000, "payment_method": "transfer"}), 201)
	if paid.Body["message"] != "Pembayaran Rp5.000.000 dicatat — sisa Rp700.000" ||
		!strings.Contains(paid.Raw, `"totals":{"charges":5800000,"payments":5100000,"balance":700000}`) ||
		paid.data()["charge"].(map[string]any)["direction"] != "kredit" {
		t.Fatalf("payment: %s", paid.Raw)
	}
	fee := f.ok(f.call("POST", "/api/resort/reservations/"+id+"/charges", map[string]any{"charge_type": "fnb", "description": "Makan malam", "amount": 300_000}), 201)
	if fee.Body["message"] != "Biaya Makan malam ditambahkan — saldo Rp1.000.000" {
		t.Fatalf("fee: %s", fee.Raw)
	}

	f.fail(f.call("POST", "/api/resort/reservations/"+id+"/status", map[string]any{"action": "check-in"}), 400,
		"Tetapkan unit kamar untuk semua baris reservasi sebelum check-in")
	lineID := f.scalar(`SELECT id::text FROM resort.reservation_rooms WHERE reservation_id = $1 AND room_id IS NULL`, id)
	f.ok(f.call("POST", "/api/resort/reservations/"+id+"/status", map[string]any{"action": "check-in",
		"assignments": []any{map[string]any{"reservation_room_id": lineID, "room_id": roomIDs[1]}}}), 200)

	board := f.ok(f.call("GET", "/api/resort/front-office?date=2026-10-10", nil), 200).data()
	summary := board["summary"].(map[string]any)
	if board["date"] != "2026-10-10" || len(board["departures"].([]any)) != 1 || summary["occupied"] != float64(2) || summary["occupancy_pct"] != float64(100) {
		t.Fatalf("board: %v", board)
	}
	if today := f.ok(f.call("GET", "/api/resort/front-office?date=kemarin", nil), 200).data(); today["date"] != "2026-10-05" {
		t.Fatalf("board date fallback: %v", today["date"])
	}
	inHouse := board["in_house"].([]any)[0].(map[string]any)
	if label := inHouse["rooms_label"]; (label != "Kamar C1, Kamar C2" && label != "Kamar C2, Kamar C1") || inHouse["balance"] != float64(1_000_000) {
		t.Fatalf("in house: %v", inHouse)
	}

	// Check-out with an open folio: refused, then forced with a note.
	f.fail(f.call("POST", "/api/resort/reservations/"+id+"/status", map[string]any{"action": "check-out"}), 409,
		"Folio masih bersaldo Rp1.000.000 — lunasi dulu atau centang lanjutkan dengan catatan")
	f.ok(f.call("POST", "/api/resort/reservations/"+id+"/status", map[string]any{"action": "check-out", "force": true, "reason": "Ditagih ke kantor"}), 200)
	if got := f.scalar(`SELECT notes || '|' || status || '|' || (checked_out_at IS NOT NULL)::text FROM resort.reservations WHERE id = $1`, id); got != "Datang malam\nCheck-out dengan saldo terbuka (Sari): Ditagih ke kantor|check-out|true" {
		t.Fatalf("forced check-out: %q", got)
	}
	if got := f.scalar(`SELECT string_agg(status, ',') FROM resort.rooms WHERE branch_id = $1`, f.branch); got != "kotor,kotor" {
		t.Fatalf("rooms after check-out: %s", got)
	}

	// A room type used by a reservation is only deactivated.
	if r := f.ok(f.call("DELETE", "/api/resort/room-types/"+typeID, nil), 200); r.Body["message"] != "Tipe kamar Cabin CAB dinonaktifkan (sudah dipakai reservasi, riwayat dipertahankan)" {
		t.Fatalf("deactivate type: %s", r.Raw)
	}
	if r := f.ok(f.call("DELETE", "/api/resort/rooms/"+roomIDs[0], nil), 200); r.Body["message"] != "Kamar Kamar C1 dinonaktifkan (punya riwayat menginap)" {
		t.Fatalf("deactivate room: %s", r.Raw)
	}
}

// Ported from reservations/[id]/status/route.test.ts.
func TestStatusRoute(t *testing.T) {
	f := newFixture(t)
	typeID, _ := f.cabin("GLM", "G1")
	id := f.reserve(typeID, 1, nil)["id"].(string)
	status := func(body map[string]any) response {
		return f.call("POST", "/api/resort/reservations/"+id+"/status", body)
	}

	bad := status(map[string]any{"action": "hapus"})
	if bad.Status != 400 || bad.Body["error"] != "Validation failed" {
		t.Fatalf("unknown action: %s", bad.Raw)
	}
	f.fail(f.call("POST", "/api/resort/reservations/"+newUUID(t)+"/status", map[string]any{"action": "konfirmasi"}), 404, "Reservasi tidak ditemukan")
	f.fail(status(map[string]any{"action": "check-out"}), 409, `Tidak bisa mengubah status dari "Menunggu bayar" ke "Selesai"`)

	f.ok(status(map[string]any{"action": "batal", "reason": "Pindah tanggal"}), 200)
	if got := f.scalar(`SELECT status || '|' || cancel_reason || '|' || (cancelled_at IS NOT NULL)::text FROM resort.reservations WHERE id = $1`, id); got != "dibatalkan|Pindah tanggal|true" {
		t.Fatalf("cancel: %s", got)
	}
	f.fail(f.call("POST", "/api/resort/reservations/"+id+"/charges", map[string]any{"charge_type": "fnb", "description": "Kopi", "amount": 20000}), 409, "Reservasi sudah dibatalkan")

	// The cancelled stay released its room.
	other := f.reserve(typeID, 1, nil)["id"].(string)
	f.ok(f.call("POST", "/api/resort/reservations/"+other+"/status", map[string]any{"action": "konfirmasi"}), 200)
	// A room held by another checked-in guest cannot be assigned.
	room := f.scalar(`SELECT id::text FROM resort.rooms WHERE branch_id = $1`, f.branch)
	line := f.scalar(`SELECT id::text FROM resort.reservation_rooms WHERE reservation_id = $1`, other)
	f.ok(f.call("POST", "/api/resort/reservations/"+other+"/status", map[string]any{"action": "check-in",
		"assignments": []any{map[string]any{"reservation_room_id": line, "room_id": room}}}), 200)
	third := f.reserve(typeID, 1, map[string]any{"check_in": "2026-10-20", "check_out": "2026-10-21", "status": "terkonfirmasi"})["id"].(string)
	thirdLine := f.scalar(`SELECT id::text FROM resort.reservation_rooms WHERE reservation_id = $1`, third)
	f.fail(f.call("POST", "/api/resort/reservations/"+third+"/status", map[string]any{"action": "check-in",
		"assignments": []any{map[string]any{"reservation_room_id": thirdLine, "room_id": room}}}), 409, "Kamar Kamar G1 sedang ditempati tamu lain")
	f.fail(f.call("POST", "/api/resort/reservations/"+third+"/status", map[string]any{"action": "check-in",
		"assignments": []any{map[string]any{"reservation_room_id": thirdLine, "room_id": newUUID(t)}}}), 400, "Kamar tujuan tidak tersedia")
}

func TestVenueNotConfigured(t *testing.T) {
	f := newFixture(t)
	f.mux = testutil.Mux(mod{h: &handler{svc: f.svc, guard: headerGuard{}, venues: fixedVenue{f.company, ""}, now: time.Now}})
	f.fail(f.call("GET", "/api/resort/rooms", nil), 409, "Venue resort belum dikonfigurasi")
}

func TestMalformedBodyIs500(t *testing.T) {
	f := newFixture(t)
	f.fail(f.call("POST", "/api/resort/room-types", "{"), 500, "Terjadi kesalahan server")
}

// The real guard: read routes need the resort menu, writes its action.
func TestAuthWiring(t *testing.T) {
	deps := testutil.Deps(t, nil)
	company, branch := newUUID(t), newUUID(t)
	mux := testutil.Mux(New(deps, fixedVenue{company, branch}))
	reader := testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{"resort.rooms": {"read"}}})
	stranger := testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{"crm": {"read"}}})

	expect := func(r *http.Request, status int, msg string) {
		t.Helper()
		rec, body := testutil.Do(t, mux, r)
		if rec.Code != status || (msg != "" && body["error"] != msg) {
			t.Fatalf("%s %s: %d %s", r.Method, r.URL, rec.Code, rec.Body.String())
		}
	}
	expect(testutil.Request("GET", "/api/resort/rooms", nil), 401, "Authentication required")
	expect(testutil.AsStaff(testutil.Request("GET", "/api/resort/rooms", nil), stranger), 403, "Insufficient permissions")
	expect(testutil.AsStaff(testutil.Request("GET", "/api/resort/rooms", nil), reader), 200, "")
	expect(testutil.AsStaff(testutil.Request("POST", "/api/resort/rooms", map[string]any{}), reader), 403, "Insufficient permissions")
}
