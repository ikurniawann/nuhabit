package memberportal

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/testutil"
)

func deskError(t *testing.T, err error, status int, field string) map[string]string {
	t.Helper()
	var e *httpx.Error
	if !errors.As(err, &e) || e.Status != status {
		t.Fatalf("err = %v, want %d", err, status)
	}
	details, _ := e.Details.(map[string]string)
	if field != "" && details["field"] != field {
		t.Fatalf("details = %v, want field %s", details, field)
	}
	return details
}

func TestIntegrationDeskRegisterAndUpdate(t *testing.T) {
	tx := testutil.Tx(t)
	ctx := context.Background()
	now := time.Date(2026, 10, 20, 9, 0, 0, 0, time.UTC)
	num := fmt.Sprintf("%08d", time.Now().UnixNano()%100_000_000)
	email := "desk" + num + "@test.local"

	_, err := RegisterAtDesk(ctx, tx, DeskMember{Name: "Dewi", Phone: "12"}, now)
	deskError(t, err, 400, "phone")

	id, err := RegisterAtDesk(ctx, tx, DeskMember{Name: "  Dewi   Lestari ", Phone: "0898" + num, Email: " " + email + " "}, now)
	if err != nil {
		t.Fatal(err)
	}
	var name, phone, storedEmail, source string
	var verified *time.Time
	if err := tx.QueryRow(ctx, `SELECT c.name, c.phone, c.email, c.wa_verified_at, p.metadata->>'source'
		  FROM pos.pos_customers c JOIN crm.crm_member_profiles p ON p.customer_id = c.id WHERE c.id = $1`, id).
		Scan(&name, &phone, &storedEmail, &verified, &source); err != nil {
		t.Fatal(err)
	}
	if name != "Dewi Lestari" || phone != "0898"+num || storedEmail != email || verified != nil || source != "gym_front_desk" {
		t.Fatalf("stored = %q %q %q %v %q", name, phone, storedEmail, verified, source)
	}

	_, err = RegisterAtDesk(ctx, tx, DeskMember{Name: "Dewi Lain", Phone: "+62 898" + num}, now)
	if details := deskError(t, err, 409, "phone"); details["member_id"] != id || details["member_name"] != "Dewi Lestari" {
		t.Fatalf("duplicate phone details = %v", details)
	}
	_, err = RegisterAtDesk(ctx, tx, DeskMember{Name: "Dewi Lain", Phone: "0897" + num, Email: "DESK" + num + "@TEST.local"}, now)
	deskError(t, err, 409, "email")

	other, err := RegisterAtDesk(ctx, tx, DeskMember{Name: "Eko", Phone: "0896" + num}, now)
	if err != nil {
		t.Fatal(err)
	}

	birth, empty, newName := "1990-05-17", "", "Dewi L."
	err = UpdateAtDesk(ctx, tx, id, DeskProfile{
		Name: &newName, BirthDate: &birth, Email: &empty, EmergencyContactSet: true,
		EmergencyContact: map[string]any{"name": "Sari", "phone": "08123456789", "relation": "Kakak"},
	}, now)
	if err != nil {
		t.Fatal(err)
	}
	var storedBirth, contact string
	var noEmail *string
	if err := tx.QueryRow(ctx, `SELECT name, phone, email, to_char(birth_date, 'YYYY-MM-DD'), emergency_contact->>'relation'
		  FROM pos.pos_customers WHERE id = $1`, id).Scan(&name, &phone, &noEmail, &storedBirth, &contact); err != nil {
		t.Fatal(err)
	}
	if name != newName || phone != "0898"+num || noEmail != nil || storedBirth != birth || contact != "Kakak" {
		t.Fatalf("updated = %q %q %v %q %q", name, phone, noEmail, storedBirth, contact)
	}

	taken := "+62896" + num
	deskError(t, UpdateAtDesk(ctx, tx, id, DeskProfile{Phone: &taken}, now), 409, "phone")
	deskError(t, UpdateAtDesk(ctx, tx, id, DeskProfile{EmergencyContactSet: true, EmergencyContact: map[string]any{"name": "Sari"}}, now),
		400, "emergency_contact")
	badBirth := "2030-01-01"
	deskError(t, UpdateAtDesk(ctx, tx, id, DeskProfile{BirthDate: &badBirth}, now), 400, "birth_date")
	deskError(t, UpdateAtDesk(ctx, tx, "00000000-0000-4000-8000-000000000000", DeskProfile{Name: &newName}, now), 404, "")

	if err := UpdateAtDesk(ctx, tx, other, DeskProfile{EmergencyContactSet: true}, now); err != nil {
		t.Fatalf("clearing an empty contact: %v", err)
	}
}
