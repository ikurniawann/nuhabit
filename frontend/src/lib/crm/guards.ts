/**
 * Gate API CRM berbasis grant menu IAM. Melempar ApiError (401 tanpa sesi,
 * 403 tanpa grant) — route membungkus handler dengan apiHandler.
 */
import type { z } from "zod";
import { ApiError, requireIamMenuPrefix, type ApiUser } from "@/lib/api/auth";
import { getApiUserScope, type UserScope } from "@/lib/api/scope";
import { IAM } from "@/lib/iam/prefixes";
import { isMissingCrmSchema } from "./server";

const CRM_GATES = {
  /** Konfigurasi CRM (tier, XP rules, scoring/workflow/approval rules). */
  settings: IAM.crmSettings,
  engagement: IAM.crmEngagement,
  /** Kampanye marketing WA (super_admin + marketing lewat menu promo). */
  campaign: IAM.crmPromo,
  /** Segmen ada di bawah menu Marketing: prefix promo atau CRM. */
  segments: [...IAM.crmPromo, ...IAM.crm],
  /** Inbox WA CS — isi chat customer adalah PII paling sensitif. */
  inbox: IAM.crmInbox,
  reports: IAM.crmReports,
  /** Klaim/approve redeem reward: operasi harian venue (kasir & supervisor). */
  operator: [...IAM.crmLoyalty, ...IAM.crmMembers, ...IAM.posOperations],
  /** Data redemption memuat PII member: laporan, member, loyalti. */
  reader: [...IAM.crmReports, ...IAM.crmMembers, ...IAM.crmLoyalty],
  /** Detail member (aktivitas, badge, persetujuan): Member atau Loyalty. */
  memberRead: [...IAM.crmMembers, ...IAM.crmLoyalty],
  /** Ubah XP & badge member: Loyalty atau Pengaturan CRM. */
  memberLoyaltyWrite: [...IAM.crmLoyalty, ...IAM.crmSettings],
  memberReviews: IAM.crmMemberReviews,
  partners: IAM.crmPartners,
} as const satisfies Record<string, readonly string[]>;

export type CrmGate = keyof typeof CRM_GATES;

export function requireCrmUser(gate: CrmGate): Promise<ApiUser> {
  return requireIamMenuPrefix(CRM_GATES[gate]);
}

/** Gate + scope bisnis user (company/branch) untuk data per-company. */
export async function requireCrmScope(
  gate: CrmGate
): Promise<{ user: ApiUser; scope: UserScope | null }> {
  const user = await requireCrmUser(gate);
  return { user, scope: await getApiUserScope() };
}

/** company_id baris baru: super_admin tanpa scope → NULL (global); selain itu company user. */
export function scopedCompanyId(user: ApiUser, scope: UserScope | null): string | null {
  if (user.role === "super_admin" && !scope?.companyId) return null;
  return scope?.companyId ?? null;
}

/** Tabel CRM belum ada → 409 "CRM migration belum diterapkan"; galat lain diteruskan. */
export function crmSchemaError(error: unknown): unknown {
  return isMissingCrmSchema(error) ? ApiError.conflict("CRM migration belum diterapkan") : error;
}

/**
 * Validasi input admin CRM: 400 dengan pesan refine buatan kita (berbahasa
 * Indonesia) bila ada, selain itu "Data tidak valid"; issues zod di `details`.
 */
export function parseCrmInput<T extends z.ZodType>(schema: T, input: unknown): z.infer<T> {
  const parsed = schema.safeParse(input);
  if (parsed.success) return parsed.data;
  const custom = parsed.error.issues.find((issue) => issue.code === "custom");
  throw ApiError.badRequest(custom?.message ?? "Data tidak valid", parsed.error.issues);
}
