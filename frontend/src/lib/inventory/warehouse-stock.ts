import { query, queryOne } from "@/lib/db";
import { branchScopeOr, companyScopeOr, type UserScope } from "@/lib/api/scope";
import { createServerPgClient } from "@/lib/pg/create-client";

function toNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export type RawMaterialStockRow = {
  raw_material_id: string;
  inventory_id: string | null;
  material_kode: string;
  material_nama: string;
  material_kategori: string | null;
  satuan: string | null;
  satuan_besar_nama: string | null;
  satuan_kecil_nama: string | null;
  konversi_factor: number | null;
  harga_beli: number | null;
  qty_onhand: number;
  min_stock: number;
  max_stock: number | null;
  unit_cost: number;
  warehouse_id: string | null;
  warehouse_nama: string | null;
};

type StockQueryRow = {
  inventory_id: string | null;
  raw_material_id: string;
  material_kode: string;
  material_nama: string;
  material_kategori: string | null;
  satuan: string | null;
  satuan_besar_nama: string | null;
  satuan_kecil_nama: string | null;
  konversi_factor: number | string | null;
  harga_beli: number | string | null;
  qty_onhand: number | string | null;
  min_stock: number | string | null;
  max_stock: number | string | null;
  unit_cost: number | string | null;
  warehouse_id: string | null;
  warehouse_nama: string | null;
};

function mapQueryRow(row: StockQueryRow): RawMaterialStockRow {
  return {
    raw_material_id: row.raw_material_id,
    inventory_id: row.inventory_id,
    material_kode: row.material_kode,
    material_nama: row.material_nama,
    material_kategori: row.material_kategori,
    satuan: row.satuan,
    satuan_besar_nama: row.satuan_besar_nama,
    satuan_kecil_nama: row.satuan_kecil_nama,
    konversi_factor:
      row.konversi_factor != null ? toNumber(row.konversi_factor) : null,
    harga_beli: row.harga_beli != null ? toNumber(row.harga_beli) : null,
    qty_onhand: toNumber(row.qty_onhand),
    min_stock: toNumber(row.min_stock),
    max_stock: row.max_stock != null ? toNumber(row.max_stock) : null,
    unit_cost: toNumber(row.unit_cost),
    warehouse_id: row.warehouse_id,
    warehouse_nama: row.warehouse_nama,
  };
}

export function computeStockStatus(
  qtyOnhand: number,
  minStock: number
): "AMAN" | "MENIPIS" | "HABIS" {
  if (qtyOnhand <= 0) return "HABIS";
  if (qtyOnhand <= minStock) return "MENIPIS";
  return "AMAN";
}

export function mapRawMaterialStockRow(row: RawMaterialStockRow) {
  const qtyOnhand = row.qty_onhand;
  const unitCost = row.unit_cost;
  return {
    id: row.raw_material_id,
    kode: row.material_kode,
    nama: row.material_nama,
    kategori: row.material_kategori,
    qty_onhand: qtyOnhand,
    min_stock: row.min_stock,
    max_stock: row.max_stock,
    unit_cost: unitCost,
    avg_cost: unitCost,
    total_value: qtyOnhand * unitCost,
    status_stok: computeStockStatus(qtyOnhand, row.min_stock),
    satuan: row.satuan || row.satuan_besar_nama || null,
    satuan_besar_nama: row.satuan_besar_nama || row.satuan || null,
    satuan_kecil_nama: row.satuan_kecil_nama,
    konversi_factor: row.konversi_factor,
    harga_beli: row.harga_beli,
    warehouse_id: row.warehouse_id,
    warehouse_nama: row.warehouse_nama,
  };
}

/** Stok per lokasi gudang: semua bahan baku cabang + qty di gudang tersebut. */
export async function listRawMaterialStockByWarehouse(
  warehouseId: string
): Promise<RawMaterialStockRow[]> {
  const warehouse = await queryOne<{
    branch_id: string;
    warehouse_nama: string;
  }>(
    `SELECT branch_id, name AS warehouse_nama
     FROM configuration.warehouses
     WHERE id = $1 AND is_active = true`,
    [warehouseId]
  );
  if (!warehouse?.branch_id) return [];

  const rows = await query<StockQueryRow>(
    `SELECT inv.id AS inventory_id,
            rm.id AS raw_material_id,
            rm.kode AS material_kode,
            rm.nama AS material_nama,
            rm.kategori AS material_kategori,
            u_besar.nama AS satuan,
            u_besar.nama AS satuan_besar_nama,
            u_kecil.nama AS satuan_kecil_nama,
            rm.konversi_factor,
            rm.harga_beli,
            COALESCE(inv.qty_available, 0) AS qty_onhand,
            COALESCE(rm.stok_minimum, inv.qty_minimum, 0) AS min_stock,
            COALESCE(rm.stok_maximum, inv.qty_maximum) AS max_stock,
            COALESCE(inv.unit_cost, rm.harga_beli, 0) AS unit_cost,
            $1::uuid AS warehouse_id,
            $3::text AS warehouse_nama
     FROM raw_materials rm
     LEFT JOIN units u_besar ON u_besar.id = rm.satuan_besar_id
     LEFT JOIN units u_kecil ON u_kecil.id = rm.satuan_kecil_id
     LEFT JOIN inventory inv
       ON inv.raw_material_id = rm.id
      AND inv.warehouse_id = $1
      AND inv.is_active = true
     WHERE rm.deleted_at IS NULL
       AND rm.is_active = true
       AND rm.branch_id = $2
     ORDER BY rm.nama ASC`,
    [warehouseId, warehouse.branch_id, warehouse.warehouse_nama]
  );

  return rows.map(mapQueryRow);
}

/** Stok agregat cabang: jumlah qty dari semua gudang aktif di cabang yang sama. */
export async function listRawMaterialStockByBranch(
  branchId: string
): Promise<RawMaterialStockRow[]> {
  const rows = await query<StockQueryRow>(
    `SELECT NULL::uuid AS inventory_id,
            rm.id AS raw_material_id,
            rm.kode AS material_kode,
            rm.nama AS material_nama,
            rm.kategori AS material_kategori,
            u_besar.nama AS satuan,
            u_besar.nama AS satuan_besar_nama,
            u_kecil.nama AS satuan_kecil_nama,
            rm.konversi_factor,
            rm.harga_beli,
            COALESCE(SUM(inv.qty_available), 0) AS qty_onhand,
            COALESCE(rm.stok_minimum, 0) AS min_stock,
            rm.stok_maximum AS max_stock,
            CASE
              WHEN COALESCE(SUM(inv.qty_available), 0) > 0
                THEN SUM(inv.qty_available * COALESCE(inv.unit_cost, 0))
                     / SUM(inv.qty_available)
              ELSE COALESCE(AVG(inv.unit_cost), rm.harga_beli, 0)
            END AS unit_cost,
            NULL::uuid AS warehouse_id,
            NULL::text AS warehouse_nama
     FROM raw_materials rm
     LEFT JOIN units u_besar ON u_besar.id = rm.satuan_besar_id
     LEFT JOIN units u_kecil ON u_kecil.id = rm.satuan_kecil_id
     LEFT JOIN inventory inv
       ON inv.raw_material_id = rm.id
      AND inv.is_active = true
      AND inv.warehouse_id IN (
            SELECT w.id
            FROM configuration.warehouses w
            WHERE w.branch_id = $1
              AND w.is_active = true
          )
     WHERE rm.deleted_at IS NULL
       AND rm.is_active = true
       AND rm.branch_id = $1
     GROUP BY rm.id, rm.kode, rm.nama, rm.kategori, rm.konversi_factor,
              rm.harga_beli, rm.stok_minimum, rm.stok_maximum,
              u_besar.nama, u_kecil.nama
     ORDER BY rm.nama ASC`,
    [branchId]
  );

  return rows.map(mapQueryRow);
}

/** Filter search (kode/nama) + status stok untuk daftar stok bahan baku. */
export function filterStockRows(rows: RawMaterialStockRow[], search?: string, status?: string) {
  let filtered = rows;
  const q = search?.trim().toLowerCase();
  if (q) {
    filtered = filtered.filter(
      (row) => row.material_nama.toLowerCase().includes(q) || row.material_kode.toLowerCase().includes(q)
    );
  }
  if (status === "out_of_stock") return filtered.filter((row) => row.qty_onhand <= 0);
  if (status === "low_stock") {
    return filtered.filter(
      (row) => row.qty_onhand > 0 && computeStockStatus(row.qty_onhand, row.min_stock) === "MENIPIS"
    );
  }
  if (status === "normal") {
    return filtered.filter((row) => computeStockStatus(row.qty_onhand, row.min_stock) === "AMAN");
  }
  return filtered;
}

export function paginateRows<T>(rows: T[], page: number, limit: number) {
  const offset = (page - 1) * limit;
  return { total: rows.length, data: rows.slice(offset, offset + limit) };
}

const LEGACY_STATUS: Record<string, string> = { out_of_stock: "HABIS", low_stock: "MENIPIS", normal: "AMAN" };

/** Stok tanpa cabang efektif: view lama v_raw_materials_stock dengan filter company/branch. */
export async function listLegacyRawMaterialStock(opts: {
  scope: UserScope | null;
  search?: string;
  status?: string;
  page: number;
  limit: number;
}) {
  const { scope, search, status, page, limit } = opts;
  const db = await createServerPgClient();
  let q = db.from("v_raw_materials_stock").select("*", { count: "exact" }).is("deleted_at", null).eq("is_active", true);
  const companyOr = companyScopeOr(scope);
  if (companyOr) q = q.or(companyOr);
  const branchOr = branchScopeOr(scope);
  if (branchOr) q = q.or(branchOr);
  if (search) q = q.or(`nama.ilike.%${search}%,kode.ilike.%${search}%`);
  if (status && LEGACY_STATUS[status]) q = q.eq("status_stok", LEGACY_STATUS[status]);

  const offset = (page - 1) * limit;
  const { data, error, count } = await q.order("nama", { ascending: true }).range(offset, offset + limit - 1);
  if (error) throw error;
  return { data: data || [], total: count || 0 };
}
