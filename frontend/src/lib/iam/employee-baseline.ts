import { cache } from "react";
import { iamDbQuery } from "./pg-client";
import { IAM } from "./prefixes";

/**
 * Mirrors employeeBaselineSQL in backend/internal/platform/auth/grants.go: an
 * account linked to an active employee gets IAM.employeeBaseline, and
 * IAM.supervisorBaseline when an active employee reports to it, with each
 * menu's own actions.
 */
const EMPLOYEE_BASELINE_SQL = `SELECT DISTINCT m.id, m.code, COALESCE(m.permission_context->'actions', '["read"]'::jsonb) AS actions
     FROM iam.menus m
     JOIN hris.employees e ON e.user_id = $1 AND e.is_active
    WHERE m.deleted_at IS NULL AND m.is_active
      AND (m.code = ANY($2)
        OR (m.code = ANY($3) AND EXISTS (
          SELECT 1 FROM hris.employees r WHERE r.reporting_to = e.id AND r.is_active)))`;

export type BaselineMenu = { id: string; code: string; actions: string[] };

/** The menus this user holds as an employee, whatever their roles grant. */
export const loadEmployeeBaseline = cache(async (userId: string): Promise<BaselineMenu[]> => {
  const rows = await iamDbQuery<{ id: string; code: string; actions: unknown }>(EMPLOYEE_BASELINE_SQL, [
    userId,
    [...IAM.employeeBaseline],
    [...IAM.supervisorBaseline],
  ]);
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    actions: Array.isArray(row.actions) ? row.actions.filter((a): a is string => typeof a === "string") : [],
  }));
});
