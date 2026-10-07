import { ApiError } from "@/lib/api/auth";

/**
 * Untuk `.catch()` di route settings: repository di luar domain ini (IAM,
 * business-repository) masih melempar `Error` biasa berpesan untuk user.
 * Pesan yang cocok `pattern` jadi ApiError 400 supaya tetap sampai ke klien.
 */
export function rethrowUserFacing(pattern: RegExp) {
  return (error: unknown): never => {
    if (error instanceof Error && !(error instanceof ApiError) && pattern.test(error.message)) {
      throw ApiError.badRequest(error.message);
    }
    throw error;
  };
}
