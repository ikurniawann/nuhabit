// Potongan SQL kecil yang dipakai berulang oleh modul server ticketing.

import { ApiError } from "@/lib/api/auth";

/**
 * Klausa SET dinamis untuk PATCH: kolom bernilai undefined dilewati.
 * Nama kolom WAJIB literal dari kode (bukan kunci kiriman klien);
 * placeholder mulai dari `$offset + 1`.
 */
export function patchAssignments(
  patch: Record<string, unknown>,
  offset = 0
): { assignments: string[]; values: unknown[] } {
  const assignments: string[] = [];
  const values: unknown[] = [];
  for (const [column, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    values.push(value);
    assignments.push(`${column} = $${offset + values.length}`);
  }
  return { assignments, values };
}

export function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "23505";
}

/** Tunggu `work`; tabrakan unique (23505) jadi 409 berpesan spesifik. */
export async function conflictOnDuplicate<T>(work: Promise<T>, message: string): Promise<T> {
  try {
    return await work;
  } catch (error) {
    if (isUniqueViolation(error)) throw ApiError.conflict(message);
    throw error;
  }
}

/** Ubah string numerik Postgres (numeric) jadi number, null tetap null. */
export const toNumberOrNull = (value: string | number | null): number | null =>
  value === null ? null : Number(value);

/** Pisahkan kolom `total_count` (COUNT(*) OVER()) dari baris halaman. */
export function splitTotalCount<T extends { total_count: string }>(
  rows: T[]
): { total: number; items: Omit<T, "total_count">[] } {
  const total = rows.length > 0 ? Number(rows[0].total_count) : 0;
  const items = rows.map(({ total_count, ...rest }) => {
    void total_count;
    return rest;
  });
  return { total, items };
}

/** Halaman dari query string: page ≥ 1, limit 1..maxLimit (default 20). */
export function readPage(searchParams: URLSearchParams, maxLimit: number) {
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const limit = Math.min(maxLimit, Math.max(1, Number(searchParams.get("limit")) || 20));
  return { page, limit };
}

export function pageMeta(page: number, limit: number, total: number) {
  return { page, limit, total, totalPages: Math.ceil(total / limit) };
}
