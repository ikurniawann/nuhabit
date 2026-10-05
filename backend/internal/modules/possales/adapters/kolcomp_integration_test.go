package adapters

import (
	"context"
	"testing"
	"time"

	"nuhabit/backend/internal/platform/testutil"
)

func TestKolComp(t *testing.T) {
	tx := testutil.Tx(t)
	ctx := context.Background()
	venue := testutil.CreateOrg(t, tx)
	k := KolComp{Now: func() time.Time { return time.Date(2026, 10, 15, 3, 0, 0, 0, time.UTC) }}
	check := func(customer string, gross float64, want string) {
		t.Helper()
		got, err := k.ValidateKolComp(ctx, tx, customer, gross)
		if err != nil || got != want {
			t.Fatalf("ValidateKolComp(%v) = %q, %v; want %q", gross, got, err, want)
		}
	}
	check("00000000-0000-4000-8000-000000000001", 1000, "Customer tidak ditemukan / fitur KOL belum aktif (migrasi 015)")

	cust := newCustomer(t, tx, "")
	mustExec(t, tx, `UPDATE pos.pos_customers SET name = 'Rina' WHERE id = $1`, cust)
	check(cust, 1000, "Rina bukan KOL — komplimen KOL ditolak")
	mustExec(t, tx, `UPDATE pos.pos_customers SET name = NULL WHERE id = $1`, cust)
	check(cust, 1000, "Customer bukan KOL — komplimen KOL ditolak")

	mustExec(t, tx, `UPDATE pos.pos_customers SET is_kol = true WHERE id = $1`, cust)
	check(cust, 1e9, "") // no limit
	mustExec(t, tx, `UPDATE pos.pos_customers SET kol_monthly_limit_idr = 100000 WHERE id = $1`, cust)
	thisMonth, lastMonth, voided := newOrder(t, tx, venue, &cust), newOrder(t, tx, venue, &cust), newOrder(t, tx, venue, &cust)
	mustExec(t, tx, `UPDATE pos.pos_orders SET comp_type = 'kol_comp', subtotal = 60000, ordered_at = '2026-10-01 00:30:00+07' WHERE id = $1`, thisMonth)
	// Before 1 Oct WIB and voided orders do not count.
	mustExec(t, tx, `UPDATE pos.pos_orders SET comp_type = 'kol_comp', subtotal = 90000, ordered_at = '2026-09-30 23:30:00+07' WHERE id = $1`, lastMonth)
	mustExec(t, tx, `UPDATE pos.pos_orders SET comp_type = 'kol_comp', subtotal = 90000, status = 'voided', ordered_at = '2026-10-02 10:00:00+07' WHERE id = $1`, voided)
	check(cust, 40000, "")
	check(cust, 40000.5, "") // 0.5 tolerance
	check(cust, 40001, "Kuota komplimen KOL bulan ini terlampaui (terpakai Rp60.000 dari Rp100.000, order ini Rp40.001)")
}
