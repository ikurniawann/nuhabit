/** Helper baca bersama untuk route penerimaan (GRN, delivery, workspace). */
import type { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import type { DbClient } from "@/lib/pg/types";

/** Validasi query string; gagal → 400 `{ success: false, error, details }`. */
export function parseSearchParams<T extends z.ZodType>(request: Request, schema: T): z.infer<T> {
  const result = schema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!result.success) throw ApiError.badRequest("Parameter tidak valid", result.error.issues);
  return result.data;
}

export function uniqueIds(values: (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

/** `SELECT <columns> FROM <table> WHERE id IN (...)`; tanpa query bila `ids` kosong. */
export async function selectByIds<T>(
  db: DbClient,
  table: string,
  columns: string,
  ids: string[]
): Promise<T[]> {
  if (ids.length === 0) return [];
  const { data, error } = await db.from(table).select(columns).in("id", ids);
  if (error) throw error;
  return (data || []) as T[];
}
