/**
 * Impor supplier (POST /api/purchasing/import/suppliers): kode yang sudah ada
 * di company/branch user di-update, sisanya di-insert.
 */
import type { DbClient } from "@/lib/pg/types";
import { exactScope } from "@/lib/purchasing/import-lookups";
import {
  emptyToNull,
  ImportTally,
  isBlankRow,
  nextCodeSequence,
  type ImportRow,
} from "@/lib/purchasing/import-spreadsheet";
import type { Currency, PaymentTerms, SupplierStatus } from "@/types/supplier";
import { CURRENCY_OPTIONS, PAYMENT_TERMS_OPTIONS } from "@/types/supplier";

const VALID_PAYMENT_TERMS = new Set<string>(PAYMENT_TERMS_OPTIONS);
const VALID_CURRENCIES = new Set<string>(CURRENCY_OPTIONS);
const VALID_STATUSES = new Set<string>(["active", "inactive", "probation", "blocked", "draft"]);

const SUPPLIER_FIELD_KEYS = [
  "kode",
  "nama_supplier",
  "pic_name",
  "pic_phone",
  "pic_email",
  "telepon",
  "email",
  "alamat",
  "kota",
  "npwp",
  "payment_terms",
  "currency",
  "bank_nama",
  "bank_rekening",
  "bank_atas_nama",
  "kategori",
  "catatan",
  "status",
] as const;

/** "top 30" → TOP30; CASH/COD → CBD; tidak dikenal → TOP30. */
export function normalizePaymentTerms(value: string | undefined): PaymentTerms {
  const raw = value?.trim().toUpperCase().replace(/\s+/g, "");
  if (!raw) return "TOP30";
  if (VALID_PAYMENT_TERMS.has(raw)) return raw as PaymentTerms;
  if (raw === "CASH" || raw === "COD") return "CBD";
  return "TOP30";
}

export function normalizeCurrency(value: string | undefined): Currency {
  const raw = value?.trim().toUpperCase();
  return raw && VALID_CURRENCIES.has(raw) ? (raw as Currency) : "IDR";
}

export function normalizeSupplierStatus(value: string | undefined): SupplierStatus {
  const raw = value?.trim().toLowerCase();
  if (!raw) return "active";
  if (VALID_STATUSES.has(raw)) return raw as SupplierStatus;
  if (["nonaktif", "false", "0", "no"].includes(raw)) return "inactive";
  return "active";
}

/** Kolom supplier dari satu baris file; nonaktif/diblokir = is_active false. */
export function buildSupplierPayload(data: Record<string, string>, namaSupplier: string) {
  const status = normalizeSupplierStatus(data.status);
  return {
    nama_supplier: namaSupplier,
    pic_name: emptyToNull(data.pic_name),
    pic_phone: emptyToNull(data.pic_phone),
    pic_email: emptyToNull(data.pic_email),
    telepon: emptyToNull(data.telepon),
    email: emptyToNull(data.email),
    alamat: emptyToNull(data.alamat),
    kota: emptyToNull(data.kota),
    npwp: emptyToNull(data.npwp),
    payment_terms: normalizePaymentTerms(data.payment_terms),
    currency: normalizeCurrency(data.currency),
    bank_nama: emptyToNull(data.bank_nama),
    bank_rekening: emptyToNull(data.bank_rekening),
    bank_atas_nama: emptyToNull(data.bank_atas_nama),
    kategori: emptyToNull(data.kategori),
    catatan: emptyToNull(data.catatan),
    status,
    is_active: status !== "inactive" && status !== "blocked",
  };
}

/** SUP-YYYY-#### berikutnya (lintas company). */
async function generateSupplierCode(db: DbClient): Promise<string> {
  const year = new Date().getFullYear();
  const { data } = await db
    .from("suppliers")
    .select("kode")
    .ilike("kode", `SUP-${year}-%`)
    .order("kode", { ascending: false })
    .limit(1);
  return `SUP-${year}-${String(nextCodeSequence(data?.[0]?.kode)).padStart(4, "0")}`;
}

export async function importSuppliers(
  db: DbClient,
  rows: ImportRow[],
  scope: { userId: string; companyId: string | null; branchId: string | null }
) {
  const tally = new ImportTally();

  for (const row of rows) {
    if (isBlankRow(row.data, SUPPLIER_FIELD_KEYS)) continue;

    const namaSupplier = row.data.nama_supplier?.trim();
    if (!namaSupplier) {
      tally.skip(row.rowNumber, "Required field missing: nama_supplier");
      continue;
    }

    const kode = row.data.kode?.trim() || (await generateSupplierCode(db));
    const existingQuery = db.from("suppliers").select("id").eq("kode", kode).is("deleted_at", null);
    const { data: existing } = await exactScope(existingQuery, scope.companyId, scope.branchId).maybeSingle();
    const payload = buildSupplierPayload(row.data, namaSupplier);

    const { error } = existing?.id
      ? await db
          .from("suppliers")
          .update({ ...payload, updated_by: scope.userId, updated_at: new Date().toISOString() })
          .eq("id", existing.id)
      : await db.from("suppliers").insert({
          kode,
          company_id: scope.companyId,
          branch_id: scope.branchId,
          ...payload,
          created_by: scope.userId,
        });

    if (error) tally.skip(row.rowNumber, error.message);
    else if (existing?.id) tally.updated += 1;
    else tally.imported += 1;
  }

  return tally.summary();
}
