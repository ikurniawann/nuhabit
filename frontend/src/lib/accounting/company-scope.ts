import { ApiError } from "@/lib/api/auth";
import type { UserScope } from "@/lib/api/scope";

/**
 * Company id dari user yang login (tanpa fallback default).
 * Dipakai untuk filter COA / mapping / fiscal / JE per company.
 */
export function accountingCompanyId(
  scope: UserScope | null
): string | null {
  return scope?.companyId ?? null;
}

/**
 * Wajib punya company_id di profil user.
 * Tidak me-default ke Sulu atau company lain.
 */
export function requireAccountingCompanyId(
  scope: UserScope | null,
  message = "Akun Anda belum terikat company. Data accounting hanya tampil untuk company user yang login."
): string {
  const companyId = accountingCompanyId(scope);
  if (!companyId) throw ApiError.badRequest(message);
  return companyId;
}
