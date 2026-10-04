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
import { generateVendorCode } from "@/lib/purchasing/utils";

/** Master vendor (pemasok produk & barang operasional). */

const vendorCategoryEnum = z.enum(["it", "office", "stationery", "services", "raw_material", "other"]);
const vendorUsageEnum = z.enum(["fnb", "operasional", "keduanya"]);

export const vendorCreateSchema = z.object({
  name: z.string().min(1, "Vendor name is required"),
  contact_person: z.string().min(1, "Contact person is required"),
  phone: z.string().min(1, "Phone number is required"),
  email: z.string().email("Invalid email address"),
  address: z.string().min(1, "Address is required"),
  category: vendorCategoryEnum,
  usage_scope: vendorUsageEnum.default("keduanya"),
  npwp: z.string().optional(),
  bank_name: z.string().optional(),
  bank_account: z.string().optional(),
  bank_account_name: z.string().optional(),
  notes: z.string().optional(),
});

export const vendorUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  contact_person: z.string().min(1).optional(),
  phone: z.string().min(1).optional(),
  email: z.string().email().optional(),
  address: z.string().min(1).optional(),
  category: vendorCategoryEnum.optional(),
  usage_scope: vendorUsageEnum.optional(),
  npwp: z.string().optional(),
  bank_name: z.string().optional(),
  bank_account: z.string().optional(),
  bank_account_name: z.string().optional(),
  notes: z.string().optional(),
  is_active: z.boolean().optional(),
});

export const vendorListQuerySchema = z.object({
  search: z.string().optional(),
  category: vendorCategoryEnum.optional(),
  usage_scope: vendorUsageEnum.optional(),
  status: z.enum(["all", "active", "inactive"]).optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(10),
});

/** Pagination daftar master purchasing (minimal 1 halaman). */
export function pageMeta(page: number, limit: number, total: number) {
  return { page, limit, total, total_pages: Math.max(1, Math.ceil(total / limit)) };
}

export async function listVendors(
  db: DbClient,
  params: z.infer<typeof vendorListQuerySchema>,
  scope: UserScope | null
) {
  const { page, limit, search, category, usage_scope, status } = params;
  let query = db.from("vendors").select("*", { count: "exact" }).order("name");

  const companyOr = companyScopeOr(scope);
  if (companyOr) query = query.or(companyOr);
  const branchOr = branchScopeOr(scope);
  if (branchOr) query = query.or(branchOr);

  if (status === "active") query = query.eq("is_active", true);
  else if (status === "inactive") query = query.eq("is_active", false);
  if (category) query = query.eq("category", category);

  // Modul yang meminta vendor "operasional"/"fnb" tetap menampilkan vendor "keduanya".
  if (usage_scope) {
    query =
      usage_scope === "keduanya"
        ? query.eq("usage_scope", "keduanya")
        : query.in("usage_scope", [usage_scope, "keduanya"]);
  }
  if (search) {
    query = query.or(`name.ilike.%${search}%,code.ilike.%${search}%,contact_person.ilike.%${search}%`);
  }

  const offset = (page - 1) * limit;
  const { data, error, count } = await query.range(offset, offset + limit - 1);
  if (error) throw error;
  return { data: data ?? [], pagination: pageMeta(page, limit, count ?? 0) };
}

export async function createVendor(
  db: DbClient,
  input: z.infer<typeof vendorCreateSchema>,
  scope: UserScope | null
) {
  const { data, error } = await db
    .from("vendors")
    .insert({
      code: await generateVendorCode(db),
      ...input,
      company_id: effectiveCompanyId(scope),
      branch_id: effectiveBranchId(scope),
      is_active: true,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Vendor di luar scope bisnis user diperlakukan sebagai tidak ada (404). */
export async function getScopedVendor(db: DbClient, id: string, scope: UserScope | null) {
  const { data: vendor, error } = await db.from("vendors").select("*").eq("id", id).single();
  if (error || !vendor || !isRowInBusinessScope(scope, vendor)) {
    throw ApiError.notFound("Vendor not found");
  }
  return vendor;
}

export async function updateVendor(
  db: DbClient,
  id: string,
  input: z.infer<typeof vendorUpdateSchema>,
  scope: UserScope | null
) {
  await getScopedVendor(db, id, scope);
  const { data, error } = await db.from("vendors").update(input).eq("id", id).select().single();
  if (error) throw error;
  return data;
}

export async function deactivateVendor(db: DbClient, id: string, scope: UserScope | null) {
  await getScopedVendor(db, id, scope);
  const { error } = await db.from("vendors").update({ is_active: false }).eq("id", id);
  if (error) throw error;
}
