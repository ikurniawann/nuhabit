package ticketing

import (
	"context"
	"errors"
	"sync"
	"testing"

	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/testutil"
)

// These tests commit their venue (concurrent transactions cannot share a
// rolled-back one) and delete it afterwards. They prove the locks the TS
// also takes: the capacity advisory lock and the visit band FOR UPDATE.

type liveVenue struct {
	svc     *Service
	venue   Venue
	variant string
}

func newLiveVenue(t *testing.T, dailyCapacity *int, bandUIDs ...string) liveVenue {
	t.Helper()
	pool := testutil.DB(t)
	ctx := context.Background()
	staff := testutil.CreateStaff(t, testutil.StaffOptions{})
	company, branch := newVenue(t, ctx, pool)
	t.Cleanup(func() {
		for _, table := range []string{"ticket_gate_events", "ticket_visit_charges", "ticket_visit_bands", "ticket_visits",
			"ticket_product_channels", "ticket_product_variants", "ticket_products", "ticket_bands", "ticket_channels", "ticket_settings"} {
			if _, err := pool.Exec(context.Background(), `DELETE FROM ticketing.`+table+` WHERE branch_id = $1`, branch); err != nil {
				t.Errorf("cleanup %s: %v", table, err)
			}
		}
		_, _ = pool.Exec(context.Background(), `DELETE FROM configuration.branches WHERE id = $1`, branch)
	})
	must := func(sql string, args ...any) string {
		var id string
		if err := pool.QueryRow(ctx, sql, args...).Scan(&id); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
		return id
	}
	must(`INSERT INTO ticketing.ticket_settings (company_id, branch_id, daily_capacity) VALUES ($1, $2, $3) RETURNING id::text`, company, branch, dailyCapacity)
	channel := must(`INSERT INTO ticketing.ticket_channels (company_id, branch_id, code, name) VALUES ($1, $2, 'walk-in', 'Walk-in') RETURNING id::text`, company, branch)
	product := must(`INSERT INTO ticketing.ticket_products (company_id, branch_id, code, name, status) VALUES ($1, $2, 'TKT-0001', 'Kolam', 'active') RETURNING id::text`, company, branch)
	variant := must(`INSERT INTO ticketing.ticket_product_variants (company_id, branch_id, ticket_product_id, code, name, price_regular, price_high)
		VALUES ($1, $2, $3, 'umum', 'Umum', 25000, 25000) RETURNING id::text`, company, branch, product)
	must(`INSERT INTO ticketing.ticket_product_channels (company_id, branch_id, ticket_product_id, channel_id, is_distributed)
		VALUES ($1, $2, $3, $4, true) RETURNING id::text`, company, branch, product, channel)
	for _, uid := range bandUIDs {
		must(`INSERT INTO ticketing.ticket_bands (company_id, branch_id, nfc_uid) VALUES ($1, $2, $3) RETURNING id::text`, company, branch, uid)
	}
	v := Venue{UserID: staff.UserID, CompanyID: company, BranchID: branch}
	return liveVenue{svc: NewService(pool, Ports{Employees: sqlEmployees{}}, nil, discard), venue: v, variant: variant}
}

func (l liveVenue) walkIn(uid string) RegisterVisitInput {
	return RegisterVisitInput{ContactName: "Paralel", PaymentMode: "postpaid", Bands: []BandVariant{{NfcUID: uid, VariantID: l.variant}}}
}

// Five registrations race for two seats: the advisory lock on
// (branch, date) serializes the count, so exactly two get in.
func TestConcurrentRegistrationsCannotOversell(t *testing.T) {
	uids := []string{"C0000001", "C0000002", "C0000003", "C0000004", "C0000005"}
	seats := 2
	l := newLiveVenue(t, &seats, uids...)
	var wg sync.WaitGroup
	errs := make([]error, len(uids))
	for i, uid := range uids {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, errs[i] = l.svc.RegisterVisit(context.Background(), l.venue, l.walkIn(uid))
		}()
	}
	wg.Wait()
	admitted := 0
	for _, err := range errs {
		var he *httpx.Error
		switch {
		case err == nil:
			admitted++
		case errors.As(err, &he) && he.Status == 409 && he.Message == "Kuota tanggal ini sudah penuh — pilih tanggal lain":
		default:
			t.Fatalf("unexpected error: %v", err)
		}
	}
	if admitted != 2 {
		t.Fatalf("admitted %d, want 2", admitted)
	}
}

// Five simultaneous taps of one band: FOR UPDATE OF vb, v lets the first
// charge and enter; the rest see entered_at and are refused.
func TestConcurrentGateTapsChargeOnce(t *testing.T) {
	l := newLiveVenue(t, nil, "D0000001")
	visitID, err := l.svc.RegisterVisit(context.Background(), l.venue, l.walkIn("D0000001"))
	if err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	results := make([]string, 5)
	for i := range results {
		wg.Add(1)
		go func() {
			defer wg.Done()
			row, err := l.svc.GateTap(context.Background(), l.venue, "D0000001", "gate-1")
			if err != nil {
				t.Error(err)
				return
			}
			results[i] = row.Str("result")
		}()
	}
	wg.Wait()
	entered := 0
	for _, r := range results {
		switch r {
		case "masuk":
			entered++
		case "ditolak-sudah-masuk":
		default:
			t.Fatalf("unexpected result %q", r)
		}
	}
	var charges int
	if err := l.svc.db.QueryRow(context.Background(), `SELECT count(*) FROM ticketing.ticket_visit_charges WHERE visit_id = $1`, visitID).Scan(&charges); err != nil {
		t.Fatal(err)
	}
	if entered != 1 || charges != 1 {
		t.Fatalf("entered %d, charges %d; want 1 and 1 (%v)", entered, charges, results)
	}
}
