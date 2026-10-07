package auth_test

import (
	"context"
	"net/http"
	"testing"
	"time"

	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/httpx"
	"nuhabit/backend/internal/platform/testutil"
)

// guardHandler exposes one guard as a route so the tests assert the wire
// status and body the TS helpers produce.
func guardHandler(guard func(r *http.Request) (*auth.User, error)) http.Handler {
	return httpx.Handle(func(w http.ResponseWriter, r *http.Request) error {
		u, err := guard(r)
		if err != nil {
			return err
		}
		return httpx.JSON(w, http.StatusOK, map[string]any{"id": u.ID, "role": u.Role, "token": u.ViaAPIToken})
	})
}

func expect(t *testing.T, h http.Handler, r *http.Request, status int, errMsg string) map[string]any {
	t.Helper()
	rec, body := testutil.Do(t, h, r)
	if rec.Code != status {
		t.Fatalf("%s %s: status %d, want %d (body %s)", r.Method, r.URL.Path, rec.Code, status, rec.Body.String())
	}
	if errMsg != "" && (body["success"] != false || body["error"] != errMsg) {
		t.Fatalf("body = %s, want error %q", rec.Body.String(), errMsg)
	}
	return body
}

func TestRequireUser(t *testing.T) {
	deps := testutil.Deps(t, nil)
	staff := testutil.CreateStaff(t, testutil.StaffOptions{Role: "pos"})
	h := guardHandler(deps.Auth.RequireUser)

	expect(t, h, testutil.Request("GET", "/api/x", nil), 401, "Authentication required")

	bad := testutil.Request("GET", "/api/x", nil)
	bad.AddCookie(&http.Cookie{Name: auth.SessionCookie, Value: "nope"})
	expect(t, h, bad, 401, "Authentication required")

	body := expect(t, h, testutil.AsStaff(testutil.Request("GET", "/api/x", nil), staff), 200, "")
	if body["id"] != staff.UserID || body["role"] != "pos" {
		t.Fatalf("user = %v", body)
	}

	legacy := testutil.Request("GET", "/api/x", nil)
	legacy.AddCookie(&http.Cookie{Name: auth.LegacySessionCookie, Value: staff.Token})
	expect(t, h, legacy, 200, "")

	// A session without a configuration.users profile is not a login.
	db := testutil.DB(t)
	if _, err := db.Exec(context.Background(), `DELETE FROM configuration.users WHERE id = $1`, staff.UserID); err != nil {
		t.Fatal(err)
	}
	expect(t, h, testutil.AsStaff(testutil.Request("GET", "/api/x", nil), staff), 401, "Authentication required")
}

func TestExpiredAndBannedSessions(t *testing.T) {
	deps := testutil.Deps(t, nil)
	db := testutil.DB(t)
	ctx := context.Background()
	h := guardHandler(deps.Auth.RequireUser)

	expired := testutil.CreateStaff(t, testutil.StaffOptions{})
	if _, err := db.Exec(ctx, `UPDATE auth.sessions SET expires_at = now() - interval '1 minute' WHERE user_id = $1`, expired.UserID); err != nil {
		t.Fatal(err)
	}
	expect(t, h, testutil.AsStaff(testutil.Request("GET", "/api/x", nil), expired), 401, "Authentication required")

	banned := testutil.CreateStaff(t, testutil.StaffOptions{})
	if _, err := db.Exec(ctx, `UPDATE auth.users SET banned_until = now() + interval '1 day' WHERE id = $1`, banned.UserID); err != nil {
		t.Fatal(err)
	}
	expect(t, h, testutil.AsStaff(testutil.Request("GET", "/api/x", nil), banned), 401, "Authentication required")
}

func TestIAMGuards(t *testing.T) {
	deps := testutil.Deps(t, nil)
	granted := testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{
		"gym.packages":        {"read", "create"},
		"pos.operations.bill": nil,
	}})
	plain := testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{"ess": nil}})
	req := func(s testutil.Staff) *http.Request {
		return testutil.AsStaff(testutil.Request("GET", "/api/x", nil), s)
	}

	prefix := guardHandler(func(r *http.Request) (*auth.User, error) {
		return deps.Auth.RequireMenuPrefix(r, "gym.packages")
	})
	expect(t, prefix, testutil.Request("GET", "/api/x", nil), 401, "Authentication required")
	expect(t, prefix, req(plain), 403, "Insufficient permissions")
	expect(t, prefix, req(granted), 200, "")

	child := guardHandler(func(r *http.Request) (*auth.User, error) {
		return deps.Auth.RequireMenuPrefix(r, "pos.operations")
	})
	expect(t, child, req(granted), 200, "")

	exact := guardHandler(func(r *http.Request) (*auth.User, error) {
		return deps.Auth.RequireMenu(r, "pos.operations")
	})
	expect(t, exact, req(granted), 403, "Insufficient permissions")

	create := guardHandler(func(r *http.Request) (*auth.User, error) {
		return deps.Auth.RequireMenuAction(r, "create", "gym.packages")
	})
	expect(t, create, req(granted), 200, "")
	expect(t, create, req(plain), 403, "Insufficient permissions")
	del := guardHandler(func(r *http.Request) (*auth.User, error) {
		return deps.Auth.RequireMenuAction(r, "delete", "gym.packages")
	})
	expect(t, del, req(granted), 403, "Insufficient permissions")
}

// Without iam.user_roles rows the role resolves through iam.roles by the
// configuration.users.role code (super_admin is seeded with every menu).
func TestRoleFallbackByCode(t *testing.T) {
	deps := testutil.Deps(t, nil)
	db := testutil.DB(t)
	var n int
	if err := db.QueryRow(context.Background(), `SELECT count(*) FROM iam.role_menu_permissions rmp
		JOIN iam.roles r ON r.id = rmp.role_id WHERE r.code = 'super_admin' AND rmp.is_active`).Scan(&n); err != nil || n == 0 {
		t.Skip("super_admin role has no seeded grants")
	}
	sa := testutil.CreateStaff(t, testutil.StaffOptions{Role: "super_admin"})
	ids, err := deps.Auth.ResolveRoleIDs(context.Background(), sa.UserID, "super_admin")
	if err != nil || len(ids) != 1 {
		t.Fatalf("ResolveRoleIDs = %v, %v", ids, err)
	}
	h := guardHandler(func(r *http.Request) (*auth.User, error) { return deps.Auth.RequireMenuPrefix(r, "settings") })
	expect(t, h, testutil.AsStaff(testutil.Request("GET", "/api/x", nil), sa), 200, "")
}

func createAPIToken(t *testing.T, userID string, scopes []string, expiresAt *time.Time) string {
	t.Helper()
	db := testutil.DB(t)
	token := auth.APITokenPrefix + testutil.RandomHex(32)
	var id string
	err := db.QueryRow(context.Background(), `INSERT INTO configuration.api_tokens (name, token_hash, token_prefix, user_id, scopes, expires_at)
		VALUES ('go test', $1, $2, $3, $4, $5) RETURNING id::text`,
		auth.HashToken(token), token[:15], userID, scopes, expiresAt).Scan(&id)
	if err != nil {
		t.Fatal(err)
	}
	return token
}

func TestAPITokenBearer(t *testing.T) {
	deps := testutil.Deps(t, nil)
	staff := testutil.CreateStaff(t, testutil.StaffOptions{Menus: map[string][]string{"pos": nil}})
	h := guardHandler(deps.Auth.RequireUser)
	posRead := createAPIToken(t, staff.UserID, []string{"pos:read"}, nil)

	bearer := func(method, path, token string) *http.Request {
		r := testutil.Request(method, path, nil)
		r.Header.Set("Authorization", "Bearer "+token)
		return r
	}
	body := expect(t, h, bearer("GET", "/api/pos/orders", posRead), 200, "")
	if body["token"] != true {
		t.Fatal("user should be marked as API token session")
	}
	expect(t, h, bearer("POST", "/api/pos/orders", posRead), 401, "Authentication required")
	expect(t, h, bearer("GET", "/api/hris/employees", posRead), 401, "Authentication required")
	expect(t, h, bearer("GET", "/api/pos/orders", "nh_unknown"), 401, "Authentication required")

	past := time.Now().Add(-time.Hour)
	expired := createAPIToken(t, staff.UserID, []string{"*"}, &past)
	expect(t, h, bearer("GET", "/api/pos/orders", expired), 401, "Authentication required")

	// A session cookie wins over the Bearer token, with no fallback.
	r := bearer("GET", "/api/pos/orders", posRead)
	r.AddCookie(&http.Cookie{Name: auth.SessionCookie, Value: "stale"})
	expect(t, h, r, 401, "Authentication required")
}

func TestGate(t *testing.T) {
	deps := testutil.Deps(t, nil)
	staff := testutil.CreateStaff(t, testutil.StaffOptions{})
	token := createAPIToken(t, staff.UserID, []string{"pos:read"}, nil)
	ok := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) })
	gate := deps.Auth.Gate(ok)

	expect(t, gate, testutil.Request("GET", "/api/gym/packages", nil), 401, "Authentication required")
	expect(t, gate, testutil.Request("GET", "/api/member-portal/me", nil), 204, "")
	expect(t, gate, testutil.Request("GET", "/health", nil), 204, "")
	expect(t, gate, testutil.AsStaff(testutil.Request("POST", "/api/gym/packages", nil), staff), 204, "")

	r := testutil.Request("GET", "/api/pos/orders", nil)
	r.Header.Set("Authorization", "Bearer "+token)
	expect(t, gate, r, 204, "")
	r = testutil.Request("POST", "/api/pos/orders", nil)
	r.Header.Set("Authorization", "Bearer "+token)
	expect(t, gate, r, 401, "Token tidak valid atau scope tidak mengizinkan")
	// Even a public path rejects a bad Open API token, as the TS gate does.
	r = testutil.Request("GET", "/api/member-portal/me", nil)
	r.Header.Set("Authorization", "Bearer nh_bogus")
	expect(t, gate, r, 401, "Token tidak valid atau scope tidak mengizinkan")

	// The gate writes the canonical audit row.
	db := testutil.DB(t)
	deadline := time.Now().Add(3 * time.Second)
	for {
		var n int
		_ = db.QueryRow(context.Background(), `SELECT count(*) FROM configuration.api_token_request_logs l
			JOIN configuration.api_tokens t ON t.id = l.token_id WHERE t.user_id = $1`, staff.UserID).Scan(&n)
		if n >= 2 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("expected 2 audit rows, got %d", n)
		}
		time.Sleep(50 * time.Millisecond)
	}
}

func TestMemberSession(t *testing.T) {
	deps := testutil.Deps(t, nil)
	member := testutil.CreateMember(t)
	h := deps.Auth.MemberHandler("Gagal memuat data", func(w http.ResponseWriter, r *http.Request, customerID string) error {
		if r.URL.Query().Get("boom") != "" {
			return context.DeadlineExceeded
		}
		if r.URL.Query().Get("bad") != "" {
			return httpx.BadRequest("Nomor tidak valid")
		}
		return httpx.JSON(w, 200, map[string]any{"success": true, "data": customerID})
	})

	expect(t, h, testutil.Request("GET", "/api/member-portal/me", nil), 401, "Unauthorized")
	body := expect(t, h, testutil.AsMember(testutil.Request("GET", "/api/member-portal/me", nil), member), 200, "")
	if body["data"] != member.CustomerID {
		t.Fatalf("customer = %v", body["data"])
	}

	// Bearer wins over a stale cookie (mobile app).
	r := testutil.Request("GET", "/api/member-portal/me", nil)
	r.Header.Set("Authorization", "Bearer "+member.Token)
	r.AddCookie(&http.Cookie{Name: auth.MemberSessionCookie, Value: "stale"})
	expect(t, h, r, 200, "")

	r = testutil.Request("GET", "/api/member-portal/me", nil)
	r.Header.Set("Authorization", "Bearer stale")
	r.AddCookie(&http.Cookie{Name: auth.MemberSessionCookie, Value: member.Token})
	expect(t, h, r, 401, "Unauthorized")

	expect(t, h, testutil.AsMember(testutil.Request("GET", "/api/member-portal/me?bad=1", nil), member), 400, "Nomor tidak valid")
	expect(t, h, testutil.AsMember(testutil.Request("GET", "/api/member-portal/me?boom=1", nil), member), 500, "Gagal memuat data")

	// Staff guards ignore member sessions.
	expect(t, guardHandler(deps.Auth.RequireUser), testutil.AsMember(testutil.Request("GET", "/api/x", nil), member), 401, "Authentication required")

	// CreateMemberSession + DestroyMemberSession round trip.
	token, err := deps.Auth.CreateMemberSession(context.Background(), deps.DB, member.CustomerID)
	if err != nil {
		t.Fatal(err)
	}
	r = testutil.Request("GET", "/api/member-portal/me", nil)
	r.Header.Set("Authorization", "Bearer "+token)
	expect(t, h, r, 200, "")
	if err := deps.Auth.DestroyMemberSession(r); err != nil {
		t.Fatal(err)
	}
	expect(t, h, r, 401, "Unauthorized")
}
