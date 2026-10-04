// Data master satuan untuk /api/purchasing/units/**. Satuan company + template global.
import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { companyScopeOr, effectiveCompanyId, type UserScope } from "@/lib/api/scope";
import type { DbClient } from "@/lib/pg/types";

const unitTypeSchema = z.enum(["BESAR", "KECIL", "KONVERSI"], {
  message: "Tipe satuan wajib dipilih",
});

export const unitCreateSchema = z.object({
  kode: z.string().min(1, "Kode satuan wajib diisi").max(10),
  nama: z.string().min(1, "Nama satuan wajib diisi").max(50),
  tipe: unitTypeSchema,
  deskripsi: z.string().optional(),
});

export const unitUpdateSchema = z.object({
  kode: z.string().min(1).max(10).optional(),
  nama: z.string().min(1).max(50).optional(),
  tipe: unitTypeSchema.optional(),
  deskripsi: z.string().optional(),
  is_active: z.boolean().optional(),
});

const NOT_FOUND = "Satuan tidak ditemukan";
const DUPLICATE_CODE = "Kode satuan sudah digunakan";

export async function listUnits(
  db: DbClient,
  scope: UserScope | null,
  params: { search: string | null; isActive: string | null; page: number; limit: number }
) {
  let query = db
    .from("units")
    .select("*", { count: "exact" })
    .is("deleted_at", null)
    .order("nama", { ascending: true });
  const scopeOr = companyScopeOr(scope);
  if (scopeOr) query = query.or(scopeOr);
  if (params.search) {
    query = query.or(`kode.ilike.%${params.search}%,nama.ilike.%${params.search}%`);
  }
  if (params.isActive !== null) query = query.eq("is_active", params.isActive === "true");

  const from = (params.page - 1) * params.limit;
  const { data, error, count } = await query.range(from, from + params.limit - 1);
  if (error) throw error;

  const total = count || 0;
  return {
    data,
    pagination: {
      page: params.page,
      limit: params.limit,
      total,
      total_pages: Math.ceil(total / params.limit),
    },
  };
}

/** Kode sudah dipakai satuan aktif di company ini (null = template global)? */
export async function unitCodeTaken(db: DbClient, kode: string, companyId: string | null) {
  const query = db.from("units").select("id").eq("kode", kode).is("deleted_at", null);
  const { data } = await (companyId ? query.eq("company_id", companyId) : query.is("company_id", null)).maybeSingle();
  return Boolean(data);
}

/** Kode unik dalam scope company (null = template global). */
export async function createUnit(
  db: DbClient,
  scope: UserScope | null,
  input: z.infer<typeof unitCreateSchema>
) {
  const companyId = effectiveCompanyId(scope);
  if (await unitCodeTaken(db, input.kode, companyId)) throw ApiError.badRequest(DUPLICATE_CODE);

  const { data, error } = await db
    .from("units")
    .insert({ ...input, company_id: companyId, is_active: true })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getUnit(db: DbClient, id: string) {
  const { data, error } = await db
    .from("units")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .single();
  if (error?.code === "PGRST116") throw ApiError.notFound(NOT_FOUND);
  if (error) throw error;
  return data;
}

/** Kode unik dicek dalam company baris yang diedit. */
export async function updateUnit(
  db: DbClient,
  id: string,
  input: z.infer<typeof unitUpdateSchema>
) {
  if (input.kode) {
    const { data: current } = await db
      .from("units")
      .select("company_id")
      .eq("id", id)
      .maybeSingle();
    const currentCompanyId = (current as { company_id: string | null } | null)?.company_id ?? null;
    let existingQuery = db
      .from("units")
      .select("id")
      .eq("kode", input.kode)
      .neq("id", id)
      .is("deleted_at", null);
    existingQuery = currentCompanyId
      ? existingQuery.eq("company_id", currentCompanyId)
      : existingQuery.is("company_id", null);
    const { data: existing } = await existingQuery.maybeSingle();
    if (existing) throw ApiError.badRequest(DUPLICATE_CODE);
  }

  const { data, error } = await db
    .from("units")
    .update({ ...input, updated_at: new Date().toISOString() })
    .eq("id", id)
    .is("deleted_at", null)
    .select()
    .single();
  if (error?.code === "PGRST116") throw ApiError.notFound(NOT_FOUND);
  if (error) throw error;
  return data;
}

/** Soft delete; ditolak bila satuan masih dipakai bahan baku. */
export async function softDeleteUnit(db: DbClient, id: string): Promise<void> {
  const { data: authData } = await db.auth.getUser();
  const { data: usedInMaterials } = await db
    .from("raw_materials")
    .select("id")
    .or(`satuan_besar_id.eq.${id},satuan_kecil_id.eq.${id}`)
    .limit(1);
  if (Array.isArray(usedInMaterials) && usedInMaterials.length > 0) {
    throw ApiError.badRequest("Satuan tidak bisa dihapus karena masih digunakan di bahan baku");
  }

  const now = new Date().toISOString();
  const { error } = await db
    .from("units")
    .update({
      is_active: false,
      deleted_at: now,
      deleted_by: authData.user?.id ?? null,
      updated_at: now,
    })
    .eq("id", id)
    .is("deleted_at", null);
  if (error?.code === "PGRST116") throw ApiError.notFound(NOT_FOUND);
  if (error) throw error;
}
