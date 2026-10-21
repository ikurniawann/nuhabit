package gymscheduling

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

// Deductions written before the ledger recorded its source carried the
// booking in their idempotency key with a generic or missing source. The
// backfill delta fills source_type and source_id from the key, so a session
// cancellation refunds them like the rest. The delta runs inside the test's
// rolled-back transaction, twice, to show it is idempotent.
func TestSessionCancelRefundsBackfilledOldDeductions(t *testing.T) {
	_, file, _, _ := runtime.Caller(0)
	delta, err := os.ReadFile(filepath.Join(filepath.Dir(file), "../../../database/migrations/deltas/20261023120000_gym_credit_ledger_source_backfill.sql"))
	if err != nil {
		t.Fatal(err)
	}
	f := newFixture(t)
	typeID, _ := f.classType(2)
	sessionID := f.session(typeID, time.Now().Add(2*time.Hour), 5)
	generic, missing := f.member(5), f.member(5)
	book := func(m string) string {
		return f.asStaff("POST", "/api/gym/bookings", map[string]any{"session_id": sessionID, "customer_id": m}).data()["bookingId"].(string)
	}
	genericBooking, missingBooking := book(generic), book(missing)
	// The old shapes: the key names the booking, the source says only
	// "booking" or nothing at all, and no lot is recorded.
	f.exec(`INSERT INTO gym.credit_ledger (customer_id, type, amount, source_type, note, idempotency_key)
		VALUES ($1, 'class_deduction', -2, 'booking', 'Check-in lama', 'gym:checkin:' || $2)`, generic, genericBooking)
	f.exec(`INSERT INTO gym.credit_ledger (customer_id, type, amount, note, idempotency_key)
		VALUES ($1, 'class_deduction', -2, 'Batal terlambat lama', 'gym:late_cancel:' || $2)`, missing, missingBooking)
	if f.balance(generic) != 3 || f.balance(missing) != 3 {
		t.Fatalf("balances after the old deductions: %d %d", f.balance(generic), f.balance(missing))
	}
	if charges, err := (Postgres{}).SessionCharges(f.ctx, f.tx, sessionID); err != nil || len(charges) != 0 {
		t.Fatalf("old rows visible before the backfill: %v %v", charges, err)
	}

	for range 2 {
		f.exec(string(delta))
	}
	charges, err := (Postgres{}).SessionCharges(f.ctx, f.tx, sessionID)
	if err != nil || len(charges) != 2 {
		t.Fatalf("charges after the backfill: %v %v", charges, err)
	}
	if got := f.scalar(`SELECT source_type || ' ' || source_id::text FROM gym.credit_ledger WHERE idempotency_key = 'gym:checkin:' || $1`, genericBooking); got != "class_booking "+genericBooking {
		t.Fatalf("generic row after backfill: %q", got)
	}
	if got := f.scalar(`SELECT source_type || ' ' || source_id::text FROM gym.credit_ledger WHERE idempotency_key = 'gym:late_cancel:' || $1`, missingBooking); got != "late_cancel "+missingBooking {
		t.Fatalf("missing row after backfill: %q", got)
	}

	res := f.asStaff("POST", "/api/gym/sessions/"+sessionID, map[string]any{"action": "cancel"})
	if d := res.data(); d["refundedCredits"] != float64(4) {
		t.Fatalf("cancel session: %s", res.Raw)
	}
	if f.balance(generic) != 5 || f.balance(missing) != 5 {
		t.Fatalf("balances after the refund: %d %d", f.balance(generic), f.balance(missing))
	}
}
