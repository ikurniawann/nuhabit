import { query, queryOne } from "@/lib/db";
import {
  listRawMaterialStockByWarehouse,
  type RawMaterialStockRow,
} from "@/lib/inventory/warehouse-stock";

function toNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export interface WarehouseOpnamePreviewLine {
  /** Null bila belum ada baris inventory di gudang ini (stok sistem = 0). */
  inventory_id: string | null;
  raw_material_id: string;
  material_kode: string;
  material_nama: string;
  satuan: string | null;
  satuan_besar_nama: string | null;
  satuan_kecil_nama: string | null;
  konversi_factor: number | null;
  qty_system: number;
  unit_cost: number;
}

function mapStockRowToOpnameLine(row: RawMaterialStockRow): WarehouseOpnamePreviewLine {
  return {
    inventory_id: row.inventory_id,
    raw_material_id: row.raw_material_id,
    material_kode: row.material_kode,
    material_nama: row.material_nama,
    satuan: row.satuan,
    satuan_besar_nama: row.satuan_besar_nama,
    satuan_kecil_nama: row.satuan_kecil_nama,
    konversi_factor: row.konversi_factor,
    qty_system: row.qty_onhand,
    unit_cost: row.unit_cost,
  };
}

/** Semua bahan baku cabang + stok sistem per lokasi gudang. */
export async function listWarehouseInventoryForOpname(
  warehouseId: string
): Promise<WarehouseOpnamePreviewLine[]> {
  const rows = await listRawMaterialStockByWarehouse(warehouseId);
  return rows.map(mapStockRowToOpnameLine);
}

type PgClient = Awaited<
  ReturnType<typeof import("@/lib/pg/create-client").createServerPgClient>
>;

/** Buat baris inventory kosong di gudang bila bahan baku belum punya record lokasi. */
export async function ensureWarehouseInventoryId(
  db: PgClient,
  params: {
    rawMaterialId: string;
    warehouseId: string;
    branchId: string;
    unitCost: number;
    userId: string;
  }
): Promise<string> {
  const existing = await queryOne<{ id: string }>(
    `SELECT id
     FROM inventory
     WHERE raw_material_id = $1
       AND warehouse_id = $2
       AND is_active = true
     LIMIT 1`,
    [params.rawMaterialId, params.warehouseId]
  );
  if (existing?.id) return existing.id;

  const { data, error } = await db
    .from("inventory")
    .insert({
      raw_material_id: params.rawMaterialId,
      warehouse_id: params.warehouseId,
      branch_id: params.branchId,
      qty_available: 0,
      unit_cost: params.unitCost,
      is_active: true,
      created_by: params.userId,
      updated_by: params.userId,
    })
    .select("id")
    .single();

  if (error || !data?.id) throw error ?? new Error("Gagal membuat record inventory");
  return data.id as string;
}

export async function fetchStockOpnameDetail(id: string) {
  const header = await queryOne<{
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
  }>(
    `SELECT so.*,
            wh.name AS warehouse_name,
            wh.code AS warehouse_code
     FROM inventory.stock_opnames so
     LEFT JOIN configuration.warehouses wh ON wh.id = so.warehouse_id
     WHERE so.id = $1`,
    [id]
  );

  if (!header) return null;

  const lines = await query<{
    id: string;
    stock_opname_id: string;
    inventory_id: string;
    raw_material_id: string;
    qty_system: number | string;
    qty_counted: number | string | null;
    qty_variance: number | string | null;
    unit_cost: number | string | null;
    notes: string | null;
    material_kode: string | null;
    material_nama: string | null;
    satuan: string | null;
    satuan_besar_nama: string | null;
    satuan_kecil_nama: string | null;
    konversi_factor: number | string | null;
  }>(
    `SELECT sol.*,
            rm.kode AS material_kode,
            rm.nama AS material_nama,
            u_besar.nama AS satuan,
            u_besar.nama AS satuan_besar_nama,
            u_kecil.nama AS satuan_kecil_nama,
            rm.konversi_factor
     FROM inventory.stock_opname_lines sol
     JOIN raw_materials rm ON rm.id = sol.raw_material_id
     LEFT JOIN units u_besar ON u_besar.id = rm.satuan_besar_id
     LEFT JOIN units u_kecil ON u_kecil.id = rm.satuan_kecil_id
     WHERE sol.stock_opname_id = $1
     ORDER BY rm.nama ASC`,
    [id]
  );

  return {
    id: header.id,
    opname_number: header.opname_number,
    warehouse_id: header.warehouse_id,
    branch_id: header.branch_id,
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
    warehouse: header.warehouse_id
      ? {
          id: header.warehouse_id,
          name: header.warehouse_name || "—",
          code: header.warehouse_code || "",
        }
      : null,
    lines: lines.map((line) => ({
      id: line.id,
      stock_opname_id: line.stock_opname_id,
      inventory_id: line.inventory_id,
      raw_material_id: line.raw_material_id,
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
      material_kode: line.material_kode,
      material_nama: line.material_nama,
      satuan: line.satuan,
      satuan_besar_nama: line.satuan_besar_nama,
      satuan_kecil_nama: line.satuan_kecil_nama,
      konversi_factor:
        line.konversi_factor != null ? toNumber(line.konversi_factor) : null,
    })),
  };
}
