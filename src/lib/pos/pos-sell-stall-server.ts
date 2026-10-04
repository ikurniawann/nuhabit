import { query, queryOne } from "@/lib/db";
import type { UserRole } from "@/types";
import { resolveActiveStallFromCookies } from "@/lib/auth/active-stall";
import { getApiUserScope } from "@/lib/api/scope";
import { resolveRoleIds } from "@/lib/iam/get-user-menus";
import { hasIamMenuCode, loadGrantedMenuCodes } from "@/lib/iam/has-menu";
import { loadUserWarehouses } from "@/lib/users/user-warehouses";
import { isSellStallAllowed } from "@/lib/users/stall-assignment";
import { CENTRAL_CASHIER_MENU } from "@/lib/pos/central-cashier";
import {
  assertProductWarehousesMatchStall,
  resolvePosSellScope,
  resolvePosSellStall,
  type ActiveStallMode,
  type PosSellScopeResult,
  type PosSellStallResult,
} from "@/lib/pos/pos-sell-stall";

function isMissingColumnError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: string; message?: string };
  return (
    candidate.code === "42703" ||
    candidate.code === "PGRST204" ||
    /column .* does not exist/i.test(candidate.message ?? "")
  );
}

async function loadUserCentralFlags(userId: string): Promise<{
  can_central_checkout: boolean;
  can_switch_stall: boolean;
}> {
  try {
    const row = await queryOne<{
      can_central_checkout: boolean;
      can_switch_stall: boolean;
    }>(
      `SELECT COALESCE(can_central_checkout, false) AS can_central_checkout,
              COALESCE(can_switch_stall, false) AS can_switch_stall
       FROM configuration.users
       WHERE id = $1`,
      [userId]
    );
    return {
      can_central_checkout: row?.can_central_checkout === true,
      can_switch_stall: row?.can_switch_stall === true,
    };
  } catch (error) {
    if (!isMissingColumnError(error)) throw error;
    const row = await queryOne<{ can_switch_stall: boolean }>(
      `SELECT COALESCE(can_switch_stall, false) AS can_switch_stall
       FROM configuration.users
       WHERE id = $1`,
      [userId]
    );
    return {
      can_central_checkout: false,
      can_switch_stall: row?.can_switch_stall === true,
    };
  }
}

export async function loadCentralCashierGate(input: {
  userId: string;
  role: string | null;
}): Promise<{
  canCentralCheckout: boolean;
  hasCentralMenu: boolean;
  activeMode: ActiveStallMode;
}> {
  const [flags, active] = await Promise.all([
    loadUserCentralFlags(input.userId),
    resolveActiveStallFromCookies(),
  ]);

  let hasCentralMenu = false;
  try {
    const roleIds = await resolveRoleIds(input.userId, (input.role ?? "") as UserRole);
    hasCentralMenu = hasIamMenuCode(
      await loadGrantedMenuCodes(roleIds),
      CENTRAL_CASHIER_MENU
    );
  } catch {
    hasCentralMenu = false;
  }

  return {
    canCentralCheckout: flags.can_central_checkout,
    hasCentralMenu,
    activeMode: active.mode,
  };
}

export async function resolvePosSellStallForUser(
  userId: string
): Promise<PosSellStallResult> {
  const [warehouses, activeStall, scope, flags] = await Promise.all([
    loadUserWarehouses(userId),
    resolveActiveStallFromCookies(),
    getApiUserScope(),
    queryOne<{ can_switch_stall: boolean; default_warehouse_id: string | null }>(
      `SELECT COALESCE(can_switch_stall, false) AS can_switch_stall,
              default_warehouse_id
       FROM configuration.users
       WHERE id = $1`,
      [userId]
    ),
  ]);

  const assignedIds = warehouses.map((row) => row.warehouse_id);
  const isUnscoped = !scope || scope.isUnscoped || scope.role === "super_admin";
  const canSwitchStall = flags?.can_switch_stall === true;

  let activeMode = activeStall.mode;
  const activeStallId: string | null =
    activeStall.mode === "stall" ? activeStall.stall.id : null;

  if (activeStall.mode === "unset" && assignedIds.length === 0 && isUnscoped) {
    activeMode = "all";
  }

  const resolved = resolvePosSellStall({
    activeMode,
    activeStallId,
    assignedWarehouseIds: assignedIds,
    defaultWarehouseId: flags?.default_warehouse_id ?? assignedIds[0] ?? null,
  });

  if (!resolved.ok) return resolved;

  if (
    !isSellStallAllowed({
      warehouseId: resolved.warehouseId,
      assignedIds,
      canSwitchStall,
      isUnscoped,
      defaultWarehouseId: flags?.default_warehouse_id ?? null,
    })
  ) {
    return {
      ok: false,
      reason: "no_stall",
      message: "Stall aktif di luar penempatan Anda",
    };
  }

  return resolved;
}

export async function resolvePosSellScopeForUser(
  userId: string
): Promise<PosSellScopeResult> {
  const [warehouses, activeStall, scope, flags] = await Promise.all([
    loadUserWarehouses(userId),
    resolveActiveStallFromCookies(),
    getApiUserScope(),
    queryOne<{ can_switch_stall: boolean; default_warehouse_id: string | null }>(
      `SELECT COALESCE(can_switch_stall, false) AS can_switch_stall,
              default_warehouse_id
       FROM configuration.users
       WHERE id = $1`,
      [userId]
    ),
  ]);

  const assignedIds = warehouses.map((row) => row.warehouse_id);
  const isUnscoped = !scope || scope.isUnscoped || scope.role === "super_admin";

  const resolved = resolvePosSellScope({
    activeMode: activeStall.mode,
    activeStallId: activeStall.mode === "stall" ? activeStall.stall.id : null,
    assignedWarehouseIds: assignedIds,
    defaultWarehouseId: flags?.default_warehouse_id ?? assignedIds[0] ?? null,
    allStallsAllowed: isUnscoped,
  });

  if (resolved.mode !== "stall") return resolved;

  if (
    !isSellStallAllowed({
      warehouseId: resolved.warehouseId,
      assignedIds,
      canSwitchStall: flags?.can_switch_stall === true,
      isUnscoped,
      defaultWarehouseId: flags?.default_warehouse_id ?? null,
    })
  ) {
    return {
      mode: "blocked",
      reason: "no_stall",
      message: "Stall aktif di luar penempatan Anda",
    };
  }

  return resolved;
}

export type PosProductWarehouse = {
  warehouse_id: string | null;
  warehouse_name: string | null;
};

export interface PosProductStallInfo {
  warehouse_id: string | null;
  stall_code: string | null;
  stall_name: string | null;
}

/** Map POS product ids → purchasing warehouse_id + name (null if unlinked). */
export async function loadPosProductWarehouses(
  productIds: string[]
): Promise<Map<string, PosProductWarehouse>> {
  const map = new Map<string, PosProductWarehouse>();
  const ids = [...new Set(productIds.filter(Boolean))];
  if (ids.length === 0) return map;

  const rows = await query<{
    id: string;
    warehouse_id: string | null;
    warehouse_name: string | null;
  }>(
    `SELECT pp.id,
            COALESCE(
              p.warehouse_id,
              p_sku.warehouse_id
            ) AS warehouse_id,
            COALESCE(w.name, w_sku.name) AS warehouse_name
     FROM pos.pos_products pp
     LEFT JOIN item.products p ON p.id = pp.source_product_id AND p.deleted_at IS NULL
     LEFT JOIN configuration.warehouses w ON w.id = p.warehouse_id
     LEFT JOIN item.products p_sku
       ON pp.source_product_id IS NULL
      AND pp.sku = ('PUR-' || p_sku.kode)
      AND p_sku.deleted_at IS NULL
      AND p_sku.kode IS NOT NULL
      AND btrim(p_sku.kode) <> ''
     LEFT JOIN configuration.warehouses w_sku ON w_sku.id = p_sku.warehouse_id
     WHERE pp.id = ANY($1::uuid[])`,
    [ids]
  );

  for (const row of rows) {
    map.set(row.id, {
      warehouse_id: row.warehouse_id,
      warehouse_name: row.warehouse_name,
    });
  }
  for (const id of ids) {
    if (!map.has(id)) map.set(id, { warehouse_id: null, warehouse_name: null });
  }
  return map;
}

/** Map POS product ids → stall (warehouse) + nama utk badge katalog/struk. */
export async function loadPosProductStallInfo(
  productIds: string[]
): Promise<Map<string, PosProductStallInfo>> {
  const map = new Map<string, PosProductStallInfo>();
  const ids = [...new Set(productIds.filter(Boolean))];
  if (ids.length === 0) return map;

  const rows = await query<{
    id: string;
    warehouse_id: string | null;
    stall_code: string | null;
    stall_name: string | null;
  }>(
    `SELECT pp.id,
            COALESCE(p.warehouse_id, p_sku.warehouse_id) AS warehouse_id,
            COALESCE(w.code, w_sku.code) AS stall_code,
            COALESCE(w.name, w_sku.name) AS stall_name
     FROM pos.pos_products pp
     LEFT JOIN item.products p ON p.id = pp.source_product_id AND p.deleted_at IS NULL
     LEFT JOIN configuration.warehouses w ON w.id = p.warehouse_id
     LEFT JOIN item.products p_sku
       ON pp.source_product_id IS NULL
      AND pp.sku = ('PUR-' || p_sku.kode)
      AND p_sku.deleted_at IS NULL
      AND p_sku.kode IS NOT NULL
      AND btrim(p_sku.kode) <> ''
     LEFT JOIN configuration.warehouses w_sku ON w_sku.id = p_sku.warehouse_id
     WHERE pp.id = ANY($1::uuid[])`,
    [ids]
  );

  for (const row of rows) {
    map.set(row.id, {
      warehouse_id: row.warehouse_id,
      stall_code: row.stall_code,
      stall_name: row.stall_name,
    });
  }
  return map;
}

/** Map POS product ids → purchasing warehouse_id (null if unlinked). */
export async function loadPosProductWarehouseIds(
  productIds: string[]
): Promise<Map<string, string | null>> {
  const warehouses = await loadPosProductWarehouses(productIds);
  const map = new Map<string, string | null>();
  for (const [id, row] of warehouses) {
    map.set(id, row.warehouse_id);
  }
  return map;
}

export async function assertOrderItemsMatchSellStall(
  productIds: string[],
  stallId: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  const warehouseByProduct = await loadPosProductWarehouseIds(productIds);
  const warehouseIds = productIds.map((id) => warehouseByProduct.get(id) ?? null);
  return assertProductWarehousesMatchStall(warehouseIds, stallId);
}
