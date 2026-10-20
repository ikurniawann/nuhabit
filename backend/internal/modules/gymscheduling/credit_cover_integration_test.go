package gymscheduling

import (
	"testing"
	"time"
)

// grantLot gives the member credits in a lot of a package that covers
// classTypeIDs (none: an unrestricted lot), expiring in days.
func (f *fixture) grantLot(customerID string, credits, days int, classTypeIDs ...string) {
	f.t.Helper()
	var pkg any
	if len(classTypeIDs) > 0 {
		pkg = f.scalar(`INSERT INTO gym.credit_packages (name, credits, price_idr, validity_days, applicable_class_type_ids)
			VALUES ('Go Restricted Pack', $1, 100000, 30, $2::uuid[]) RETURNING id::text`, credits, classTypeIDs)
	}
	lot := f.scalar(`INSERT INTO gym.credit_lots (customer_id, package_id, credits, expires_at)
		VALUES ($1, $2, $3, now() + make_interval(days => $4)) RETURNING id::text`, customerID, pkg, credits, days)
	f.exec(`INSERT INTO gym.credit_ledger (customer_id, type, amount, lot_id, source_type) VALUES ($1, 'top_up', $2, $3, 'admin')`,
		customerID, credits, lot)
}

// Reservation follows the lots: credits restricted to one class type are
// reserved by bookings of that type only.
func TestCreditReservationPerClassType(t *testing.T) {
	f := newFixture(t)
	f.setRules(map[string]any{"maxConcurrentBookings": 0, "maxBookingsPerDay": 0})
	raceSim, _ := f.classType(1)
	engine, _ := f.classType(1)
	m := f.member(0)
	f.grantLot(m, 8, 60, raceSim)
	f.grantLot(m, 1, 60)

	for i := range 8 {
		start := wibDayAt(1+i/4, 6+2*(i%4))
		if res := f.book(m, f.session(raceSim, start, 5)); res.data()["status"] != "confirmed" {
			t.Fatalf("race sim %d: %s", i, res.Raw)
		}
	}
	if res := f.book(m, f.session(engine, wibDayAt(4, 9), 5)); res.data()["status"] != "confirmed" {
		t.Fatalf("engine builder with the general credit: %s", res.Raw)
	}
	// Nine credits, nine classes: neither class type has one left.
	expectError(t, f.book(m, f.session(engine, wibDayAt(5, 9), 5)), 409,
		"Kredit tidak cukup untuk kelas ini: tersedia 0, butuh 1 (9 kredit sudah terpakai untuk booking lain)")
	expectError(t, f.book(m, f.session(raceSim, wibDayAt(5, 11), 5)), 409,
		"Kredit tidak cukup untuk kelas ini: tersedia 0, butuh 1 (9 kredit sudah terpakai untuk booking lain)")
}

// The race sim lot is not used by an engine class even when its balance
// alone would suggest room: the general credit is what pays.
func TestCreditReservationUsesTheRightLot(t *testing.T) {
	f := newFixture(t)
	f.setRules(map[string]any{"maxConcurrentBookings": 0, "maxBookingsPerDay": 0})
	raceSim, _ := f.classType(1)
	engine, _ := f.classType(1)
	m := f.member(0)
	f.grantLot(m, 3, 60, raceSim)
	f.grantLot(m, 1, 60)

	if res := f.book(m, f.session(engine, wibDayAt(1, 9), 5)); res.data()["status"] != "confirmed" {
		t.Fatalf("engine: %s", res.Raw)
	}
	// Usable for engine: 1, reserved 1, so a second engine class is short
	// even though the member still holds 3 race sim credits.
	expectError(t, f.book(m, f.session(engine, wibDayAt(2, 9), 5)), 409,
		"Kredit tidak cukup untuk kelas ini: tersedia 0, butuh 1 (1 kredit sudah terpakai untuk booking lain)")
	for i := range 3 {
		if res := f.book(m, f.session(raceSim, wibDayAt(2, 6+2*i), 5)); res.data()["status"] != "confirmed" {
			t.Fatalf("race sim %d: %s", i, res.Raw)
		}
	}
}

// A lot that lapses before the class starts does not reserve for it.
func TestCreditReservationIgnoresLotsLapsedByClassTime(t *testing.T) {
	f := newFixture(t)
	typeID, _ := f.classType(1)
	m := f.member(0)
	f.grantLot(m, 1, 2)

	expectError(t, f.book(m, f.session(typeID, time.Now().Add(5*24*time.Hour), 5)), 409,
		"Kredit tidak cukup untuk kelas ini: kredit yang berlaku sudah dipesan untuk booking lain atau kedaluwarsa sebelum kelas dimulai")
	if res := f.book(m, f.session(typeID, time.Now().Add(24*time.Hour), 5)); res.data()["status"] != "confirmed" {
		t.Fatalf("class before the lot lapses: %s", res.Raw)
	}
}
