package members

import (
	"context"
	"errors"
	"strings"
	"testing"

	"nuhabit/backend/internal/modules/crm/internal/crmtest"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/testutil"
)

// fakeMessenger records the last WhatsApp text instead of sending it.
type fakeMessenger struct {
	target, message, sentBy string
	fail                    bool
}

func (m *fakeMessenger) SendText(_ context.Context, _ database.Querier, target, message, sentByUserID string) error {
	if m.fail {
		return errors.New("provider down")
	}
	m.target, m.message, m.sentBy = target, message, sentByUserID
	return nil
}

func TestResetPassword(t *testing.T) {
	f := setup(t)
	reader := testutil.CreateStaff(t, testutil.StaffOptions{Role: "admin", Menus: map[string][]string{"crm.members": {"read"}}})
	customerID := f.customer("PwMember" + testutil.RandomHex(4))
	path := "/api/crm/members/" + customerID + "/password"
	crmtest.MustExec(t, f.tx, `INSERT INTO crm.member_portal_sessions (token_hash, customer_id, expires_at) VALUES ($1, $2, now() + interval '1 day')`,
		auth.HashToken(testutil.RandomHex(32)), customerID)

	status, body := f.call("POST", path, map[string]any{}, nil)
	expect(t, status, body, 401, "Authentication required")
	status, body = f.call("POST", path, map[string]any{}, &f.plain)
	expect(t, status, body, 403, "Insufficient permissions")
	status, body = f.call("POST", path, map[string]any{}, &reader)
	expect(t, status, body, 403, "Insufficient permissions")
	status, body = f.call("POST", "/api/crm/members/not-a-member/password", map[string]any{}, &f.crm)
	expect(t, status, body, 404, "Member not found")

	// The password comes back once, verifies against the stored hash and
	// ends the member's sessions; the reset is audited.
	status, body = f.call("POST", path, nil, &f.crm)
	expect(t, status, body, 200, "")
	password, _ := data(t, body)["password"].(string)
	if len(password) != passwordLength {
		t.Fatalf("password %q", password)
	}
	hash := crmtest.Scalar[string](t, f.tx, `SELECT password_hash FROM pos.pos_customers WHERE id = $1`, customerID)
	if !auth.VerifyPassword(password, hash) {
		t.Fatal("stored hash does not match the answered password")
	}
	if n := crmtest.Scalar[int](t, f.tx, `SELECT count(*) FROM crm.member_portal_sessions WHERE customer_id = $1`, customerID); n != 0 {
		t.Fatalf("sessions left: %d", n)
	}
	if n := crmtest.Scalar[int](t, f.tx, `SELECT count(*) FROM audit.audit_log WHERE action = 'member.password_reset' AND entity_id = $1 AND actor_id = $2`,
		customerID, f.crm.UserID); n != 1 {
		t.Fatalf("audit rows: %d", n)
	}

	// Sending by WhatsApp keeps the password out of the body; the pos-
	// prefixed synthetic id works too.
	status, body = f.call("POST", "/api/crm/members/pos-"+customerID+"/password", map[string]any{"send_whatsapp": true}, &f.crm)
	expect(t, status, body, 200, "")
	if d := data(t, body); d["sent"] != true || d["password"] != nil {
		t.Fatalf("whatsapp answer %v", d)
	}
	if !strings.HasPrefix(f.wa.target, "62899") || !strings.HasPrefix(f.wa.message, "Your NüHabit password: ") || f.wa.sentBy != f.crm.UserID {
		t.Fatalf("message %+v", f.wa)
	}
	sent := strings.TrimPrefix(f.wa.message, "Your NüHabit password: ")
	hash = crmtest.Scalar[string](t, f.tx, `SELECT password_hash FROM pos.pos_customers WHERE id = $1`, customerID)
	if !auth.VerifyPassword(sent, hash) {
		t.Fatal("sent password does not match the stored hash")
	}

	// A failed send leaves the previous password in place.
	f.wa.fail = true
	status, body = f.call("POST", path, map[string]any{"send_whatsapp": true}, &f.crm)
	expect(t, status, body, 502, "The WhatsApp message could not be sent. Reset again and read the password to the member.")
	if h := crmtest.Scalar[string](t, f.tx, `SELECT password_hash FROM pos.pos_customers WHERE id = $1`, customerID); h != hash {
		t.Fatal("hash changed although the message was not sent")
	}
	crmtest.MustExec(t, f.tx, `UPDATE pos.pos_customers SET phone = 'walk-in' WHERE id = $1`, customerID)
	f.wa.fail = false
	status, body = f.call("POST", path, map[string]any{"send_whatsapp": true}, &f.crm)
	expect(t, status, body, 400, "This member has no WhatsApp number")
}
