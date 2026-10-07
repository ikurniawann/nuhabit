import { query, queryOne } from "@/lib/db";
import type { UserScope } from "@/lib/api/scope";
import { addDays, summarizeExpiry, todayJakarta, type ExpirySummary } from "@/lib/inventory/batches";

/**
 * Query baca inventori lintas item: batch kedaluwarsa, batch terbuka per
 * gudang, mutasi stok, dan riwayat scrap. Semua dibatasi scope bisnis user.
 */

class SqlParams {
  values: unknown[] = [];
  add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

/** Batasi kolom branch sesuai scope user (branch → miliknya, company → cabang company). */
function scopeClause(scope: UserScope | null, branchColumn: string, params: SqlParams): string | null {
  if (!scope || scope.isUnscoped) return null;
  if (scope.businessScope === "branch" && scope.branchId) {
    return `${branchColumn} = ${params.add(scope.branchId)}`;
  }
  if (scope.businessScope === "company" && scope.companyId) {
    return `${branchColumn} IN (SELECT id FROM configuration.branches WHERE company_id = ${params.add(scope.companyId)})`;
  }
  return null;
}

// ── Kedaluwarsa ──────────────────────────────────────────────────────────────

export type ExpiryFilter = "all" | "near" | "expired";

export interface ExpiringBatchRow {
  id: string;
  inventory_id: string;
  raw_material_id: string;
  material_kode: string;
  material_nama: string;
  satuan: string | null;
  warehouse_id: string | null;
  warehouse_nama: string | null;
  branch_id: string | null;
  branch_nama: string | null;
  batch_number: string | null;
  expiry_date: string;
  days_left: number;
  qty_remaining: number;
  avg_cost: number;
  value_at_risk: number;
  source_type: string;
  received_at: string;
}

export async function listExpiringBatches(opts: {
  scope: UserScope | null;
  days: number;
  status: ExpiryFilter;
  warehouseId?: string | null;
  branchId?: string | null;
  search?: string | null;
  today?: string;
}): Promise<{ rows: ExpiringBatchRow[]; summary: ExpirySummary; today: string; horizon: string }> {
  const today = opts.today ?? todayJakarta();
  const horizon = addDays(today, Math.max(0, opts.days));
  const params = new SqlParams();
  const where = ["b.qty_remaining > 0", "b.expiry_date IS NOT NULL"];

  if (opts.status === "expired") where.push(`b.expiry_date < ${params.add(today)}::date`);
  else if (opts.status === "near") {
    where.push(`b.expiry_date >= ${params.add(today)}::date`, `b.expiry_date <= ${params.add(horizon)}::date`);
  } else where.push(`b.expiry_date <= ${params.add(horizon)}::date`);

  if (opts.warehouseId) where.push(`b.warehouse_id = ${params.add(opts.warehouseId)}`);
  if (opts.branchId) where.push(`b.branch_id = ${params.add(opts.branchId)}`);
  if (opts.search?.trim()) {
    const term = params.add(`%${opts.search.trim()}%`);
    where.push(`(rm.nama ILIKE ${term} OR rm.kode ILIKE ${term} OR b.batch_number ILIKE ${term})`);
  }
  const scoped = scopeClause(opts.scope, "b.branch_id", params);
  if (scoped) where.push(scoped);

  const todayParam = params.add(today);
  const rows = await query<ExpiringBatchRow>(
    `SELECT b.id, b.inventory_id, b.raw_material_id, rm.kode AS material_kode, rm.nama AS material_nama,
            COALESCE(u_kecil.nama, u_besar.nama) AS satuan,
            b.warehouse_id, w.name AS warehouse_nama, b.branch_id, br.name AS branch_nama,
            b.batch_number, b.expiry_date::text AS expiry_date,
            (b.expiry_date - ${todayParam}::date)::int AS days_left,
            b.qty_remaining::float8 AS qty_remaining,
            COALESCE(inv.unit_cost, b.unit_cost)::float8 AS avg_cost,
            (b.qty_remaining * COALESCE(inv.unit_cost, b.unit_cost))::float8 AS value_at_risk,
            b.source_type, b.received_at::text AS received_at
       FROM inventory.stock_batches b
       JOIN inventory.inventory inv ON inv.id = b.inventory_id
       JOIN item.raw_materials rm ON rm.id = b.raw_material_id
       LEFT JOIN item.units u_kecil ON u_kecil.id = rm.satuan_kecil_id
       LEFT JOIN item.units u_besar ON u_besar.id = rm.satuan_besar_id
       LEFT JOIN configuration.warehouses w ON w.id = b.warehouse_id
       LEFT JOIN configuration.branches br ON br.id = b.branch_id
      WHERE ${where.join(" AND ")}
      ORDER BY b.expiry_date ASC, rm.nama ASC
      LIMIT 1000`,
    params.values
  );

  const summary = summarizeExpiry(
    rows.map((row) => ({ expiryDate: row.expiry_date, qtyRemaining: row.qty_remaining, valueCost: row.avg_cost })),
    today,
    opts.days
  );
  return { rows, summary, today, horizon };
}

// ── Batch terbuka per gudang (pemilih batch scrap) ───────────────────────────

export interface OpenBatchRow {
  id: string;
  batch_number: string | null;
  expiry_date: string | null;
  qty_remaining: number;
  received_at: string;
  source_type: string;
}

export async function listOpenBatches(rawMaterialId: string, warehouseId: string): Promise<OpenBatchRow[]> {
  return query<OpenBatchRow>(
    `SELECT b.id, b.batch_number, b.expiry_date::text AS expiry_date,
            b.qty_remaining::float8 AS qty_remaining, b.received_at::text AS received_at, b.source_type
       FROM inventory.stock_batches b
       JOIN inventory.inventory inv ON inv.id = b.inventory_id
      WHERE b.raw_material_id = $1 AND inv.warehouse_id = $2 AND b.qty_remaining > 0
      ORDER BY b.expiry_date ASC NULLS LAST, b.received_at ASC`,
    [rawMaterialId, warehouseId]
  );
}

// ── Mutasi stok lintas item ──────────────────────────────────────────────────

export interface MovementFilter {
  scope: UserScope | null;
  rawMaterialId?: string | null;
  warehouseId?: string | null;
  tipe?: string | null;
  referenceType?: string | null;
  /** Cari nomor/ID referensi atau nama bahan. */
  reference?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
}

export interface MovementRow {
  id: string;
  created_at: string;
  raw_material_id: string;
  material_kode: string;
  material_nama: string;
  satuan: string | null;
  warehouse_id: string | null;
  warehouse_nama: string | null;
  tipe: string;
  direction: "in" | "out" | "none";
  jumlah: number;
  qty_before: number;
  qty_after: number;
  unit_cost: number | null;
  total_cost: number | null;
  reference_type: string | null;
  reference_number: string | null;
  reference_id: string | null;
  batch_numbers: string | null;
  alasan: string | null;
  created_by_name: string | null;
}

function movementWhere(filter: MovementFilter, params: SqlParams): string {
  const where = ["m.is_active = true"];
  if (filter.rawMaterialId) where.push(`m.raw_material_id = ${params.add(filter.rawMaterialId)}`);
  if (filter.warehouseId) where.push(`m.warehouse_id = ${params.add(filter.warehouseId)}`);
  if (filter.tipe) where.push(`m.tipe = ${params.add(filter.tipe)}`);
  if (filter.referenceType) where.push(`m.reference_type = ${params.add(filter.referenceType)}`);
  if (filter.reference?.trim()) {
    const term = params.add(`%${filter.reference.trim()}%`);
    where.push(`(m.reference_number ILIKE ${term} OR m.reference_id::text ILIKE ${term} OR rm.nama ILIKE ${term} OR rm.kode ILIKE ${term})`);
  }
  if (filter.dateFrom) where.push(`m.created_at >= ${params.add(filter.dateFrom)}::date`);
  if (filter.dateTo) where.push(`m.created_at < (${params.add(filter.dateTo)}::date + 1)`);
  const scoped = scopeClause(filter.scope, "m.branch_id", params);
  if (scoped) where.push(scoped);
  return where.join(" AND ");
}

const MOVEMENT_SELECT = `
  SELECT m.id, m.created_at::text AS created_at, m.raw_material_id,
         rm.kode AS material_kode, rm.nama AS material_nama,
         COALESCE(u_kecil.nama, u_besar.nama) AS satuan,
         m.warehouse_id, w.name AS warehouse_nama, m.tipe,
         CASE WHEN m.qty_after > m.qty_before THEN 'in'
              WHEN m.qty_after < m.qty_before THEN 'out' ELSE 'none' END AS direction,
         m.jumlah::float8 AS jumlah, m.qty_before::float8 AS qty_before, m.qty_after::float8 AS qty_after,
         m.unit_cost::float8 AS unit_cost, m.total_cost::float8 AS total_cost,
         m.reference_type, m.reference_number, m.reference_id::text AS reference_id,
         (SELECT string_agg(DISTINCT sb.batch_number, ', ')
            FROM inventory.stock_batch_movements sbm
            JOIN inventory.stock_batches sb ON sb.id = sbm.batch_id
           WHERE sbm.movement_id = m.id AND sb.batch_number IS NOT NULL) AS batch_numbers,
         m.alasan, u.full_name AS created_by_name
    FROM inventory.inventory_movements m
    JOIN item.raw_materials rm ON rm.id = m.raw_material_id
    LEFT JOIN item.units u_kecil ON u_kecil.id = rm.satuan_kecil_id
    LEFT JOIN item.units u_besar ON u_besar.id = rm.satuan_besar_id
    LEFT JOIN configuration.warehouses w ON w.id = m.warehouse_id
    LEFT JOIN configuration.users u ON u.id = m.created_by`;

export async function listMovements(
  filter: MovementFilter,
  page: { limit: number; offset: number }
): Promise<{ rows: MovementRow[]; total: number }> {
  const params = new SqlParams();
  const where = movementWhere(filter, params);
  const countRow = await queryOne<{ total: string }>(
    `SELECT COUNT(*)::text AS total
       FROM inventory.inventory_movements m
       JOIN item.raw_materials rm ON rm.id = m.raw_material_id
      WHERE ${where}`,
    params.values
  );
  const limit = params.add(page.limit);
  const offset = params.add(page.offset);
  const rows = await query<MovementRow>(
    `${MOVEMENT_SELECT} WHERE ${where} ORDER BY m.created_at DESC, m.id LIMIT ${limit} OFFSET ${offset}`,
    params.values
  );
  return { rows, total: Number(countRow?.total ?? 0) };
}

/** Batas baris ekspor CSV supaya satu permintaan tidak membaca seluruh buku besar. */
const MOVEMENT_EXPORT_LIMIT = 50_000;

export async function listMovementsForExport(filter: MovementFilter): Promise<MovementRow[]> {
  const params = new SqlParams();
  const where = movementWhere(filter, params);
  return query<MovementRow>(
    `${MOVEMENT_SELECT} WHERE ${where} ORDER BY m.created_at DESC, m.id LIMIT ${MOVEMENT_EXPORT_LIMIT}`,
    params.values
  );
}

// ── Pilihan bahan baku ───────────────────────────────────────────────────────

export interface MaterialOption {
  id: string;
  kode: string;
  nama: string;
  satuan: string | null;
}

/** Bahan baku aktif (maks 2000) untuk filter & pemilih, dibatasi company/branch user. */
export async function listActiveMaterialOptions(scope: UserScope | null): Promise<MaterialOption[]> {
  const scoped = scope && !scope.isUnscoped;
  const companyId = scoped && scope.businessScope !== "holding" ? scope.companyId : null;
  const branchId = scoped && scope.businessScope === "branch" ? scope.branchId : null;
  return query<MaterialOption>(
    `SELECT rm.id, rm.kode, rm.nama, COALESCE(u_kecil.nama, u_besar.nama) AS satuan
       FROM item.raw_materials rm
       LEFT JOIN item.units u_kecil ON u_kecil.id = rm.satuan_kecil_id
       LEFT JOIN item.units u_besar ON u_besar.id = rm.satuan_besar_id
      WHERE rm.is_active = true AND rm.deleted_at IS NULL
        AND ($1::uuid IS NULL OR rm.company_id = $1)
        AND ($2::uuid IS NULL OR rm.branch_id = $2)
      ORDER BY rm.nama
      LIMIT 2000`,
    [companyId, branchId]
  );
}
