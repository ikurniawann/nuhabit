package app

import (
	"context"
	"testing"

	"nuhabit/backend/internal/platform/testutil"
)

// The till's gym check-in runs gym-scheduling's CheckInBooking: a member
// without a booking is denied and the access log records source "pos".
func TestPosGymCheckInLogsPosSource(t *testing.T) {
	deps := testutil.Deps(t, nil)
	staff := testutil.CreateStaff(t, testutil.StaffOptions{})
	member := testutil.CreateMember(t)
	tx := testutil.Tx(t)
	ctx := context.Background()

	res, err := possalesLookupPorts(deps).Gym.CheckInAtPos(ctx, tx, member.CustomerID, staff.UserID)
	if err != nil || res.Decision != "denied" || res.CustomerID == nil || *res.CustomerID != member.CustomerID {
		t.Fatalf("check-in %+v %v", res, err)
	}
	var source, scannedBy string
	if err := tx.QueryRow(ctx, `SELECT source, scanned_by::text FROM gym.access_logs WHERE customer_id = $1`, member.CustomerID).
		Scan(&source, &scannedBy); err != nil || source != "pos" || scannedBy != staff.UserID {
		t.Fatalf("access log %q %q %v", source, scannedBy, err)
	}
}
