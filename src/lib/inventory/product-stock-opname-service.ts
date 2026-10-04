import { ApiError } from "@/lib/api/auth";
import { resolveWarehouseFilter } from "@/lib/api/stall-scope";
import { validateProductWarehouseScope, type UserScope } from "@/lib/api/scope";
import { query, queryOne, withTransaction } from "@/lib/db";
import { createServerPgClient } from "@/lib/pg/create-client";
import { insertFinishedGoodsMovementSql } from "@/lib/inventory/finished-goods-movements";
import { assertOpnameCompletable, opnameListPagination, toQty } from "@/lib/inventory/opname-rules";
import {
  applyOpnameChanges,
  type OpnameCreateInput,
  type OpnameListQuery,
  type OpnamePatchInput,
} from "@/lib/inventory/opname-sessions";
import {
  buildOpnameScopeFilter,
  ensureProductInventoryId,
  fetchProductStockOpnameDetail,
  isOpnameInScope,
  listProductInventoryForOpname,
  resolveOpnameScopeIds,
  summarizeOpnameSkuDeltas,
  type OpnameCompleteLineInput,
} from "@/lib/inventory/product-stock-opname";

type ProductOpnameDetail = NonNullable<Awaited<ReturnType<typeof fetchProductStockOpnameDetail>>>;

type ProductOpnameListRow = {
  id: string;
  opname_number: string;
  company_id: string | null;
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
  branch_name: string | null;
  branch_code: string | null;
  warehouse_id: string | null;
  warehouse_name: string | null;
  warehouse_code: string | null;
};

const NOT_FOUND = "Stock opname produk tidak ditemukan";

export async function listProductStockOpnames(scope: UserScope | null, params: OpnameListQuery) {
  const conditions: string[] = ["1=1"];
  const values: unknown[] = [];
  const push = (sql: (idx: number) => string, value: unknown) => {
    values.push(value);
    conditions.push(sql(values.length));
  };

  if (params.status && params.status !== "all") push((i) => `pso.status = $${i}`, params.status);
  if (params.reason) push((i) => `pso.reason = $${i}`, params.reason);
  if (params.search) {
    push((i) => `(pso.opname_number ILIKE $${i} OR pso.notes ILIKE $${i})`, `%${params.search}%`);
  }
  const warehouseFilter = await resolveWarehouseFilter(params.warehouse_id);
  if (warehouseFilter) push((i) => `pso.warehouse_id = $${i}`, warehouseFilter);

  const scopeFilter = buildOpnameScopeFilter(scope, "pso", values.length + 1);
  if (scopeFilter.sql !== "1=1") {
    conditions.push(scopeFilter.sql);
    values.push(...scopeFilter.values);
  }

  const where = conditions.join(" AND ");
  const countRow = await queryOne<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM inventory.product_stock_opnames pso WHERE ${where}`,
    values
  );
  const total = Number(countRow?.total || 0);

  const rows = await query<ProductOpnameListRow>(
    `SELECT pso.*,
            b.name AS branch_name,
            b.code AS branch_code,
            wh.name AS warehouse_name,
            wh.code AS warehouse_code
     FROM inventory.product_stock_opnames pso
     LEFT JOIN configuration.branches b ON b.id = pso.branch_id
     LEFT JOIN configuration.warehouses wh ON wh.id = pso.warehouse_id
     WHERE ${where}
     ORDER BY pso.opname_date DESC, pso.created_at DESC
     LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
    [...values, params.limit, (params.page - 1) * params.limit]
  );

  const data = rows.map((row) => ({
    id: row.id,
    opname_number: row.opname_number,
    company_id: row.company_id,
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
    branch: row.branch_id
      ? { id: row.branch_id, name: row.branch_name || "—", code: row.branch_code || "" }
      : null,
    warehouse: row.warehouse_id
      ? { id: row.warehouse_id, name: row.warehouse_name || "—", code: row.warehouse_code || "" }
      : null,
    lines: [],
  }));

  return { data, pagination: opnameListPagination(params.page, params.limit, total) };
}

export async function createProductStockOpname(opts: {
  scope: UserScope | null;
  userId: string;
  input: OpnameCreateInput;
}) {
  const { scope, userId, input } = opts;
  const warehouseScope = await validateProductWarehouseScope(input.warehouse_id, scope);
  if ("error" in warehouseScope) throw ApiError.badRequest(warehouseScope.error);

  const rows = await listProductInventoryForOpname(scope, input.warehouse_id);
  if (rows.length === 0) throw ApiError.badRequest("No active products found for this stall");

  const { companyId, branchId } = resolveOpnameScopeIds(scope);
  const db = await createServerPgClient();
  const { data: header, error: headerError } = await db
    .from("product_stock_opnames")
    .insert({
      company_id: companyId ?? warehouseScope.company_id,
      branch_id: branchId ?? warehouseScope.branch_id,
      warehouse_id: input.warehouse_id,
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
      (await ensureProductInventoryId(db, {
        productId: row.product_id,
        unitCost: row.unit_cost,
        userId,
      }));
    linePayload.push({
      product_stock_opname_id: header.id,
      inventory_id: inventoryId,
      product_id: row.product_id,
      // EPIC-047 Fase 3 — null untuk produk tanpa varian (jalur lama); terisi
      // per baris untuk produk merchandise ber-SKU aktif (satu baris = satu SKU).
      pos_sku_id: row.pos_sku_id ?? null,
      qty_system: row.qty_system,
      qty_counted: null,
      qty_variance: null,
      unit_cost: row.unit_cost,
    });
  }

  const { error: linesError } = await db.from("product_stock_opname_lines").insert(linePayload);
  if (linesError) {
    await db.from("product_stock_opnames").delete().eq("id", header.id);
    throw linesError;
  }
  return fetchProductStockOpnameDetail(header.id);
}

/**
 * EPIC-047 Fase 3: opname milik company/branch lain dijawab 404 (bentuk sama
 * dengan "tidak ditemukan"), bukan 403, supaya keberadaannya tidak bocor.
 */
export async function getProductStockOpnameInScope(
  id: string,
  scope: UserScope | null
): Promise<ProductOpnameDetail> {
  const detail = await fetchProductStockOpnameDetail(id);
  if (!detail || !isOpnameInScope(scope, detail)) throw ApiError.notFound(NOT_FOUND);
  return detail;
}

export async function saveProductStockOpnameChanges(opts: {
  id: string;
  scope: UserScope | null;
  userId: string;
  input: OpnamePatchInput;
}) {
  const { id, scope, userId, input } = opts;
  const result = await applyOpnameChanges({
    db: await createServerPgClient(),
    tables: { header: "product_stock_opnames", lines: "product_stock_opname_lines" },
    id,
    userId,
    input,
    load: fetchProductStockOpnameDetail,
    detail: await getProductStockOpnameInScope(id, scope),
  });
  return { result, data: await fetchProductStockOpnameDetail(id) };
}

export async function completeProductStockOpname(id: string, scope: UserScope | null, userId: string) {
  const detail = await getProductStockOpnameInScope(id, scope);
  assertOpnameCompletable(detail);

  await withTransaction(async (client) => {
    const lineById = new Map(detail.lines.map((line) => [line.id, line]));
    // Semua baris SKU milik produk yang sama berbagi SATU baris
    // finished_goods_inventory (ensureProductInventoryId).
    const inventoryIdByProduct = new Map(detail.lines.map((line) => [line.product_id, line.inventory_id]));

    // EPIC-047 Fase 3 — kunci & baca stok LIVE tiap SKU (FOR UPDATE) lebih dulu;
    // ini "qty_before" untuk summarizeOpnameSkuDeltas, BUKAN snapshot qty_system.
    const skuBeforeById = new Map<string, number>();
    for (const line of detail.lines) {
      if (!line.pos_sku_id) continue;
      const skuRes = await client.query<{ stock_quantity: number | string }>(
        `SELECT stock_quantity FROM pos.pos_product_skus WHERE id = $1 FOR UPDATE`,
        [line.pos_sku_id]
      );
      const sku = skuRes.rows[0];
      if (!sku) throw new Error(`SKU ${line.pos_sku_id} tidak ditemukan`);
      skuBeforeById.set(line.id, toQty(sku.stock_quantity));
    }

    const lineInputs: OpnameCompleteLineInput[] = detail.lines.map((line) => ({
      id: line.id,
      product_id: line.product_id,
      pos_sku_id: line.pos_sku_id ?? null,
      qty_before: line.pos_sku_id ? skuBeforeById.get(line.id)! : line.qty_system,
      qty_counted: toQty(line.qty_counted),
    }));

    let summary;
    try {
      summary = summarizeOpnameSkuDeltas(lineInputs);
    } catch (err) {
      throw ApiError.badRequest(err instanceof Error ? err.message : "Baris opname tidak valid");
    }

    const movementBase = {
      warehouseId: detail.warehouse_id,
      tipe: "adjustment" as const,
      referenceType: "product_stock_opname",
      referenceId: detail.id,
      referenceNumber: detail.opname_number ?? detail.id,
      userId,
    };

    // Baris ber-SKU: stock_quantity SKU diset absolut + satu movement per SKU berselisih.
    for (const skuLine of summary.skuLines) {
      if (skuLine.delta === 0) continue;
      const detailLine = lineById.get(skuLine.id)!;
      await client.query(
        `UPDATE pos.pos_product_skus SET stock_quantity = $1, updated_at = now() WHERE id = $2`,
        [skuLine.qty_after, skuLine.pos_sku_id]
      );
      await insertFinishedGoodsMovementSql(client, {
        ...movementBase,
        inventoryId: detailLine.inventory_id,
        productId: skuLine.product_id,
        qtyBefore: skuLine.qty_before,
        qtyAfter: skuLine.qty_after,
        unitCost: toQty(detailLine.unit_cost),
        alasan: "Stock opname completed",
        catatan: "opname per varian",
        posSkuId: skuLine.pos_sku_id,
      });
    }

    // Produk ber-varian: stok level produk disesuaikan sebesar Σ selisih SKU-nya.
    for (const productDelta of summary.productDeltas) {
      const inventoryId = inventoryIdByProduct.get(productDelta.product_id)!;
      const inv = await lockFinishedGoodsInventory(client, inventoryId);
      const qtyBefore = toQty(inv.qty_available);
      const qtyAfter = qtyBefore + productDelta.delta;
      await setFinishedGoodsQty(client, inv.id, qtyAfter, userId);
      await insertFinishedGoodsMovementSql(client, {
        ...movementBase,
        inventoryId: inv.id,
        productId: productDelta.product_id,
        qtyBefore,
        qtyAfter,
        unitCost: toQty(inv.unit_cost),
        alasan: "Stock opname completed (Σ varian)",
      });
    }

    // Baris TANPA pos_sku_id: jalur lama.
    for (const line of detail.lines) {
      if (line.pos_sku_id) continue;
      const qtyBefore = line.qty_system;
      const qtyAfter = toQty(line.qty_counted);
      if (qtyAfter === qtyBefore) continue;
      const inv = await lockFinishedGoodsInventory(client, line.inventory_id);
      await setFinishedGoodsQty(client, line.inventory_id, qtyAfter, userId);
      await insertFinishedGoodsMovementSql(client, {
        ...movementBase,
        inventoryId: line.inventory_id,
        productId: line.product_id,
        qtyBefore,
        qtyAfter,
        unitCost: toQty(inv.unit_cost),
        alasan: "Stock opname completed",
      });
    }

    // Guard di kolom status supaya dua request complete konkuren tidak sama-sama
    // memposting movement: 0 baris ter-update → rollback + 400.
    const completeResult = await client.query(
      `UPDATE inventory.product_stock_opnames
       SET status = 'completed',
           completed_at = now(),
           lines_counted = $2,
           lines_with_variance = $3,
           updated_by = $4,
           updated_at = now()
       WHERE id = $1 AND status <> 'completed'`,
      [
        detail.id,
        detail.lines.length,
        detail.lines.filter((l) => toQty(l.qty_variance) !== 0).length,
        userId,
      ]
    );
    if (completeResult.rowCount === 0) {
      throw ApiError.badRequest("Stock opname sudah diselesaikan sebelumnya");
    }
  });

  return fetchProductStockOpnameDetail(id);
}

type TxClient = Parameters<Parameters<typeof withTransaction>[0]>[0];

async function lockFinishedGoodsInventory(client: TxClient, inventoryId: string) {
  const res = await client.query<{
    id: string;
    qty_available: number | string | null;
    unit_cost: number | string | null;
  }>(
    `SELECT id, qty_available, unit_cost
     FROM inventory.finished_goods_inventory
     WHERE id = $1
     FOR UPDATE`,
    [inventoryId]
  );
  const inv = res.rows[0];
  if (!inv) throw new Error(`Stok produk ${inventoryId} tidak ditemukan`);
  return inv;
}

async function setFinishedGoodsQty(client: TxClient, inventoryId: string, qty: number, userId: string) {
  await client.query(
    `UPDATE inventory.finished_goods_inventory
     SET qty_available = $1,
         last_movement_at = now(),
         updated_at = now(),
         updated_by = $2
     WHERE id = $3`,
    [qty, userId, inventoryId]
  );
}
