// Alias lama /api/purchasing/materials → item.raw_materials (CRUD ramping).
import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import {
  branchScopeOr,
  companyScopeOr,
  effectiveBranchId,
  effectiveCompanyId,
  type UserScope,
} from "@/lib/api/scope";
import type { DbClient } from "@/lib/pg/types";

export const legacyMaterialListQuerySchema = z.object({
  search: z.string().optional(),
  kategori: z.string().optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
});

export const legacyMaterialUpdateSchema = z.object({
  nama: z.string().min(1).optional(),
  kode: z.string().min(1).optional(),
  kategori: z.string().optional(),
  satuan_id: z.string().uuid().optional(),
  satuan_besar_id: z.string().uuid().optional(),
  is_active: z.boolean().optional(),
});

/** Body POST lama: tanpa skema ketat, field dibaca apa adanya. */
export interface LegacyMaterialCreateBody {
  kode?: string;
  nama?: string;
  kategori?: string;
  deskripsi?: string | null;
  satuan_id?: string;
  satuan_besar_id?: string;
  satuan_kecil_id?: string | null;
  konversi_factor?: number;
  stok_minimum?: number;
  stok_maximum?: number;
}

const NOT_FOUND = "Bahan baku tidak ditemukan";

export async function listLegacyMaterials(
  db: DbClient,
  scope: UserScope | null,
  params: z.infer<typeof legacyMaterialListQuerySchema>
) {
  const { page, limit, search, kategori } = params;
  const offset = (page - 1) * limit;

  let query = db
    .from("raw_materials")
    .select("*", { count: "exact" })
    .is("deleted_at", null)
    .eq("is_active", true);
  const companyOr = companyScopeOr(scope);
  if (companyOr) query = query.or(companyOr);
  const branchOr = branchScopeOr(scope);
  if (branchOr) query = query.or(branchOr);
  if (search) {
    query = query.or(`nama.ilike.%${search}%,kode.ilike.%${search}%,kategori.ilike.%${search}%`);
  }
  if (kategori) query = query.eq("kategori", kategori);

  const { data, count, error } = await query
    .order("nama", { ascending: true })
    .range(offset, offset + limit - 1);
  if (error) throw error;

  return {
    rows: (data ?? []) as unknown[],
    meta: { page, limit, total: count ?? 0, totalPages: Math.ceil((count ?? 0) / limit) },
  };
}

export async function getLegacyMaterial(db: DbClient, id: string) {
  const { data, error } = await db
    .from("raw_materials")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .single();
  if (error || !data) throw ApiError.notFound(NOT_FOUND);
  return data;
}

export async function createLegacyMaterial(
  db: DbClient,
  scope: UserScope | null,
  userId: string,
  body: LegacyMaterialCreateBody
) {
  const satuanBesarId = body.satuan_besar_id || body.satuan_id;
  if (!satuanBesarId) throw ApiError.badRequest("satuan_id atau satuan_besar_id wajib diisi");

  const { data, error } = await db
    .from("raw_materials")
    .insert({
      kode: body.kode,
      nama: body.nama,
      kategori: body.kategori || "LAINNYA",
      deskripsi: body.deskripsi ?? null,
      satuan_besar_id: satuanBesarId,
      satuan_kecil_id: body.satuan_kecil_id ?? null,
      konversi_factor: body.konversi_factor ?? 1,
      stok_minimum: body.stok_minimum ?? 0,
      stok_maximum: body.stok_maximum ?? 0,
      company_id: effectiveCompanyId(scope),
      branch_id: effectiveBranchId(scope),
      created_by: userId,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateLegacyMaterial(
  db: DbClient,
  id: string,
  userId: string,
  input: z.infer<typeof legacyMaterialUpdateSchema>
) {
  const updatePayload: Record<string, unknown> = { updated_by: userId };
  if (input.nama !== undefined) updatePayload.nama = input.nama;
  if (input.kode !== undefined) updatePayload.kode = input.kode;
  if (input.kategori !== undefined) updatePayload.kategori = input.kategori;
  if (input.is_active !== undefined) updatePayload.is_active = input.is_active;
  const satuanBesarId = input.satuan_besar_id || input.satuan_id;
  if (satuanBesarId) updatePayload.satuan_besar_id = satuanBesarId;

  const { data, error } = await db
    .from("raw_materials")
    .update(updatePayload)
    .eq("id", id)
    .is("deleted_at", null)
    .select()
    .single();
  if (error || !data) throw ApiError.notFound(NOT_FOUND);
  return data;
}

export async function softDeleteLegacyMaterial(
  db: DbClient,
  id: string,
  userId: string
): Promise<void> {
  const { error } = await db
    .from("raw_materials")
    .update({
      is_active: false,
      deleted_at: new Date().toISOString(),
      deleted_by: userId,
      updated_by: userId,
    })
    .eq("id", id);
  if (error) throw error;
}
