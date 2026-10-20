package gymscheduling

import (
	"testing"
	"time"

	"nuhabit/backend/internal/modules/gymcredits"
	"nuhabit/backend/internal/platform/testutil"
)

// A frozen pass covers neither bookings nor gate entry until it is unfrozen.
func TestFrozenPassGrantsNothing(t *testing.T) {
	f := newFixture(t)
	typeID, _ := f.classType(2)
	holder := f.member(0)
	passID := f.passFor(holder, 20)

	booked := f.session(typeID, time.Now().Add(30*time.Minute), 5)
	res := f.asMember(holder, "POST", "/api/member-portal/gym/bookings", map[string]any{"session_id": booked})
	if res.Status != 200 || res.data()["status"] != "confirmed" {
		t.Fatalf("book with pass: %s", res.Raw)
	}

	if _, err := f.credits.svc.FreezePass(f.ctx, passID, 7, gymcredits.PassActor{StaffID: f.staff}); err != nil {
		t.Fatal(err)
	}
	other := f.session(typeID, time.Now().Add(50*time.Minute), 5)
	expectError(t, f.asMember(holder, "POST", "/api/member-portal/gym/bookings", map[string]any{"session_id": other}), 409,
		"Kredit tidak cukup untuk kelas ini")
	if listed := f.asMember(holder, "GET", "/api/member-portal/gym/sessions", nil).data(); listed["active_pass"] != nil {
		t.Fatalf("frozen pass listed as active: %v", listed["active_pass"])
	}
	tok := "nhqr_" + testutil.RandomHex(8)
	f.exec(`INSERT INTO crm.member_qr_tokens (token, customer_id, expires_at) VALUES ($1, $2, now() + interval '5 minutes')`, tok, holder)
	if d := f.asStaff("POST", "/api/gym/checkin", map[string]any{"token": tok}).data(); d["decision"] == "allowed" {
		t.Fatalf("gate admitted a frozen pass: %v", d)
	}

	if _, err := f.credits.svc.UnfreezePass(f.ctx, passID, gymcredits.PassActor{StaffID: f.staff}); err != nil {
		t.Fatal(err)
	}
	res = f.asMember(holder, "POST", "/api/member-portal/gym/bookings", map[string]any{"session_id": other})
	if res.Status != 200 || res.data()["status"] != "confirmed" {
		t.Fatalf("book after unfreeze: %s", res.Raw)
	}
}
