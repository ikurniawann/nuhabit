package files

import (
	"net/http"
	"testing"

	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/testutil"
)

func TestServeWithSessions(t *testing.T) {
	deps := testutil.Deps(t, nil)
	owner := testutil.CreateMember(t)
	other := testutil.CreateMember(t)
	photo := "member-photos/" + owner.CustomerID + "/m.png"
	h := fixture(t, deps.Auth, photo)
	staff := testutil.CreateStaff(t, testutil.StaffOptions{})
	asStaff := func(r *http.Request) { testutil.AsStaff(r, staff) }
	asMember := func(m testutil.Member) func(*http.Request) {
		return func(r *http.Request) { testutil.AsMember(r, m) }
	}

	rec := get(t, h, "/api/files/cv/candidates/cv.pdf", asStaff)
	if rec.Code != 200 || rec.Header().Get("Cache-Control") != "private, max-age=300" ||
		rec.Header().Get("Vary") != "Cookie, Authorization" || rec.Header().Get("Content-Type") != "application/pdf" {
		t.Fatalf("staff reads cv: %d %v", rec.Code, rec.Header())
	}
	if rec := get(t, h, "/api/files/rahasia/a.pdf", asStaff); rec.Code != 404 {
		t.Fatalf("staff, missing file in unknown bucket: %d", rec.Code)
	}
	if rec := get(t, h, "/api/files/products/..%2F..%2Fetc", asStaff); rec.Code != 404 {
		t.Fatalf("staff traversal: %d", rec.Code)
	}

	if rec := get(t, h, "/api/files/"+photo, asMember(owner)); rec.Code != 200 {
		t.Fatalf("owner reads own photo: %d %s", rec.Code, rec.Body.String())
	}
	bearer := func(r *http.Request) { r.Header.Set("Authorization", "Bearer "+owner.Token) }
	if rec := get(t, h, "/api/files/"+photo, bearer); rec.Code != 200 {
		t.Fatalf("owner with Bearer token: %d", rec.Code)
	}
	if rec := get(t, h, "/api/files/"+photo, asMember(other)); rec.Code != 401 {
		t.Fatalf("other member: %d", rec.Code)
	}
	if rec := get(t, h, "/api/files/"+photo, asStaff); rec.Code != 200 {
		t.Fatalf("staff reads member photo: %d", rec.Code)
	}
	// A member session never opens staff buckets.
	if rec := get(t, h, "/api/files/cv/candidates/cv.pdf", asMember(owner)); rec.Code != 401 {
		t.Fatalf("member reads cv: %d", rec.Code)
	}
	stale := func(r *http.Request) { r.AddCookie(&http.Cookie{Name: auth.SessionCookie, Value: "stale"}) }
	if rec := get(t, h, "/api/files/cv/candidates/cv.pdf", stale); rec.Code != 401 {
		t.Fatalf("stale staff session: %d", rec.Code)
	}
}
