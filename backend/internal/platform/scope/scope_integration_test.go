package scope_test

import (
	"context"
	"testing"

	"nuhabit/backend/internal/platform/scope"
	"nuhabit/backend/internal/platform/testutil"
)

func TestLoad(t *testing.T) {
	// Staff first: cleanups run in reverse, so the tx rolls back (releasing
	// its row lock) before CreateStaff deletes the user.
	staff := testutil.CreateStaff(t, testutil.StaffOptions{})
	tx := testutil.Tx(t)
	ctx := context.Background()

	if _, err := tx.Exec(ctx, `UPDATE configuration.users SET business_scope = 'branch',
	    company_id = (SELECT id FROM configuration.companies LIMIT 1),
	    branch_id = (SELECT id FROM configuration.branches LIMIT 1) WHERE id = $1`, staff.UserID); err != nil {
		t.Fatal(err)
	}
	s, err := scope.Load(ctx, tx, staff.UserID)
	if err != nil {
		t.Fatal(err)
	}
	if s.Unscoped || s.Level() != "branch" || s.UserID != staff.UserID {
		t.Fatalf("scope = %+v", s)
	}

	missing, err := scope.Load(ctx, tx, "00000000-0000-4000-8000-000000000000")
	if err != nil || !missing.Unscoped || missing.Role != nil {
		t.Fatalf("missing profile = %+v, %v", missing, err)
	}
}
