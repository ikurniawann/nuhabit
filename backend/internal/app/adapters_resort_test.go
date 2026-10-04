package app

import (
	"context"
	"testing"

	"nuhabit/backend/internal/platform/testutil"
)

// The venue comes from the user's scope, then from the CRM defaults; a
// non-string JSON value loses its quotes as String(value).replace does.
func TestResortVenuesFallBackToCRMDefaults(t *testing.T) {
	tx := testutil.Tx(t)
	ctx := context.Background()
	for key, value := range map[string]string{"default_company_id": `"co-1"`, "default_branch_id": `123`} {
		if _, err := tx.Exec(ctx, `INSERT INTO crm.crm_settings (key, value) VALUES ($1, $2::jsonb)
			ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, key, value); err != nil {
			t.Fatal(err)
		}
	}
	staff := testutil.CreateStaff(t, testutil.StaffOptions{})
	company, branch, err := resortVenues{db: tx}.Resolve(ctx, staff.UserID)
	if err != nil || company != "co-1" || branch != "123" {
		t.Fatalf("got %q %q %v", company, branch, err)
	}
}
