package gymscheduling

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"nuhabit/backend/internal/modules/gymscheduling/domain"
	"nuhabit/backend/internal/platform/testutil"
)

// Waiver enforcement, open gym, gate devices, staff corrections and the
// waitlist re-queue, against the database.

// qrToken issues a fresh member QR token.
func (f *fixture) qrToken(customerID string) string {
	f.t.Helper()
	tok := "nhqr_" + testutil.RandomHex(8)
	f.exec(`INSERT INTO crm.member_qr_tokens (token, customer_id, expires_at) VALUES ($1, $2, now() + interval '5 minutes')`, tok, customerID)
	return tok
}

func (f *fixture) bookingAction(bookingID string, body map[string]any) response {
	f.t.Helper()
	return f.asStaff("POST", "/api/gym/bookings/"+bookingID, body)
}

func TestWaiverRequiredForBookingAndGate(t *testing.T) {
	f := newFixture(t)
	typeID, _ := f.classType(1)
	sessionID := f.session(typeID, time.Now().Add(20*time.Minute), 5)
	m := f.member(3)
	f.exec(`UPDATE pos.pos_customers SET waiver_version = NULL, waiver_accepted_at = NULL WHERE id = $1`, m)
	label := domain.BookingDenialLabel[domain.DenyWaiverRequired]

	// The member app gets the code that links to the waiver screen.
	res := f.book(m, sessionID)
	if res.Status != 409 || res.Body["error"] != label || res.Body["code"] != "BOOKING_WAIVER_REQUIRED" {
		t.Fatalf("member booking: %d %s", res.Status, res.Raw)
	}
	expectError(t, f.asStaff("POST", "/api/gym/bookings", map[string]any{"session_id": sessionID, "customer_id": m}), 409, label)

	// An outdated version counts as missing.
	f.exec(`UPDATE pos.pos_customers SET waiver_version = '0.9', waiver_accepted_at = now() WHERE id = $1`, m)
	if res := f.book(m, sessionID); res.Status != 409 {
		t.Fatalf("outdated waiver: %s", res.Raw)
	}

	// The gate checks the waiver before looking for a booking.
	d := f.asStaff("POST", "/api/gym/checkin", map[string]any{"token": f.qrToken(m)}).data()
	if d["decision"] != "denied" || d["reason"] != "waiver_required" || d["message"] != domain.GateDenialLabel[domain.GateWaiverRequired] {
		t.Fatalf("gate: %v", d)
	}
	if got := f.scalar(`SELECT reason FROM gym.access_logs WHERE customer_id = $1 ORDER BY created_at DESC LIMIT 1`, m); got != "waiver_required" {
		t.Fatalf("access log reason = %s", got)
	}

	// The desk search shows the waiver, and staff record the acceptance.
	phone := f.scalar(`SELECT phone FROM pos.pos_customers WHERE id = $1`, m)
	hits := f.asStaff("GET", "/api/gym/checkin/members?q="+strings.TrimPrefix(phone, "+"), nil).list()
	if len(hits) != 1 || hits[0].(map[string]any)["waiver_current"] != false || hits[0].(map[string]any)["waiver_version"] != "0.9" {
		t.Fatalf("desk search: %v", hits)
	}
	expectError(t, f.asStaff("POST", "/api/gym/checkin/members/"+m+"/waiver", map[string]any{"accepted": false}), 400,
		"Centang persetujuan waiver dulu")
	res = f.asStaff("POST", "/api/gym/checkin/members/"+m+"/waiver", map[string]any{"accepted": true})
	if res.Status != 200 || res.data()["version"] != testWaiverVersion || res.data()["accepted_by"] != f.staff {
		t.Fatalf("record waiver: %s", res.Raw)
	}
	if got := f.scalar(`SELECT waiver_version || ':' || (waiver_accepted_by = $2)::text FROM pos.pos_customers WHERE id = $1`, m, f.staff); got != "1.0:true" {
		t.Fatalf("stored waiver = %s", got)
	}
	if got := f.scalar(`SELECT count(*)::text FROM audit.audit_log WHERE entity_id = $1 AND action = 'gym.waiver.record_at_desk'`, m); got != "1" {
		t.Fatalf("audit rows = %s", got)
	}
	if res := f.book(m, sessionID); res.Status != 200 || res.data()["status"] != "confirmed" {
		t.Fatalf("booking after the waiver: %s", res.Raw)
	}

	// With the rule off, no waiver is needed.
	other := f.member(3)
	f.exec(`UPDATE pos.pos_customers SET waiver_version = NULL, waiver_accepted_at = NULL WHERE id = $1`, other)
	f.setRules(map[string]any{"requireWaiver": false})
	if res := f.book(other, sessionID); res.Status != 200 {
		t.Fatalf("rule off: %s", res.Raw)
	}
}

func TestOpenGymChargesOncePerDay(t *testing.T) {
	f := newFixture(t)
	branch := testutil.CreateOrg(t, f.tx).BranchID
	f.setRules(map[string]any{"openGymEnabled": true, "openGymCreditCost": 2, "reEntryGraceMin": 0, "antiPassbackMin": 0})
	scan := func(customerID string) map[string]any {
		t.Helper()
		return f.asStaff("POST", "/api/gym/checkin", map[string]any{"token": f.qrToken(customerID), "branch_id": branch}).data()
	}
	m := f.member(5)

	// No hours set: open all day. The first visit of the day pays.
	d := scan(m)
	if d["decision"] != "allowed" || d["entryKind"] != "open_gym" || d["creditsDeducted"] != float64(2) ||
		d["message"] != "Open gym · 2 kredit dipotong · sisa 3 kredit" || d["booking"] != nil {
		t.Fatalf("first visit: %v", d)
	}
	// Coming back the same day is free.
	if d := scan(m); d["decision"] != "allowed" || d["entryKind"] != "open_gym" || d["creditsDeducted"] != float64(0) {
		t.Fatalf("second visit: %v", d)
	}
	if f.balance(m) != 3 {
		t.Fatalf("balance = %d", f.balance(m))
	}
	if got := f.scalar(`SELECT count(*)::text || ':' || sum(-credit_delta)::text FROM gym.access_logs
		WHERE customer_id = $1 AND entry_kind = 'open_gym' AND branch_id = $2`, m, branch); got != "2:2" {
		t.Fatalf("open gym log = %s", got)
	}
	if got := f.scalar(`SELECT count(*)::text FROM gym.credit_ledger WHERE customer_id = $1 AND source_type = 'open_gym'`, m); got != "1" {
		t.Fatalf("open gym charges = %s", got)
	}

	// Anti-passback still applies.
	f.setRules(map[string]any{"antiPassbackMin": 60})
	if d := scan(m); d["reason"] != "anti_passback" {
		t.Fatalf("anti-passback: %v", d)
	}
	f.setRules(map[string]any{"antiPassbackMin": 0})

	// Hours on another weekday only: closed now.
	today := int(time.Now().In(domain.WIB).Weekday())
	if today == 0 {
		today = 7
	}
	hours := func(weekday int, opens, closes string) response {
		return f.asStaff("PUT", "/api/gym/open-gym-hours", map[string]any{
			"branch_id": branch, "hours": []any{map[string]any{"weekday": weekday, "opens_at": opens, "closes_at": closes}},
		})
	}
	if res := hours(today%7+1, "06:00", "22:00"); res.Status != 200 {
		t.Fatalf("save hours: %s", res.Raw)
	}
	got := f.asStaff("GET", "/api/gym/open-gym-hours?branch_id="+branch, nil).data()["hours"].([]any)
	if len(got) != 1 || got[0].(map[string]any)["opens_at"] != "06:00" {
		t.Fatalf("hours: %v", got)
	}
	if d := scan(m); d["reason"] != "open_gym_closed" || d["message"] != "Di luar jam open gym" {
		t.Fatalf("closed: %v", d)
	}
	expectError(t, hours(1, "22:00", "06:00"), 400, "Data tidak valid: hours.0.closes_at")

	// Open all of today: a pass holder enters free, a short balance does not.
	if res := hours(today, "00:00", "23:59"); res.Status != 200 {
		t.Fatalf("save hours: %s", res.Raw)
	}
	holder := f.member(0)
	f.passFor(holder, 30)
	if d := scan(holder); d["decision"] != "allowed" || d["creditsDeducted"] != float64(0) || d["message"] != "Open gym · pass aktif, tanpa potong kredit" {
		t.Fatalf("pass holder: %v", d)
	}
	if d := scan(f.member(1)); d["reason"] != "insufficient_credits" {
		t.Fatalf("short balance: %v", d)
	}

	// With open gym off, entry needs a booking again.
	f.setRules(map[string]any{"openGymEnabled": false})
	if d := scan(m); d["reason"] != "no_booking" {
		t.Fatalf("open gym off: %v", d)
	}
}

func (f *fixture) device(path, key string, body any) response {
	f.t.Helper()
	raw, _ := json.Marshal(body)
	req := httptest.NewRequest("POST", path, strings.NewReader(string(raw)))
	if key != "" {
		req.Header.Set(DeviceKeyHeader, key)
	}
	rec := httptest.NewRecorder()
	f.mux.ServeHTTP(rec, req)
	out := response{Status: rec.Code, Raw: rec.Body.String()}
	_ = json.Unmarshal(rec.Body.Bytes(), &out.Body)
	if after := rec.Header().Get("Retry-After"); after != "" {
		out.Body["retry_after"] = after
	}
	return out
}

func TestGateDeviceKeyAndRateLimit(t *testing.T) {
	f := newFixture(t)
	branch := testutil.CreateOrg(t, f.tx).BranchID
	typeID, _ := f.classType(1)
	res := f.asStaff("POST", "/api/gym/sessions", map[string]any{
		"class_type_id": typeID, "branch_id": branch, "starts_at": time.Now().Add(20 * time.Minute).UTC().Format(time.RFC3339), "capacity": 5,
	})
	sessionID := res.data()["id"].(string)
	m := f.member(3)
	f.book(m, sessionID)

	expectError(t, f.asStaff("POST", "/api/gym/gate-devices", map[string]any{"branch_id": branch, "name": "T"}), 400, "Data tidak valid: name")
	created := f.asStaff("POST", "/api/gym/gate-devices", map[string]any{"branch_id": branch, "name": "Turnstile Utama", "relay_open_ms": 2500})
	key, _ := created.data()["key"].(string)
	deviceID, _ := created.data()["id"].(string)
	if created.Status != 200 || !strings.HasPrefix(key, "nhgd_") || created.data()["key_prefix"] != key[:11] {
		t.Fatalf("create device: status %d", created.Status)
	}
	if got := f.scalar(`SELECT key_hash FROM gym.gate_devices WHERE id = $1`, deviceID); got != hashDeviceKey(key) {
		t.Fatal("the stored hash does not match the key")
	}
	list := f.asStaff("GET", "/api/gym/gate-devices", nil)
	if strings.Contains(list.Raw, key) || strings.Contains(list.Raw, "key_hash") || len(list.list()) == 0 {
		t.Fatal("the device list must not expose the key or its hash")
	}

	scanPath, beatPath := "/api/gym/gate/devices/scan", "/api/gym/gate/devices/heartbeat"
	expectError(t, f.device(scanPath, "", map[string]any{"token": f.qrToken(m)}), 401, "Kunci perangkat gate tidak valid")
	expectError(t, f.device(scanPath, "nhgd_"+strings.Repeat("0", 48), map[string]any{"token": f.qrToken(m)}), 401, "Kunci perangkat gate tidak valid")

	d := f.device(scanPath, key, map[string]any{"token": f.qrToken(m)}).data()
	if d["allow"] != true || d["entryKind"] != "booking" || d["relayOpenMs"] != float64(2500) || d["display"] != "Silakan masuk, Go" {
		t.Fatalf("device scan: %v", d)
	}
	if got := f.scalar(`SELECT source || ':' || device_id || ':' || branch_id FROM gym.access_logs
		WHERE customer_id = $1 AND decision = 'allowed' ORDER BY created_at DESC LIMIT 1`, m); got != "device:"+deviceID+":"+branch {
		t.Fatalf("access log = %s", got)
	}
	if got := f.scalar(`SELECT (last_seen_at IS NOT NULL)::text FROM gym.gate_devices WHERE id = $1`, deviceID); got != "true" {
		t.Fatal("scan should mark the device as seen")
	}
	d = f.device(scanPath, key, map[string]any{"token": "nhqr_unknown"}).data()
	if d["allow"] != false || d["relayOpenMs"] != float64(0) || d["display"] != "Ditolak: QR tidak dikenal" {
		t.Fatalf("denied scan: %v", d)
	}

	// Heartbeats are capped per device per minute.
	if hb := f.device(beatPath, key, nil); hb.Status != 200 || hb.data()["deviceId"] != deviceID || hb.data()["relayOpenMs"] != float64(2500) {
		t.Fatalf("heartbeat: %s", hb.Raw)
	}
	for i := 1; i < deviceHeartbeatLimit; i++ {
		if hb := f.device(beatPath, key, nil); hb.Status != 200 {
			t.Fatalf("heartbeat %d: %d", i, hb.Status)
		}
	}
	limited := f.device(beatPath, key, nil)
	if limited.Status != 429 || limited.Body["retry_after"] == nil {
		t.Fatalf("over the limit: %d %s", limited.Status, limited.Raw)
	}

	// Rotating replaces the key at once; revoking refuses the device.
	rotated := f.asStaff("POST", "/api/gym/gate-devices/"+deviceID+"/rotate", nil)
	newKey, _ := rotated.data()["key"].(string)
	if rotated.Status != 200 || newKey == "" || newKey == key {
		t.Fatalf("rotate: status %d", rotated.Status)
	}
	expectError(t, f.device(scanPath, key, map[string]any{"token": "nhqr_unknown"}), 401, "Kunci perangkat gate tidak valid")
	if res := f.device(scanPath, newKey, map[string]any{"token": "nhqr_unknown"}); res.Status != 200 {
		t.Fatalf("new key: %d", res.Status)
	}
	if res := f.asStaff("POST", "/api/gym/gate-devices/"+deviceID+"/revoke", nil); res.Status != 200 {
		t.Fatalf("revoke: %s", res.Raw)
	}
	expectError(t, f.device(scanPath, newKey, map[string]any{"token": "nhqr_unknown"}), 403, "Perangkat gate sudah dinonaktifkan")
	if got := f.scalar(`SELECT count(*)::text FROM audit.audit_log WHERE entity_id = $1 AND entity = 'gym.gate_devices'`, deviceID); got != "3" {
		t.Fatalf("device audit rows = %s", got)
	}
}

func TestUndoCheckInRefundsAndChargesAgain(t *testing.T) {
	f := newFixture(t)
	typeID, _ := f.classType(2)
	sessionID := f.session(typeID, time.Now().Add(20*time.Minute), 5)
	m := f.member(5)
	bookingID := f.book(m, sessionID).data()["bookingId"].(string)
	if res := f.bookingAction(bookingID, map[string]any{"action": "check_in"}); res.data()["creditsDeducted"] != float64(2) {
		t.Fatalf("check in: %s", res.Raw)
	}

	expectError(t, f.bookingAction(bookingID, map[string]any{"action": "undo_check_in"}), 400,
		"Alasan koreksi wajib diisi (minimal 3 karakter)")
	res := f.bookingAction(bookingID, map[string]any{"action": "undo_check_in", "reason": "Salah member di-scan"})
	if d := res.data(); d["status"] != "confirmed" || d["refundedCredits"] != float64(2) || d["strikeCleared"] != false {
		t.Fatalf("undo check-in: %s", res.Raw)
	}
	if f.balance(m) != 5 {
		t.Fatalf("balance after undo = %d", f.balance(m))
	}
	if got := f.scalar(`SELECT status || ':' || (checked_in_at IS NULL)::text || ':' || correction_seq FROM gym.bookings WHERE id = $1`, bookingID); got != "confirmed:true:1" {
		t.Fatalf("booking = %s", got)
	}
	if got := f.scalar(`SELECT reason FROM audit.audit_log WHERE entity_id = $1 AND action = 'gym.booking.undo_check_in'`, bookingID); got != "Salah member di-scan" {
		t.Fatalf("audit reason = %q", got)
	}
	if n := f.notifications(m, "gym_booking_corrected"); len(n) != 1 || !strings.Contains(n[0], "2 kredit dikembalikan") {
		t.Fatalf("notification: %v", n)
	}
	expectError(t, f.bookingAction(bookingID, map[string]any{"action": "undo_check_in", "reason": "lagi"}), 409,
		"Hanya booking yang sudah check-in yang bisa dibatalkan check-in-nya")

	// Checking in again charges again, and a session cancel refunds only that charge.
	if res := f.bookingAction(bookingID, map[string]any{"action": "check_in"}); res.data()["creditsDeducted"] != float64(2) {
		t.Fatalf("check in again: %s", res.Raw)
	}
	if f.balance(m) != 3 {
		t.Fatalf("balance after the second check-in = %d", f.balance(m))
	}
	if res := f.asStaff("POST", "/api/gym/sessions/"+sessionID, map[string]any{"action": "cancel"}); res.data()["refundedCredits"] != float64(2) {
		t.Fatalf("cancel session: %s", res.Raw)
	}
	if f.balance(m) != 5 {
		t.Fatalf("balance after the session cancel = %d", f.balance(m))
	}
}

func TestUndoNoShowRefundsPenaltyAndClearsStrike(t *testing.T) {
	f := newFixture(t)
	typeID, _ := f.classType(2)
	sessionID := f.session(typeID, time.Now().Add(20*time.Minute), 5)
	credit, holder := f.member(5), f.member(0)
	pass := f.passFor(holder, 30)
	// The pass must cover the class start, which moves into the past below.
	f.exec(`UPDATE gym.member_passes SET starts_at = now() - interval '1 day' WHERE id = $1`, pass)
	creditBooking := f.book(credit, sessionID).data()["bookingId"].(string)
	holderBooking := f.book(holder, sessionID).data()["bookingId"].(string)
	f.exec(`UPDATE gym.class_sessions SET starts_at = now() - interval '10 minutes', ends_at = now() + interval '50 minutes' WHERE id = $1`, sessionID)

	if res := f.bookingAction(creditBooking, map[string]any{"action": "no_show"}); res.data()["penaltyCredits"] != float64(2) {
		t.Fatalf("no-show: %s", res.Raw)
	}
	f.bookingAction(holderBooking, map[string]any{"action": "no_show"})
	if got := f.scalar(`SELECT pass_strike::text FROM gym.bookings WHERE id = $1`, holderBooking); got != "true" {
		t.Fatalf("strike = %s", got)
	}

	// A coach (read_own) cannot correct.
	coachOnly := f.asGrants(f.staff, map[string][]string{"gym.sessions": {"read_own"}}, "POST", "/api/gym/bookings/"+creditBooking,
		map[string]any{"action": "undo_no_show", "reason": "hadir"})
	if coachOnly.Status != 403 {
		t.Fatalf("coach correction: %d", coachOnly.Status)
	}

	res := f.bookingAction(creditBooking, map[string]any{"action": "undo_no_show", "reason": "Member hadir, lupa scan"})
	if d := res.data(); d["refundedCredits"] != float64(2) || d["status"] != "confirmed" {
		t.Fatalf("undo no-show: %s", res.Raw)
	}
	if f.balance(credit) != 5 {
		t.Fatalf("balance = %d", f.balance(credit))
	}
	res = f.bookingAction(holderBooking, map[string]any{"action": "undo_no_show", "reason": "Sakit, ada surat dokter"})
	if d := res.data(); d["strikeCleared"] != true || d["refundedCredits"] != float64(0) {
		t.Fatalf("undo strike: %s", res.Raw)
	}
	if got := f.scalar(`SELECT (pass_strike OR pass_strike_at IS NOT NULL)::text FROM gym.bookings WHERE id = $1`, holderBooking); got != "false" {
		t.Fatalf("strike after undo = %s", got)
	}
	if n := f.notifications(holder, "gym_booking_corrected"); len(n) != 1 || !strings.Contains(n[0], "Strike pass") {
		t.Fatalf("holder notification: %v", n)
	}

	// A second no-show is charged under a fresh key; outside the window it stays.
	if res := f.bookingAction(creditBooking, map[string]any{"action": "no_show"}); res.data()["penaltyCredits"] != float64(2) {
		t.Fatalf("second no-show: %s", res.Raw)
	}
	f.setRules(map[string]any{"correctionWindowDays": 0})
	expectError(t, f.bookingAction(creditBooking, map[string]any{"action": "undo_no_show", "reason": "terlambat"}), 409,
		"Koreksi hanya bisa dalam 0 hari setelah kelas")
}

func TestWaitlistOfferLapsesTwiceThenLeaves(t *testing.T) {
	f := newFixture(t)
	f.setRules(map[string]any{"waitlistAutoPromote": false, "waitlistOfferMinutes": 30})
	typeID, _ := f.classType(1)
	sessionID := f.session(typeID, time.Now().Add(72*time.Hour), 1)
	a, b := f.member(3), f.member(3)
	bookingA := f.book(a, sessionID).data()["bookingId"].(string)
	bookingB := f.book(b, sessionID).data()["bookingId"].(string)
	f.asMember(a, "DELETE", "/api/member-portal/gym/bookings/"+bookingA, nil)

	// Nobody else waits: B is re-queued and offered the seat again.
	svc := f.service(NotificationsSQL{})
	start := time.Now()
	if err := svc.SweepWaitlistOffers(f.ctx, start.Add(31*time.Minute)); err != nil {
		t.Fatal(err)
	}
	if got := f.scalar(`SELECT status || ':' || offer_lapses || ':' || (promotion_offered_at IS NOT NULL)::text FROM gym.bookings WHERE id = $1`,
		bookingB); got != "waitlist:1:true" {
		t.Fatalf("after the first lapse: %s", got)
	}
	if n := f.notifications(b, "gym_waitlist_offer_expired"); len(n) != 1 || !strings.Contains(n[0], "kembali ke waitlist di posisi #1") {
		t.Fatalf("first lapse notice: %v", n)
	}

	// The second lapse removes B.
	if err := svc.SweepWaitlistOffers(f.ctx, start.Add(62*time.Minute)); err != nil {
		t.Fatal(err)
	}
	if f.bookingStatus(bookingB) != "cancelled" {
		t.Fatalf("after the second lapse: %s", f.bookingStatus(bookingB))
	}
	// Both notices share the test transaction's now(), so their order is not fixed.
	if n := f.notifications(b, "gym_waitlist_offer_expired"); len(n) != 2 || !strings.Contains(strings.Join(n, "\n"), "dua kali") {
		t.Fatalf("second lapse notice: %v", n)
	}
}

func TestDeclineWaitlistOffer(t *testing.T) {
	f := newFixture(t)
	f.setRules(map[string]any{"waitlistAutoPromote": false})
	typeID, _ := f.classType(1)
	sessionID := f.session(typeID, time.Now().Add(72*time.Hour), 1)
	a, b, c := f.member(3), f.member(3), f.member(3)
	bookingA := f.book(a, sessionID).data()["bookingId"].(string)
	bookingB := f.book(b, sessionID).data()["bookingId"].(string)
	bookingC := f.book(c, sessionID).data()["bookingId"].(string)
	f.asMember(a, "DELETE", "/api/member-portal/gym/bookings/"+bookingA, nil)

	res := f.asMember(b, "POST", "/api/member-portal/gym/bookings/"+bookingB, map[string]any{"action": "decline_offer"})
	if res.Status != 200 || res.data()["status"] != "cancelled" {
		t.Fatalf("decline: %s", res.Raw)
	}
	if got := f.scalar(`SELECT status || ':' || (promotion_offered_at IS NOT NULL)::text FROM gym.bookings WHERE id = $1`, bookingC); got != "waitlist:true" {
		t.Fatalf("C after B declined: %s", got)
	}
	expectError(t, f.asMember(b, "POST", "/api/member-portal/gym/bookings/"+bookingB, map[string]any{"action": "decline_offer"}), 409,
		"Belum ada kursi yang ditawarkan untuk Anda di kelas ini")
}
