/**
 * Resolve which single stall a POS cashier may sell from.
 * "Semua Stall" and multi-assignment without an explicit active stall are not sellable.
 */

export type ActiveStallMode = "unset" | "all" | "stall";

export type PosSellStallInput = {
  activeMode: ActiveStallMode;
  activeStallId: string | null;
  assignedWarehouseIds: string[];
  defaultWarehouseId?: string | null;
};

export type PosSellStallResult =
  | { ok: true; warehouseId: string }
  | {
      ok: false;
      reason: "all_stalls" | "no_stall" | "multiple_unselected";
      message: string;
    };

const MESSAGES = {
  all_stalls: "Pilih satu stall aktif sebelum membuat transaksi POS",
  no_stall: "Tidak ada stall penempatan. Hubungi admin untuk assign stall",
  multiple_unselected: "Pilih satu stall aktif sebelum membuat transaksi POS",
} as const;

export function resolvePosSellStall(input: PosSellStallInput): PosSellStallResult {
  const assigned = [...new Set(input.assignedWarehouseIds.filter(Boolean))];

  if (input.activeMode === "stall" && input.activeStallId) {
    return { ok: true, warehouseId: input.activeStallId };
  }

  if (input.activeMode === "all") {
    return { ok: false, reason: "all_stalls", message: MESSAGES.all_stalls };
  }

  // unset (or invalid stall cookie cleared by caller)
  if (input.defaultWarehouseId) {
    return { ok: true, warehouseId: input.defaultWarehouseId };
  }
  if (assigned.length === 1) {
    return { ok: true, warehouseId: assigned[0] };
  }
  if (assigned.length === 0) {
    return { ok: false, reason: "no_stall", message: MESSAGES.no_stall };
  }
  return {
    ok: false,
    reason: "multiple_unselected",
    message: MESSAGES.multiple_unselected,
  };
}

export type PosSellScopeInput = PosSellStallInput & {
  /** true = user boleh berjualan mode "Semua Stall" (akses penuh). */
  allStallsAllowed: boolean;
};

export type PosSellScopeResult =
  | { mode: "stall"; warehouseId: string }
  | { mode: "all" }
  | { mode: "blocked"; reason: "all_stalls" | "no_stall" | "multiple_unselected"; message: string };

/**
 * Mode jual "Semua Stall" (owner 2026-08-16): satu transaksi boleh berisi
 * produk lintas stall untuk user ber-akses penuh. Cookie stall tertentu
 * tetap menang; tanpa izin, perilaku lama (wajib satu stall) dipertahankan.
 */
export function resolvePosSellScope(input: PosSellScopeInput): PosSellScopeResult {
  if (input.allStallsAllowed) {
    if (input.activeMode === "all") return { mode: "all" };
    if (
      input.activeMode === "unset" &&
      !input.defaultWarehouseId &&
      [...new Set(input.assignedWarehouseIds.filter(Boolean))].length === 0
    ) {
      return { mode: "all" };
    }
  }

  const single = resolvePosSellStall(input);
  if (single.ok) return { mode: "stall", warehouseId: single.warehouseId };
  return { mode: "blocked", reason: single.reason, message: single.message };
}

/** localStorage key used by usePosCart — keep in sync. */
export const POS_CART_STORAGE_KEY = "pos_cart_state";

export function posCartHasItems(raw: string | null | undefined): boolean {
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as { items?: unknown };
    return Array.isArray(parsed.items) && parsed.items.length > 0;
  } catch {
    return false;
  }
}

export function assertProductWarehousesMatchStall(
  productWarehouseIds: Array<string | null | undefined>,
  stallId: string
): { ok: true } | { ok: false; message: string } {
  for (const wid of productWarehouseIds) {
    if (!wid) {
      return {
        ok: false,
        message: "Ada produk tanpa stall — tidak bisa digabung ke transaksi stall ini",
      };
    }
    if (wid !== stallId) {
      return {
        ok: false,
        message: "Keranjang berisi produk dari stall lain. Ganti stall atau kosongkan keranjang",
      };
    }
  }
  return { ok: true };
}
