import type { z } from "zod";
import { ApiError } from "@/lib/api/auth";

/**
 * Validasi query string dengan zod. Nilai di `ignore` (default: string kosong)
 * dibuang dulu supaya filter kosong dari UI tidak memicu galat. Gagal → 400.
 */
export function parseSearchParams<T extends z.ZodTypeAny>(
  sp: URLSearchParams,
  schema: T,
  message = "Filter tidak valid",
  ignore: readonly string[] = [""]
): z.infer<T> {
  const raw = Object.fromEntries([...sp.entries()].filter(([, value]) => !ignore.includes(value)));
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw ApiError.badRequest(message, parsed.error.flatten().fieldErrors);
  return parsed.data;
}
