// EPIC-026 B1 — master barang operasional (non-F&B, non-jual) untuk
// /api/purchasing/supply-items/**. Scope company+branch fail-closed.
import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import {
  branchScopeOr,
  companyScopeOr,
  effectiveBranchId,
  effectiveCompanyId,
  isRowInBusinessScope,
  type UserScope,
} from "@/lib/api/scope";
import type { DbClient } from "@/lib/pg/types";
import { nextSequentialCode, utcDateStamp } from "@/lib/purchasing/item-codes";

export const supplyItemCreateSchema = z.object({
  kode: z.string().max(30).optional(),
  nama: z.string().min(1, "Nama barang wajib diisi").max(100),
  deskripsi: z.string().optional().nullable(),
  kategori: z.string().optional().nullable(),
  satuan_id: z.string().uuid().optional().nullable(),
  stockable: z.boolean().default(false),
  harga_beli: z.number().min(0).default(0),
  stok_minimum: z.number().min(0).optional(),
  is_active: z.boolean().optional(),
});

export const supplyItemUpdateSchema = z.object({
  nama: z.string().min(1).max(100).optional(),
  deskripsi: z.string().optional().nullable(),
  kategori: z.string().optional().nullable(),
  satuan_id: z.string().uuid().optional().nullable(),
  stockable: z.boolean().optional(),
  harga_beli: z.number().min(0).optional(),
  stok_minimum: z.number().min(0).optional(),
  is_active: z.boolean().optional(),
});

type SupplyItemUpdateInput = z.infer<typeof supplyItemUpdateSchema>;

interface SupplyItemRow {
  id: string;
  company_id: string | null;
  branch_id: string | null;
}

/** Teks opsional: trim, kosong → null. */
function optionalText(value: string | null | undefined): string | null {
  return value?.trim() || null;
}

export async function listSupplyItems(
  db: DbClient,
  scope: UserScope | null,
  params: {
    search: string | null;
    isActive: string | null;
    stockable: string | null;
    page: number;
    limit: number;
  }
) {
  let query = db.from("supply_items").select("*", { count: "exact" }).is("deleted_at", null);
  const companyOr = companyScopeOr(scope);
  if (companyOr) query = query.or(companyOr);
  const branchOr = branchScopeOr(scope);
  if (branchOr) query = query.or(branchOr);
  if (params.isActive === "true" || params.isActive === "false") {
    query = query.eq("is_active", params.isActive === "true");
  }
  if (params.stockable === "true" || params.stockable === "false") {
    query = query.eq("stockable", params.stockable === "true");
  }
  if (params.search) {
    query = query.or(`kode.ilike.%${params.search}%,nama.ilike.%${params.search}%`);
  }

  const from = (params.page - 1) * params.limit;
  const { data, error, count } = await query
    .order("nama", { ascending: true })
    .range(from, from + params.limit - 1);
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

function scopeFilter<T extends { eq: (c: string, v: unknown) => T; is: (c: string, v: unknown) => T }>(
  query: T,
  companyId: string | null,
  branchId: string | null
): T {
  const byCompany = companyId ? query.eq("company_id", companyId) : query.is("company_id", null);
  return branchId ? byCompany.eq("branch_id", branchId) : byCompany.is("branch_id", null);
}

async function generateSupplyCode(
  db: DbClient,
  companyId: string | null,
  branchId: string | null
): Promise<string> {
  const prefix = `SUP-${utcDateStamp()}`;
  const { data } = await scopeFilter(
    db
      .from("supply_items")
      .select("kode")
      .like("kode", `${prefix}-%`)
      .is("deleted_at", null)
      .order("kode", { ascending: false })
      .limit(1),
    companyId,
    branchId
  );
  const last = Array.isArray(data) ? (data[0] as { kode?: string } | undefined)?.kode : null;
  return nextSequentialCode(prefix, last, 3);
}

export async function createSupplyItem(
  db: DbClient,
  scope: UserScope | null,
  input: z.infer<typeof supplyItemCreateSchema>
) {
  const companyId = effectiveCompanyId(scope);
  const branchId = effectiveBranchId(scope);

  let kode = input.kode?.trim().toUpperCase();
  if (!kode) {
    kode = await generateSupplyCode(db, companyId, branchId);
  } else {
    const { data: existing } = await scopeFilter(
      db.from("supply_items").select("id").eq("kode", kode).is("deleted_at", null),
      companyId,
      branchId
    ).maybeSingle();
    if (existing) throw ApiError.badRequest("Kode barang sudah digunakan");
  }

  const { data, error } = await db
    .from("supply_items")
    .insert({
      kode,
      nama: input.nama.trim(),
      deskripsi: optionalText(input.deskripsi),
      kategori: optionalText(input.kategori),
      satuan_id: input.satuan_id || null,
      stockable: input.stockable,
      harga_beli: input.harga_beli,
      stok_minimum: input.stok_minimum ?? 0,
      is_active: input.is_active ?? true,
      company_id: companyId,
      branch_id: branchId,
      created_by: scope?.userId ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Baris aktif dalam scope bisnis user; selain itu 404 (fail-closed). */
export async function getSupplyItemInScope(
  db: DbClient,
  scope: UserScope | null,
  id: string
): Promise<SupplyItemRow> {
  const { data, error } = await db
    .from("supply_items")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw error;
  if (!data || !isRowInBusinessScope(scope, data)) {
    throw ApiError.notFound("Barang tidak ditemukan");
  }
  return data as SupplyItemRow;
}

/** Patch hanya field yang dikirim; teks dirapikan seperti saat membuat. */
export function buildSupplyItemPatch(
  input: SupplyItemUpdateInput,
  userId: string | null
): Record<string, unknown> {
  const patch: Record<string, unknown> = { updated_by: userId };
  if (input.nama !== undefined) patch.nama = input.nama.trim();
  if (input.deskripsi !== undefined) patch.deskripsi = optionalText(input.deskripsi);
  if (input.kategori !== undefined) patch.kategori = optionalText(input.kategori);
  if (input.satuan_id !== undefined) patch.satuan_id = input.satuan_id || null;
  if (input.stockable !== undefined) patch.stockable = input.stockable;
  if (input.harga_beli !== undefined) patch.harga_beli = input.harga_beli;
  if (input.stok_minimum !== undefined) patch.stok_minimum = input.stok_minimum;
  if (input.is_active !== undefined) patch.is_active = input.is_active;
  return patch;
}

export async function updateSupplyItem(db: DbClient, id: string, patch: Record<string, unknown>) {
  const { data, error } = await db
    .from("supply_items")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function softDeleteSupplyItem(
  db: DbClient,
  id: string,
  userId: string | null
): Promise<void> {
  const { error } = await db
    .from("supply_items")
    .update({ deleted_at: new Date().toISOString(), deleted_by: userId })
    .eq("id", id);
  if (error) throw error;
}
