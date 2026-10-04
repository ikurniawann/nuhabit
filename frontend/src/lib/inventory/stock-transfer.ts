import { query, queryOne } from "@/lib/db";
import type { DbClient } from "@/lib/pg/types";
import { isMainStorageCode, isStallCode } from "@/lib/configuration/stall-labels";
import { ensureWarehouseInventoryId } from "@/lib/inventory/stock-opname";

export type StockTransferKind = "main_to_stall" | "stall_to_stall" | "stall_to_main";

export type WarehouseInfo = {
  id: string;
  code: string;
  name: string;
  branch_id: string;
  is_default: boolean;
};

export type StockTransferListRow = {
  id: string;
  reference_id: string;
  transfer_number: string;
  raw_material_id: string;
  material_kode: string;
  material_nama: string;
  qty: number;
  source_warehouse_id: string;
  source_warehouse_name: string;
  source_warehouse_code: string;
  dest_warehouse_id: string;
  dest_warehouse_name: string;
  dest_warehouse_code: string;
  transfer_kind: StockTransferKind | null;
  notes: string | null;
  created_at: string;
  created_by_name: string | null;
};

function toQty(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export { isMainStorageCode, isStallCode };

export function inferTransferKind(
  sourceCode: string,
  destCode: string
): StockTransferKind | null {
  const sourceIsMain = isMainStorageCode(sourceCode);
  const destIsMain = isMainStorageCode(destCode);
  const sourceIsStall = isStallCode(sourceCode);
  const destIsStall = isStallCode(destCode);

  if (sourceIsMain && destIsStall) return "main_to_stall";
  if (sourceIsStall && destIsStall) return "stall_to_stall";
  if (sourceIsStall && destIsMain) return "stall_to_main";
  return null;
}

export async function fetchWarehouseInfo(warehouseId: string): Promise<WarehouseInfo | null> {
  return queryOne<WarehouseInfo>(
    `SELECT id, code, name, branch_id, is_default
     FROM warehouses
     WHERE id = $1
       AND is_active = true`,
    [warehouseId]
  );
}

export function validateTransferWarehouses(
  kind: StockTransferKind,
  source: WarehouseInfo,
  dest: WarehouseInfo
): string | null {
  if (source.id === dest.id) {
    return "Source and destination must be different";
  }
  if (source.branch_id !== dest.branch_id) {
    return "Source and destination must belong to the same branch";
  }

  const sourceIsMain = isMainStorageCode(source.code);
  const destIsMain = isMainStorageCode(dest.code);
  const sourceIsStall = isStallCode(source.code);
  const destIsStall = isStallCode(dest.code);

  switch (kind) {
    case "main_to_stall":
      if (!sourceIsMain) return "Source must be Main Storage";
      if (!destIsStall) return "Destination must be a stall";
      break;
    case "stall_to_stall":
      if (!sourceIsStall) return "Source must be a stall";
      if (!destIsStall) return "Destination must be a stall";
      break;
    case "stall_to_main":
      if (!sourceIsStall) return "Source must be a stall";
      if (!destIsMain) return "Destination must be Main Storage";
      break;
  }

  return null;
}

export async function generateTransferNumber(db: DbClient): Promise<string> {
  const today = new Date();
  const datePrefix = `TRF-${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;

  const { data } = await db
    .from("inventory_movements")
    .select("reference_number")
    .eq("reference_type", "stock_transfer")
    .ilike("reference_number", `${datePrefix}-%`)
    .order("reference_number", { ascending: false })
    .limit(1);

  let sequence = 1;
  if (data && data.length > 0) {
    const lastSeq = Number.parseInt(String(data[0].reference_number).split("-").at(-1) || "", 10);
    if (Number.isFinite(lastSeq)) sequence = lastSeq + 1;
  }

  return `${datePrefix}-${String(sequence).padStart(4, "0")}`;
}

export type ExecuteStockTransferParams = {
  rawMaterialId: string;
  sourceWarehouseId: string;
  destWarehouseId: string;
  kind: StockTransferKind;
  qty: number;
  notes?: string;
  userId: string;
};

export type ExecuteStockTransferResult = {
  transfer_number: string;
  reference_id: string;
  qty: number;
  unit_cost: number;
  source_warehouse: WarehouseInfo;
  dest_warehouse: WarehouseInfo;
};

export async function executeStockTransfer(
  db: DbClient,
  params: ExecuteStockTransferParams
): Promise<ExecuteStockTransferResult> {
  const qty = toQty(params.qty);
  if (qty <= 0) {
    throw new Error("Transfer quantity must be greater than zero");
  }

  const source = await fetchWarehouseInfo(params.sourceWarehouseId);
  const dest = await fetchWarehouseInfo(params.destWarehouseId);

  if (!source) throw new Error("Source stall not found");
  if (!dest) throw new Error("Destination stall not found");

  const validationError = validateTransferWarehouses(params.kind, source, dest);
  if (validationError) throw new Error(validationError);

  const { data: sourceInv, error: sourceInvError } = await db
    .from("inventory")
    .select("*")
    .eq("raw_material_id", params.rawMaterialId)
    .eq("warehouse_id", params.sourceWarehouseId)
    .eq("is_active", true)
    .maybeSingle();

  if (sourceInvError) throw sourceInvError;
  if (!sourceInv) {
    throw new Error("Raw material is not available at the source stall");
  }

  const sourceQtyBefore = toQty(sourceInv.qty_available);
  if (sourceQtyBefore < qty) {
    throw new Error(`Insufficient stock. Available: ${sourceQtyBefore}`);
  }

  const sourceQtyAfter = sourceQtyBefore - qty;
  const unitCost = toQty(sourceInv.unit_cost);
  const branchId = source.branch_id;
  const transferNumber = await generateTransferNumber(db);
  const referenceId = crypto.randomUUID();
  const notes = params.notes?.trim() || null;

  const destInventoryId = await ensureWarehouseInventoryId(db, {
    rawMaterialId: params.rawMaterialId,
    warehouseId: params.destWarehouseId,
    branchId,
    unitCost,
    userId: params.userId,
  });

  const { data: destInv, error: destInvError } = await db
    .from("inventory")
    .select("*")
    .eq("id", destInventoryId)
    .maybeSingle();

  if (destInvError || !destInv) {
    throw destInvError ?? new Error("Failed to load destination inventory");
  }

  const destQtyBefore = toQty(destInv.qty_available);
  const destQtyAfter = destQtyBefore + qty;
  const prevDestCost = toQty(destInv.unit_cost);
  const destUnitCost =
    destQtyAfter > 0
      ? (destQtyBefore * prevDestCost + qty * unitCost) / destQtyAfter
      : unitCost;

  const now = new Date().toISOString();

  const { error: sourceUpdateError } = await db
    .from("inventory")
    .update({
      qty_available: sourceQtyAfter,
      last_movement_at: now,
      updated_at: now,
      updated_by: params.userId,
    })
    .eq("id", sourceInv.id);

  if (sourceUpdateError) throw sourceUpdateError;

  const { error: destUpdateError } = await db
    .from("inventory")
    .update({
      qty_available: destQtyAfter,
      unit_cost: destUnitCost,
      last_movement_at: now,
      updated_at: now,
      updated_by: params.userId,
    })
    .eq("id", destInventoryId);

  if (destUpdateError) throw destUpdateError;

  const outReason = `Transfer to ${dest.name} (${dest.code})`;
  const inReason = `Transfer from ${source.name} (${source.code})`;

  const { error: outMovementError } = await db.from("inventory_movements").insert({
    inventory_id: sourceInv.id,
    raw_material_id: params.rawMaterialId,
    tipe: "out",
    jumlah: qty,
    qty_before: sourceQtyBefore,
    qty_after: sourceQtyAfter,
    unit_cost: unitCost,
    total_cost: qty * unitCost,
    branch_id: branchId,
    warehouse_id: params.sourceWarehouseId,
    reference_type: "stock_transfer",
    reference_id: referenceId,
    reference_number: transferNumber,
    alasan: outReason,
    catatan: notes,
    created_by: params.userId,
    updated_by: params.userId,
  });

  if (outMovementError) throw outMovementError;

  const { error: inMovementError } = await db.from("inventory_movements").insert({
    inventory_id: destInventoryId,
    raw_material_id: params.rawMaterialId,
    tipe: "in",
    jumlah: qty,
    qty_before: destQtyBefore,
    qty_after: destQtyAfter,
    unit_cost: destUnitCost,
    total_cost: qty * destUnitCost,
    branch_id: branchId,
    warehouse_id: params.destWarehouseId,
    reference_type: "stock_transfer",
    reference_id: referenceId,
    reference_number: transferNumber,
    alasan: inReason,
    catatan: notes,
    created_by: params.userId,
    updated_by: params.userId,
  });

  if (inMovementError) throw inMovementError;

  return {
    transfer_number: transferNumber,
    reference_id: referenceId,
    qty,
    unit_cost: unitCost,
    source_warehouse: source,
    dest_warehouse: dest,
  };
}

export async function listStockTransfers(params: {
  branchId?: string | null;
  page: number;
  limit: number;
}): Promise<{ rows: StockTransferListRow[]; total: number }> {
  const offset = (params.page - 1) * params.limit;
  const branchFilter = params.branchId ?? null;

  const countRow = await queryOne<{ total: string }>(
    `SELECT COUNT(*)::text AS total
     FROM inventory_movements out_mov
     WHERE out_mov.reference_type = 'stock_transfer'
       AND out_mov.tipe = 'out'
       AND out_mov.is_active = true
       AND ($1::uuid IS NULL OR out_mov.branch_id = $1)`,
    [branchFilter]
  );

  const rows = await query<StockTransferListRow>(
    `SELECT out_mov.id,
            out_mov.reference_id,
            out_mov.reference_number AS transfer_number,
            out_mov.raw_material_id,
            rm.kode AS material_kode,
            rm.nama AS material_nama,
            out_mov.jumlah::float8 AS qty,
            src.id AS source_warehouse_id,
            src.name AS source_warehouse_name,
            src.code AS source_warehouse_code,
            dst.id AS dest_warehouse_id,
            dst.name AS dest_warehouse_name,
            dst.code AS dest_warehouse_code,
            out_mov.catatan AS notes,
            out_mov.created_at::text AS created_at,
            u.full_name AS created_by_name
     FROM inventory_movements out_mov
     INNER JOIN inventory_movements in_mov
       ON in_mov.reference_id = out_mov.reference_id
      AND in_mov.reference_type = 'stock_transfer'
      AND in_mov.tipe = 'in'
      AND in_mov.is_active = true
     INNER JOIN raw_materials rm ON rm.id = out_mov.raw_material_id
     INNER JOIN warehouses src ON src.id = out_mov.warehouse_id
     INNER JOIN warehouses dst ON dst.id = in_mov.warehouse_id
     LEFT JOIN users u ON u.id = out_mov.created_by
     WHERE out_mov.reference_type = 'stock_transfer'
       AND out_mov.tipe = 'out'
       AND out_mov.is_active = true
       AND ($1::uuid IS NULL OR out_mov.branch_id = $1)
     ORDER BY out_mov.created_at DESC
     LIMIT $2 OFFSET $3`,
    [branchFilter, params.limit, offset]
  );

  return {
    rows: rows.map((row) => ({
      ...row,
      qty: toQty(row.qty),
      transfer_kind: inferTransferKind(row.source_warehouse_code, row.dest_warehouse_code),
    })),
    total: Number(countRow?.total ?? 0),
  };
}
