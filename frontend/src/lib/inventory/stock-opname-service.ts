import { ApiError } from "@/lib/api/auth";
import { resolveWarehouseFilter } from "@/lib/api/stall-scope";
import {
  effectiveBranchId,
  validateWarehouseForReceivingScope,
  type UserScope,
} from "@/lib/api/scope";
import { recordAudit, type requestMeta } from "@/lib/audit";
import { query, queryOne, withTransaction } from "@/lib/db";
import { createServerPgClient } from "@/lib/pg/create-client";
import {
  AccountingPostError,
  postStockOpnameAccounting,
} from "@/lib/inventory/accounting-posting";
import { assertOpnameCompletable, opnameListPagination, toQty } from "@/lib/inventory/opname-rules";
import {
  applyOpnameChanges,
  type OpnameCreateInput,
  type OpnameListQuery,
  type OpnamePatchInput,
} from "@/lib/inventory/opname-sessions";
import {
  ensureWarehouseInventoryId,
  fetchStockOpnameDetail,
  listWarehouseInventoryForOpname,
} from "@/lib/inventory/stock-opname";

type Actor = { id: string; full_name: string };
type StockOpnameDetail = NonNullable<Awaited<ReturnType<typeof fetchStockOpnameDetail>>>;

type StockOpnameListRow = {
  id: string;
  opname_number: string;
  warehouse_id: string | null;
  branch_id: string | null;
  opname_date: string;
  status: string;
  reason: string;
  notes: string | null;
  total_lines: number;
  lines_counted: number;
  lines_with_variance: number;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  warehouse_name: string | null;
  warehouse_code: string | null;
};

export async function listStockOpnames(scope: UserScope | null, params: OpnameListQuery) {
  const conditions: string[] = ["1=1"];
  const values: unknown[] = [];
  const push = (sql: (idx: number) => string, value: unknown) => {
    values.push(value);
    conditions.push(sql(values.length));
  };

  if (params.status && params.status !== "all") push((i) => `so.status = $${i}`, params.status);
  const warehouseFilter = await resolveWarehouseFilter(params.warehouse_id);
  if (warehouseFilter) push((i) => `so.warehouse_id = $${i}`, warehouseFilter);
  if (params.reason) push((i) => `so.reason = $${i}`, params.reason);
  if (params.search) {
    push((i) => `(so.opname_number ILIKE $${i} OR so.notes ILIKE $${i})`, `%${params.search}%`);
  }
  const branchId = effectiveBranchId(scope);
  if (branchId) push((i) => `so.branch_id = $${i}`, branchId);

  const where = conditions.join(" AND ");
  const countRow = await queryOne<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM inventory.stock_opnames so WHERE ${where}`,
    values
  );
  const total = Number(countRow?.total || 0);

  const rows = await query<StockOpnameListRow>(
    `SELECT so.*,
            wh.name AS warehouse_name,
            wh.code AS warehouse_code
     FROM inventory.stock_opnames so
     LEFT JOIN configuration.warehouses wh ON wh.id = so.warehouse_id
     WHERE ${where}
     ORDER BY so.opname_date DESC, so.created_at DESC
     LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, params.limit, (params.page - 1) * params.limit]
  );

  const data = rows.map(({ warehouse_name, warehouse_code, ...row }) => ({
    id: row.id,
    opname_number: row.opname_number,
    warehouse_id: row.warehouse_id,
    branch_id: row.branch_id,
    opname_date: row.opname_date,
    status: row.status,
    reason: row.reason,
    notes: row.notes,
    total_lines: row.total_lines,
    lines_counted: row.lines_counted,
    lines_with_variance: row.lines_with_variance,
    completed_at: row.completed_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    warehouse: row.warehouse_id
      ? { id: row.warehouse_id, name: warehouse_name || "—", code: warehouse_code || "" }
      : null,
    lines: [],
  }));

  return { data, pagination: opnameListPagination(params.page, params.limit, total) };
}

export async function createStockOpname(opts: {
  scope: UserScope | null;
  userId: string;
  input: OpnameCreateInput;
}) {
  const { scope, userId, input } = opts;
  const warehouseCheck = await validateWarehouseForReceivingScope(input.warehouse_id, scope, null);
  if ("error" in warehouseCheck) {
    throw ApiError.badRequest("Gudang tidak valid atau tidak diizinkan");
  }

  const rows = await listWarehouseInventoryForOpname(input.warehouse_id);
  if (rows.length === 0) {
    throw ApiError.badRequest("Tidak ada bahan baku aktif di cabang gudang ini");
  }

  const db = await createServerPgClient();
  const branchId = effectiveBranchId(scope) || warehouseCheck.branch_id;
  const { data: header, error: headerError } = await db
    .from("stock_opnames")
    .insert({
      warehouse_id: input.warehouse_id,
      branch_id: branchId,
      opname_date: input.opname_date || new Date().toISOString().slice(0, 10),
      status: "draft",
      reason: input.reason,
      notes: input.notes || null,
      total_lines: rows.length,
      lines_counted: 0,
      lines_with_variance: 0,
      created_by: userId,
      updated_by: userId,
    })
    .select()
    .single();
  if (headerError || !header) throw headerError;

  const linePayload = [];
  for (const row of rows) {
    const inventoryId =
      row.inventory_id ??
      (await ensureWarehouseInventoryId(db, {
        rawMaterialId: row.raw_material_id,
        warehouseId: input.warehouse_id,
        branchId,
        unitCost: row.unit_cost,
        userId,
      }));
    linePayload.push({
      stock_opname_id: header.id,
      inventory_id: inventoryId,
      raw_material_id: row.raw_material_id,
      qty_system: row.qty_system,
      qty_counted: null,
      qty_variance: null,
      unit_cost: row.unit_cost,
    });
  }

  const { error: linesError } = await db.from("stock_opname_lines").insert(linePayload);
  if (linesError) {
    await db.from("stock_opnames").delete().eq("id", header.id);
    throw linesError;
  }
  return fetchStockOpnameDetail(header.id);
}

/** Detail opname yang terlihat oleh scope user (aturan cabang sama dengan daftar); selain itu 404. */
export async function getStockOpnameOr404(id: string, scope: UserScope | null): Promise<StockOpnameDetail> {
  const detail = await fetchStockOpnameDetail(id);
  const branchId = effectiveBranchId(scope);
  if (!detail || (branchId && detail.branch_id !== branchId)) {
    throw ApiError.notFound("Stock opname tidak ditemukan");
  }
  return detail;
}

export async function saveStockOpnameChanges(
  id: string,
  userId: string,
  input: OpnamePatchInput,
  scope: UserScope | null
) {
  const result = await applyOpnameChanges({
    db: await createServerPgClient(),
    tables: { header: "stock_opnames", lines: "stock_opname_lines" },
    id,
    userId,
    input,
    load: fetchStockOpnameDetail,
    detail: await getStockOpnameOr404(id, scope),
  });
  return { result, data: await fetchStockOpnameDetail(id) };
}

/** Terapkan selisih ke stok gudang + movement + audit dalam satu transaksi. */
async function applyStockOpnameVariances(
  detail: StockOpnameDetail,
  actor: Actor,
  meta: ReturnType<typeof requestMeta>
) {
  await withTransaction(async (client) => {
    for (const line of detail.lines) {
      const qtyBefore = line.qty_system;
      const qtyAfter = toQty(line.qty_counted);
      const qtyDiff = qtyAfter - qtyBefore;
      if (qtyDiff === 0) continue;

      const invRes = await client.query<{
        id: string;
        branch_id: string | null;
        warehouse_id: string | null;
        unit_cost: number | string | null;
      }>(
        `SELECT id, branch_id, warehouse_id, unit_cost
         FROM inventory.inventory
         WHERE id = $1
         FOR UPDATE`,
        [line.inventory_id]
      );
      const inv = invRes.rows[0];
      if (!inv) throw new Error(`Inventory ${line.inventory_id} tidak ditemukan`);

      await client.query(
        `UPDATE inventory.inventory
         SET qty_available = $1,
             last_movement_at = now(),
             updated_at = now(),
             updated_by = $2
         WHERE id = $3`,
        [qtyAfter, actor.id, line.inventory_id]
      );

      const unitCost = toQty(inv.unit_cost ?? line.unit_cost);
      await client.query(
        `INSERT INTO inventory.inventory_movements (
           inventory_id, raw_material_id, tipe, jumlah,
           qty_before, qty_after, unit_cost, total_cost,
           branch_id, warehouse_id,
           reference_type, reference_id, reference_number, alasan,
           created_by, updated_by
         ) VALUES (
           $1, $2, 'adjustment', $3,
           $4, $5, $6, $7,
           $8, $9,
           'stock_opname', $10, $11, $12,
           $13, $13
         )`,
        [
          line.inventory_id,
          line.raw_material_id,
          Math.abs(qtyDiff),
          qtyBefore,
          qtyAfter,
          unitCost,
          Math.abs(qtyDiff) * unitCost,
          inv.branch_id,
          inv.warehouse_id,
          detail.id,
          detail.opname_number,
          line.notes || `Stock opname ${detail.opname_number}: ${qtyDiff > 0 ? "+" : ""}${qtyDiff}`,
          actor.id,
        ]
      );
    }

    const varianceLines = detail.lines
      .map((line) => ({
        raw_material_id: line.raw_material_id,
        inventory_id: line.inventory_id,
        qty_system: line.qty_system,
        qty_counted: toQty(line.qty_counted),
      }))
      .filter((line) => line.qty_counted !== line.qty_system);

    await client.query(
      `UPDATE inventory.stock_opnames
       SET status = 'completed',
           completed_at = now(),
           lines_counted = $2,
           lines_with_variance = $3,
           updated_by = $4,
           updated_at = now()
       WHERE id = $1`,
      [detail.id, detail.lines.length, varianceLines.length, actor.id]
    );

    await recordAudit(client, {
      actor: { id: actor.id, name: actor.full_name },
      action: "stock.opname_complete",
      entity: "stock_opname",
      entityId: detail.id,
      entityLabel: detail.opname_number,
      before: { status: detail.status },
      after: { status: "completed", lines_counted: detail.lines.length, variances: varianceLines },
      ...meta,
    });
  });
}

/** Posting jurnal selisih opname; galat mapping jurnal jadi catatan, bukan kegagalan. */
async function postStockOpnameVarianceJournal(detail: StockOpnameDetail, userId: string) {
  try {
    const companyRow = detail.branch_id
      ? await queryOne<{ company_id: string }>(
          `SELECT company_id FROM configuration.branches WHERE id = $1`,
          [detail.branch_id]
        )
      : null;
    const accounting = await postStockOpnameAccounting({
      companyId: companyRow?.company_id ?? null,
      userId,
      opnameId: detail.id,
      opnameNumber: detail.opname_number,
      opnameDate: String(detail.opname_date).slice(0, 10),
      lines: detail.lines.map((line) => ({
        raw_material_id: line.raw_material_id,
        qty_diff: toQty(line.qty_counted) - line.qty_system,
        unit_cost: toQty(line.unit_cost),
        material_nama: line.material_nama,
      })),
    });
    return accounting.note;
  } catch (err) {
    if (!(err instanceof AccountingPostError)) throw err;
    console.error("[stock-opname] accounting post failed:", err.message);
    return err.message;
  }
}

export async function completeStockOpname(
  id: string,
  actor: Actor,
  meta: ReturnType<typeof requestMeta>,
  scope: UserScope | null
) {
  const detail = await getStockOpnameOr404(id, scope);
  assertOpnameCompletable(detail);
  await applyStockOpnameVariances(detail, actor, meta);
  const accountingNote = await postStockOpnameVarianceJournal(detail, actor.id);
  return { data: await fetchStockOpnameDetail(id), accountingNote };
}
