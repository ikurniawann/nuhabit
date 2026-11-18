import { cache } from "react";
import type { UserRole } from "@/types";
import { loadEmployeeBaseline } from "@/lib/iam/employee-baseline";
import { resolveRoleIds } from "@/lib/iam/get-user-menus";
import { cachedGrant } from "@/lib/iam/grant-cache";
import { iamDbQuery } from "@/lib/iam/pg-client";
import {
  hasAnyIamMenuPrefix,
  hasGrantedAction,
  hasIamMenuCode,
} from "@/lib/iam/match";

export { hasAnyIamMenuPrefix, hasGrantedAction, hasIamMenuCode };

export async function loadGrantedMenuCodes(roleIds: string[]): Promise<string[]> {
  if (roleIds.length === 0) return [];
  const rows = await iamDbQuery<{ code: string }>(
    `SELECT DISTINCT m.code
     FROM iam.role_menu_permissions rmp
     JOIN iam.menus m ON m.id = rmp.menu_id
     WHERE rmp.role_id = ANY($1::uuid[])
       AND rmp.is_active = true
       AND m.deleted_at IS NULL
       AND m.is_active = true`,
    [roleIds]
  );
  return rows.map((row) => row.code);
}

function parseGrantedActions(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  return [];
}

export async function loadGrantedMenuActions(
  roleIds: string[]
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  if (roleIds.length === 0) return map;

  const rows = await iamDbQuery<{ code: string; granted_actions: unknown }>(
    `SELECT m.code, rmp.granted_actions
     FROM iam.role_menu_permissions rmp
     JOIN iam.menus m ON m.id = rmp.menu_id
     WHERE rmp.role_id = ANY($1::uuid[])
       AND rmp.is_active = true
       AND m.deleted_at IS NULL
       AND m.is_active = true`,
    [roleIds]
  );

  for (const row of rows) {
    const next = parseGrantedActions(row.granted_actions);
    const current = map.get(row.code) ?? [];
    map.set(row.code, [...new Set([...current, ...next])]);
  }
  return map;
}

/**
 * granted_actions per kode menu: grant role ditambah baseline karyawan (Area
 * Karyawan, Tugas Saya). Di-cache di Redis bersama API Go (lihat grant-cache).
 */
export const loadGrantedMenuActionsForUser = cache(
  (userId: string, role: UserRole): Promise<Record<string, string[]>> =>
    cachedGrant(`${userId}:${role}`, async () => {
      const roleIds = await resolveRoleIds(userId, role);
      const [granted, baseline] = await Promise.all([loadGrantedMenuActions(roleIds), loadEmployeeBaseline(userId)]);
      for (const menu of baseline) {
        granted.set(menu.code, [...new Set([...(granted.get(menu.code) ?? []), ...menu.actions])]);
      }
      return Object.fromEntries(granted);
    })
);

/** Kode menu milik user: kunci dari loadGrantedMenuActionsForUser. */
export async function loadGrantedMenuCodesForUser(userId: string, role: UserRole): Promise<string[]> {
  return Object.keys(await loadGrantedMenuActionsForUser(userId, role));
}

export async function userHasIamPrefix(
  userId: string,
  role: UserRole,
  prefixes: readonly string[]
): Promise<boolean> {
  const granted = await loadGrantedMenuCodesForUser(userId, role);
  return hasAnyIamMenuPrefix(granted, prefixes);
}

export async function userHasIamAction(
  userId: string,
  role: UserRole,
  prefixes: readonly string[],
  action: string
): Promise<boolean> {
  const granted = await loadGrantedMenuActionsForUser(userId, role);
  return hasGrantedAction(new Map(Object.entries(granted)), prefixes, action);
}
