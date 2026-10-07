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

/** Master supplier bahan baku (PO raw_material memakai `purchase_orders.supplier_id`). */

const paymentTermsEnum = z.enum(["CBD", "TOP7", "TOP14", "TOP30", "TOP45", "TOP60"]);
const supplierStatusEnum = z.enum(["active", "inactive", "probation", "blocked", "draft"]);
const optionalEmail = (message: string) => z.string().email(message).optional().or(z.literal(""));

export const supplierCreateSchema = z.object({
  kode_supplier: z.string().min(1, "Kode supplier wajib diisi").max(50).optional(),
  nama_supplier: z.string().min(1, "Nama supplier wajib diisi").max(200),
  pic_name: z.string().max(100).optional(),
  pic_phone: z.string().max(30).optional(),
  pic_email: optionalEmail("Email PIC tidak valid"),
  telepon: z.string().max(50).optional(),
  email: optionalEmail("Email tidak valid"),
  alamat: z.string().optional(),
  kota: z.string().max(100).optional(),
  npwp: z.string().max(50).optional(),
  payment_terms: paymentTermsEnum.default("TOP30"),
  currency: z.enum(["IDR", "USD", "EUR"]).default("IDR"),
  bank_nama: z.string().optional(),
  bank_rekening: z.string().optional(),
  bank_atas_nama: z.string().optional(),
  kategori: z.string().optional(),
  catatan: z.string().optional(),
  status: supplierStatusEnum.default("active"),
});

export const supplierUpdateSchema = z.object({
  nama_supplier: z.string().min(1).max(200).optional(),
  pic_name: z.string().max(100).optional(),
  pic_phone: z.string().max(30).optional(),
  pic_email: optionalEmail("Email PIC tidak valid"),
  email: optionalEmail("Email tidak valid"),
  alamat: z.string().optional(),
  telepon: z.string().max(30).optional(),
  kota: z.string().max(100).optional(),
  npwp: z.string().max(50).optional(),
  payment_terms: paymentTermsEnum.optional(),
  currency: z.enum(["IDR", "USD", "EUR"]).optional(),
  bank_nama: z.string().optional(),
  bank_rekening: z.string().optional(),
  bank_atas_nama: z.string().optional(),
  kategori: z.string().optional(),
  catatan: z.string().optional(),
  status: supplierStatusEnum.optional(),
  is_active: z.boolean().optional(),
});

export const supplierListQuerySchema = z.object({
  search: z.string().optional(),
  is_active: z.coerce.boolean().optional(),
  status: supplierStatusEnum.optional(),
  payment_terms: paymentTermsEnum.optional(),
  page: z.coerce.number().min(1).default(1),
  limit: z.coerce.number().min(1).max(100).default(20),
  sort_by: z.enum(["nama_supplier", "kode_supplier", "kota", "created_at"]).default("nama_supplier"),
  sort_dir: z.enum(["ASC", "DESC"]).default("ASC"),
});

const SORT_COLUMNS: Record<string, string> = {
  nama_supplier: "nama_supplier",
  kode_supplier: "kode",
  kota: "kota",
  created_at: "created_at",
};

const SEARCH_COLUMNS = [
  "nama_supplier",
  "kode",
  "kota",
  "pic_name",
  "pic_phone",
  "pic_email",
  "telepon",
  "email",
  "alamat",
  "npwp",
  "payment_terms",
  "kategori",
  "catatan",
  "status",
];

const NPWP_FORMAT = /^\d{2}\.\d{3}\.\d{3}\.\d{1}-\d{3}\.\d{3}$/;

/** PO supplier yang masih berjalan (dipakai analytics & blokir hapus). */
const ACTIVE_PO_STATUSES = ["draft", "sent", "partial"];

export async function listSuppliers(
  db: DbClient,
  params: z.infer<typeof supplierListQuerySchema>,
  scope: UserScope | null
) {
  const { page, limit, search, is_active, status, payment_terms, sort_by, sort_dir } = params;
  let query = db.from("suppliers").select("*", { count: "exact" }).is("deleted_at", null);

  const companyOr = companyScopeOr(scope);
  if (companyOr) query = query.or(companyOr);
  const branchOr = branchScopeOr(scope);
  if (branchOr) query = query.or(branchOr);

  if (status) query = query.eq("status", status);
  else if (is_active !== undefined) query = query.eq("is_active", is_active);
  if (payment_terms) query = query.eq("payment_terms", payment_terms);
  if (search) {
    query = query.or(SEARCH_COLUMNS.map((column) => `${column}.ilike.%${search}%`).join(","));
  }

  const offset = (page - 1) * limit;
  const { data, count, error } = await query
    .order(SORT_COLUMNS[sort_by] ?? "nama_supplier", { ascending: sort_dir === "ASC" })
    .range(offset, offset + limit - 1);
  if (error) throw error;

  return {
    data,
    pagination: { page, limit, total: count ?? 0, totalPages: Math.ceil((count ?? 0) / limit) },
  };
}

/** Kode berikutnya SUP-{tahun}-NNNN dari kode terakhir tahun itu. */
export function nextSupplierCode(year: number, lastCode: string | null | undefined): string {
  const seq = lastCode ? parseInt(lastCode.split("-").pop() || "0") + 1 : 1;
  return `SUP-${year}-${String(seq).padStart(4, "0")}`;
}

async function generateSupplierCode(db: DbClient): Promise<string> {
  const year = new Date().getFullYear();
  const { data } = await db
    .from("suppliers")
    .select("kode")
    .ilike("kode", `SUP-${year}-%`)
    .order("kode", { ascending: false })
    .limit(1);
  return nextSupplierCode(year, (data as Array<{ kode: string }> | null)?.[0]?.kode);
}

/** Kode kosong / placeholder "XXXX" dibuatkan otomatis. */
function needsGeneratedCode(code: string): boolean {
  return code.trim() === "" || code.includes("XXXX");
}

export async function createSupplier(
  db: DbClient,
  input: z.infer<typeof supplierCreateSchema>,
  userId: string,
  scope: UserScope | null
) {
  const companyId = effectiveCompanyId(scope);
  const branchId = effectiveBranchId(scope);
  const { kode_supplier, ...fields } = input;
  const kode =
    kode_supplier && !needsGeneratedCode(kode_supplier) ? kode_supplier : await generateSupplierCode(db);

  // Kode unik per scope company/branch.
  let existingQuery = db.from("suppliers").select("id").eq("kode", kode).is("deleted_at", null);
  existingQuery = companyId
    ? existingQuery.eq("company_id", companyId)
    : existingQuery.is("company_id", null);
  existingQuery = branchId ? existingQuery.eq("branch_id", branchId) : existingQuery.is("branch_id", null);
  const { data: existing } = await existingQuery.maybeSingle();
  if (existing) throw ApiError.conflict("Kode supplier sudah digunakan");

  const { data, error } = await db
    .from("suppliers")
    .insert({
      kode,
      company_id: companyId,
      branch_id: branchId,
      ...fields,
      is_active: input.status !== "inactive",
      created_by: userId,
    })
    .select()
    .single();
  if (error) {
    if (error.code === "23505") throw ApiError.conflict("Kode supplier sudah digunakan");
    throw error;
  }
  return data;
}

type PoTotalRow = { total: number | string | null };

function sumTotals(rows: PoTotalRow[]): number {
  return rows.reduce((sum, po) => sum + Number(po.total), 0);
}

/** Nama bahan unik (maks 5) dari item PO terbaru supplier. */
export function collectMaterialNames(
  pos: Array<{ purchase_order_items?: Array<{ raw_material?: { nama?: string } | null }> | null }>
): string[] {
  const names = new Set<string>();
  for (const po of pos) {
    for (const item of po.purchase_order_items ?? []) {
      if (item.raw_material?.nama) names.add(item.raw_material.nama);
    }
  }
  return Array.from(names).slice(0, 5);
}

/** Supplier + ringkasan transaksi: PO aktif, 12 bulan terakhir, bahan yang sering dibeli. */
export async function getSupplierDetail(db: DbClient, id: string) {
  const { data: supplier, error } = await db
    .from("suppliers")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .single();
  if (error || !supplier) throw ApiError.notFound("Supplier tidak ditemukan");

  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

  const [{ data: activePos }, { data: closedPos }, { data: recentPos }] = await Promise.all([
    db.from("purchase_orders").select("total").eq("supplier_id", id).in("status", ACTIVE_PO_STATUSES),
    db
      .from("purchase_orders")
      .select("id, total, status")
      .eq("supplier_id", id)
      .gte("created_at", twelveMonthsAgo.toISOString())
      .in("status", ["received", "closed"]),
    db
      .from("purchase_orders")
      .select(`
        id,
        purchase_order_items(raw_material:raw_materials!raw_material_id(nama))
      `)
      .eq("supplier_id", id)
      .limit(5),
  ]);
  const active = (activePos ?? []) as PoTotalRow[];
  const closed = (closedPos ?? []) as PoTotalRow[];

  return {
    ...supplier,
    analytics: {
      po_aktif_count: active.length,
      po_aktif_nilai: sumTotals(active),
      total_transaksi_12_bulan: sumTotals(closed),
      jumlah_po_12_bulan: closed.length,
      // PO belum menyimpan tanggal kirim aktual; rasio tepat waktu belum bisa dihitung.
      on_time_delivery_rate: 0,
      bahan_sering_dibeli: collectMaterialNames(recentPos ?? []),
    },
  };
}

async function assertSupplierExists(db: DbClient, id: string) {
  const { data } = await db
    .from("suppliers")
    .select("id")
    .eq("id", id)
    .is("deleted_at", null)
    .single();
  if (!data) throw ApiError.notFound("Supplier tidak ditemukan");
}

export async function updateSupplier(
  db: DbClient,
  id: string,
  input: z.infer<typeof supplierUpdateSchema>,
  userId: string
) {
  await assertSupplierExists(db, id);
  if (input.npwp && !NPWP_FORMAT.test(input.npwp)) {
    throw ApiError.badRequest("Format NPWP tidak valid. Gunakan format: XX.XXX.XXX.X-XXX.XXX");
  }

  const { data, error } = await db
    .from("suppliers")
    .update({ ...input, updated_by: userId })
    .eq("id", id)
    .is("deleted_at", null)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/** Soft delete; ditolak bila supplier masih punya PO aktif. */
export async function deleteSupplier(db: DbClient, id: string, userId: string) {
  await assertSupplierExists(db, id);

  const { count } = await db
    .from("purchase_orders")
    .select("*", { count: "exact", head: true })
    .eq("supplier_id", id)
    .in("status", ACTIVE_PO_STATUSES);
  if (count && count > 0) {
    throw ApiError.conflict(
      `Tidak dapat menghapus supplier. Terdapat ${count} PO aktif (DRAFT/SENT/PARTIAL) yang masih terkait dengan supplier ini.`
    );
  }

  const { error } = await db
    .from("suppliers")
    .update({
      is_active: false,
      status: "inactive",
      deleted_by: userId,
      deleted_at: new Date().toISOString(),
      updated_by: userId,
    })
    .eq("id", id)
    .is("deleted_at", null);
  if (error) throw error;
}
