package resort

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/resort/domain"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/testutil"
)

// These tests commit their venue (concurrent transactions cannot share a
// rolled-back one) and delete it afterwards. They prove that the last room
// of a type cannot be sold twice: Go creations serialize on the branch
// stock lock, and the stock guard trigger
// (20261005160000_resort_room_stock_guard.sql) rejects a TS-style insert
// that skipped the check or checked stale data.

type liveVenue struct {
	svc    *Service
	venue  Venue
	typeID string
}

func newLiveVenue(t *testing.T, units int) liveVenue {
	t.Helper()
	pool := testutil.DB(t)
	ctx := context.Background()
	v := Venue{UserID: newUUID(t), ActorName: "Front Office", CompanyID: newUUID(t), BranchID: newUUID(t)}
	t.Cleanup(func() {
		for _, table := range []string{"reservations", "rooms", "room_types"} {
			if _, err := pool.Exec(context.Background(), `DELETE FROM resort.`+table+` WHERE branch_id = $1`, v.BranchID); err != nil {
				t.Errorf("cleanup %s: %v", table, err)
			}
		}
	})
	svc := NewService(pool, nil)
	typeRow, err := svc.CreateRoomType(ctx, v, RoomTypeInput{Code: "LAST", Name: "Cabin", CapacityAdults: 2, RateWeekday: 1_000_000, Amenities: []string{}})
	if err != nil {
		t.Fatal(err)
	}
	typeID := typeRow.Str("id")
	for i := range units {
		if _, err := svc.CreateRoom(ctx, v, RoomInput{RoomTypeID: typeID, Code: fmt.Sprintf("U%d", i), Name: fmt.Sprintf("Unit %d", i)}); err != nil {
			t.Fatal(err)
		}
	}
	return liveVenue{svc: svc, venue: v, typeID: typeID}
}

func (l liveVenue) booking(guest string) ReservationInput {
	return ReservationInput{GuestName: guest, GuestPhone: "0812345678", CheckIn: "2026-11-02", CheckOut: "2026-11-04",
		Adults: 2, Source: "walk-in", Status: domain.StatusConfirmed, Rooms: []domain.RoomRequest{{RoomTypeID: l.typeID, Qty: 1}}}
}

func (l liveVenue) held(t *testing.T) int {
	t.Helper()
	var n int
	if err := l.svc.db.QueryRow(context.Background(), `SELECT count(*) FROM resort.reservation_rooms rr
		JOIN resort.reservations r ON r.id = rr.reservation_id WHERE r.branch_id = $1`, l.venue.BranchID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	return n
}

// Five Go creations race for two rooms: exactly two get in, the rest get
// the planner's 409.
func TestConcurrentReservationsCannotOverbook(t *testing.T) {
	l := newLiveVenue(t, 2)
	errs := make([]error, 5)
	var wg sync.WaitGroup
	for i := range errs {
		wg.Go(func() {
			_, _, errs[i] = l.svc.CreateReservation(context.Background(), l.venue, l.booking(fmt.Sprintf("Tamu %d", i)))
		})
	}
	wg.Wait()
	booked := 0
	for _, err := range errs {
		var he *httpx.Error
		switch {
		case err == nil:
			booked++
		case errors.As(err, &he) && he.Status == 409 && he.Message == "Cabin: sisa 0 kamar untuk tanggal tersebut, diminta 1":
		default:
			t.Fatalf("unexpected error: %v", err)
		}
	}
	if booked != 2 || l.held(t) != 2 {
		t.Fatalf("booked %d, held %d; want 2", booked, l.held(t))
	}
}

// tsInsert is what the TS createReservation transaction does after its
// unlocked availability check passed: insert the header, then the room line.
func tsInsert(ctx context.Context, l liveVenue, guest string) error {
	return database.WithTx(ctx, l.svc.db, func(tx pgx.Tx) error {
		var id string
		if err := tx.QueryRow(ctx, `INSERT INTO resort.reservations
			(company_id, branch_id, reservation_code, access_token, guest_name, guest_phone, check_in, check_out, nights, status)
			VALUES ($1, $2, $3, md5(random()::text), $4, '0812345678', '2026-11-03', '2026-11-05', 2, 'menunggu-bayar') RETURNING id::text`,
			l.venue.CompanyID, l.venue.BranchID, domain.GenerateReservationCode(), guest).Scan(&id); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `INSERT INTO resort.reservation_rooms (company_id, branch_id, reservation_id, room_type_id, room_type_name)
			VALUES ($1, $2, $3, $4, 'Cabin')`, l.venue.CompanyID, l.venue.BranchID, id, l.typeID)
		return err
	})
}

// TS-style creations that all passed a stale check, racing Go creations
// for one room: the trigger lets exactly one through overall and rejects
// the other TS inserts with check_violation (400 in both stacks).
func TestStockGuardStopsTSStyleOverbooking(t *testing.T) {
	l := newLiveVenue(t, 1)
	tsErrs := make([]error, 4)
	goErrs := make([]error, 2)
	var wg sync.WaitGroup
	for i := range tsErrs {
		wg.Go(func() { tsErrs[i] = tsInsert(context.Background(), l, fmt.Sprintf("TS %d", i)) })
	}
	for i := range goErrs {
		wg.Go(func() {
			_, _, goErrs[i] = l.svc.CreateReservation(context.Background(), l.venue, l.booking(fmt.Sprintf("Go %d", i)))
		})
	}
	wg.Wait()
	for _, err := range tsErrs {
		if err != nil && database.PgCode(err) != "23514" {
			t.Fatalf("TS insert: %v", err)
		}
	}
	for _, err := range goErrs {
		var he *httpx.Error
		if err != nil && !(errors.As(err, &he) && he.Status == 409) && database.PgCode(err) != "23514" {
			t.Fatalf("Go create: %v", err)
		}
	}
	if held := l.held(t); held != 1 {
		t.Fatalf("held %d room lines for one room", held)
	}
}
