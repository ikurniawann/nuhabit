import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import {
  getApiUserScope,
  importBusinessIds,
  type UserScope,
} from "@/lib/api/scope";
import { query } from "@/lib/db";
import { IAM } from "@/lib/iam/prefixes";
import type { UserRole } from "@/types";

export const BAND_STATUSES = [
  "tersedia",
  "dipakai",
  "hilang",
  "rusak",
  // dipegang karyawan (staff pass Fase E) — bukan stok kunjungan
  "karyawan",
] as const;

export const RE_ENTRY_POLICIES = ["sekali-masuk", "bebas-keluar-masuk"] as const;

export const PAYMENT_MODES = ["postpaid", "prepaid"] as const;

/** Metode uang fisik yang diterima loket/kasir — konsisten dengan POS. */
export const CASH_METHODS = ["cash", "qris", "card"] as const;

/**
 * Venue untuk data ticketing: scope bisnis user dulu, lalu fallback venue
 * default dari crm.crm_settings (default_company_id/default_branch_id) —
 * pola resolveSalesVenue, operasi masih single-venue.
 */
export async function resolveTicketingVenue(scope: UserScope | null): Promise<{
  companyId: string | null;
  branchId: string | null;
}> {
  const ids = importBusinessIds(scope);
  let companyId = ids.companyId;
  let branchId = ids.branchId;
  if (companyId && branchId) return { companyId, branchId };

  try {
    const rows = await query<{ key: string; value: unknown }>(
      `SELECT key, value FROM crm.crm_settings
       WHERE key IN ('default_company_id', 'default_branch_id')`
    );
    for (const row of rows) {
      const value = typeof row.value === "string" ? row.value : null;
      if (!value) continue;
      if (row.key === "default_company_id" && !companyId) companyId = value;
      if (row.key === "default_branch_id" && !branchId) branchId = value;
    }
  } catch {
    // crm_settings belum ada → biarkan null, route menolak dengan 400
  }
  return { companyId, branchId };
}

const VENUE_NOT_CONFIGURED =
  "Venue belum dikonfigurasi — set default_company_id/default_branch_id di CRM Settings atau lengkapi scope bisnis user";

export type TicketingContext = {
  user: { id: string; role: UserRole };
  companyId: string;
  branchId: string;
};

/**
 * Guard + resolusi venue sekali jalan untuk route ticketing:
 * grant menu IAM → scope bisnis → venue (fail-closed bila venue tak
 * ter-resolve). Default menu admin (Master Ticket, Pengaturan); route
 * operasional mengoper IAM.ticketingOperator, laporan/void
 * IAM.ticketingReports. Melempar ApiError 401/403/400.
 */
export async function ticketingContext(
  menus: readonly string[] = IAM.ticketingAdmin
): Promise<TicketingContext> {
  const user = await requireIamMenuPrefix(menus);
  const { companyId, branchId } = await resolveTicketingVenue(
    await getApiUserScope()
  );
  if (!companyId || !branchId) throw ApiError.badRequest(VENUE_NOT_CONFIGURED);
  return { user: { id: user.id, role: user.role }, companyId, branchId };
}

/** Normalisasi UID NFC dari reader/wedge: hex uppercase tanpa separator. */
export function normalizeNfcUid(raw: string): string {
  return raw.replace(/[^0-9a-fA-F]/g, "").toUpperCase();
}

const MIN_NFC_UID_LENGTH = 8;

/** Valid bila hasil normalisasi masih layak jadi UID kartu (≥ 4 byte hex). */
export function isValidNfcUid(uid: string): boolean {
  return uid.length >= MIN_NFC_UID_LENGTH && uid.length <= 64;
}

/** Normalisasi + validasi satu UID; melempar 400 dengan pesan pemanggil. */
export function requireNfcUid(raw: string, message = "UID gelang tidak valid"): string {
  const uid = normalizeNfcUid(raw);
  if (!isValidNfcUid(uid)) throw ApiError.badRequest(message);
  return uid;
}

/**
 * Normalisasi sekumpulan UID yang di-tap bersamaan (registrasi/redeem):
 * semua harus valid dan tidak ada yang di-tap dua kali.
 */
export function requireDistinctNfcUids(raws: readonly string[]): string[] {
  const uids = raws.map(normalizeNfcUid);
  if (uids.some((uid) => !isValidNfcUid(uid))) {
    throw ApiError.badRequest("Ada UID gelang yang tidak valid");
  }
  if (new Set(uids).size !== uids.length) {
    throw ApiError.badRequest("Ada gelang yang di-tap dua kali");
  }
  return uids;
}
