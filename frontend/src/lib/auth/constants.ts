export const SESSION_COOKIE = "nuhabit_session";
/**
 * Nama cookie sesi sebelum rename NüHabit. Masih dibaca agar sesi yang aktif
 * tidak putus; tidak pernah ditulis lagi dan dihapus saat logout/login ulang.
 */
export const LEGACY_SESSION_COOKIE = "arkiv_session";
export const SESSION_TTL_DAYS = 14;

/** Bentuk minimal cookie jar: NextRequest.cookies maupun cookies() dari next/headers. */
export interface CookieReader {
  get(name: string): { value: string } | undefined;
}

/** Token sesi dari cookie baru, jatuh ke cookie lama bila belum ada. */
export function readSessionToken(jar: CookieReader): string | undefined {
  return jar.get(SESSION_COOKIE)?.value || jar.get(LEGACY_SESSION_COOKIE)?.value || undefined;
}
