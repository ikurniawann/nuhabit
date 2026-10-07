package branches_test

import (
	"context"
	"testing"

	"nuhabit/backend/internal/modules/configuration/branches"
	"nuhabit/backend/internal/platform/testutil"
)

func TestName(t *testing.T) {
	ctx := context.Background()
	tx := testutil.Tx(t)
	var id, want string
	if err := tx.QueryRow(ctx, `SELECT id::text, name FROM configuration.branches ORDER BY created_at LIMIT 1`).Scan(&id, &want); err != nil {
		t.Skipf("no branch: %v", err)
	}
	if name, err := (branches.Service{}).Name(ctx, tx, id); err != nil || name == nil || *name != want {
		t.Fatalf("name = %v %v", name, err)
	}
	if name, err := (branches.Service{}).Name(ctx, tx, "00000000-0000-4000-8000-000000000000"); err != nil || name != nil {
		t.Fatalf("missing branch = %v %v", name, err)
	}
}
