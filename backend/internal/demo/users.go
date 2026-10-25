package demo

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/database"
)

// Demo accounts for internal walkthroughs: one staff user per role plus a
// member for the member app. Re-running resets their passwords.

// EmailDomain is the domain of every demo account.
const EmailDomain = "nuhabit.test"

// Account is one demo account to create.
type Account struct {
	// Role is the iam.roles code; "member" is the member app account.
	Role     string
	FullName string
	// legacyRole is configuration.users.role, a column still constrained to
	// the pre-IAM role list; access comes from iam.user_roles.
	legacyRole string
}

// Email is the account's sign-in email: demo-<role>@nuhabit.test.
func (a Account) Email() string { return "demo-" + a.Role + "@" + EmailDomain }

// Accounts are the demo accounts, in creation order. A role missing from
// iam.roles is skipped, except super_admin, which is created with every
// menu as the admin seeder does.
var Accounts = []Account{
	{Role: "super_admin", FullName: "Demo Super Admin", legacyRole: "super_admin"},
	{Role: "admin", FullName: "Demo Admin", legacyRole: "admin"},
	{Role: "gym_manager", FullName: "Demo Gym Manager", legacyRole: "pos_supervisor"},
	{Role: "gym_front_desk", FullName: "Demo Front Desk", legacyRole: "pos"},
	{Role: "gym_coach", FullName: "Demo Coach", legacyRole: "pos"},
	{Role: "marketing", FullName: "Demo Marketing", legacyRole: "pos"},
	{Role: "investor", FullName: "Demo Investor", legacyRole: "direksi"},
	{Role: "member", FullName: "Demo Member"},
}

const (
	coachName   = "Demo Coach"
	coachNIP    = "DEMO-COACH"
	memberPhone = "081200000999"
)

// Result is one account after EnsureUsers.
type Result struct {
	Account
	// Password is set when it was generated; empty with a shared password.
	Password string
	// Skipped says why no account was written.
	Skipped string
}

// Options configure EnsureUsers.
type Options struct {
	// Password applies to every account; empty generates one per account.
	Password string
}

// EnsureUsers creates or resets every demo account in one transaction and
// returns what it did. Passwords are only in the results, never logged.
func EnsureUsers(ctx context.Context, db database.DB, opts Options) ([]Result, error) {
	var results []Result
	err := database.WithTx(ctx, db, func(tx pgx.Tx) error {
		for _, a := range Accounts {
			password := opts.Password
			generated := ""
			if password == "" {
				var err error
				if password, err = auth.GeneratePassword(14); err != nil {
					return err
				}
				generated = password
			}
			res := Result{Account: a, Password: generated}
			var err error
			if a.Role == "member" {
				err = ensureMember(ctx, tx, a, password)
			} else {
				res.Skipped, err = ensureStaff(ctx, tx, a, password)
			}
			if err != nil {
				return fmt.Errorf("%s: %w", a.Email(), err)
			}
			if res.Skipped != "" {
				res.Password = ""
			}
			results = append(results, res)
		}
		return nil
	})
	return results, err
}

// roleID finds the IAM role, creating super_admin with every menu when
// the admin seeder has not run; "" when the role does not exist.
func roleID(ctx context.Context, tx pgx.Tx, code string) (string, error) {
	var id string
	err := tx.QueryRow(ctx, `SELECT id::text FROM iam.roles WHERE code = $1 AND deleted_at IS NULL LIMIT 1`, code).Scan(&id)
	if err == nil || !database.IsNoRows(err) {
		return id, err
	}
	if code != "super_admin" {
		return "", nil
	}
	if err := tx.QueryRow(ctx, `INSERT INTO iam.roles (code, name, description, is_system, is_active)
		VALUES ('super_admin', 'Super Admin', 'Akses penuh ke seluruh sistem', true, true) RETURNING id::text`).Scan(&id); err != nil {
		return "", err
	}
	_, err = tx.Exec(ctx, `INSERT INTO iam.role_menu_permissions (role_id, menu_id, granted_actions)
		SELECT $1, m.id, COALESCE(m.permission_context->'actions', '["read"]'::jsonb) || '["create","update","delete","approve","export","import","execute"]'::jsonb
		FROM iam.menus m WHERE m.deleted_at IS NULL AND m.is_active
		ON CONFLICT (role_id, menu_id) DO UPDATE SET is_active = true, granted_actions = EXCLUDED.granted_actions, updated_at = now()`, id)
	return id, err
}

func ensureStaff(ctx context.Context, tx pgx.Tx, a Account, password string) (skipped string, err error) {
	role, err := roleID(ctx, tx, a.Role)
	if err != nil {
		return "", err
	}
	if role == "" {
		return "role " + a.Role + " belum ada di iam.roles (jalankan seeder IAM)", nil
	}
	hash, err := auth.HashPassword(password)
	if err != nil {
		return "", err
	}
	userMeta, _ := json.Marshal(map[string]string{"full_name": a.FullName})
	appMeta, _ := json.Marshal(map[string]string{"role": a.Role})
	var userID string
	err = tx.QueryRow(ctx, `INSERT INTO auth.users (email, password_hash, email_verified_at, raw_user_meta_data, raw_app_meta_data)
		VALUES ($1, $2, now(), $3::jsonb, $4::jsonb)
		ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash, banned_until = NULL,
		  email_verified_at = COALESCE(auth.users.email_verified_at, now()), updated_at = now()
		RETURNING id::text`, a.Email(), hash, string(userMeta), string(appMeta)).Scan(&userID)
	if err != nil {
		return "", err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO configuration.users (id, full_name, role, email, status)
		VALUES ($1, $2, $3, $4, 'active')
		ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, role = EXCLUDED.role, email = EXCLUDED.email,
		  status = 'active', updated_at = now()`, userID, a.FullName, a.legacyRole, a.Email()); err != nil {
		return "", err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM iam.user_roles WHERE user_id = $1`, userID); err != nil {
		return "", err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO iam.user_roles (user_id, role_id, is_primary) VALUES ($1, $2, true)`, userID, role); err != nil {
		return "", err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM auth.sessions WHERE user_id = $1`, userID); err != nil {
		return "", err
	}
	if a.Role == "gym_coach" {
		return "", ensureCoach(ctx, tx, a, userID)
	}
	return "", nil
}

// ensureCoach gives the coach account its employee record, an active
// salary (so coach incentives can post to payroll) and its gym.coaches row
// (so Kelas Saya lists its classes).
func ensureCoach(ctx context.Context, tx pgx.Tx, a Account, userID string) error {
	var employeeID string
	err := tx.QueryRow(ctx, `INSERT INTO hris.employees (user_id, full_name, nip, email, phone, join_date, employment_status, is_active, is_access_app)
		VALUES ($1, $2, $3, $4, '081200000998', CURRENT_DATE, 'permanent', true, true)
		ON CONFLICT (nip) DO UPDATE SET user_id = EXCLUDED.user_id, full_name = EXCLUDED.full_name, email = EXCLUDED.email,
		  is_active = true, is_access_app = true, updated_at = now()
		RETURNING id::text`, userID, a.FullName, coachNIP, a.Email()).Scan(&employeeID)
	if err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO hris.employee_salary (employee_id, base_salary, effective_date, is_active, notes)
		SELECT $1, 5000000, CURRENT_DATE, true, 'Gaji demo'
		WHERE NOT EXISTS (SELECT 1 FROM hris.employee_salary WHERE employee_id = $1 AND is_active)`, employeeID); err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO gym.coaches (name, bio, specialization, user_id, status)
		VALUES ($1, 'Akun demo untuk walkthrough menu Kelas Saya.', 'Demo', $2, 'active')
		ON CONFLICT ((lower(name))) DO UPDATE SET user_id = EXCLUDED.user_id, status = 'active', updated_at = now()`, coachName, userID)
	return err
}

// ensureMember creates the member app account: a customer with a password
// and a CRM profile.
func ensureMember(ctx context.Context, tx pgx.Tx, a Account, password string) error {
	hash, err := auth.HashPassword(password)
	if err != nil {
		return err
	}
	var id string
	err = tx.QueryRow(ctx, `INSERT INTO pos.pos_customers (phone, name, email, password_hash, member_type, is_active)
		VALUES ($1, $2, $3, $4, 'registered', true)
		ON CONFLICT (phone) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email, password_hash = EXCLUDED.password_hash,
		  is_active = true, updated_at = now()
		RETURNING id::text`, memberPhone, a.FullName, a.Email(), hash).Scan(&id)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `INSERT INTO crm.crm_member_profiles (customer_id, tier_id, status, metadata, last_activity_at)
		SELECT $1, t.id, 'active', '{"source":"demo-users"}'::jsonb, now()
		FROM crm.crm_membership_tiers t WHERE t.code = 'regular' OR t.is_active
		ORDER BY (t.code = 'regular') DESC, t.rank LIMIT 1
		ON CONFLICT (customer_id) DO NOTHING`, id)
	return err
}

// WritePasswords writes "email<TAB>password" lines for the generated
// passwords to path (mode 0600) and returns how many it wrote.
func WritePasswords(path string, results []Result) (int, error) {
	var b strings.Builder
	n := 0
	for _, r := range results {
		if r.Password == "" {
			continue
		}
		fmt.Fprintf(&b, "%s\t%s\n", r.Email(), r.Password)
		n++
	}
	if n == 0 {
		return 0, nil
	}
	return n, os.WriteFile(path, []byte(b.String()), 0o600)
}

// PrintResults lists the accounts without their passwords.
func PrintResults(w io.Writer, results []Result) {
	for _, r := range results {
		switch {
		case r.Skipped != "":
			fmt.Fprintf(w, "  %-34s lewati: %s\n", r.Email(), r.Skipped)
		default:
			fmt.Fprintf(w, "  %-34s %s\n", r.Email(), r.FullName)
		}
	}
}
