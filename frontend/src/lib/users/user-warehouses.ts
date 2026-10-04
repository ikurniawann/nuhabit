import { query } from "@/lib/db";
import type { DbClient } from "@/lib/pg/types";

export type UserWarehouseRow = {
  id: string;
  warehouse_id: string;
  name: string;
  code: string;
  branch_id: string;
  is_default: boolean;
};

export async function loadUserWarehouses(userId: string): Promise<UserWarehouseRow[]> {
  try {
    return await query<UserWarehouseRow>(
      `SELECT uw.id,
              uw.warehouse_id,
              w.name,
              w.code,
              w.branch_id,
              w.is_default
       FROM configuration.user_warehouses uw
       INNER JOIN configuration.warehouses w ON w.id = uw.warehouse_id
       WHERE uw.user_id = $1
         AND uw.is_active = true
         AND w.is_active = true
       ORDER BY w.is_default DESC, w.name ASC`,
      [userId]
    );
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as { code?: string }).code === "42P01"
    ) {
      return [];
    }
    throw error;
  }
}

export async function loadUserWarehousesBatch(
  userIds: string[]
): Promise<Map<string, UserWarehouseRow[]>> {
  const map = new Map<string, UserWarehouseRow[]>();
  if (userIds.length === 0) return map;

  try {
    const rows = await query<UserWarehouseRow & { user_id: string }>(
      `SELECT uw.user_id,
              uw.id,
              uw.warehouse_id,
              w.name,
              w.code,
              w.branch_id,
              w.is_default
       FROM configuration.user_warehouses uw
       INNER JOIN configuration.warehouses w ON w.id = uw.warehouse_id
       WHERE uw.user_id = ANY($1::uuid[])
         AND uw.is_active = true
         AND w.is_active = true
       ORDER BY w.is_default DESC, w.name ASC`,
      [userIds]
    );

    for (const row of rows) {
      const list = map.get(row.user_id) ?? [];
      list.push({
        id: row.id,
        warehouse_id: row.warehouse_id,
        name: row.name,
        code: row.code,
        branch_id: row.branch_id,
        is_default: row.is_default,
      });
      map.set(row.user_id, list);
    }
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as { code?: string }).code === "42P01"
    ) {
      return map;
    }
    throw error;
  }

  return map;
}

export async function validateUserWarehouseIds(
  db: DbClient,
  warehouseIds: string[],
  branchId: string | null | undefined
): Promise<void> {
  if (warehouseIds.length === 0) return;
  if (!branchId) {
    throw new Error("Branch must be selected before choosing stalls");
  }

  const { data, error } = await db
    .from("warehouses", "configuration")
    .select("id, branch_id")
    .in("id", warehouseIds)
    .eq("is_active", true);

  if (error) throw error;

  const found = new Map(
    (data ?? []).map((row: { id: string; branch_id: string }) => [row.id, row.branch_id])
  );

  for (const warehouseId of warehouseIds) {
    const rowBranchId = found.get(warehouseId);
    if (!rowBranchId) {
      throw new Error("Stall not found or inactive");
    }
    if (rowBranchId !== branchId) {
      throw new Error("Stall must belong to the same branch as the user scope");
    }
  }
}

export async function syncUserWarehouses(
  db: DbClient,
  userId: string,
  warehouseIds: string[],
  branchId: string | null | undefined
): Promise<void> {
  await validateUserWarehouseIds(db, warehouseIds, branchId);

  const uniqueIds = [...new Set(warehouseIds)];

  await db
    .from("user_warehouses", "configuration")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("user_id", userId);

  if (uniqueIds.length === 0) return;

  const { error } = await db.from("user_warehouses", "configuration").upsert(
    uniqueIds.map((warehouseId) => ({
      user_id: userId,
      warehouse_id: warehouseId,
      is_active: true,
      updated_at: new Date().toISOString(),
    })),
    { onConflict: "user_id,warehouse_id" }
  );

  if (error) throw error;
}

export async function clearUserWarehouses(db: DbClient, userId: string): Promise<void> {
  await db
    .from("user_warehouses", "configuration")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("user_id", userId);
}

export { requiresStallAssignment } from "./stall-assignment";
