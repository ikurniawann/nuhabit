// Bacaan stok & pergerakan bahan baku untuk /api/purchasing/inventory/**.
import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { branchScopeOr, companyScopeOr, type UserScope } from "@/lib/api/scope";
import type { rawMaterialStockSource } from "@/lib/api/stall-scope";
import type { DbClient } from "@/lib/pg/types";

type StockSource = Awaited<ReturnType<typeof rawMaterialStockSource>>;

/** Stok bahan baku aktif (per stall aktif atau agregat), opsional hanya yang menipis/habis. */
export async function listRawMaterialStock(
  db: DbClient,
  scope: UserScope | null,
  { view, warehouseId }: StockSource,
  { belowMinimum, search }: { belowMinimum: boolean; search: string | null }
) {
  let query = db.from(view).select("*").eq("is_active", true).is("deleted_at", null);
  if (warehouseId) query = query.eq("warehouse_id", warehouseId);
  const companyOr = companyScopeOr(scope);
  if (companyOr) query = query.or(companyOr);
  const branchOr = branchScopeOr(scope);
  if (branchOr) query = query.or(branchOr);
  if (belowMinimum) query = query.or("status_stok.eq.MENIPIS,status_stok.eq.HABIS");
  if (search) query = query.or(`nama.ilike.%${search}%,kode.ilike.%${search}%`);

  const { data, error } = await query.order("nama", { ascending: true });
  if (error) throw error;
  return data;
}

/** Satu baris stok bahan baku (tanpa cek scope, perilaku lama). */
export async function getRawMaterialStock(
  db: DbClient,
  { view, warehouseId }: StockSource,
  rawMaterialId: string
) {
  let query = db.from(view).select("*").eq("id", rawMaterialId);
  if (warehouseId) query = query.eq("warehouse_id", warehouseId);
  const { data, error } = await query.single();
  if (error?.code === "PGRST116") throw ApiError.notFound("Inventory tidak ditemukan");
  if (error) throw error;
  return data;
}

/** Pergerakan terbaru satu bahan baku (tanpa cek scope, perilaku lama). */
export async function listMaterialMovements(db: DbClient, rawMaterialId: string, limit: number) {
  const { data, error } = await db
    .from("inventory_movements")
    .select(`
      *,
      raw_material:raw_materials!raw_material_id (*)
    `)
    .eq("raw_material_id", rawMaterialId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}

export const movementListQuerySchema = z.object({
  bahan_id: z.string().uuid().optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  tipe: z.enum(["in", "out", "adjustment", "transfer", "return"]).optional(),
  date_from: z.string().optional(),
  date_to: z.string().optional(),
  reference_type: z.string().optional(),
});

/** Kartu pergerakan stok lintas bahan, dibatasi cabang efektif user. */
export async function listInventoryMovements(
  db: DbClient,
  branchId: string | null,
  params: z.infer<typeof movementListQuerySchema>
) {
  const { bahan_id, page, limit, tipe, date_from, date_to, reference_type } = params;
  const offset = (page - 1) * limit;

  let query = db
    .from("inventory_movements")
    .select(
      `
      *,
      inventory:inventory_id(id),
      raw_material:raw_material_id(id, kode, nama),
      creator:created_by(full_name)
    `,
      { count: "exact" }
    )
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (branchId) query = query.eq("branch_id", branchId);
  if (bahan_id) query = query.eq("raw_material_id", bahan_id);
  if (tipe) query = query.eq("tipe", tipe);
  if (reference_type) query = query.eq("reference_type", reference_type);
  if (date_from) query = query.gte("created_at", date_from);
  if (date_to) query = query.lte("created_at", date_to);

  const { data, error, count } = await query;
  if (error) throw error;
  return {
    rows: (data ?? []) as unknown[],
    meta: { page, limit, total: count || 0, totalPages: Math.ceil((count || 0) / limit) },
  };
}
