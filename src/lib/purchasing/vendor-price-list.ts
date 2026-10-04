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
import { pageMeta } from "@/lib/purchasing/vendor-directory";

/** Daftar harga vendor per produk (satuan = satuan dasar produk). */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const priceListCreateSchema = z.object({
  vendor_id: z.string().uuid("Vendor is required"),
  product_id: z.string().uuid("Product is required"),
  harga: z.number().min(0, "Price cannot be negative"),
  satuan_id: z.string().uuid().optional(),
  minimum_qty: z.number().min(0).default(1),
  lead_time_days: z.number().min(0).default(0),
  is_preferred: z.boolean().default(false),
  berlaku_dari: z.string().regex(ISO_DATE, "Date format must be YYYY-MM-DD").optional(),
  berlaku_sampai: z.string().regex(ISO_DATE, "Date format must be YYYY-MM-DD").optional(),
  catatan: z.string().optional(),
});

export const priceListUpdateSchema = z.object({
  vendor_id: z.string().uuid().optional(),
  product_id: z.string().uuid().optional(),
  harga: z.number().min(0).optional(),
  satuan_id: z.string().uuid().optional(),
  minimum_qty: z.number().min(0).optional(),
  lead_time_days: z.number().min(0).optional(),
  is_preferred: z.boolean().optional(),
  berlaku_dari: z.string().regex(ISO_DATE).optional(),
  berlaku_sampai: z.string().regex(ISO_DATE).optional(),
  catatan: z.string().optional(),
  is_active: z.boolean().optional(),
});

export const priceListQuerySchema = z.object({
  search: z.string().optional(),
  vendor_id: z.string().uuid().optional(),
  product_id: z.string().uuid().optional(),
  status: z.enum(["all", "active", "inactive"]).optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(10),
});

const PRODUCT_AND_UNIT = `
  product:products!product_id (
    id,
    kode,
    nama,
    satuan_id
  ),
  unit:units!satuan_id (
    id,
    kode,
    nama
  )`;

const LIST_SELECT = `
  *,
  vendor:vendors!vendor_id (
    id,
    code,
    name
  ),${PRODUCT_AND_UNIT}
`;

const DETAIL_SELECT = `
  *,
  vendor:vendors!vendor_id (
    id,
    code,
    name,
    contact_person,
    phone,
    email
  ),${PRODUCT_AND_UNIT}
`;

const DUPLICATE_MESSAGE = "A price list for this vendor and product already exists";

/** Satuan harga wajib = satuan dasar produk; kosong → pakai satuan produk. */
export function pickPriceListUnit(
  productUnitId: string | null,
  requestedUnitId: string | undefined
): string {
  const resolved = requestedUnitId || productUnitId;
  if (!resolved) throw ApiError.badRequest("Product unit is not configured");
  if (requestedUnitId && productUnitId && requestedUnitId !== productUnitId) {
    throw ApiError.badRequest("Unit must match the product base unit");
  }
  return resolved;
}

async function resolveProductUnit(db: DbClient, productId: string, satuanId?: string) {
  const { data: product, error } = await db
    .from("products")
    .select("id, satuan_id")
    .eq("id", productId)
    .is("deleted_at", null)
    .single();
  if (error || !product) throw ApiError.badRequest("Product not found");
  return pickPriceListUnit(product.satuan_id ?? null, satuanId);
}

/** 23505 (duplikat vendor+produk) → 400 berpesan; galat lain diteruskan. */
function rethrowDuplicate(error: { code?: string }): never {
  if (error.code === "23505") throw ApiError.badRequest(DUPLICATE_MESSAGE);
  throw error;
}

async function findIdsMatching(db: DbClient, table: string, filter: string, activeOnly = false) {
  let query = db.from(table).select("id").or(filter);
  if (activeOnly) query = query.is("deleted_at", null);
  const { data } = await query;
  return ((data ?? []) as Array<{ id: string }>).map((row) => row.id);
}

export async function listPriceLists(
  db: DbClient,
  params: z.infer<typeof priceListQuerySchema>,
  scope: UserScope | null
) {
  const { page, limit, search, vendor_id, product_id, status } = params;
  let query = db
    .from("vendor_price_lists")
    .select(LIST_SELECT, { count: "exact" })
    .order("is_preferred", { ascending: false })
    .order("created_at", { ascending: false });

  const companyOr = companyScopeOr(scope);
  if (companyOr) query = query.or(companyOr);
  const branchOr = branchScopeOr(scope);
  if (branchOr) query = query.or(branchOr);

  if (status === "active") query = query.eq("is_active", true);
  else if (status === "inactive") query = query.eq("is_active", false);
  if (vendor_id) query = query.eq("vendor_id", vendor_id);
  if (product_id) query = query.eq("product_id", product_id);

  if (search) {
    const term = `%${search}%`;
    const [vendorIds, productIds] = await Promise.all([
      findIdsMatching(db, "vendors", `name.ilike.${term},code.ilike.${term}`),
      findIdsMatching(db, "products", `nama.ilike.${term},kode.ilike.${term}`, true),
    ]);
    if (vendorIds.length === 0 && productIds.length === 0) {
      return { data: [], pagination: pageMeta(page, limit, 0) };
    }
    const orFilters: string[] = [];
    if (vendorIds.length > 0) orFilters.push(`vendor_id.in.(${vendorIds.join(",")})`);
    if (productIds.length > 0) orFilters.push(`product_id.in.(${productIds.join(",")})`);
    query = query.or(orFilters.join(","));
  }

  const offset = (page - 1) * limit;
  const { data, error, count } = await query.range(offset, offset + limit - 1);
  if (error) throw error;
  return { data: data ?? [], pagination: pageMeta(page, limit, count ?? 0) };
}

export async function createPriceList(
  db: DbClient,
  input: z.infer<typeof priceListCreateSchema>,
  scope: UserScope | null
) {
  const satuanId = await resolveProductUnit(db, input.product_id, input.satuan_id);

  const { data: vendor, error: vendorError } = await db
    .from("vendors")
    .select("id, is_active")
    .eq("id", input.vendor_id)
    .single();
  if (vendorError || !vendor) throw ApiError.badRequest("Vendor not found");
  if (!vendor.is_active) throw ApiError.badRequest("Vendor is inactive");

  const { data, error } = await db
    .from("vendor_price_lists")
    .insert({
      vendor_id: input.vendor_id,
      product_id: input.product_id,
      harga: input.harga,
      satuan_id: satuanId,
      minimum_qty: input.minimum_qty,
      lead_time_days: input.lead_time_days,
      is_preferred: input.is_preferred,
      berlaku_dari: input.berlaku_dari || new Date().toISOString().split("T")[0],
      berlaku_sampai: input.berlaku_sampai ?? null,
      catatan: input.catatan ?? null,
      company_id: effectiveCompanyId(scope),
      branch_id: effectiveBranchId(scope),
      is_active: true,
    })
    .select(LIST_SELECT)
    .single();
  if (error) rethrowDuplicate(error);
  return data;
}

/** Daftar harga di luar scope bisnis user diperlakukan sebagai tidak ada (404). */
async function findScopedPriceList(db: DbClient, id: string, scope: UserScope | null, select: string) {
  const { data, error } = await db.from("vendor_price_lists").select(select).eq("id", id).single();
  if (error || !data || !isRowInBusinessScope(scope, data)) {
    throw ApiError.notFound("Price list not found");
  }
  return data;
}

export function getPriceList(db: DbClient, id: string, scope: UserScope | null) {
  return findScopedPriceList(db, id, scope, DETAIL_SELECT);
}

export async function updatePriceList(
  db: DbClient,
  id: string,
  input: z.infer<typeof priceListUpdateSchema>,
  scope: UserScope | null
) {
  const existing = await findScopedPriceList(db, id, scope, "*");
  const update: Record<string, unknown> = { ...input, updated_at: new Date().toISOString() };
  if (input.product_id || input.satuan_id) {
    update.satuan_id = await resolveProductUnit(
      db,
      input.product_id || existing.product_id,
      input.satuan_id || existing.satuan_id
    );
  }

  const { data, error } = await db
    .from("vendor_price_lists")
    .update(update)
    .eq("id", id)
    .select(DETAIL_SELECT)
    .single();
  if (error) rethrowDuplicate(error);
  return data;
}

export async function deactivatePriceList(db: DbClient, id: string, scope: UserScope | null) {
  await findScopedPriceList(db, id, scope, "*");
  const now = new Date().toISOString();
  const { error } = await db
    .from("vendor_price_lists")
    .update({ is_active: false, deleted_at: now, updated_at: now })
    .eq("id", id);
  if (error) throw error;
}
