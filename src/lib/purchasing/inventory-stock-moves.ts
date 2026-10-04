// Penyesuaian & transfer stok bahan baku (/api/purchasing/inventory/{adjustment,transfer}):
// validasi scope gudang/bahan, mutasi stok, audit, lalu posting jurnal.
import { z } from "zod";
import { ApiError, type ApiUser } from "@/lib/api/auth";
import {
  effectiveBranchId,
  isRowInBusinessScope,
  validateWarehouseForReceivingScope,
  type UserScope,
} from "@/lib/api/scope";
import { recordAuditAfterCommit, type requestMeta } from "@/lib/audit";
import { queryOne } from "@/lib/db";
import {
  AccountingPostError,
  postStockAdjustmentAccounting,
  postStockTransferAccounting,
} from "@/lib/inventory/accounting-posting";
import {
  ensureWarehouseInventoryId,
  listWarehouseInventoryForOpname,
} from "@/lib/inventory/stock-opname";
import { executeStockTransfer } from "@/lib/inventory/stock-transfer";
import type { DbClient } from "@/lib/pg/types";

type RequestMeta = ReturnType<typeof requestMeta>;

interface MaterialScopeRow {
  company_id: string | null;
  branch_id: string | null;
  kode?: string | null;
}

interface InventoryRow {
  qty_available: number | string | null;
  unit_cost: number | string | null;
  branch_id: string | null;
  warehouse_id: string | null;
}

export const stockAdjustmentSchema = z.object({
  raw_material_id: z.string().uuid("Bahan baku wajib dipilih"),
  warehouse_id: z.string().uuid("Gudang wajib dipilih"),
  qty_actual: z.number().min(0, "Stok aktual minimal 0"),
  notes: z.string().optional(),
});

export const stockTransferSchema = z.object({
  transfer_kind: z.enum(["main_to_stall", "stall_to_stall", "stall_to_main"]),
  source_warehouse_id: z.string().uuid("Source stall is required"),
  dest_warehouse_id: z.string().uuid("Destination stall is required"),
  raw_material_id: z.string().uuid("Raw material is required"),
  qty: z.number().positive("Quantity must be greater than zero"),
  notes: z.string().optional(),
});

/** Jurnal gagal karena mapping/akun → catatan untuk user, bukan galat transaksi. */
async function postAccounting(
  context: string,
  post: () => Promise<{ note: string | null }>
): Promise<string | null> {
  try {
    return (await post()).note;
  } catch (err) {
    if (!(err instanceof AccountingPostError)) throw err;
    console.error(`[${context}] accounting post failed:`, err.message);
    return err.message;
  }
}

async function requireWarehouseInScope(
  warehouseId: string,
  scope: UserScope | null,
  message: string
): Promise<{ branch_id: string }> {
  const check = await validateWarehouseForReceivingScope(warehouseId, scope, null);
  if ("error" in check) throw ApiError.badRequest(message);
  return check;
}

/** Bahan tak dikenal dibiarkan lolos (perilaku lama); bahan di luar scope → 403. */
async function loadMaterialInScope(
  db: DbClient,
  scope: UserScope | null,
  rawMaterialId: string,
  columns: string,
  forbiddenMessage: string
): Promise<MaterialScopeRow | null> {
  const { data } = await db
    .from("raw_materials")
    .select(columns)
    .eq("id", rawMaterialId)
    .maybeSingle();
  const material = data as MaterialScopeRow | null;
  if (material && !isRowInBusinessScope(scope, material)) {
    throw ApiError.forbidden(forbiddenMessage);
  }
  return material;
}

/** Selisih stok opname: qty aktual − qty sistem. */
export function adjustmentDiff(qtyBefore: number, qtyActual: number) {
  return { qty_before: qtyBefore, qty_after: qtyActual, qty_diff: qtyActual - qtyBefore };
}

/** Set stok satu bahan di satu gudang ke qty aktual; selisih dicatat sebagai movement + jurnal. */
export async function adjustRawMaterialStock(
  db: DbClient,
  scope: UserScope | null,
  user: ApiUser,
  input: z.infer<typeof stockAdjustmentSchema>,
  meta: RequestMeta
) {
  const warehouse = await requireWarehouseInScope(
    input.warehouse_id,
    scope,
    "Gudang tidak valid atau tidak diizinkan"
  );
  const branchId = effectiveBranchId(scope) || warehouse.branch_id;
  const material = await loadMaterialInScope(
    db,
    scope,
    input.raw_material_id,
    "company_id, branch_id, kode",
    "Bahan baku tidak tersedia untuk cabang Anda"
  );

  const previewLine = (await listWarehouseInventoryForOpname(input.warehouse_id)).find(
    (row) => row.raw_material_id === input.raw_material_id
  );
  if (!previewLine) throw ApiError.notFound("Bahan baku tidak ditemukan di gudang ini");

  const inventoryId =
    previewLine.inventory_id ??
    (await ensureWarehouseInventoryId(db, {
      rawMaterialId: input.raw_material_id,
      warehouseId: input.warehouse_id,
      branchId,
      unitCost: previewLine.unit_cost,
      userId: user.id,
    }));

  const { data: found, error: invError } = await db
    .from("inventory")
    .select("*")
    .eq("id", inventoryId)
    .maybeSingle();
  if (invError || !found) {
    throw ApiError.notFound("Data inventory tidak ditemukan untuk gudang ini");
  }
  const currentInv = found as InventoryRow;
  const adjustment = adjustmentDiff(Number(currentInv.qty_available || 0), input.qty_actual);
  const { qty_before: qtyBefore, qty_diff: qtyDiff } = adjustment;
  const unitCost = Number(currentInv.unit_cost || 0);

  const { data: updated, error: updateError } = await db
    .from("inventory")
    .update({
      qty_available: input.qty_actual,
      last_movement_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    })
    .eq("id", inventoryId)
    .select()
    .single();
  if (updateError) throw updateError;

  if (qtyDiff === 0) {
    return { data: updated, message: "Stok berhasil disesuaikan", adjustment };
  }

  const referenceId = crypto.randomUUID();
  const { error: movementError } = await db.from("inventory_movements").insert({
    inventory_id: inventoryId,
    raw_material_id: input.raw_material_id,
    tipe: "adjustment",
    jumlah: Math.abs(qtyDiff),
    qty_before: qtyBefore,
    qty_after: input.qty_actual,
    unit_cost: currentInv.unit_cost || 0,
    total_cost: Math.abs(qtyDiff) * unitCost,
    branch_id: currentInv.branch_id ?? null,
    warehouse_id: currentInv.warehouse_id ?? input.warehouse_id,
    reference_type: "adjustment",
    reference_id: referenceId,
    alasan: input.notes || `Penyesuaian stok: ${qtyDiff > 0 ? "+" : ""}${qtyDiff}`,
    created_by: user.id,
    updated_by: user.id,
  });
  if (movementError) throw movementError;

  await recordAuditAfterCommit({
    actor: { id: user.id, name: user.full_name },
    action: "stock.adjust",
    entity: "inventory",
    entityId: inventoryId,
    entityLabel: material?.kode ?? null,
    before: { qty_available: qtyBefore },
    after: {
      qty_available: input.qty_actual,
      qty_diff: qtyDiff,
      raw_material_id: input.raw_material_id,
      warehouse_id: input.warehouse_id,
    },
    reason: input.notes ?? null,
    ...meta,
  });

  const accountingNote = await postAccounting("adjustment", async () => {
    const companyRow = currentInv.branch_id
      ? await queryOne<{ company_id: string }>(
          `SELECT company_id FROM configuration.branches WHERE id = $1`,
          [currentInv.branch_id]
        )
      : null;
    return postStockAdjustmentAccounting({
      companyId: companyRow?.company_id ?? material?.company_id ?? null,
      userId: user.id,
      documentId: referenceId,
      entryDate: new Date().toISOString().slice(0, 10),
      rawMaterialId: input.raw_material_id,
      qtyDiff,
      unitCost,
      notes: input.notes,
    });
  });

  return {
    data: updated,
    message: accountingNote
      ? `Stok berhasil disesuaikan (${accountingNote})`
      : "Stok berhasil disesuaikan",
    accounting_note: accountingNote,
    adjustment,
  };
}

/** Pesan galat bisnis dari executeStockTransfer yang aman ditampilkan sebagai 400. */
export function isTransferRuleError(message: string): boolean {
  return (
    message.includes("Insufficient stock") ||
    message.includes("must be") ||
    message.includes("not available") ||
    message.includes("not found")
  );
}

/** Pindahkan stok antar stall/gudang, catat audit, lalu jurnal transfer. */
export async function transferRawMaterialStock(
  db: DbClient,
  scope: UserScope | null,
  user: ApiUser,
  input: z.infer<typeof stockTransferSchema>,
  meta: RequestMeta
) {
  await requireWarehouseInScope(
    input.source_warehouse_id,
    scope,
    "Source stall is invalid or not allowed"
  );
  await requireWarehouseInScope(
    input.dest_warehouse_id,
    scope,
    "Destination stall is invalid or not allowed"
  );
  const material = await loadMaterialInScope(
    db,
    scope,
    input.raw_material_id,
    "company_id, branch_id",
    "Raw material is not available for your branch"
  );

  let result: Awaited<ReturnType<typeof executeStockTransfer>>;
  try {
    result = await executeStockTransfer(db, {
      rawMaterialId: input.raw_material_id,
      sourceWarehouseId: input.source_warehouse_id,
      destWarehouseId: input.dest_warehouse_id,
      kind: input.transfer_kind,
      qty: input.qty,
      notes: input.notes,
      userId: user.id,
    });
  } catch (error) {
    if (error instanceof Error && isTransferRuleError(error.message)) {
      throw ApiError.badRequest(error.message);
    }
    throw error;
  }

  await recordAuditAfterCommit({
    actor: { id: user.id, name: user.full_name },
    action: "stock.transfer",
    entity: "stock_transfer",
    entityId: result.reference_id,
    entityLabel: result.transfer_number,
    after: {
      raw_material_id: input.raw_material_id,
      qty: result.qty,
      unit_cost: result.unit_cost,
      source_warehouse_id: input.source_warehouse_id,
      dest_warehouse_id: input.dest_warehouse_id,
      transfer_kind: input.transfer_kind,
    },
    reason: input.notes ?? null,
    ...meta,
  });

  const accountingNote = await postAccounting("transfer", () =>
    postStockTransferAccounting({
      companyId: material?.company_id ?? null,
      userId: user.id,
      transferId: result.reference_id,
      transferNumber: result.transfer_number,
      entryDate: new Date().toISOString().slice(0, 10),
      rawMaterialId: input.raw_material_id,
      qty: result.qty,
      unitCost: result.unit_cost,
      sourceWarehouseName: result.source_warehouse.name,
      destWarehouseName: result.dest_warehouse.name,
    })
  );

  const baseMessage = `Stock transferred successfully (${result.transfer_number})`;
  return {
    message: accountingNote ? `${baseMessage} (${accountingNote})` : baseMessage,
    accounting_note: accountingNote,
    data: result,
  };
}
