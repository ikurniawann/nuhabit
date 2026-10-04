// Package adapters holds stopgap implementations of the pos-sales ports
// (possales/ports) with SQL ported from the TS libs. Each adapter touches
// tables another context owns; internal/app swaps one for the owning
// module's service once that module exposes it.
package adapters

import (
	"context"
	"errors"
	"log/slog"
	"strings"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/modules/possales/ports"
	"nuhabit/backend/internal/platform/auth"
	"nuhabit/backend/internal/platform/database"
	"nuhabit/backend/internal/platform/iam"
	"nuhabit/backend/internal/platform/scope"
)

// Directory reads configuration.*, hris.employees and crm settings.
type Directory struct {
	Auth *auth.Service
	Log  *slog.Logger
}

var _ ports.Directory = Directory{}

// Venue is getCrmDefaultVenue: crm_settings default_company_id/branch_id
// (string values only); any failure yields "". The read runs in a savepoint
// so a missing crm schema does not abort the caller's transaction.
func (Directory) Venue(ctx context.Context, q database.Querier) (string, string) {
	var company, branch string
	err := savepoint(ctx, q, func(q database.Querier) error {
		rows, err := q.Query(ctx, `SELECT key, value FROM crm.crm_settings WHERE key = ANY($1::text[])`,
			[]string{"default_company_id", "default_branch_id"})
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var key string
			var value any
			if err := rows.Scan(&key, &value); err != nil {
				return err
			}
			s, _ := value.(string)
			switch key {
			case "default_company_id":
				company = s
			case "default_branch_id":
				branch = s
			}
		}
		return rows.Err()
	})
	if err != nil {
		return "", ""
	}
	return company, branch
}

// Flags reads can_central_checkout, can_switch_stall and default_warehouse_id
// (a database without can_central_checkout falls back like the TS).
func (Directory) Flags(ctx context.Context, q database.Querier, userID string) (ports.CashierFlags, error) {
	var f ports.CashierFlags
	var def *string
	err := savepoint(ctx, q, func(q database.Querier) error {
		return q.QueryRow(ctx, `SELECT COALESCE(can_central_checkout, false), COALESCE(can_switch_stall, false), default_warehouse_id::text
			FROM configuration.users WHERE id = $1`, userID).Scan(&f.CanCentralCheckout, &f.CanSwitchStall, &def)
	})
	if database.PgCode(err) == "42703" {
		f = ports.CashierFlags{}
		err = q.QueryRow(ctx, `SELECT COALESCE(can_switch_stall, false), default_warehouse_id::text
			FROM configuration.users WHERE id = $1`, userID).Scan(&f.CanSwitchStall, &def)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return ports.CashierFlags{}, nil
	}
	f.DefaultWarehouseID = deref(def)
	return f, err
}

// AssignedWarehouses is loadUserWarehouses (missing table → none).
func (Directory) AssignedWarehouses(ctx context.Context, q database.Querier, userID string) ([]ports.Warehouse, error) {
	var out []ports.Warehouse
	err := savepoint(ctx, q, func(q database.Querier) error {
		var err error
		out, err = scanWarehouses(q.Query(ctx, `SELECT w.id::text, w.name, w.code, w.branch_id::text, w.is_default
			FROM configuration.user_warehouses uw
			INNER JOIN configuration.warehouses w ON w.id = uw.warehouse_id
			WHERE uw.user_id = $1 AND uw.is_active = true AND w.is_active = true
			ORDER BY w.is_default DESC, w.name ASC`, userID))
		return err
	})
	if database.IsUndefinedTable(err) {
		return nil, nil
	}
	return out, err
}

// BranchWarehouses lists active warehouses of a branch ("" = every branch).
func (Directory) BranchWarehouses(ctx context.Context, q database.Querier, branchID string) ([]ports.Warehouse, error) {
	if branchID == "" {
		return scanWarehouses(q.Query(ctx, `SELECT w.id::text, w.name, w.code, w.branch_id::text, w.is_default
			FROM configuration.warehouses w WHERE w.is_active`))
	}
	return scanWarehouses(q.Query(ctx, `SELECT w.id::text, w.name, w.code, w.branch_id::text, w.is_default
		FROM configuration.warehouses w WHERE w.is_active AND w.branch_id = $1`, branchID))
}

// ActiveWarehouse is findActiveStall.
func (Directory) ActiveWarehouse(ctx context.Context, q database.Querier, id string) (*ports.Warehouse, error) {
	if !isUUID(id) {
		return nil, nil
	}
	ws, err := scanWarehouses(q.Query(ctx, `SELECT id::text, name, code, branch_id::text, is_default
		FROM configuration.warehouses WHERE id = $1 AND is_active = true`, id))
	if err != nil || len(ws) == 0 {
		return nil, err
	}
	return &ws[0], nil
}

func scanWarehouses(rows pgx.Rows, err error) ([]ports.Warehouse, error) {
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ports.Warehouse
	for rows.Next() {
		var w ports.Warehouse
		var name, code, branch *string
		var isDefault *bool
		if err := rows.Scan(&w.ID, &name, &code, &branch, &isDefault); err != nil {
			return nil, err
		}
		w.Name, w.Code, w.BranchID = deref(name), deref(code), deref(branch)
		w.IsDefault = isDefault != nil && *isDefault
		out = append(out, w)
	}
	return out, rows.Err()
}

// EmployeeID is `SELECT id FROM hris.employees WHERE user_id = $1 LIMIT 1`
// (errors swallowed like the TS `.catch(() => null)`).
func (Directory) EmployeeID(ctx context.Context, q database.Querier, userID string) (string, error) {
	var id string
	err := savepoint(ctx, q, func(q database.Querier) error {
		return q.QueryRow(ctx, `SELECT id::text FROM hris.employees WHERE user_id = $1 LIMIT 1`, userID).Scan(&id)
	})
	if err != nil {
		return "", nil
	}
	return id, nil
}

// EmployeeName is hris.employees.full_name.
func (Directory) EmployeeName(ctx context.Context, q database.Querier, employeeID string) (*string, error) {
	return optionalName(ctx, q, `SELECT full_name FROM hris.employees WHERE id = $1`, employeeID)
}

// UserName is configuration.users.full_name.
func (Directory) UserName(ctx context.Context, q database.Querier, userID string) (*string, error) {
	return optionalName(ctx, q, `SELECT full_name FROM configuration.users WHERE id = $1`, userID)
}

// optionalName mirrors `.maybeSingle()` lookups whose errors the TS ignores.
func optionalName(ctx context.Context, q database.Querier, sql, id string) (*string, error) {
	var name *string
	err := savepoint(ctx, q, func(q database.Querier) error { return q.QueryRow(ctx, sql, id).Scan(&name) })
	if err != nil {
		return nil, nil
	}
	return name, nil
}

// ActiveSupervisors is activeSupervisors() with the scope columns.
func (Directory) ActiveSupervisors(ctx context.Context, q database.Querier) ([]ports.Supervisor, error) {
	rows, err := q.Query(ctx, `SELECT id::text, role::text, business_scope::text, holding_id::text, company_id::text, branch_id::text, full_name, pos_pin
		FROM configuration.users
		WHERE role = 'pos_supervisor' AND status = 'active' AND pos_pin IS NOT NULL`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ports.Supervisor
	for rows.Next() {
		var s ports.Supervisor
		var role, level, holding, company, branch *string
		if err := rows.Scan(&s.ID, &role, &level, &holding, &company, &branch, &s.FullName, &s.PosPin); err != nil {
			return nil, err
		}
		s.Scope = scope.New(s.ID, role, level, holding, company, branch)
		out = append(out, s)
	}
	return out, rows.Err()
}

// HasCentralMenu reports the pos.cashier.central grant (errors → false).
func (d Directory) HasCentralMenu(ctx context.Context, userID, role string) bool {
	if d.Auth == nil {
		return false
	}
	codes, err := d.Auth.GrantedMenuCodes(ctx, userID, role)
	if err != nil {
		return false
	}
	return iam.HasMenuCode(codes, "pos.cashier.central")
}

/* ── helpers ─────────────────────────────────────────────────────────── */

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// savepoint runs fn in a savepoint when q is a transaction (so an expected
// SQL error does not abort the caller's transaction), else directly.
func savepoint(ctx context.Context, q database.Querier, fn func(database.Querier) error) error {
	b, ok := q.(database.TxBeginner)
	if !ok {
		return fn(q)
	}
	return database.WithTx(ctx, b, func(tx pgx.Tx) error { return fn(tx) })
}

func isUUID(s string) bool {
	if len(s) != 36 {
		return false
	}
	for i, c := range strings.ToLower(s) {
		switch i {
		case 8, 13, 18, 23:
			if c != '-' {
				return false
			}
		default:
			if !(c >= '0' && c <= '9' || c >= 'a' && c <= 'f') {
				return false
			}
		}
	}
	return true
}
