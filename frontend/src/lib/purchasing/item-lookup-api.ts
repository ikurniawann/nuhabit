// Data master lookup item (kategori bahan baku / produk / barang operasional)
// untuk /api/purchasing/items/[lookup]. Konfigurasi tabel: ./items-lookup.
import { ApiError } from "@/lib/api/auth";
import { companyScopeOr, effectiveCompanyId, getApiUserScope } from "@/lib/api/scope";
import type { DbClient } from "@/lib/pg/types";
import {
  getItemsLookupConfig,
  type ItemsLookupConfig,
  type ItemsLookupFormData,
} from "@/lib/purchasing/items-lookup";

/** Tabel master yang di-scope per company. */
const COMPANY_SCOPED_TABLES = new Set([
  "raw_material_categories",
  "product_categories",
  "supply_categories",
]);

export function requireItemsLookupConfig(lookup: string): ItemsLookupConfig {
  const config = getItemsLookupConfig(lookup);
  if (!config) throw ApiError.notFound("Tipe lookup tidak valid");
  return config;
}

function isCompanyScoped(config: ItemsLookupConfig): boolean {
  return COMPANY_SCOPED_TABLES.has(config.table);
}

export async function listItemsLookup(
  db: DbClient,
  config: ItemsLookupConfig,
  { search, page, limit }: { search: string | null; page: number; limit: number }
) {
  let query = db
    .from(config.table)
    .select("*", { count: "exact" })
    .is("deleted_at", null)
    .order("nama", { ascending: true });

  if (isCompanyScoped(config)) {
    const scopeOr = companyScopeOr(await getApiUserScope());
    if (scopeOr) query = query.or(scopeOr);
  }
  if (search) query = query.or(`code.ilike.%${search}%,nama.ilike.%${search}%`);

  const from = (page - 1) * limit;
  const { data, error, count } = await query.range(from, from + limit - 1);
  if (error) throw error;

  const total = count || 0;
  return {
    data,
    pagination: { page, limit, total, total_pages: Math.ceil(total / limit) },
  };
}

function lookupColumns(input: ItemsLookupFormData) {
  return {
    code: input.code.trim().toUpperCase(),
    nama: input.nama.trim(),
    deskripsi: input.deskripsi?.trim() || null,
    is_active: input.is_active ?? true,
  };
}

export async function createItemsLookup(
  db: DbClient,
  config: ItemsLookupConfig,
  input: ItemsLookupFormData
) {
  const columns = lookupColumns(input);
  const scoped = isCompanyScoped(config);
  const companyId = scoped ? effectiveCompanyId(await getApiUserScope()) : null;

  let existingQuery = db
    .from(config.table)
    .select("id")
    .eq("code", columns.code)
    .is("deleted_at", null);
  if (scoped) {
    existingQuery = companyId
      ? existingQuery.eq("company_id", companyId)
      : existingQuery.is("company_id", null);
  }
  const { data: existing } = await existingQuery.maybeSingle();
  if (existing) throw ApiError.badRequest("Kode sudah digunakan");

  const { data, error } = await db
    .from(config.table)
    .insert({ ...columns, ...(scoped ? { company_id: companyId } : {}) })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Kode unik dicek dalam company baris yang diedit (bukan company user). */
export async function updateItemsLookup(
  db: DbClient,
  config: ItemsLookupConfig,
  id: string,
  input: ItemsLookupFormData
) {
  const columns = lookupColumns(input);
  let duplicateQuery = db
    .from(config.table)
    .select("id")
    .eq("code", columns.code)
    .neq("id", id)
    .is("deleted_at", null);

  if (isCompanyScoped(config)) {
    const { data: current } = await db
      .from(config.table)
      .select("company_id")
      .eq("id", id)
      .maybeSingle();
    const currentCompanyId = (current as { company_id: string | null } | null)?.company_id ?? null;
    duplicateQuery = currentCompanyId
      ? duplicateQuery.eq("company_id", currentCompanyId)
      : duplicateQuery.is("company_id", null);
  }

  const { data: duplicate } = await duplicateQuery.maybeSingle();
  if (duplicate) throw ApiError.badRequest("Kode sudah digunakan");

  const { data, error } = await db
    .from(config.table)
    .update({ ...columns, updated_at: new Date().toISOString() })
    .eq("id", id)
    .is("deleted_at", null)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function softDeleteItemsLookup(
  db: DbClient,
  config: ItemsLookupConfig,
  id: string
): Promise<void> {
  const { error } = await db
    .from(config.table)
    .update({ deleted_at: new Date().toISOString(), is_active: false })
    .eq("id", id)
    .is("deleted_at", null);
  if (error) throw error;
}
