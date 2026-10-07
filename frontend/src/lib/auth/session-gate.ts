/**
 * Keputusan gerbang sesi middleware — fungsi MURNI supaya bisa diuji tanpa
 * Next/DB. Dipakai `updateSession` di middleware.
 *
 * Poin penting (audit 2026-09-17): saat validasi token ke DB MELEMPAR (DB
 * gangguan), permintaan API dan MUTASI (POST/PUT/PATCH/DELETE) harus
 * FAIL-CLOSED (ditolak) — jangan pernah biarkan aksi tulis atau endpoint data
 * lolos hanya karena DB error. Navigasi HALAMAN GET boleh fail-open supaya
 * blip DB sesaat tidak menendang semua kasir keluar (layout tetap validasi
 * ulang di server).
 */

export type SessionValidation = "valid" | "invalid" | "db-error";

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function isMutationMethod(method: string): boolean {
  return MUTATION_METHODS.has(method.toUpperCase());
}

export function isApiPath(pathname: string): boolean {
  return pathname.startsWith("/api/");
}

/** Saat DB error: boleh anggap punya-sesi? Hanya untuk navigasi halaman GET. */
export function failOpenOnDbError(input: { pathname: string; method: string }): boolean {
  if (isApiPath(input.pathname)) return false;
  if (isMutationMethod(input.method)) return false;
  return true;
}

/** Hasil akhir: apakah request dianggap punya sesi valid? */
export function resolveHasSession(input: {
  validation: SessionValidation;
  pathname: string;
  method: string;
}): boolean {
  if (input.validation === "valid") return true;
  if (input.validation === "invalid") return false;
  return failOpenOnDbError({ pathname: input.pathname, method: input.method });
}

/**
 * Saat request ditolak (tanpa sesi & bukan rute publik), kode status yang
 * tepat: 503 bila DB sedang error pada jalur fail-closed (transien, klien
 * boleh coba lagi), selain itu 401 (autentikasi kurang).
 */
export function rejectionStatus(input: {
  validation: SessionValidation;
  pathname: string;
  method: string;
}): 401 | 503 {
  const failClosedDbError =
    input.validation === "db-error" &&
    !failOpenOnDbError({ pathname: input.pathname, method: input.method });
  return failClosedDbError ? 503 : 401;
}
