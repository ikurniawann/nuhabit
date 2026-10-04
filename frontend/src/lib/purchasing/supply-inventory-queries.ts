// EPIC-026 C2 — bacaan stok barang operasional (per gudang) untuk
// /api/purchasing/inventory/supply/**. Mutasi stok: ./supply-inventory.
import { ApiError } from "@/lib/api/auth";
import { branchScopeOr, companyScopeOr, type UserScope } from "@/lib/api/scope";
import { query, queryOne } from "@/lib/db";
import type { DbClient } from "@/lib/pg/types";

/** Sesi tanpa scope (tanpa login/profil) → 401, perilaku lama route supply. */
export function requireSupplyScope(scope: UserScope | null): UserScope {
  if (!scope) throw ApiError.unauthorized("Unauthorized");
  return scope;
}

/** User ber-scope hanya melihat stok cabangnya (+ baris global null); null = semua. */
export function supplyBranchFilter(scope: UserScope): string | null {
  return scope.isUnscoped ? null : scope.branchId;
}

export type SupplyStockRow = {
  id: string;
  supply_item_id: string;
  warehouse_id: string | null;
  warehouse_nama: string | null;
  item_kode: string;
  item_nama: string;
  item_kategori: string | null;
  satuan_nama: string | null;
  qty_available: string;
  qty_on_order: string;
  qty_minimum: string;
  unit_cost: string;
  last_movement_at: string | null;
};

export async function listSupplyStock(
  scope: UserScope,
  params: { search: string | null; warehouseId: string | null; lowStock: boolean }
): Promise<SupplyStockRow[]> {
  return query<SupplyStockRow>(
    `SELECT si.id,
            si.supply_item_id,
            si.warehouse_id,
            w.name AS warehouse_nama,
            s.kode AS item_kode,
            s.nama AS item_nama,
            s.kategori AS item_kategori,
            u.nama AS satuan_nama,
            COALESCE(si.qty_available, 0) AS qty_available,
            COALESCE(si.qty_on_order, 0) AS qty_on_order,
            GREATEST(COALESCE(si.qty_minimum, 0), COALESCE(s.stok_minimum, 0)) AS qty_minimum,
            COALESCE(si.unit_cost, 0) AS unit_cost,
            si.last_movement_at
     FROM supply_inventory si
     JOIN supply_items s ON s.id = si.supply_item_id
     LEFT JOIN configuration.warehouses w ON w.id = si.warehouse_id
     LEFT JOIN units u ON u.id = s.satuan_id
     WHERE si.is_active = true
       AND ($1::uuid IS NULL OR si.branch_id = $1 OR si.branch_id IS NULL)
       AND ($2::uuid IS NULL OR si.warehouse_id = $2)
       AND ($3::text IS NULL OR s.nama ILIKE '%' || $3 || '%' OR s.kode ILIKE '%' || $3 || '%')
       AND ($4::boolean = false OR COALESCE(si.qty_available,0) <= GREATEST(COALESCE(si.qty_minimum,0), COALESCE(s.stok_minimum,0)))
     ORDER BY s.nama ASC`,
    [supplyBranchFilter(scope), params.warehouseId, params.search, params.lowStock]
  );
}

type SupplyStockHeader = SupplyStockRow & {
  stockable: boolean;
  branch_id: string | null;
};

/** Saldo + kartu stok (200 pergerakan terakhir); baris cabang lain → 404. */
export async function getSupplyStockDetail(scope: UserScope, id: string) {
  const header = await queryOne<SupplyStockHeader>(
    `SELECT si.id,
            si.supply_item_id,
            si.warehouse_id,
            w.name AS warehouse_nama,
            s.kode AS item_kode,
            s.nama AS item_nama,
            s.kategori AS item_kategori,
            s.stockable,
            u.nama AS satuan_nama,
            COALESCE(si.qty_available, 0) AS qty_available,
            COALESCE(si.qty_on_order, 0) AS qty_on_order,
            GREATEST(COALESCE(si.qty_minimum, 0), COALESCE(s.stok_minimum, 0)) AS qty_minimum,
            COALESCE(si.unit_cost, 0) AS unit_cost,
            si.branch_id,
            si.last_movement_at
     FROM supply_inventory si
     JOIN supply_items s ON s.id = si.supply_item_id
     LEFT JOIN configuration.warehouses w ON w.id = si.warehouse_id
     LEFT JOIN units u ON u.id = s.satuan_id
     WHERE si.id = $1`,
    [id]
  );
  if (!header || (!scope.isUnscoped && header.branch_id && header.branch_id !== scope.branchId)) {
    throw ApiError.notFound("Stok tidak ditemukan");
  }

  const movements = await query(
    `SELECT id, tipe, jumlah, qty_before, qty_after, unit_cost, total_cost,
            reference_type, reference_id, reference_number, alasan, catatan, created_at
     FROM supply_inventory_movements
     WHERE supply_inventory_id = $1
     ORDER BY created_at DESC, id DESC
     LIMIT 200`,
    [id]
  );
  return { ...header, movements };
}

/** Pilihan form pemakaian/penyesuaian: gudang, barang stockable, satuan. */
export async function getSupplyFormData(db: DbClient, scope: UserScope) {
  const companyOr = companyScopeOr(scope);
  const branchOr = branchScopeOr(scope);

  let warehousesQuery = db
    .from("warehouses", "configuration")
    .select("id, name, code")
    .eq("is_active", true)
    .order("name");
  if (branchOr) warehousesQuery = warehousesQuery.or(branchOr);

  let suppliesQuery = db
    .from("supply_items")
    .select("id, kode, nama, satuan_id, stok_minimum")
    .eq("is_active", true)
    .eq("stockable", true)
    .is("deleted_at", null)
    .order("nama");
  if (companyOr) suppliesQuery = suppliesQuery.or(companyOr);
  if (branchOr) suppliesQuery = suppliesQuery.or(branchOr);

  const [{ data: warehouses }, { data: supplies }, { data: units }] = await Promise.all([
    warehousesQuery,
    suppliesQuery,
    db.from("units").select("id, nama, kode").eq("is_active", true).order("nama"),
  ]);
  return { warehouses: warehouses || [], supplies: supplies || [], units: units || [] };
}
