import { query, queryOne } from "@/lib/db";
import type { UserScope } from "@/lib/api/scope";
import { effectiveBranchId, effectiveCompanyId } from "@/lib/api/scope";

function toNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export interface ProductOpnamePreviewLine {
  inventory_id: string | null;
  product_id: string;
  product_kode: string;
  product_nama: string;
  satuan: string | null;
  qty_system: number;
  unit_cost: number;
  // EPIC-047 Fase 3 — diisi saat produk ini merchandise POS ber-SKU aktif;
  // baris ini lalu mewakili SATU SKU (bukan produk), qty_system = stok SKU.
  pos_sku_id?: string | null;
  pos_sku_code?: string | null;
  pos_sku_name?: string | null;
}

/** Satu SKU aktif milik sebuah produk (item.products.id), dipakai untuk
 *  ekspansi baris preview opname per varian. */
export interface OpnameSkuOption {
  pos_sku_id: string;
  pos_sku_code: string;
  pos_sku_name: string;
  stock_quantity: number;
}

/**
 * EPIC-047 Fase 3 — murni (tanpa I/O). Produk yang punya ≥1 SKU aktif di
 * `skusByProductId` diekspansi jadi satu baris preview PER SKU (field produk
 * sama, `qty_system` diganti stok SKU); produk tanpa SKU (peta kosong/tidak
 * ada entri) dikembalikan APA ADANYA. Urutan produk asal + urutan SKU
 * (sesuai `skusByProductId`) dijaga stabil.
 */
export function expandOpnameLinesBySku(
  rows: ProductOpnamePreviewLine[],
  skusByProductId: Map<string, OpnameSkuOption[]>
): ProductOpnamePreviewLine[] {
  const expanded: ProductOpnamePreviewLine[] = [];

  for (const row of rows) {
    const skus = skusByProductId.get(row.product_id);
    if (!skus || skus.length === 0) {
      expanded.push(row);
      continue;
    }

    for (const sku of skus) {
      expanded.push({
        ...row,
        pos_sku_id: sku.pos_sku_id,
        pos_sku_code: sku.pos_sku_code,
        pos_sku_name: sku.pos_sku_name,
        qty_system: sku.stock_quantity,
      });
    }
  }

  return expanded;
}

type PgClient = Awaited<
  ReturnType<typeof import("@/lib/pg/create-client").createServerPgClient>
>;

function buildProductScopeFilter(
  scope: UserScope | null,
  alias = "p",
  startIdx = 1
): { sql: string; values: unknown[]; nextIdx: number } {
  const conditions: string[] = [];
  const values: unknown[] = [];
  let idx = startIdx;

  if (scope && !scope.isUnscoped) {
    if (scope.businessScope === "branch" && scope.branchId) {
      conditions.push(`${alias}.branch_id = $${idx++}`);
      values.push(scope.branchId);
    } else if (scope.companyId) {
      conditions.push(`${alias}.company_id = $${idx++}`);
      values.push(scope.companyId);
    }
  }

  return {
    sql: conditions.length ? conditions.join(" AND ") : "1=1",
    values,
    nextIdx: idx,
  };
}

function buildOpnameScopeFilter(
  scope: UserScope | null,
  alias = "pso",
  startIdx = 1
): { sql: string; values: unknown[]; nextIdx: number } {
  const conditions: string[] = [];
  const values: unknown[] = [];
  let idx = startIdx;

  if (scope && !scope.isUnscoped) {
    if (scope.businessScope === "branch" && scope.branchId) {
      conditions.push(`${alias}.branch_id = $${idx++}`);
      values.push(scope.branchId);
    } else if (scope.companyId) {
      conditions.push(`${alias}.company_id = $${idx++}`);
      values.push(scope.companyId);
    }
  }

  return {
    sql: conditions.length ? conditions.join(" AND ") : "1=1",
    values,
    nextIdx: idx,
  };
}

/** Active products in scope for a specific stall + system stock from finished_goods_inventory. */
export async function listProductInventoryForOpname(
  scope: UserScope | null,
  warehouseId: string
): Promise<ProductOpnamePreviewLine[]> {
  const productScope = buildProductScopeFilter(scope, "p", 1);
  const values = [...productScope.values, warehouseId];
  const warehouseIdx = productScope.nextIdx;

  const rows = await query<{
    inventory_id: string | null;
    product_id: string;
    product_kode: string;
    product_nama: string;
    satuan: string | null;
    qty_system: number | string | null;
    unit_cost: number | string | null;
  }>(
    `SELECT p.id AS product_id,
            fgi.id AS inventory_id,
            p.kode AS product_kode,
            p.nama AS product_nama,
            u.nama AS satuan,
            COALESCE(fgi.qty_available, 0) AS qty_system,
            COALESCE(NULLIF(fgi.unit_cost, 0), p.harga_modal, 0) AS unit_cost
     FROM products p
     LEFT JOIN inventory.finished_goods_inventory fgi
       ON fgi.product_id = p.id AND fgi.is_active = true
     LEFT JOIN units u ON u.id = p.satuan_id
     WHERE p.deleted_at IS NULL
       AND p.is_active = true
       AND p.warehouse_id = $${warehouseIdx}
       AND ${productScope.sql}
     ORDER BY p.nama ASC`,
    values
  );

  const baseRows: ProductOpnamePreviewLine[] = rows.map((row) => ({
    inventory_id: row.inventory_id,
    product_id: row.product_id,
    product_kode: row.product_kode,
    product_nama: row.product_nama,
    satuan: row.satuan,
    qty_system: toNumber(row.qty_system),
    unit_cost: toNumber(row.unit_cost),
  }));

  const skusByProductId = await fetchActiveSkusByProductId(
    baseRows.map((row) => row.product_id)
  );

  return expandOpnameLinesBySku(baseRows, skusByProductId);
}

/**
 * EPIC-047 Fase 3 — two-hop `item.products` → `pos.pos_products`
 * (merchandise) → `pos.pos_product_skus` (aktif), dipola dari
 * `resolveVariantProductIds` (src/lib/purchasing/grn-qc.ts). Produk tanpa
 * link POS merchandise atau tanpa SKU aktif tidak muncul di map (peta
 * kosong untuknya), sehingga `expandOpnameLinesBySku` membiarkan barisnya
 * apa adanya.
 */
async function fetchActiveSkusByProductId(
  productIds: string[]
): Promise<Map<string, OpnameSkuOption[]>> {
  const map = new Map<string, OpnameSkuOption[]>();
  if (productIds.length === 0) return map;

  const rows = await query<{
    product_id: string;
    pos_sku_id: string;
    pos_sku_code: string;
    pos_sku_name: string;
    stock_quantity: number | string | null;
  }>(
    `SELECT pp.source_product_id AS product_id,
            s.id AS pos_sku_id,
            s.sku AS pos_sku_code,
            s.name AS pos_sku_name,
            s.stock_quantity AS stock_quantity
     FROM pos.pos_products pp
     JOIN pos.pos_product_skus s
       ON s.product_id = pp.id AND s.is_active = true
     WHERE pp.product_kind = 'merchandise'
       AND pp.source_product_id = ANY($1::uuid[])
     ORDER BY pp.source_product_id ASC, s.sku ASC`,
    [productIds]
  );

  for (const row of rows) {
    const list = map.get(row.product_id) ?? [];
    list.push({
      pos_sku_id: row.pos_sku_id,
      pos_sku_code: row.pos_sku_code,
      pos_sku_name: row.pos_sku_name,
      stock_quantity: toNumber(row.stock_quantity),
    });
    map.set(row.product_id, list);
  }

  return map;
}

export async function ensureProductInventoryId(
  db: PgClient,
  params: {
    productId: string;
    unitCost: number;
    userId: string;
  }
): Promise<string> {
  const existing = await queryOne<{ id: string }>(
    `SELECT id
     FROM inventory.finished_goods_inventory
     WHERE product_id = $1
       AND is_active = true
     LIMIT 1`,
    [params.productId]
  );
  if (existing?.id) return existing.id;

  const { data, error } = await db
    .from("finished_goods_inventory")
    .insert({
      product_id: params.productId,
      qty_available: 0,
      unit_cost: params.unitCost,
      is_active: true,
      created_by: params.userId,
      updated_by: params.userId,
    })
    .select("id")
    .single();

  if (error || !data?.id) throw error ?? new Error("Gagal membuat record stok produk");
  return data.id as string;
}

export async function fetchProductStockOpnameDetail(id: string) {
  const header = await queryOne<{
    id: string;
    opname_number: string;
    company_id: string | null;
    branch_id: string | null;
    warehouse_id: string | null;
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
    warehouse_name: string | null;
    warehouse_code: string | null;
  }>(
    `SELECT pso.*,
            b.name AS branch_name,
            b.code AS branch_code,
            wh.name AS warehouse_name,
            wh.code AS warehouse_code
     FROM inventory.product_stock_opnames pso
     LEFT JOIN configuration.branches b ON b.id = pso.branch_id
     LEFT JOIN configuration.warehouses wh ON wh.id = pso.warehouse_id
     WHERE pso.id = $1`,
    [id]
  );

  if (!header) return null;

  const lines = await query<{
    id: string;
    product_stock_opname_id: string;
    inventory_id: string;
    product_id: string;
    pos_sku_id: string | null;
    qty_system: number | string;
    qty_counted: number | string | null;
    qty_variance: number | string | null;
    unit_cost: number | string | null;
    notes: string | null;
    product_kode: string | null;
    product_nama: string | null;
    satuan: string | null;
    pos_sku_code: string | null;
    pos_sku_name: string | null;
  }>(
    `SELECT psol.*,
            p.kode AS product_kode,
            p.nama AS product_nama,
            u.nama AS satuan,
            sk.sku AS pos_sku_code,
            sk.name AS pos_sku_name
     FROM inventory.product_stock_opname_lines psol
     JOIN products p ON p.id = psol.product_id
     LEFT JOIN units u ON u.id = p.satuan_id
     LEFT JOIN pos.pos_product_skus sk ON sk.id = psol.pos_sku_id
     WHERE psol.product_stock_opname_id = $1
     ORDER BY p.nama ASC, sk.sku ASC NULLS FIRST`,
    [id]
  );

  return {
    id: header.id,
    opname_number: header.opname_number,
    company_id: header.company_id,
    branch_id: header.branch_id,
    warehouse_id: header.warehouse_id,
    opname_date: header.opname_date,
    status: header.status,
    reason: header.reason,
    notes: header.notes,
    total_lines: header.total_lines,
    lines_counted: header.lines_counted,
    lines_with_variance: header.lines_with_variance,
    completed_at: header.completed_at,
    created_at: header.created_at,
    updated_at: header.updated_at,
    branch: header.branch_id
      ? {
          id: header.branch_id,
          name: header.branch_name || "—",
          code: header.branch_code || "",
        }
      : null,
    warehouse: header.warehouse_id
      ? {
          id: header.warehouse_id,
          name: header.warehouse_name || "—",
          code: header.warehouse_code || "",
        }
      : null,
    lines: lines.map((line) => ({
      id: line.id,
      product_stock_opname_id: line.product_stock_opname_id,
      inventory_id: line.inventory_id,
      product_id: line.product_id,
      qty_system: toNumber(line.qty_system),
      qty_counted:
        line.qty_counted === null || line.qty_counted === undefined
          ? null
          : toNumber(line.qty_counted),
      qty_variance:
        line.qty_variance === null || line.qty_variance === undefined
          ? null
          : toNumber(line.qty_variance),
      unit_cost: toNumber(line.unit_cost),
      notes: line.notes,
      product_kode: line.product_kode,
      product_nama: line.product_nama,
      satuan: line.satuan,
      pos_sku_id: line.pos_sku_id,
      pos_sku_code: line.pos_sku_code,
      pos_sku_name: line.pos_sku_name,
    })),
  };
}

export function resolveOpnameScopeIds(scope: UserScope | null) {
  return {
    companyId: effectiveCompanyId(scope),
    branchId: effectiveBranchId(scope),
  };
}

/**
 * Guard for the single-record fetch path (GET/PATCH/complete on
 * `[id]`) — `fetchProductStockOpnameDetail` itself has no scope predicate,
 * so callers MUST check this before trusting the detail. Mirrors the exact
 * fields/semantics of `buildOpnameScopeFilter` (branch scope → branch_id
 * only; otherwise → company_id only; unscoped/super_admin → always true).
 */
function isOpnameInScope(
  scope: UserScope | null,
  opname: { company_id: string | null; branch_id: string | null }
): boolean {
  if (!scope || scope.isUnscoped) return true;

  if (scope.businessScope === "branch" && scope.branchId) {
    return opname.branch_id === scope.branchId;
  }
  if (scope.companyId) {
    return opname.company_id === scope.companyId;
  }
  return true;
}

export { buildOpnameScopeFilter, isOpnameInScope };

// ---------------------------------------------------------------------------
// EPIC-047 Fase 3 — complete: per-line decision + Σ-selisih per produk ber-
// varian. Murni (tanpa I/O); route yang men-supply `qty_before` (untuk baris
// SKU: stok live `pos_product_skus` hasil `SELECT ... FOR UPDATE`; untuk
// baris non-SKU: `qty_system` opname, jalur lama byte-identical).
// ---------------------------------------------------------------------------

export interface OpnameCompleteLineInput {
  id: string;
  product_id: string;
  pos_sku_id: string | null;
  qty_before: number;
  qty_counted: number;
}

export interface OpnameSkuLineSummary {
  id: string;
  product_id: string;
  pos_sku_id: string;
  qty_before: number;
  qty_after: number;
  delta: number;
}

export interface OpnameProductLineSummary {
  id: string;
  product_id: string;
  qty_before: number;
  qty_after: number;
  delta: number;
}

export interface OpnameProductDelta {
  product_id: string;
  delta: number;
}

export interface OpnameSkuDeltaSummary {
  skuLines: OpnameSkuLineSummary[];
  productLines: OpnameProductLineSummary[];
  /** Σ selisih per produk ber-varian, HANYA produk dengan Σ ≠ 0 (zero-delta
   *  di-skip — tidak ada penyesuaian `finished_goods_inventory` / movement). */
  productDeltas: OpnameProductDelta[];
}

/**
 * Guard: produk ber-varian (punya ≥1 baris `pos_sku_id`) tidak boleh JUGA
 * punya baris level produk (`pos_sku_id` null) di opname yang sama —
 * ekspansi preview (`expandOpnameLinesBySku`) menjamin ini, tapi kita
 * asersi di sini supaya data korup (mis. hasil migrasi manual) tidak lolos
 * diam-diam saat complete.
 */
export function summarizeOpnameSkuDeltas(
  lines: OpnameCompleteLineInput[]
): OpnameSkuDeltaSummary {
  const variantProductIds = new Set(
    lines.filter((line) => line.pos_sku_id).map((line) => line.product_id)
  );
  const conflict = lines.find(
    (line) => !line.pos_sku_id && variantProductIds.has(line.product_id)
  );
  if (conflict) {
    throw new Error(
      `Produk ${conflict.product_id} punya baris SKU dan baris level produk sekaligus dalam satu opname`
    );
  }

  const skuLines: OpnameSkuLineSummary[] = [];
  const productLines: OpnameProductLineSummary[] = [];
  const deltaByProduct = new Map<string, number>();

  for (const line of lines) {
    const delta = toNumber(line.qty_counted) - toNumber(line.qty_before);

    if (line.pos_sku_id) {
      skuLines.push({
        id: line.id,
        product_id: line.product_id,
        pos_sku_id: line.pos_sku_id,
        qty_before: toNumber(line.qty_before),
        qty_after: toNumber(line.qty_counted),
        delta,
      });
      deltaByProduct.set(line.product_id, (deltaByProduct.get(line.product_id) ?? 0) + delta);
    } else {
      productLines.push({
        id: line.id,
        product_id: line.product_id,
        qty_before: toNumber(line.qty_before),
        qty_after: toNumber(line.qty_counted),
        delta,
      });
    }
  }

  const productDeltas = Array.from(deltaByProduct.entries())
    .filter(([, delta]) => delta !== 0)
    .map(([product_id, delta]) => ({ product_id, delta }));

  return { skuLines, productLines, productDeltas };
}
