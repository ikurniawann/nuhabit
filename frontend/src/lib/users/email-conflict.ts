import { ApiError } from "@/lib/api/auth";

export const EMAIL_IN_USE_MESSAGE = "Email sudah dipakai akun lain";

/**
 * Galat unique violation (23505) pada kolom email (employees, users,
 * auth.users) jadi 409 berpesan jelas; galat lain dikembalikan sebagai Error
 * biasa (pesan pg tetap tidak bocor karena apiHandler menyaringnya).
 */
export function emailConflictOr(error: { message?: string; code?: string; constraint?: string }): Error {
  const text = `${error.constraint ?? ""} ${error.message ?? ""}`;
  if (error.code === "23505" && /email/i.test(text)) {
    return ApiError.conflict(EMAIL_IN_USE_MESSAGE);
  }
  return error instanceof Error ? error : Object.assign(new Error(error.message ?? "Unknown error"), { code: error.code });
}
