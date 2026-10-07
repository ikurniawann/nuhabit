/**
 * Penyusun fragmen SQL berparameter untuk query sales-funnel (pure, tanpa DB).
 * Semua nilai lewat placeholder `$n`; nama kolom hanya dari kode, bukan input.
 */
import { ApiError } from "@/lib/api/auth";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string | null | undefined): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/**
 * Kondisi WHERE dengan nomor placeholder berurutan. `startIndex` dipakai bila
 * query sudah punya parameter di depan (mis. $1=from, $2=to).
 */
export function createWhere(initial: string[] = [], startIndex = 1) {
  const conditions = [...initial];
  const params: unknown[] = [];
  const param = (value: unknown) => {
    params.push(value);
    return `$${startIndex + params.length - 1}`;
  };
  return {
    conditions,
    params,
    /** Daftarkan nilai, kembalikan placeholder-nya (untuk fragmen yang memakai nilai sama dua kali). */
    param,
    /** Fragmen dengan satu `?` yang diganti placeholder nilai. */
    add(fragment: string, value: unknown) {
      conditions.push(fragment.replace("?", param(value)));
    },
    push(fragment: string) {
      conditions.push(fragment);
    },
    sql(separator = " AND ") {
      return conditions.join(separator);
    },
  };
}

/** Klausa SET untuk PATCH parsial; `updated_at = now()` selalu ikut. */
export function createUpdateSet() {
  const sets = ["updated_at = now()"];
  const values: unknown[] = [];
  return {
    set(column: string, value: unknown, cast = "") {
      values.push(value);
      sets.push(`${column} = $${values.length}${cast}`);
    },
    /** Semua field terdefinisi; string kosong jadi NULL bila `emptyAsNull`. */
    setAll(fields: Record<string, unknown>, emptyAsNull = false) {
      for (const [column, value] of Object.entries(fields)) {
        if (value === undefined) continue;
        this.set(column, emptyAsNull && value === "" ? null : value);
      }
    },
    raw(fragment: string) {
      sets.push(fragment);
    },
    /** Lempar 400 bila tidak ada kolom berparameter; id selalu parameter terakhir. */
    build(id: string): { sql: string; values: unknown[]; idParam: string } {
      if (values.length === 0) throw ApiError.badRequest("Tidak ada field yang diubah");
      return { sql: sets.join(", "), values: [...values, id], idParam: `$${values.length + 1}` };
    },
  };
}

/** page ≥ 1, limit 1..100 (default 20) dari query string. */
export function parsePagination(searchParams: URLSearchParams): { page: number; limit: number; offset: number } {
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit")) || 20));
  return { page, limit, offset: (page - 1) * limit };
}

/** Pisahkan kolom `total_count` (COUNT(*) OVER()) dari baris data. */
export function splitTotalCount<T extends { total_count: string | number }>(
  rows: T[]
): { data: Array<Omit<T, "total_count">>; total: number } {
  const total = rows.length > 0 ? Number(rows[0].total_count) : 0;
  const data = rows.map((row) => {
    const rest: Partial<T> = { ...row };
    delete rest.total_count;
    return rest as Omit<T, "total_count">;
  });
  return { data, total };
}

/** Kode stabil dari nama bebas: huruf kecil, non-alfanumerik jadi "-". */
export function slugify(value: string, maxLength: number): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, maxLength);
}
