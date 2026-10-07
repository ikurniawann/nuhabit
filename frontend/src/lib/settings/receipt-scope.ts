import { ApiError } from "@/lib/api/auth";
import type { createPgClient } from "@/lib/pg/create-client";
import { RECEIPT_SETTINGS_GLOBAL_ID, normalizeReceiptLines } from "@/lib/pos/receipt-settings";

type PgClient = ReturnType<typeof createPgClient>;

export interface ReceiptScopeInput {
  warehouseId: string | null;
  branchId: string | null;
  headerLines: string[];
  footerLines: string[];
  showStallName: boolean;
}

type ScopeRow = { id?: unknown; branch_id?: unknown; warehouse_id?: unknown };

/**
 * Body PUT → input ter-sanitasi. Tanpa warehouse_id & branch_id = baris global;
 * baris struk dibatasi lebar kertas 80mm (normalizeReceiptLines).
 */
export function parseReceiptScopeInput(body: Record<string, unknown>): ReceiptScopeInput {
  const text = (value: unknown) => (typeof value === "string" && value ? value : null);
  const warehouseId = text(body.warehouse_id);
  const branchId = text(body.branch_id);
  if (warehouseId && !branchId) throw ApiError.badRequest("Scope warehouse membutuhkan branch_id");
  return {
    warehouseId,
    branchId,
    headerLines: normalizeReceiptLines(body.header_lines),
    footerLines: normalizeReceiptLines(body.footer_lines),
    showStallName: body.show_stall_name !== false,
  };
}

/** Baris aktif yang tepat untuk scope: warehouse, branch (tanpa warehouse), atau global. */
export function findReceiptScopeRow<T extends ScopeRow>(
  rows: T[],
  scope: Pick<ReceiptScopeInput, "warehouseId" | "branchId">
): T | undefined {
  return rows.find((row) =>
    scope.warehouseId
      ? row.warehouse_id === scope.warehouseId
      : scope.branchId
        ? row.branch_id === scope.branchId && !row.warehouse_id
        : !row.branch_id && !row.warehouse_id
  );
}

/** Upsert satu scope konfigurasi struk. */
export async function upsertReceiptScope(db: PgClient, input: ReceiptScopeInput) {
  const { data: existingRows, error: findError } = await db
    .from("pos_receipt_settings")
    .select("id, branch_id, warehouse_id")
    .eq("is_active", true);
  if (findError) throw findError;

  const payload = {
    header_lines: JSON.stringify(input.headerLines),
    footer_lines: JSON.stringify(input.footerLines),
    show_stall_name: input.showStallName,
    updated_at: new Date().toISOString(),
  };

  const existing = findReceiptScopeRow((existingRows as ScopeRow[]) ?? [], input);
  if (existing) {
    const { error } = await db.from("pos_receipt_settings").update(payload).eq("id", existing.id);
    if (error) throw error;
    return;
  }

  const isGlobal = !input.warehouseId && !input.branchId;
  const { error } = await db.from("pos_receipt_settings").insert({
    // Baris global memakai id tetap supaya seed migrasi & upsert konvergen.
    ...(isGlobal ? { id: RECEIPT_SETTINGS_GLOBAL_ID } : {}),
    branch_id: input.branchId,
    warehouse_id: input.warehouseId,
    is_active: true,
    ...payload,
  });
  if (error) throw error;
}
