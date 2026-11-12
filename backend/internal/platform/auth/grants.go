package auth

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5"

	"nuhabit/backend/internal/platform/iam"
)

// ResolveRoleIDs mirrors resolveRoleIds: iam.user_roles rows, else the
// iam.roles row whose code is configuration.users.role. There is no
// super_admin shortcut in the API guards; super_admin passes because its
// role is granted every menu.
func (s *Service) ResolveRoleIDs(ctx context.Context, userID, role string) ([]string, error) {
	ids, err := s.queryStrings(ctx, `SELECT role_id::text FROM iam.user_roles WHERE user_id = $1`, userID)
	if err != nil {
		return nil, err
	}
	if len(ids) > 0 {
		return ids, nil
	}
	var id string
	err = s.db.QueryRow(ctx, `SELECT id::text FROM iam.roles WHERE code = $1 AND deleted_at IS NULL LIMIT 1`, role).Scan(&id)
	if isNoRows(err) {
		return []string{}, nil
	}
	if err != nil {
		return nil, err
	}
	return []string{id}, nil
}

// GrantedMenuCodes mirrors loadGrantedMenuCodesForUser: the role grants plus
// the employee baseline.
func (s *Service) GrantedMenuCodes(ctx context.Context, userID, role string) ([]string, error) {
	roleIDs, err := s.ResolveRoleIDs(ctx, userID, role)
	if err != nil {
		return nil, err
	}
	codes, err := s.GrantedMenuCodesForRoles(ctx, roleIDs)
	if err != nil {
		return nil, err
	}
	baseline, err := s.employeeBaseline(ctx, userID)
	if err != nil {
		return nil, err
	}
	for code := range baseline {
		codes = mergeUnique(codes, []string{code})
	}
	return codes, nil
}

// UserMenuActions mirrors loadGrantedMenuActionsForUser: the role grants plus
// the employee baseline.
func (s *Service) UserMenuActions(ctx context.Context, userID, role string) (map[string][]string, error) {
	roleIDs, err := s.ResolveRoleIDs(ctx, userID, role)
	if err != nil {
		return nil, err
	}
	granted, err := s.GrantedMenuActions(ctx, roleIDs)
	if err != nil {
		return nil, err
	}
	baseline, err := s.employeeBaseline(ctx, userID)
	if err != nil {
		return nil, err
	}
	for code, actions := range baseline {
		granted[code] = mergeUnique(granted[code], actions)
	}
	return granted, nil
}

// employeeBaselineSQL mirrors EMPLOYEE_BASELINE_SQL in
// frontend/src/lib/iam/employee-baseline.ts: an account linked to an active
// employee gets iam.EmployeeBaseline, and iam.SupervisorBaseline when an
// active employee reports to it, with each menu's own actions.
const employeeBaselineSQL = `SELECT DISTINCT m.code, COALESCE(m.permission_context->'actions', '["read"]'::jsonb)
     FROM iam.menus m
     JOIN hris.employees e ON e.user_id = $1 AND e.is_active
    WHERE m.deleted_at IS NULL AND m.is_active
      AND (m.code = ANY($2)
        OR (m.code = ANY($3) AND EXISTS (
          SELECT 1 FROM hris.employees r WHERE r.reporting_to = e.id AND r.is_active)))`

func (s *Service) employeeBaseline(ctx context.Context, userID string) (map[string][]string, error) {
	out := map[string][]string{}
	rows, err := s.db.Query(ctx, employeeBaselineSQL, userID, iam.EmployeeBaseline, iam.SupervisorBaseline)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var code string
		var raw []byte
		if err := rows.Scan(&code, &raw); err != nil {
			return nil, err
		}
		out[code] = mergeUnique(out[code], parseGrantedActions(raw))
	}
	return out, rows.Err()
}

// GrantedMenuCodesForRoles mirrors loadGrantedMenuCodes.
func (s *Service) GrantedMenuCodesForRoles(ctx context.Context, roleIDs []string) ([]string, error) {
	if len(roleIDs) == 0 {
		return []string{}, nil
	}
	return s.queryStrings(ctx, `SELECT DISTINCT m.code
     FROM iam.role_menu_permissions rmp
     JOIN iam.menus m ON m.id = rmp.menu_id
     WHERE rmp.role_id = ANY($1::uuid[])
       AND rmp.is_active = true
       AND m.deleted_at IS NULL
       AND m.is_active = true`, roleIDs)
}

// queryStrings runs a one-column text query; no rows is an empty slice.
func (s *Service) queryStrings(ctx context.Context, sql string, args ...any) ([]string, error) {
	rows, err := s.db.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[string])
}

// GrantedMenuActions mirrors loadGrantedMenuActions: menu code to the union
// of granted_actions strings across the roles.
func (s *Service) GrantedMenuActions(ctx context.Context, roleIDs []string) (map[string][]string, error) {
	out := map[string][]string{}
	if len(roleIDs) == 0 {
		return out, nil
	}
	rows, err := s.db.Query(ctx, `SELECT m.code, rmp.granted_actions
     FROM iam.role_menu_permissions rmp
     JOIN iam.menus m ON m.id = rmp.menu_id
     WHERE rmp.role_id = ANY($1::uuid[])
       AND rmp.is_active = true
       AND m.deleted_at IS NULL
       AND m.is_active = true`, roleIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var code string
		var raw []byte
		if err := rows.Scan(&code, &raw); err != nil {
			return nil, err
		}
		out[code] = mergeUnique(out[code], parseGrantedActions(raw))
	}
	return out, rows.Err()
}

// parseGrantedActions keeps the string items of a JSON array; anything
// else is an empty list.
func parseGrantedActions(raw []byte) []string {
	var items []any
	if err := json.Unmarshal(raw, &items); err != nil {
		return nil
	}
	var out []string
	for _, it := range items {
		if s, ok := it.(string); ok {
			out = append(out, s)
		}
	}
	return out
}

func mergeUnique(current, next []string) []string {
	seen := make(map[string]bool, len(current)+len(next))
	out := make([]string, 0, len(current)+len(next))
	for _, v := range append(append([]string{}, current...), next...) {
		if !seen[v] {
			seen[v] = true
			out = append(out, v)
		}
	}
	return out
}
