// Package testutil holds helpers for integration tests that need PostgreSQL.
// Every helper skips the test unless TEST_DATABASE_URL is set, and every
// fixture it creates is removed in t.Cleanup.
package testutil

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/config"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/module"
	"nuhabit/backend/internal/platform/outbox"
)

var (
	poolOnce sync.Once
	pool     *pgxpool.Pool
	poolErr  error
)

// DB returns a shared pool on TEST_DATABASE_URL (opened with the same
// search_path and timezone as the runtime), or skips the test.
func DB(t testing.TB) *pgxpool.Pool {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set; skipping integration test")
	}
	poolOnce.Do(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		pool, poolErr = database.Open(ctx, url)
	})
	if poolErr != nil {
		t.Fatalf("open test database: %v", poolErr)
	}
	return pool
}

// Tx opens a transaction on the test database that is rolled back in
// t.Cleanup. Repositories take it as a database.Querier, and
// database.WithTx(ctx, tx, ...) nests as a savepoint, so a test can write
// rows that triggers forbid deleting (ledgers) and still leave nothing behind.
func Tx(t testing.TB) pgx.Tx {
	t.Helper()
	tx, err := DB(t).Begin(context.Background())
	if err != nil {
		t.Fatalf("testutil: begin: %v", err)
	}
	t.Cleanup(func() { _ = tx.Rollback(context.Background()) })
	return tx
}

// Deps builds module.Deps on the test database with a discard logger.
// now may be nil for time.Now.
func Deps(t testing.TB, now func() time.Time) module.Deps {
	t.Helper()
	db := DB(t)
	if now == nil {
		now = time.Now
	}
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	cfg := config.Config{DatabaseURL: os.Getenv("TEST_DATABASE_URL"), Port: "0", Modules: "all", AppEnv: "test", TimeZone: "Asia/Jakarta"}
	return module.Deps{
		DB:     db,
		Auth:   auth.NewService(db, log, now, auth.Options{DatabaseURL: cfg.DatabaseURL}),
		Log:    log,
		Now:    now,
		Config: cfg,
		Events: outbox.NewBus(db, log),
	}
}

// Mux mounts a module's routes on a fresh ServeMux.
func Mux(m module.Module) *http.ServeMux {
	mux := http.NewServeMux()
	for _, r := range m.Routes() {
		mux.Handle(r.Pattern, r.Handler)
	}
	return mux
}

// RandomHex returns n random bytes hex-encoded, for unique fixture values.
func RandomHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// Org is a throwaway holding with one company and one branch.
type Org struct {
	HoldingID, CompanyID, BranchID string
}

// CreateOrg inserts a holding, company and branch. Given a transaction from
// Tx the rows roll back with it. With tx nil they are committed and the
// holding (cascading to company and branch) is deleted on cleanup; create
// such an org before the staff and the Tx that reference it, since cleanups
// run in reverse.
func CreateOrg(t testing.TB, tx pgx.Tx) Org {
	t.Helper()
	db := DB(t)
	var q database.Querier = db
	if tx != nil {
		q = tx
	}
	ctx := context.Background()
	sfx := RandomHex(4)
	var o Org
	must(t, q.QueryRow(ctx, `INSERT INTO configuration.holdings (name, code) VALUES ('Go Test H '||$1, 'GOH'||$1) RETURNING id::text`, sfx).Scan(&o.HoldingID))
	if tx == nil {
		t.Cleanup(func() {
			_, _ = db.Exec(context.Background(), `DELETE FROM configuration.holdings WHERE id = $1`, o.HoldingID)
		})
	}
	must(t, q.QueryRow(ctx, `INSERT INTO configuration.companies (holding_id, name, code) VALUES ($1, 'Go Test C '||$2, 'GOC'||$2) RETURNING id::text`,
		o.HoldingID, sfx).Scan(&o.CompanyID))
	must(t, q.QueryRow(ctx, `INSERT INTO configuration.branches (company_id, name, code) VALUES ($1, 'Go Test B '||$2, 'GOB'||$2) RETURNING id::text`,
		o.CompanyID, sfx).Scan(&o.BranchID))
	return o
}

// Staff is a throwaway staff account with a live session.
type Staff struct {
	UserID   string
	Email    string
	Role     string
	RoleID   string // IAM role created for this user ("" when Menus is nil)
	Token    string // raw nuhabit_session cookie value
	FullName string
}

// StaffOptions configures CreateStaff.
type StaffOptions struct {
	// Role is configuration.users.role; default "pos".
	Role     string
	FullName string
	// Menus grants menu codes to a fresh IAM role assigned through
	// iam.user_roles, mapped to their granted_actions (nil means ["read"]).
	// Missing menu codes are created and removed afterwards. With Menus nil
	// no IAM role is created, so the user resolves through iam.roles by code.
	Menus map[string][]string
	// BrandID, CompanyID, BranchID fill the configuration.users scope.
	BrandID, CompanyID, BranchID *string
}

// CreateStaff inserts auth.users + configuration.users, optional IAM grants
// and an auth.sessions row, all removed on cleanup.
func CreateStaff(t testing.TB, opts StaffOptions) Staff {
	t.Helper()
	db := DB(t)
	ctx := context.Background()
	if opts.Role == "" {
		opts.Role = "pos"
	}
	if opts.FullName == "" {
		opts.FullName = "Go Test " + RandomHex(3)
	}
	s := Staff{Email: "go-test-" + RandomHex(6) + "@test.local", Role: opts.Role, FullName: opts.FullName}
	must(t, db.QueryRow(ctx, `INSERT INTO auth.users (email, password_hash) VALUES ($1, 'x') RETURNING id::text`, s.Email).Scan(&s.UserID))
	t.Cleanup(func() { _, _ = db.Exec(context.Background(), `DELETE FROM auth.users WHERE id = $1`, s.UserID) })
	_, err := db.Exec(ctx, `INSERT INTO configuration.users (id, full_name, role, email, brand_id, company_id, branch_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7)`, s.UserID, s.FullName, s.Role, s.Email, opts.BrandID, opts.CompanyID, opts.BranchID)
	must(t, err)

	if opts.Menus != nil {
		code := "go_test_" + RandomHex(5)
		must(t, db.QueryRow(ctx, `INSERT INTO iam.roles (code, name) VALUES ($1, $1) RETURNING id::text`, code).Scan(&s.RoleID))
		t.Cleanup(func() { _, _ = db.Exec(context.Background(), `DELETE FROM iam.roles WHERE id = $1`, s.RoleID) })
		_, err = db.Exec(ctx, `INSERT INTO iam.user_roles (user_id, role_id) VALUES ($1, $2)`, s.UserID, s.RoleID)
		must(t, err)
		for menuCode, actions := range opts.Menus {
			GrantMenu(t, s.RoleID, menuCode, actions)
		}
	}

	s.Token = RandomHex(32)
	_, err = db.Exec(ctx, `INSERT INTO auth.sessions (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '1 day')`,
		s.UserID, auth.HashToken(s.Token))
	must(t, err)
	return s
}

// testMenuMark is iam.menus.description on menus GrantMenu created, so
// cleanup never removes a seeded menu.
const testMenuMark = "testutil.GrantMenu fixture"

// GrantMenu grants menuCode to roleID, creating the menu when the database
// has no seed for it. Packages run in parallel against one database and
// share menu codes, so a created menu belongs to every grant of that code:
// grants and cleanups take a per-code lock, and the last grant to go
// removes the menu.
func GrantMenu(t testing.TB, roleID, menuCode string, actions []string) {
	t.Helper()
	db := DB(t)
	if actions == nil {
		actions = []string{"read"}
	}
	raw, _ := json.Marshal(actions)
	must(t, withMenuLock(db, menuCode, func(ctx context.Context, tx pgx.Tx) error {
		var menuID string
		if err := tx.QueryRow(ctx, `WITH ins AS (
			INSERT INTO iam.menus (code, menu_name, description) VALUES ($1, $1, $2)
			ON CONFLICT (code) DO NOTHING RETURNING id::text)
			SELECT id FROM ins UNION ALL SELECT id::text FROM iam.menus WHERE code = $1 LIMIT 1`, menuCode, testMenuMark).
			Scan(&menuID); err != nil {
			return err
		}
		_, err := tx.Exec(ctx, `INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions) VALUES ($1, $2, $3::jsonb)`,
			roleID, menuID, string(raw))
		return err
	}))
	t.Cleanup(func() {
		_ = withMenuLock(db, menuCode, func(ctx context.Context, tx pgx.Tx) error {
			if _, err := tx.Exec(ctx, `DELETE FROM iam.role_menu_permissions p USING iam.menus m
				WHERE p.menu_id = m.id AND m.code = $1 AND p.role_id = $2`, menuCode, roleID); err != nil {
				return err
			}
			_, err := tx.Exec(ctx, `DELETE FROM iam.menus m WHERE m.code = $1 AND m.description = $2
				AND NOT EXISTS (SELECT 1 FROM iam.role_menu_permissions p WHERE p.menu_id = m.id)`, menuCode, testMenuMark)
			return err
		})
	})
}

// withMenuLock runs fn in a transaction holding an advisory lock on the
// menu code.
func withMenuLock(db *pgxpool.Pool, code string, fn func(context.Context, pgx.Tx) error) error {
	ctx := context.Background()
	return pgx.BeginFunc(ctx, db, func(tx pgx.Tx) error {
		if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtext('testutil.menu:' || $1))`, code); err != nil {
			return err
		}
		return fn(ctx, tx)
	})
}

// Member is a throwaway pos.pos_customers row with a portal session.
type Member struct {
	CustomerID string
	Phone      string
	Token      string // raw member_session cookie / Bearer value
}

// CreateMember inserts a customer and a crm.member_portal_sessions row.
func CreateMember(t testing.TB) Member {
	t.Helper()
	db := DB(t)
	ctx := context.Background()
	m := Member{Phone: "+6299" + digits(9)}
	must(t, db.QueryRow(ctx, `INSERT INTO pos.pos_customers (phone, name) VALUES ($1, 'Go Test Member') RETURNING id::text`, m.Phone).Scan(&m.CustomerID))
	t.Cleanup(func() {
		_, _ = db.Exec(context.Background(), `DELETE FROM pos.pos_customers WHERE id = $1`, m.CustomerID)
	})
	m.Token = RandomHex(32)
	_, err := db.Exec(ctx, `INSERT INTO crm.member_portal_sessions (token_hash, customer_id, expires_at) VALUES ($1, $2, now() + interval '1 day')`,
		auth.HashToken(m.Token), m.CustomerID)
	must(t, err)
	return m
}

func digits(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	var sb strings.Builder
	for _, c := range b {
		sb.WriteByte('0' + c%10)
	}
	return sb.String()
}

// Request builds a request; body may be nil, a string, or any value that is
// JSON-encoded.
func Request(method, target string, body any) *http.Request {
	var rd io.Reader
	switch b := body.(type) {
	case nil:
	case string:
		rd = strings.NewReader(b)
	default:
		raw, _ := json.Marshal(b)
		rd = strings.NewReader(string(raw))
	}
	r := httptest.NewRequest(method, target, rd)
	if body != nil {
		r.Header.Set("Content-Type", "application/json")
	}
	return r
}

// AsStaff attaches the staff session cookie.
func AsStaff(r *http.Request, s Staff) *http.Request {
	r.AddCookie(&http.Cookie{Name: auth.SessionCookie, Value: s.Token})
	return r
}

// AsMember attaches the member session cookie.
func AsMember(r *http.Request, m Member) *http.Request {
	r.AddCookie(&http.Cookie{Name: auth.MemberSessionCookie, Value: m.Token})
	return r
}

// Do serves r on h and decodes the JSON body into a generic map (nil when
// the body is not a JSON object).
func Do(t testing.TB, h http.Handler, r *http.Request) (*httptest.ResponseRecorder, map[string]any) {
	t.Helper()
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, r)
	var body map[string]any
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	return rec, body
}

func must(t testing.TB, err error) {
	t.Helper()
	if err != nil {
		t.Fatalf("testutil: %v", err)
	}
}
