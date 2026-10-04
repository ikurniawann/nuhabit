// Package stall resolves the sidebar's active stall (warehouse):
// frontend/src/lib/auth/active-stall.ts and the active_stall_id that
// getUser (lib/auth/require-user.ts) derives from it.
package stall

import (
	"context"
	"net/http"
	"regexp"
	"strings"

	"nuhabit/backend/internal/platform/database"
)

// Active stall cookies: the legacy name is still read, never written.
const (
	CookieName       = "nuhabit-active-stall"
	LegacyCookieName = "arkiv-active-stall"
	// All is the cookie value for "Semua Stall".
	All = "all"
)

var stallUUID = regexp.MustCompile(`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

// Cookie is readActiveStallCookie: the trimmed new cookie, else the legacy
// one, "" when neither is set.
func Cookie(r *http.Request) string {
	for _, name := range []string{CookieName, LegacyCookieName} {
		if c, err := r.Cookie(name); err == nil {
			if v := strings.TrimSpace(c.Value); v != "" {
				return v
			}
		}
	}
	return ""
}

// Active is getUser().active_stall_id: the active stall id, or "" for
// "Semua Stall". The cookie wins when it names an active stall the user may
// switch to, "all" only with free access; otherwise the user's home stall.
func Active(ctx context.Context, q database.Querier, r *http.Request, userID string) (string, error) {
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
	assigned, err := assignedStalls(ctx, q, userID)
	if err != nil {
		return "", err
	}
	home := ""
	for _, w := range assigned {
		if defaultWarehouse != nil && w.id == *defaultWarehouse {
			home = w.id
			break
		}
	}
	if home == "" && len(assigned) > 0 {
		home = assigned[0].id
	}

	roleName := ""
	if role != nil {
		roleName = *role
	}
	allAccess := roleName == "super_admin" || canSwitch
	for _, w := range assigned {
		allAccess = allAccess || w.isDefault
	}
	allowed := map[string]bool{}
	stallCount := len(assigned)
	if allAccess {
		ids, err := branchStalls(ctx, q, branchID)
		if err != nil {
			return "", err
		}
		for _, id := range ids {
			allowed[id] = true
		}
		stallCount = len(ids)
	} else {
		for _, w := range assigned {
			allowed[w.id] = true
		}
	}
	canSwitchStall := roleName == "super_admin" || roleName == "admin" || canSwitch || allAccess || stallCount > 1
	if !canSwitchStall {
		return home, nil
	}

	cookie := Cookie(r)
	if cookie == All {
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

type assignedStall struct {
	id        string
	isDefault bool
}

// assignedStalls lists the user's active stall placements, default first
// (an install without user_warehouses has none).
func assignedStalls(ctx context.Context, q database.Querier, userID string) ([]assignedStall, error) {
	rows, err := q.Query(ctx, `SELECT uw.warehouse_id::text, COALESCE(w.is_default, false)
		FROM configuration.user_warehouses uw
		INNER JOIN configuration.warehouses w ON w.id = uw.warehouse_id
		WHERE uw.user_id = $1 AND uw.is_active = true AND w.is_active = true
		ORDER BY w.is_default DESC, w.name ASC`, userID)
	if database.IsUndefinedTable(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []assignedStall
	for rows.Next() {
		var s assignedStall
		if err := rows.Scan(&s.id, &s.isDefault); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	if database.IsUndefinedTable(rows.Err()) {
		return nil, nil
	}
	return out, rows.Err()
}

// branchStalls lists the active stalls of the user's branch, every active
// stall when the user has none.
func branchStalls(ctx context.Context, q database.Querier, branchID *string) ([]string, error) {
	sql, args := `SELECT id::text FROM configuration.warehouses w WHERE w.is_active`, []any{}
	if branchID != nil {
		sql, args = sql+` AND w.branch_id = $1`, append(args, *branchID)
	}
	rows, err := q.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}
