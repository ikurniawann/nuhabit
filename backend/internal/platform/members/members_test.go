package members_test

import (
	"context"
	"testing"

	"nuhabit/backend/internal/platform/members"
	"nuhabit/backend/internal/platform/testutil"
)

func TestGetAndGetMany(t *testing.T) {
	db := testutil.DB(t)
	ctx := context.Background()
	a := testutil.CreateMember(t)
	b := testutil.CreateMember(t)
	if _, err := db.Exec(ctx, `UPDATE pos.pos_customers SET photo_url = 'https://x/p.jpg', is_active = false WHERE id = $1`, b.CustomerID); err != nil {
		t.Fatal(err)
	}

	m, err := members.Get(ctx, db, a.CustomerID)
	if err != nil || m == nil || m.Name == nil || *m.Name != "Go Test Member" || m.Phone != a.Phone || !m.IsActive || m.PhotoURL != nil {
		t.Fatalf("Get = %+v, %v", m, err)
	}
	missing, err := members.Get(ctx, db, "00000000-0000-0000-0000-000000000000")
	if err != nil || missing != nil {
		t.Fatalf("missing = %+v, %v", missing, err)
	}

	got, err := members.GetMany(ctx, db, []string{a.CustomerID, b.CustomerID, "00000000-0000-0000-0000-000000000000"})
	if err != nil || len(got) != 2 {
		t.Fatalf("GetMany = %v, %v", got, err)
	}
	if mb := got[b.CustomerID]; mb.IsActive || mb.PhotoURL == nil || *mb.PhotoURL != "https://x/p.jpg" {
		t.Fatalf("b = %+v", mb)
	}
	if empty, err := members.GetMany(ctx, db, nil); err != nil || len(empty) != 0 {
		t.Fatal("empty ids")
	}
}
