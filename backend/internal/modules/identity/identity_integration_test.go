package identity_test

import (
	"context"
	"net/http"
	"testing"

	"nuhabit/backend/internal/modules/identity"
	"nuhabit/backend/internal/platform/testutil"
)

func TestAuthMe(t *testing.T) {
	deps := testutil.Deps(t, nil)
	mux := testutil.Mux(identity.New(deps))
	staff := testutil.CreateStaff(t, testutil.StaffOptions{Role: "admin", FullName: "Ayu Test"})

	rec, body := testutil.Do(t, mux, testutil.Request("GET", "/api/auth/me", nil))
	if rec.Code != 401 || body["error"] != "Not authenticated" || body["success"] != false {
		t.Fatalf("no session: %d %s", rec.Code, rec.Body.String())
	}

	rec, _ = testutil.Do(t, mux, testutil.AsStaff(testutil.Request("GET", "/api/auth/me", nil), staff))
	want := `{"success":true,"data":{"id":"` + staff.UserID + `","full_name":"Ayu Test","role":"admin","brand_id":null,"email":"` + staff.Email + `"}}`
	if rec.Code != 200 || rec.Body.String() != want {
		t.Fatalf("signed in: %d\n got %s\nwant %s", rec.Code, rec.Body.String(), want)
	}

	if _, err := deps.DB.Exec(context.Background(), `DELETE FROM configuration.users WHERE id = $1`, staff.UserID); err != nil {
		t.Fatal(err)
	}
	rec, body = testutil.Do(t, mux, testutil.AsStaff(testutil.Request("GET", "/api/auth/me", nil), staff))
	if rec.Code != 401 || body["error"] != "Not authenticated" {
		t.Fatalf("no profile: %d %s", rec.Code, rec.Body.String())
	}
}

// Through the full app handler the gate answers first, like the Next proxy.
func TestAuthMeBehindGate(t *testing.T) {
	deps := testutil.Deps(t, nil)
	h := deps.Auth.Gate(testutil.Mux(identity.New(deps)))
	rec, body := testutil.Do(t, h, testutil.Request("GET", "/api/auth/me", nil))
	if rec.Code != http.StatusUnauthorized || body["error"] != "Authentication required" {
		t.Fatalf("%d %s", rec.Code, rec.Body.String())
	}
}
