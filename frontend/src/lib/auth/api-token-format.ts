/**
 * Format token Open API (EPIC-042), tanpa akses DB agar middleware dan
 * session bisa mengenali token tanpa memuat modul database.
 *
 * Token baru berawalan `nh_`. Token lama `arkiv_` tetap diterima sampai
 * dicabut; keduanya diverifikasi lewat hash yang sama.
 */
export const API_TOKEN_PREFIX = "nh_";
export const LEGACY_API_TOKEN_PREFIX = "arkiv_";

export function hasApiTokenPrefix(token: string): boolean {
  return token.startsWith(API_TOKEN_PREFIX) || token.startsWith(LEGACY_API_TOKEN_PREFIX);
}

/** Ambil token dari header `Authorization: Bearer <token>`; null bila bukan token Open API. */
export function extractBearerToken(authorization: string | null): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(String(authorization || "").trim());
  const token = match?.[1] ?? null;
  return token && hasApiTokenPrefix(token) ? token : null;
}
