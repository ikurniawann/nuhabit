package stall_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/platform/stall"
	"nuhabit/backend/internal/platform/testutil"
)

func id(t *testing.T, tx pgx.Tx, sql string, args ...any) string {
	t.Helper()
	var v string
	if err := tx.QueryRow(context.Background(), sql, args...).Scan(&v); err != nil {
		t.Fatal(err)
	}
	return v
}

func request(cookies ...*http.Cookie) *http.Request {
	r := httptest.NewRequest("GET", "/api/purchasing/dashboard", nil)
	for _, c := range cookies {
		r.AddCookie(c)
	}
	return r
}

func TestActive(t *testing.T) {
	tx := testutil.Tx(t)
	ctx := context.Background()
	sfx := testutil.RandomHex(4)
	holding := id(t, tx, `INSERT INTO configuration.holdings (name, code) VALUES ('H '||$1, 'H'||$1) RETURNING id::text`, sfx)
	company := id(t, tx, `INSERT INTO configuration.companies (holding_id, name, code) VALUES ($1, 'C '||$2, 'C'||$2) RETURNING id::text`, holding, sfx)
	branch := id(t, tx, `INSERT INTO configuration.branches (company_id, name, code) VALUES ($1, 'B '||$2, 'B'||$2) RETURNING id::text`, company, sfx)
	stall1 := id(t, tx, `INSERT INTO configuration.warehouses (branch_id, name, code) VALUES ($1, 'Stall 1', 'STALL-01') RETURNING id::text`, branch)
	stall2 := id(t, tx, `INSERT INTO configuration.warehouses (branch_id, name, code) VALUES ($1, 'Stall 2', 'STALL-02') RETURNING id::text`, branch)
	closed := id(t, tx, `INSERT INTO configuration.warehouses (branch_id, name, code, is_active) VALUES ($1, 'Tutup', 'STALL-09', false) RETURNING id::text`, branch)
	user := func(role string) string {
		uid := id(t, tx, `INSERT INTO auth.users (email, password_hash) VALUES ('go-stall-'||$1||'@test.local', 'x') RETURNING id::text`, testutil.RandomHex(6))
		if _, err := tx.Exec(ctx, `INSERT INTO configuration.users (id, full_name, role, email, branch_id) VALUES ($1::uuid, 'Stall Test', $2, $1::text||'@x', $3)`,
			uid, role, branch); err != nil {
			t.Fatal(err)
		}
		return uid
	}
	active := func(r *http.Request, userID string) string {
		t.Helper()
		got, err := stall.Active(ctx, tx, r, userID)
		if err != nil {
			t.Fatal(err)
		}
		return got
	}
	cookie := func(name, value string) *http.Cookie { return &http.Cookie{Name: name, Value: value} }

	if got := active(request(), "00000000-0000-0000-0000-000000000000"); got != "" {
		t.Fatalf("unknown user = %q", got)
	}

	// One placement and no switch right: always the home stall.
	cashier := user("pos")
	if _, err := tx.Exec(ctx, `INSERT INTO configuration.user_warehouses (user_id, warehouse_id) VALUES ($1, $2)`, cashier, stall1); err != nil {
		t.Fatal(err)
	}
	if got := active(request(cookie(stall.CookieName, stall2)), cashier); got != stall1 {
		t.Fatalf("cashier = %q, want home %q", got, stall1)
	}

	// super_admin: any active stall of the branch, "all", the legacy cookie.
	admin := user("super_admin")
	for _, c := range []struct {
		cookies []*http.Cookie
		want    string
	}{
		{nil, ""},
		{[]*http.Cookie{cookie(stall.CookieName, " "+stall2+" ")}, stall2},
		{[]*http.Cookie{cookie(stall.CookieName, stall.All)}, ""},
		{[]*http.Cookie{cookie(stall.LegacyCookieName, stall1)}, stall1},
		{[]*http.Cookie{cookie(stall.CookieName, " "), cookie(stall.LegacyCookieName, stall2)}, stall2},
		{[]*http.Cookie{cookie(stall.CookieName, closed)}, ""},
		{[]*http.Cookie{cookie(stall.CookieName, "not-a-uuid")}, ""},
	} {
		if got := active(request(c.cookies...), admin); got != c.want {
			t.Errorf("admin %v = %q, want %q", c.cookies, got, c.want)
		}
	}

	// Two placements let a cashier switch between them, but not to "all".
	if _, err := tx.Exec(ctx, `INSERT INTO configuration.user_warehouses (user_id, warehouse_id) VALUES ($1, $2)`, cashier, stall2); err != nil {
		t.Fatal(err)
	}
	if got := active(request(cookie(stall.CookieName, stall2)), cashier); got != stall2 {
		t.Fatalf("switch = %q", got)
	}
	if got := active(request(cookie(stall.CookieName, stall.All)), cashier); got == "" {
		t.Fatal("cashier got all stalls")
	}
}
