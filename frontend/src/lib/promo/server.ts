// EPIC-032 — guard & konteks route promo. Pengelola = pemegang menu IAM promo
// (super_admin + marketing).

import { randomInt } from "crypto";
import { ApiError, requireIamMenuPrefix } from "@/lib/api/auth";
import { getApiUserScope } from "@/lib/api/scope";
import { IAM } from "@/lib/iam/prefixes";
import { resolveTicketingVenue } from "@/lib/ticketing/server";
import type { UserRole } from "@/types";

/** @deprecated Gate memakai menu IAM promo / crm.promo. */
export const PROMO_MANAGER_ROLES: UserRole[] = ["super_admin", "marketing"];

export type PromoContext = {
  user: { id: string; role: UserRole };
  companyId: string;
  branchId: string;
};

/** Venue (company + branch) tempat data promo dibatasi. */
export type PromoVenue = Pick<PromoContext, "companyId" | "branchId">;

const VENUE_NOT_CONFIGURED =
  "Venue belum dikonfigurasi — set default_company_id/default_branch_id di CRM Settings atau lengkapi scope bisnis user";

/** Gerbang menu promo + venue (company/branch) dari scope user atau default CRM. Melempar ApiError. */
export async function requirePromoContext(): Promise<PromoContext> {
  const user = await requireIamMenuPrefix(IAM.promo);
  const { companyId, branchId } = await resolveTicketingVenue(await getApiUserScope());
  if (!companyId || !branchId) throw ApiError.badRequest(VENUE_NOT_CONFIGURED);
  return { user: { id: user.id, role: user.role }, companyId, branchId };
}

// Charset anti-ambigu (tanpa 0/O/1/I) — pola booking code EPIC-023
const CODE_CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/**
 * Satu kode acak `PREFIX-XXXXXX` utk batch voucher. CSPRNG (crypto), bukan
 * Math.random — kode voucher bersifat bearer (siapa pegang bisa pakai),
 * tidak boleh bisa ditebak (temuan LOW security review A4).
 */
export function generateVoucherCode(prefix: string): string {
  let suffix = "";
  for (let i = 0; i < 6; i++) {
    suffix += CODE_CHARSET[randomInt(CODE_CHARSET.length)];
  }
  return `${prefix}-${suffix}`;
}
