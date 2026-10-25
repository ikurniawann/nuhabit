package hris_test

import (
	"context"
	"testing"

	"nuhabit/backend/internal/modules/hris"
	"nuhabit/backend/internal/platform/testutil"
)

// Only active, undeleted holidays count; two on one date are joined.
func TestHolidaysBetween(t *testing.T) {
	tx := testutil.Tx(t)
	ctx := context.Background()
	if _, err := tx.Exec(ctx, `INSERT INTO hris.public_holidays (holiday_date, name, type, status, deleted_at) VALUES
		('2031-03-10', 'Nyepi', 'nasional', 'aktif', NULL),
		('2031-03-10', 'Cuti Bersama Nyepi', 'cuti_bersama', 'aktif', NULL),
		('2031-03-11', 'Draf', 'nasional', 'draft', NULL),
		('2031-03-12', 'Dihapus', 'nasional', 'aktif', now()),
		('2031-03-20', 'Di luar rentang', 'perusahaan', 'aktif', NULL)`); err != nil {
		t.Fatal(err)
	}
	got, err := hris.Holidays{}.Between(ctx, tx, "2031-03-01", "2031-03-15")
	if err != nil || len(got) != 1 || got["2031-03-10"] != "Cuti Bersama Nyepi · Nyepi" {
		t.Fatalf("holidays = %v %v", got, err)
	}
}
