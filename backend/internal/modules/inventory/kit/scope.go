package kit

import (
	"context"
	"net/http"
	ps "nuhabit/backend/internal/platform/scope"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"nuhabit/backend/internal/platform/database"
)

// Deref returns *p or "".
func Deref(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// ScopeFilters appends the companyScopeOr/branchScopeOr conditions on the
// given column prefix ("" or "alias.") to where.
func ScopeFilters(s *ps.Scope, prefix string, a *Args, where []string) []string {
	if c := ps.CompanyFilter(s); c != nil {
		where = append(where, prefix+"company_id = "+a.Add(*c))
	}
	if b := ps.BranchFilter(s); b != nil {
		where = append(where, prefix+"branch_id = "+a.Add(*b))
	}
	return where
}

// WarehouseError is a validateWarehouseForReceivingScope failure.
type WarehouseError string

const (
	WarehouseNotFound       WarehouseError = "not_found"
	WarehouseInactive       WarehouseError = "inactive"
	WarehouseBranchMismatch WarehouseError = "branch_mismatch"
)

// ValidateWarehouse is validateWarehouseForReceivingScope; it returns the
// warehouse branch_id, or the failure.
func ValidateWarehouse(ctx context.Context, q database.Querier, warehouseID string, s *ps.Scope, contextBranchID *string) (string, WarehouseError, error) {
	expectedBranch := Deref(ps.WarehouseBranchFilter(s, contextBranchID))
	expectedCompany := Deref(ps.WarehouseCompanyFilter(s))
	row, err := QueryOne(ctx, q, `SELECT w.id, w.branch_id, w.is_active, b.company_id
		FROM configuration.warehouses w
		LEFT JOIN configuration.branches b ON b.id = w.branch_id
		WHERE w.id = $1`, warehouseID)
	if err != nil {
		return "", "", err
	}
	if row == nil {
		return "", WarehouseNotFound, nil
	}
	if !row.Bool("is_active") {
		return "", WarehouseInactive, nil
	}
	if expectedBranch != "" && row.Str("branch_id") != expectedBranch {
		return "", WarehouseBranchMismatch, nil
	}
	if expectedCompany != "" && row.Str("company_id") != expectedCompany {
		return "", WarehouseBranchMismatch, nil
	}
	return row.Str("branch_id"), "", nil
}

var warehouseScopeErrors = map[WarehouseError]string{
	WarehouseNotFound:       "Stall not found",
	WarehouseInactive:       "Stall is inactive",
	WarehouseBranchMismatch: "Stall is outside your branch scope",
}

// ProductWarehouse is the business scope of a stall for product masters.
type ProductWarehouse struct {
	CompanyID, BranchID, WarehouseID string
}

// ValidateProductWarehouse is validateProductWarehouseScope; msg is the TS
// error string when the stall is not usable.
func ValidateProductWarehouse(ctx context.Context, q database.Querier, warehouseID string, s *ps.Scope) (*ProductWarehouse, string, error) {
	biz, err := QueryOne(ctx, q, `SELECT c.id AS company_id, b.id AS branch_id
		FROM configuration.warehouses w
		JOIN configuration.branches b ON b.id = w.branch_id
		JOIN configuration.companies c ON c.id = b.company_id
		WHERE w.id = $1 AND w.is_active = true AND b.is_active = true AND c.is_active = true`, warehouseID)
	if err != nil {
		return nil, "", err
	}
	if biz == nil {
		return nil, "Stall not found or inactive", nil
	}
	branchID := biz.Str("branch_id")
	_, werr, err := ValidateWarehouse(ctx, q, warehouseID, s, &branchID)
	if err != nil {
		return nil, "", err
	}
	if werr != "" {
		return nil, warehouseScopeErrors[werr], nil
	}
	if c := ps.WarehouseCompanyFilter(s); c != nil && biz.Str("company_id") != *c {
		return nil, "Stall is outside your company scope", nil
	}
	return &ProductWarehouse{CompanyID: biz.Str("company_id"), BranchID: branchID, WarehouseID: warehouseID}, "", nil
}

/* ── active stall (frontend/src/lib/api/stall-scope.ts) ─────────────────── */

// Active stall cookies (frontend/src/lib/auth/active-stall.ts).
const (
	ActiveStallCookie       = "nuhabit-active-stall"
	LegacyActiveStallCookie = "arkiv-active-stall"
)

var stallUUID = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

func activeStallCookie(r *http.Request) string {
	for _, name := range []string{ActiveStallCookie, LegacyActiveStallCookie} {
		if c, err := r.Cookie(name); err == nil {
			if v := strings.TrimSpace(c.Value); v != "" {
				return v
			}
		}
	}
	return ""
}

type stallOption struct {
	id, name, code string
	isDefault      bool
}

// ActiveStall is getApiStallScope: the sidebar's active stall id, or "" for
// "Semua Stall". It follows getUser's resolution: the cookie when it names a
// stall the user may switch to, "all" only with free access, otherwise the
// user's home stall.
func ActiveStall(ctx context.Context, q database.Querier, r *http.Request, userID string) (string, error) {
	var role, defaultWarehouse, branchID *string
	var canSwitch bool
	err := q.QueryRow(ctx, `SELECT role, COALESCE(can_switch_stall, false), default_warehouse_id::text, branch_id::text
		FROM configuration.users WHERE id = $1`, userID).Scan(&role, &canSwitch, &defaultWarehouse, &branchID)
	if database.IsNoRows(err) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	warehouses, err := Query(ctx, q, `SELECT uw.warehouse_id::text AS warehouse_id, w.name, w.code, w.is_default
		FROM configuration.user_warehouses uw
		INNER JOIN configuration.warehouses w ON w.id = uw.warehouse_id
		WHERE uw.user_id = $1 AND uw.is_active = true AND w.is_active = true
		ORDER BY w.is_default DESC, w.name ASC`, userID)
	if err != nil && !database.IsUndefinedTable(err) {
		return "", err
	}
	home := ""
	for _, w := range warehouses {
		if defaultWarehouse != nil && w.Str("warehouse_id") == *defaultWarehouse {
			home = w.Str("warehouse_id")
			break
		}
	}
	if home == "" && len(warehouses) > 0 {
		home = warehouses[0].Str("warehouse_id")
	}

	roleName := Deref(role)
	allAccess := roleName == "super_admin" || canSwitch
	if !allAccess {
		for _, w := range warehouses {
			if w.Bool("is_default") {
				allAccess = true
				break
			}
		}
	}
	allowed := map[string]bool{}
	stallCount := 0
	if allAccess {
		args := []any{}
		where := "w.is_active"
		if branchID != nil {
			args = append(args, *branchID)
			where += " AND w.branch_id = $1"
		}
		rows, err := Query(ctx, q, `SELECT w.id FROM configuration.warehouses w WHERE `+where, args...)
		if err != nil {
			return "", err
		}
		for _, w := range rows {
			allowed[w.Str("id")] = true
		}
		stallCount = len(rows)
	} else {
		for _, w := range warehouses {
			allowed[w.Str("warehouse_id")] = true
		}
		stallCount = len(warehouses)
	}
	canSwitchStall := roleName == "super_admin" || roleName == "admin" || canSwitch || allAccess || stallCount > 1
	if !canSwitchStall {
		return home, nil
	}

	cookie := activeStallCookie(r)
	if cookie == "all" {
		if allAccess {
			return "", nil
		}
		return home, nil
	}
	if cookie != "" && stallUUID.MatchString(cookie) {
		var active bool
		err := q.QueryRow(ctx, `SELECT true FROM configuration.warehouses WHERE id = $1 AND is_active = true`, cookie).Scan(&active)
		if err != nil && !database.IsNoRows(err) {
			return "", err
		}
		if active && allowed[cookie] {
			return cookie, nil
		}
	}
	return home, nil
}

// ResolveWarehouseFilter is resolveWarehouseFilter: the explicit value wins,
// else the active stall ("" = all stalls).
func ResolveWarehouseFilter(ctx context.Context, q database.Querier, r *http.Request, userID, explicit string) (string, error) {
	if explicit != "" {
		return explicit, nil
	}
	return ActiveStall(ctx, q, r, userID)
}

// StockSource is rawMaterialStockSource: the per-warehouse view when a stall
// is active, else the aggregate view.
type StockSource struct {
	View        string
	WarehouseID string
}

// RawMaterialStockSource resolves the stock view for the active stall.
func RawMaterialStockSource(ctx context.Context, q database.Querier, r *http.Request, userID string) (StockSource, error) {
	w, err := ActiveStall(ctx, q, r, userID)
	if err != nil {
		return StockSource{}, err
	}
	if w != "" {
		return StockSource{View: "v_raw_materials_stock_by_warehouse", WarehouseID: w}, nil
	}
	return StockSource{View: "v_raw_materials_stock"}, nil
}

/* ── warehouses ordering (frontend/src/lib/configuration/sort-warehouses.ts) */

var stallCodeNum = regexp.MustCompile(`^STALL-0*(\d+)$`)

func stallNumber(code string) (int, bool) {
	m := stallCodeNum.FindStringSubmatch(strings.ToUpper(strings.TrimSpace(code)))
	if m == nil {
		return 0, false
	}
	n, err := strconv.Atoi(m[1])
	return n, err == nil
}

// CompareWarehouses is compareWarehouses (default first, MAIN, then stalls
// numerically). Locale comparison is approximated case-insensitively with
// numeric runs compared by value.
func CompareWarehouses(aDefault bool, aCode, aName string, bDefault bool, bCode, bName string) int {
	if aDefault != bDefault {
		if aDefault {
			return -1
		}
		return 1
	}
	an, aStall := stallNumber(aCode)
	bn, bStall := stallNumber(bCode)
	switch {
	case aStall && bStall:
		return an - bn
	case aStall:
		return 1
	case bStall:
		return -1
	}
	if strings.ToUpper(aCode) == "MAIN" {
		return -1
	}
	if strings.ToUpper(bCode) == "MAIN" {
		return 1
	}
	if c := naturalCompare(aCode, bCode); c != 0 {
		return c
	}
	return naturalCompare(aName, bName)
}

// SortWarehouses sorts rows with id/code/name/is_default columns.
func SortWarehouses(rows Rows) {
	sort.SliceStable(rows, func(i, j int) bool {
		a, b := rows[i], rows[j]
		return CompareWarehouses(a.Bool("is_default"), a.Str("code"), a.Str("name"), b.Bool("is_default"), b.Str("code"), b.Str("name")) < 0
	})
}

// naturalCompare approximates localeCompare(..., {numeric: true,
// sensitivity: "base"}).
func naturalCompare(a, b string) int {
	a, b = strings.ToLower(a), strings.ToLower(b)
	for a != "" && b != "" {
		ad, bd := isDigit(a[0]), isDigit(b[0])
		if ad && bd {
			ai, bi := digitRun(a), digitRun(b)
			an, _ := strconv.ParseFloat(a[:ai], 64)
			bn, _ := strconv.ParseFloat(b[:bi], 64)
			if an != bn {
				if an < bn {
					return -1
				}
				return 1
			}
			a, b = a[ai:], b[bi:]
			continue
		}
		if a[0] != b[0] {
			if a[0] < b[0] {
				return -1
			}
			return 1
		}
		a, b = a[1:], b[1:]
	}
	switch {
	case a == "" && b == "":
		return 0
	case a == "":
		return -1
	}
	return 1
}

func isDigit(c byte) bool { return c >= '0' && c <= '9' }

func digitRun(s string) int {
	i := 0
	for i < len(s) && isDigit(s[i]) {
		i++
	}
	return i
}
