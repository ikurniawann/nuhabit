package engagement

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/contracts/storedvalue"
	"nuhabit/backend/internal/modules/crm/engagement/domain"
	"nuhabit/backend/internal/modules/crm/internal/crmtest"
	"nuhabit/backend/internal/platform/outbox"
	"nuhabit/backend/internal/platform/safehttp"
	"nuhabit/backend/internal/platform/testutil"
)

// recordingPush is a synchronous Pusher for tests.
type recordingPush struct {
	mu            sync.Mutex
	members       []string
	announcements []string
	types         []string
}

func (p *recordingPush) SendMember(customerID string, msg domain.PushMessage) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.members = append(p.members, customerID)
	p.types = append(p.types, msg.Type)
}

func (p *recordingPush) SendAnnouncement(id string, _ domain.PushMessage) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.announcements = append(p.announcements, id)
}

type env struct {
	t     *testing.T
	tx    pgx.Tx
	mux   *http.ServeMux
	push  *recordingPush
	staff testutil.Staff
}

func setup(t *testing.T) env {
	t.Helper()
	tx := testutil.Tx(t)
	d := testutil.Deps(t, nil)
	push := &recordingPush{}
	h := newHandler(tx, d, Ports{Orders: OrdersSQL{}, Push: push})
	return env{t: t, tx: tx, mux: crmtest.Mux(h.routes()), push: push,
		staff: crmtest.Staff(t, "crm.engagement", "crm.members.member-reviews")}
}

func (e env) call(method, path string, body any) (int, map[string]any) {
	e.t.Helper()
	return crmtest.Call(e.t, e.mux, method, path, body, &e.staff)
}

func (e env) customer(name string) string {
	e.t.Helper()
	return crmtest.Scalar[string](e.t, e.tx, `INSERT INTO pos.pos_customers (phone, name) VALUES ($1, $2) RETURNING id::text`,
		"+6297"+testutil.RandomHex(4), name)
}

func (e env) paidOrder(customerID string, total float64, at time.Time) string {
	e.t.Helper()
	return crmtest.Scalar[string](e.t, e.tx, `INSERT INTO pos.pos_orders (order_number, cashier_id, customer_id, status, payment_status, subtotal, total_amount, created_at)
		VALUES ($1, $2, $3, 'completed', 'paid', $4, $4, $5) RETURNING id::text`,
		"GT"+testutil.RandomHex(6), e.staff.UserID, customerID, total, at)
}

func data(t *testing.T, body map[string]any) map[string]any {
	t.Helper()
	d, ok := body["data"].(map[string]any)
	if !ok {
		t.Fatalf("no data object: %v", body)
	}
	return d
}

func TestEngagementAuth(t *testing.T) {
	e := setup(t)
	other := crmtest.Staff(t, "crm.settings")
	for _, c := range []struct{ method, path string }{
		{"GET", "/api/crm/engagement/announcements"}, {"POST", "/api/crm/engagement/announcements"},
		{"GET", "/api/crm/engagement/challenges"}, {"POST", "/api/crm/engagement/challenges"},
		{"GET", "/api/crm/engagement/checkins"}, {"GET", "/api/crm/engagement/events"},
		{"POST", "/api/crm/engagement/events"}, {"DELETE", "/api/crm/engagement/events"},
		{"GET", "/api/crm/engagement/events/bookings"}, {"POST", "/api/crm/engagement/events/bookings"},
		{"GET", "/api/crm/member-reviews"}, {"PATCH", "/api/crm/member-reviews/x"},
	} {
		if code, body := crmtest.Call(t, e.mux, c.method, c.path, map[string]any{}, nil); code != 401 || body["error"] != "Authentication required" {
			t.Errorf("%s %s anon: %d %v", c.method, c.path, code, body)
		}
		if code, _ := crmtest.Call(t, e.mux, c.method, c.path, map[string]any{}, &other); code != 403 {
			t.Errorf("%s %s without menu: %d", c.method, c.path, code)
		}
	}
}

func TestChallenges(t *testing.T) {
	e := setup(t)
	valid := map[string]any{
		"title": " Go Challenge ", "metric": "visits", "target": 2, "starts_at": "2026-09-01T00:00:00+07:00",
		"ends_at": "2026-12-01T00:00:00Z", "reward_xp": 10, "reward_ark_idr": 0, "is_active": true,
	}
	bad := map[string]any{}
	for k, v := range valid {
		bad[k] = v
	}
	bad["ends_at"] = "2026-08-01T00:00:00Z"
	bad["id"] = "not-a-uuid"
	code, body := e.call("POST", "/api/crm/engagement/challenges", bad)
	if code != 400 || body["error"] != "Selesai harus setelah mulai" || len(body["details"].([]any)) != 2 {
		t.Fatalf("refine: %d %v", code, body)
	}
	code, body = e.call("POST", "/api/crm/engagement/challenges", map[string]any{"title": "Go"})
	if code != 400 || body["error"] != "Data tidak valid" {
		t.Fatalf("invalid: %d %v", code, body)
	}
	code, body = e.call("POST", "/api/crm/engagement/challenges", valid)
	id, _ := data(t, body)["id"].(string)
	if code != 200 || id == "" {
		t.Fatalf("create: %d %v", code, body)
	}
	valid["id"] = "00000000-0000-4000-8000-000000000000"
	if code, body = e.call("POST", "/api/crm/engagement/challenges", valid); code != 404 || body["error"] != "Challenge tidak ditemukan" {
		t.Fatalf("update unknown: %d %v", code, body)
	}

	ana, budi := e.customer("Ana"), e.customer("Budi")
	for _, c := range []string{ana, budi} {
		crmtest.MustExec(t, e.tx, `INSERT INTO crm.challenge_joins (challenge_id, customer_id) VALUES ($1, $2)`, id, c)
	}
	day := time.Date(2026, 10, 1, 3, 0, 0, 0, time.UTC)
	e.paidOrder(budi, 50000, day)
	e.paidOrder(budi, 10000, day.Add(time.Hour)) // same WIB day: still one visit
	e.paidOrder(budi, 10000, day.Add(48*time.Hour))

	code, body = e.call("GET", "/api/crm/engagement/challenges", nil)
	if code != 200 {
		t.Fatalf("list: %d %v", code, body)
	}
	var listed map[string]any
	for _, it := range body["data"].([]any) {
		if m := it.(map[string]any); m["id"] == id {
			listed = m
		}
	}
	if listed == nil || listed["target"] != float64(2) || listed["participant_count"] != float64(2) || listed["title"] != "Go Challenge" {
		t.Fatalf("listed: %v", listed)
	}
	if code, body = e.call("GET", "/api/crm/engagement/challenges?id=nope", nil); code != 404 {
		t.Fatalf("bad id: %d %v", code, body)
	}
	code, body = e.call("GET", "/api/crm/engagement/challenges?id="+id, nil)
	d := data(t, body)
	people := d["participants"].([]any)
	first := people[0].(map[string]any)
	if code != 200 || len(people) != 2 || first["customer_id"] != budi || first["value"] != float64(2) ||
		first["pct"] != float64(100) || first["completed"] != true || people[1].(map[string]any)["value"] != float64(0) {
		t.Fatalf("participants: %d %v", code, body)
	}
}

func TestEventsAndBookings(t *testing.T) {
	e := setup(t)
	start := time.Now().Add(72 * time.Hour).UTC()
	code, body := e.call("POST", "/api/crm/engagement/events", map[string]any{
		"title": "Go Event", "starts_at": start.Format(time.RFC3339), "ends_at": start.Add(2 * time.Hour).Format(time.RFC3339),
		"capacity": 1, "status": "published", "host_name": " Coach ",
	})
	eventID, _ := data(t, body)["id"].(string)
	if code != 200 || eventID == "" {
		t.Fatalf("create: %d %v", code, body)
	}
	if got := crmtest.Scalar[string](t, e.tx, `SELECT host_name || cancel_deadline_hours FROM crm.events WHERE id = $1`, eventID); got != "Coach2" {
		t.Fatalf("defaults and trim: %q", got)
	}
	code, body = e.call("GET", "/api/crm/engagement/events", nil)
	if code != 200 {
		t.Fatalf("list: %d %v", code, body)
	}
	for _, it := range body["data"].([]any) {
		if m := it.(map[string]any); m["id"] == eventID && (m["price_idr"] != float64(0) || m["confirmed_count"] != float64(0)) {
			t.Fatalf("event row: %v", m)
		}
	}

	ana, budi := e.customer("Ana"), e.customer("Budi")
	confirmed := crmtest.Scalar[string](t, e.tx, `INSERT INTO crm.event_bookings (event_id, customer_id, status) VALUES ($1, $2, 'confirmed') RETURNING id::text`, eventID, ana)
	crmtest.MustExec(t, e.tx, `INSERT INTO crm.event_bookings (event_id, customer_id, status, waitlist_position) VALUES ($1, $2, 'waitlist', 1)`, eventID, budi)

	if code, body = e.call("GET", "/api/crm/engagement/events/bookings?event_id=x", nil); code != 400 || body["error"] != "ID event tidak valid" {
		t.Fatalf("bookings bad id: %d %v", code, body)
	}
	code, body = e.call("GET", "/api/crm/engagement/events/bookings?event_id="+eventID, nil)
	if rows := body["data"].([]any); code != 200 || len(rows) != 2 || rows[0].(map[string]any)["status"] != "confirmed" {
		t.Fatalf("bookings: %d %v", code, body)
	}
	code, body = e.call("POST", "/api/crm/engagement/events/bookings", map[string]any{"booking_id": confirmed, "status": "cancelled"})
	if d := data(t, body); code != 200 || d["ok"] != true || d["lateCancel"] != false {
		t.Fatalf("cancel: %d %v", code, body)
	}
	if s := crmtest.Scalar[string](t, e.tx, `SELECT status FROM crm.event_bookings WHERE customer_id = $1`, budi); s != "confirmed" {
		t.Fatalf("waitlist not promoted: %s", s)
	}
	if n := crmtest.Scalar[int](t, e.tx, `SELECT count(*)::int FROM crm.member_notifications WHERE customer_id = $1 AND type = 'waitlist_promoted'`, budi); n != 1 || len(e.push.members) != 1 {
		t.Fatalf("promotion notice: %d rows, pushes %v", n, e.push.members)
	}
	code, body = e.call("POST", "/api/crm/engagement/events/bookings", map[string]any{"booking_id": confirmed, "status": "attended"})
	if code != 409 || body["error"] != "Status booking ini tidak bisa diubah lagi" {
		t.Fatalf("closed booking: %d %v", code, body)
	}
	code, body = e.call("POST", "/api/crm/engagement/events/bookings", map[string]any{"booking_id": "00000000-0000-4000-8000-000000000000", "status": "attended"})
	if code != 409 || body["error"] != "Booking tidak ditemukan" {
		t.Fatalf("missing booking: %d %v", code, body)
	}

	if code, body = e.call("DELETE", "/api/crm/engagement/events?id=x", nil); code != 400 || body["error"] != "ID tidak valid" {
		t.Fatalf("delete bad id: %d %v", code, body)
	}
	code, body = e.call("DELETE", "/api/crm/engagement/events?id="+eventID, nil)
	if code != 200 || data(t, body)["notified"] != float64(1) {
		t.Fatalf("cancel event: %d %v", code, body)
	}
	if e.push.types[len(e.push.types)-1] != "event_cancelled" {
		t.Fatalf("pushes %v", e.push.types)
	}
	code, body = e.call("POST", "/api/crm/engagement/events", map[string]any{
		"id": eventID, "title": "Go Event", "starts_at": start.Format(time.RFC3339), "ends_at": start.Add(time.Hour).Format(time.RFC3339),
		"capacity": 1, "status": "draft",
	})
	if code != 404 || body["error"] != "Event tidak ditemukan atau sudah dibatalkan" {
		t.Fatalf("edit cancelled: %d %v", code, body)
	}
}

func TestAnnouncementsAndCheckins(t *testing.T) {
	e := setup(t)
	member := e.customer("Penerima")
	crmtest.MustExec(t, e.tx, `UPDATE pos.pos_customers SET visit_count = 10000 WHERE id = $1`, member)
	payload := map[string]any{"title": " Halo ", "body": "Isi pengumuman", "kind": "promo",
		"audience": map[string]any{"min_visits": 10000}, "link_url": "nowhere"}
	code, body := e.call("POST", "/api/crm/engagement/announcements", payload)
	if code != 400 || body["error"] != "Tujuan portal tidak dikenal" {
		t.Fatalf("link refine: %d %v", code, body)
	}
	payload["link_url"] = "promo:KOPI10"
	payload["image_url"] = "/api/files/x.png"
	payload["preview"] = true
	code, body = e.call("POST", "/api/crm/engagement/announcements", payload)
	recipients, _ := data(t, body)["recipients"].(float64)
	if code != 200 || recipients < 1 {
		t.Fatalf("preview: %d %v", code, body)
	}
	delete(payload, "preview")
	code, body = e.call("POST", "/api/crm/engagement/announcements", payload)
	d := data(t, body)
	if code != 200 || d["recipients"] != recipients || len(e.push.announcements) != 1 || e.push.announcements[0] != d["id"] {
		t.Fatalf("send: %d %v %v", code, body, e.push.announcements)
	}
	if got := crmtest.Scalar[string](t, e.tx, `SELECT n.title || '|' || n.link_url || '|' || a.audience::text FROM crm.member_notifications n
		JOIN crm.member_announcements a ON a.id = n.announcement_id WHERE n.customer_id = $1`, member); got != `Halo|promo:KOPI10|{"min_visits": 10000}` {
		t.Fatalf("inbox row: %q", got)
	}
	code, body = e.call("GET", "/api/crm/engagement/announcements", nil)
	first := body["data"].([]any)[0].(map[string]any)
	if code != 200 || first["id"] != d["id"] || first["read_count"] != float64(0) || first["audience"].(map[string]any)["min_visits"] != float64(10000) {
		t.Fatalf("history: %d %v", code, first)
	}

	crmtest.MustExec(t, e.tx, `INSERT INTO crm.member_checkins (customer_id, decision, scanned_by) VALUES ($1, 'accepted', $2)`, member, e.staff.UserID)
	code, body = e.call("GET", "/api/crm/engagement/checkins", nil)
	d = data(t, body)
	last := d["checkins"].([]any)[0].(map[string]any)
	if code != 200 || last["member_name"] != "Penerima" || last["cashier_name"] != e.staff.FullName || d["today"].(map[string]any)["accepted"].(float64) < 1 {
		t.Fatalf("checkins: %d %v", code, body)
	}
}

func TestMemberReviews(t *testing.T) {
	e := setup(t)
	name := "Reviewer" + testutil.RandomHex(4)
	member := e.customer(name)
	order := e.paidOrder(member, 75000, time.Now())
	reviewID := crmtest.Scalar[string](t, e.tx, `INSERT INTO crm.member_reviews (order_id, customer_id, rating, comment) VALUES ($1, $2, 4, 'Enak') RETURNING id::text`, order, member)

	code, body := e.call("GET", "/api/crm/member-reviews?q="+name+"&rating=4&branch_id=zzz", nil)
	d := data(t, body)
	reviews := d["reviews"].([]any)
	if code != 200 || len(reviews) != 1 {
		t.Fatalf("list: %d %v", code, body)
	}
	row := reviews[0].(map[string]any)
	if row["order_total"] != float64(75000) || row["order_number"] == nil || row["rating"] != float64(4) || row["outlet_name"] != nil {
		t.Fatalf("row: %v", row)
	}
	summary := d["summary"].(map[string]any)
	if summary["count"] != float64(1) || summary["average"] != float64(4) || summary["outlets"].([]any)[0].(map[string]any)["name"] != "Tanpa outlet" {
		t.Fatalf("summary: %v", summary)
	}

	path := "/api/crm/member-reviews/" + reviewID
	code, body = e.call("PATCH", path, map[string]any{"reply": "a"})
	issues := body["details"].([]any)
	if code != 400 || body["error"] != "Data tidak valid" || issues[0].(map[string]any)["message"] != "Balasan minimal 2 karakter" {
		t.Fatalf("short reply: %d %v", code, body)
	}
	code, body = e.call("PATCH", path, map[string]any{"status": "gone"})
	if code != 400 || body["details"].([]any)[0].(map[string]any)["code"] != "invalid_union" {
		t.Fatalf("union: %d %v", code, body)
	}
	code, body = e.call("PATCH", path, map[string]any{"reply": "  Terima kasih  "})
	if d := data(t, body); code != 200 || d["id"] != reviewID || d["status"] != "replied" || len(e.push.members) != 1 {
		t.Fatalf("reply: %d %v", code, body)
	}
	if got := crmtest.Scalar[string](t, e.tx, `SELECT reply FROM crm.member_reviews WHERE id = $1`, reviewID); got != "Terima kasih" {
		t.Fatalf("reply text %q", got)
	}
	if code, body = e.call("PATCH", path, map[string]any{"status": "hidden"}); code != 200 || data(t, body)["status"] != "hidden" {
		t.Fatalf("hide: %d %v", code, body)
	}
	if code, body = e.call("PATCH", path, map[string]any{"status": "visible"}); code != 200 || data(t, body)["status"] != "replied" {
		t.Fatalf("show: %d %v", code, body)
	}
	if code, body = e.call("PATCH", "/api/crm/member-reviews/00000000-0000-4000-8000-000000000000", map[string]any{"status": "hidden"}); code != 404 || body["error"] != "Ulasan tidak ditemukan" {
		t.Fatalf("missing: %d %v", code, body)
	}
	if code, body = e.call("PATCH", "/api/crm/member-reviews/bad", map[string]any{"status": "hidden"}); code != 400 || body["error"] != "Format data tidak valid" {
		t.Fatalf("bad id: %d %v", code, body)
	}
	// Last: the failed read aborts the test transaction.
	if code, body = e.call("GET", "/api/crm/member-reviews?branch_id=------------------------------------", nil); code != 400 || body["error"] != "Format data tidak valid" {
		t.Fatalf("loose uuid reaches pg: %d %v", code, body)
	}
}

// Each bus is one API replica. A redelivery after a lost commit lands on the
// other replica, which must not push the member a second time.
func TestWalletPushDedupedAcrossReplicas(t *testing.T) {
	tx := testutil.Tx(t)
	ctx := context.Background()
	d := testutil.Deps(t, nil)
	push := &recordingPush{}
	replicas := []*outbox.Bus{outbox.NewBus(nil, d.Log), outbox.NewBus(nil, d.Log)}
	for _, bus := range replicas {
		Subscribe(bus, d, Ports{Push: push})
	}
	if err := replicas[0].Register(ctx, tx); err != nil {
		t.Fatal(err)
	}
	member := crmtest.Scalar[string](t, tx, `INSERT INTO pos.pos_customers (phone, name) VALUES ($1, 'Wallet') RETURNING id::text`, "+6296"+testutil.RandomHex(4))
	// The subscribers claim on the pool, outside this transaction.
	t.Cleanup(func() {
		_, _ = testutil.DB(t).Exec(context.Background(), `DELETE FROM crm.member_push_claims WHERE recipient = $1`, member)
	})
	if err := outbox.Publish(ctx, tx, storedvalue.TopicMemberNotified, member, storedvalue.MemberNotified{
		CustomerID: member, Type: "wallet_low_balance", Title: "Saldo menipis", Body: "Isi ulang",
	}); err != nil {
		t.Fatal(err)
	}
	for _, bus := range replicas {
		crmtest.MustExec(t, tx, `UPDATE platform.outbox_deliveries d SET delivered_at = NULL FROM platform.outbox_events e
			WHERE e.id = d.event_id AND e.key = $1 AND d.subscriber = $2`, member, subscriberWalletNotice)
		if n, err := bus.Dispatch(ctx, tx); err != nil || n != 1 {
			t.Fatalf("dispatch: %d %v", n, err)
		}
	}
	if len(push.members) != 1 {
		t.Fatalf("pushes = %v, want one", push.members)
	}
}

func TestWalletNotificationSubscriber(t *testing.T) {
	tx := testutil.Tx(t)
	ctx := context.Background()
	d := testutil.Deps(t, nil)
	bus := outbox.NewBus(nil, d.Log)
	push := &recordingPush{}
	Subscribe(bus, d, Ports{Push: push})
	if err := bus.Register(ctx, tx); err != nil {
		t.Fatal(err)
	}
	member := crmtest.Scalar[string](t, tx, `INSERT INTO pos.pos_customers (phone, name) VALUES ($1, 'Wallet') RETURNING id::text`, "+6296"+testutil.RandomHex(4))
	t.Cleanup(func() {
		_, _ = testutil.DB(t).Exec(context.Background(), `DELETE FROM crm.member_push_claims WHERE recipient = $1`, member)
	})
	if err := outbox.Publish(ctx, tx, storedvalue.TopicMemberNotified, member, storedvalue.MemberNotified{
		CustomerID: member, Type: "wallet_low_balance", Title: "Saldo menipis", Body: "Isi ulang",
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := bus.Dispatch(ctx, tx); err != nil {
		t.Fatal(err)
	}
	if got := crmtest.Scalar[string](t, tx, `SELECT type || '|' || title || '|' || body FROM crm.member_notifications WHERE customer_id = $1`, member); got != "wallet_low_balance|Saldo menipis|Isi ulang" {
		t.Fatalf("inbox row %q", got)
	}
	if len(push.members) != 1 || push.members[0] != member {
		t.Fatalf("push %v", push.members)
	}

	// A redelivery of the same event (keyed on its id) does not push again.
	w := walletSubscriber{h: newHandler(tx, d, Ports{Push: push})}
	ev := outbox.Event{ID: 42, Payload: []byte(`{"customer_id":"` + member + `","type":"t","title":"x","body":"y"}`)}
	for range 2 {
		if err := w.handle(ctx, tx, ev); err != nil {
			t.Fatal(err)
		}
	}
	if len(push.members) != 2 {
		t.Fatalf("redelivery pushed again: %v", push.members)
	}
}

// Push endpoints come from members' browsers: the sender must not reach
// the server's own network.
func TestWebPushRefusesInternalEndpoints(t *testing.T) {
	hit := false
	srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { hit = true }))
	defer srv.Close()
	resp, err := NewWebPush(nil, nil, nil).Client.Post(srv.URL, "application/octet-stream", nil)
	if err == nil {
		resp.Body.Close()
	}
	if !errors.Is(err, safehttp.ErrBlocked) || hit {
		t.Fatalf("loopback endpoint: err=%v hit=%v", err, hit)
	}
}
