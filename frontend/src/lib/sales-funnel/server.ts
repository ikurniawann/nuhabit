import { NextResponse } from "next/server";
import { ApiError, getApiUser } from "@/lib/api/auth";
import { getApiUserScope, importBusinessIds, type UserScope } from "@/lib/api/scope";
import { mergeCustomValues, validateCustomValues, type CustomFieldObject, type CustomValues } from "@/lib/crm/custom-fields";
import { loadCustomFieldDefs } from "@/lib/crm/custom-fields-server";
import { query, queryOne } from "@/lib/db";
import { IAM } from "@/lib/iam/prefixes";
import { userHasIamPrefix } from "@/lib/iam/has-menu";
import type { UserRole } from "@/types";

/** Role yang boleh jadi penanggung jawab lead/deal (gate menu memakai IAM `sales-funnel`). */
export const SALES_FUNNEL_ROLES: UserRole[] = ["super_admin", "sales"];

export type SalesFunnelUser = { id: string; role: UserRole };

/** Guard route sales-funnel: sesi + grant menu IAM `sales-funnel`, lempar 401/403. */
export async function requireSalesFunnelUser(): Promise<SalesFunnelUser> {
  const user = await getApiUser();
  if (!user) throw ApiError.unauthorized();
  if (!(await userHasIamPrefix(user.id, user.role, IAM.salesFunnel))) {
    throw ApiError.forbidden();
  }
  return { id: user.id, role: user.role };
}

/** Batasi aksi ke role tertentu (konfigurasi = admin/super_admin). */
export function requireRole(
  user: SalesFunnelUser,
  roles: readonly UserRole[],
  message = "Insufficient permissions"
): void {
  if (!roles.includes(user.role)) throw ApiError.forbidden(message);
}

export const LEAD_ORG_TYPES = [
  "corporate",
  "sekolah",
  "komunitas",
  "travel-agent",
  "pemerintah",
  "perorangan",
  "lainnya",
] as const;

export { LEAD_SOURCES } from "./lead-sources";

export const LEAD_TEMPERATURES = ["panas", "hangat", "dingin"] as const;

export const DEAL_EVENT_TYPES = [
  "gathering",
  "field-trip",
  "ulang-tahun",
  "buyout-venue",
  "lainnya",
] as const;

// EPIC-050 Fase 1: + "tugas" (task umum) & "email" (log manual; kirim email Fase 7)
export const ACTIVITY_TYPES = ["telepon", "wa", "meeting", "catatan", "tugas", "email"] as const;

/** Jenis account = jenis instansi lead (satu kosakata, EPIC-050 Fase 1). */
export const ACCOUNT_TYPES = LEAD_ORG_TYPES;

/**
 * Render template pesan WA — substitusi placeholder {pic} {instansi} {acara}
 * {tanggal_acara} {venue}. Nilai kosong diganti string kosong agar pesan
 * tetap terkirim rapi.
 */
export function renderWaTemplate(
  body: string,
  values: Partial<Record<"pic" | "instansi" | "acara" | "tanggal_acara" | "venue", string | null>>
): string {
  return body
    .replace(/\{(pic|instansi|acara|tanggal_acara|venue)\}/g, (_match, key) => {
      const value = values[key as keyof typeof values];
      return value ?? "";
    })
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export const LEAD_STATUSES = [
  "baru",
  "dihubungi",
  "qualified",
  "tidak-cocok",
] as const;

/**
 * Validasi penanggung jawab (owner_user_id) — temuan security gate Fase B:
 * harus user ber-role sales/super_admin dan satu company dengan lead/deal-nya
 * (super_admin/holding tanpa company tetap boleh). Mengembalikan pesan error
 * atau null bila valid.
 */
export async function validateAssignableOwner(
  ownerUserId: string,
  companyId: string | null
): Promise<string | null> {
  const owner = await queryOne<{
    role: UserRole;
    company_id: string | null;
  }>(
    `SELECT role, company_id FROM configuration.users WHERE id = $1`,
    [ownerUserId]
  );
  if (!owner) return "Penanggung jawab tidak ditemukan";
  if (!SALES_FUNNEL_ROLES.includes(owner.role)) {
    return "Penanggung jawab harus user ber-role sales atau super admin";
  }
  if (companyId && owner.company_id && owner.company_id !== companyId) {
    return "Penanggung jawab berada di luar venue lead/deal ini";
  }
  return null;
}

/** Valid bila string YYYY-MM-DD adalah tanggal kalender sungguhan. */
export function isValidCalendarDate(value: string): boolean {
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

/** Normalisasi nomor WA ke digit kanonik 62… (0812/812/+62 → 62812…). */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/[^0-9]/g, "");
  if (digits.startsWith("0")) return `62${digits.slice(1)}`;
  if (digits.startsWith("8")) return `62${digits}`;
  return digits;
}

const MIN_PHONE_DIGITS = 10;

/** Valid bila hasil normalisasi masih layak jadi nomor WA Indonesia. */
export function isValidNormalizedPhone(phone: string): boolean {
  return phone.length >= MIN_PHONE_DIGITS && phone.startsWith("62");
}

const SCOPE_MISSING = "Scope bisnis user belum dikonfigurasi — hubungi admin";

/**
 * Tenant isolation WAJIB fail-closed (acceptance criteria EPIC-022): selain
 * super_admin, user tanpa company_id di scope bisnisnya DITOLAK — jangan
 * pernah melewatkan filter company diam-diam.
 */
export function hasCompanyScope(user: SalesFunnelUser, scope: UserScope | null): boolean {
  return user.role === "super_admin" || Boolean(scope?.companyId);
}

/** Versi respons untuk route finance (pola `if (err) return err`). */
export function requireCompanyScope(
  user: SalesFunnelUser,
  scope: UserScope | null
): NextResponse | null {
  return hasCompanyScope(user, scope) ? null : ApiError.forbidden(SCOPE_MISSING).toResponse();
}

/** Scope bisnis user yang sudah lolos cek fail-closed. */
export async function requireSalesScope(user: SalesFunnelUser): Promise<UserScope | null> {
  const scope = await getApiUserScope();
  if (!hasCompanyScope(user, scope)) throw ApiError.forbidden(SCOPE_MISSING);
  return scope;
}

/**
 * Penanggung jawab baru: role sales hanya boleh menunjuk dirinya sendiri,
 * user lain wajib lolos validateAssignableOwner.
 */
export async function assertOwnerAssignable(
  user: SalesFunnelUser,
  ownerUserId: string | null | undefined,
  companyId: string | null
): Promise<void> {
  if (!ownerUserId) return;
  if (user.role === "sales" && ownerUserId !== user.id) {
    throw ApiError.forbidden("Role sales hanya boleh menjadi penanggung jawab sendiri");
  }
  const ownerError = await validateAssignableOwner(ownerUserId, companyId);
  if (ownerError) throw ApiError.badRequest(ownerError);
}

/**
 * Validasi payload `custom` terhadap definisi aktif. `existing` (PATCH)
 * membuat validasi parsial dan hasilnya di-merge ke nilai lama.
 */
export async function resolveCustomValues(
  object: CustomFieldObject,
  companyId: string | null,
  raw: CustomValues | null | undefined,
  existing?: CustomValues
): Promise<CustomValues> {
  const defs = await loadCustomFieldDefs(object, companyId);
  const partial = existing !== undefined;
  const result = validateCustomValues(defs, raw, { partial });
  if (!result.ok) {
    throw ApiError.badRequest(result.errors.map((e) => e.message).join("; "), result.errors);
  }
  return partial ? mergeCustomValues(existing, result.values) : result.values;
}

/** Nomor WA kanonik 62… atau 400 dengan pesan route. */
export function requireValidPhone(raw: string, message: string): string {
  const phone = normalizePhone(raw);
  if (!isValidNormalizedPhone(phone)) throw ApiError.badRequest(message);
  return phone;
}

/**
 * Venue untuk stempel lead/deal baru: scope bisnis user dulu, lalu fallback
 * venue default dari crm.crm_settings (default_company_id/default_branch_id,
 * pola sama dengan getCrmDefaultVenue di CRM loyalty — operasi masih
 * single-venue).
 */
export async function resolveSalesVenue(scope: UserScope | null): Promise<{
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
    // crm_settings belum ada → biarkan null, route yang menolak dengan 400
  }
  return { companyId, branchId };
}

const VENUE_MISSING =
  "Venue belum dikonfigurasi — set default_company_id/default_branch_id di CRM Settings atau lengkapi scope bisnis user";
/** Pesan venue kosong untuk contact & task member (warisan route lama). */
export const VENUE_MISSING_SHORT = "Venue belum dikonfigurasi — lengkapi scope bisnis user atau venue default CRM";

/** resolveSalesVenue yang wajib lengkap (company + branch), else 400. */
export async function requireSalesVenue(
  scope: UserScope | null,
  message = VENUE_MISSING
): Promise<{ companyId: string; branchId: string }> {
  const { companyId, branchId } = await resolveSalesVenue(scope);
  if (!companyId || !branchId) throw ApiError.badRequest(message);
  return { companyId, branchId };
}
