import { branchScopeOr, companyScopeOr, getApiUserScope } from "@/lib/api/scope";
import { isMissingRelationError, throwUnlessMissingBomTable } from "@/lib/manufacturing/bom-helpers";
import { MANUFACTURING_SCHEMA } from "@/lib/manufacturing/constants";
import type { DbClient } from "@/lib/pg/types";
import { toQty } from "@/lib/purchasing/utils";

type RecipeRow = { id: string } & Record<string, unknown>;

export function countBy<T>(rows: T[], key: (row: T) => string) {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(key(row), (counts.get(key(row)) || 0) + 1);
  return counts;
}

/** Item aktif (max 200) dalam scope company/branch user, urut nama. */
async function listScopedItems(db: DbClient, view: string) {
  const scope = await getApiUserScope();
  let query = db
    .from(view)
    .select("*")
    .is("deleted_at", null)
    .eq("is_active", true)
    .order("nama", { ascending: true })
    .limit(200);

  const companyOr = companyScopeOr(scope);
  if (companyOr) query = query.or(companyOr);
  const branchOr = branchScopeOr(scope);
  if (branchOr) query = query.or(branchOr);

  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as RecipeRow[];
}

/** Jumlah baris BOM aktif per item; tabel BOM yang belum dimigrasi dianggap kosong. */
async function countBomLines(db: DbClient, table: string, column: string, ids: string[], label: string) {
  if (ids.length === 0) return new Map<string, number>();

  const { data, error } = await db
    .from(table, MANUFACTURING_SCHEMA)
    .select(column)
    .in(column, ids)
    .eq("is_active", true);

  if (error && isMissingRelationError(error)) {
    console.warn(`[${label}] ${MANUFACTURING_SCHEMA}.${table} is missing; returning items without BOM counts`);
    return new Map<string, number>();
  }
  throwUnlessMissingBomTable(error);
  return countBy((data || []) as Array<Record<string, string>>, (row) => row[column]);
}

export async function listProductRecipes(db: DbClient) {
  const products = await listScopedItems(db, "v_products_cogs");
  const bomCounts = await countBomLines(
    db,
    "bom_items",
    "product_id",
    products.map((row) => row.id),
    "product-recipes"
  );
  return products.map((product) => ({
    ...product,
    total_bahan_baku: bomCounts.get(product.id) || 0,
    hpp_estimasi: toQty(product.hpp_estimasi ?? product.estimated_cogs),
  }));
}

export async function listRawMaterialRecipes(db: DbClient) {
  const materials = await listScopedItems(db, "v_raw_materials_stock");
  const bomCounts = await countBomLines(
    db,
    "raw_material_bom_items",
    "output_raw_material_id",
    materials.map((row) => row.id),
    "raw-material-recipes"
  );
  return materials.map((material) => ({
    ...material,
    total_bahan_baku: bomCounts.get(material.id) || 0,
    hpp_estimasi: toQty(material.avg_cost),
  }));
}
