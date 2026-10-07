import { ApiError } from "@/lib/api/auth";

/**
 * Pesan galat bisnis dari src/lib/users/user-service (dilempar sebagai Error
 * biasa) yang aman ditampilkan ke klien sebagai 400. Galat lain dibiarkan
 * naik ke apiHandler supaya pesan internal tidak bocor. Email bentrok sudah
 * dilempar sebagai ApiError 409 (src/lib/users/email-conflict.ts).
 */
const USER_SERVICE_CLIENT_ERRORS = new Set([
  "Employee not found",
  "Password and role are required to enable app access",
]);

export function rethrowUserServiceError(error: unknown): never {
  if (
    error instanceof Error &&
    !(error instanceof ApiError) &&
    USER_SERVICE_CLIENT_ERRORS.has(error.message)
  ) {
    throw ApiError.badRequest(error.message);
  }
  throw error;
}
