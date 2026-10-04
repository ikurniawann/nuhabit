import type { z } from "zod";
import { ApiError } from "@/lib/api/auth";

/**
 * Validasi input route HRIS (payroll, KPI, cuti, logbook, dst.): gagal skema
 * jadi 400 dengan pesan issue pertama (skema memuat pesan Indonesia) atau
 * `message` bila diberikan. Body JSON wajib memakai readJson di
 * `@/lib/hris/workforce-route`; helper ini untuk query string dan body
 * opsional.
 */
export function parseInput<S extends z.ZodType>(schema: S, data: unknown, message?: string): z.output<S> {
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    throw ApiError.badRequest(
      message ?? parsed.error.issues[0]?.message ?? "Data tidak valid",
      parsed.error.issues
    );
  }
  return parsed.data;
}

/** Query string sebagai objek (parameter kosong dianggap tidak ada). */
export function searchParamsOf(request: Request): Record<string, string> {
  const entries = [...new URL(request.url).searchParams.entries()].filter(([, v]) => v !== "");
  return Object.fromEntries(entries);
}

/** Body JSON opsional: body kosong/bukan JSON diperlakukan sebagai `{}`. */
export async function readOptionalJson<S extends z.ZodType>(
  request: Request,
  schema: S,
  message?: string
): Promise<z.output<S>> {
  const body: unknown = await request.json().catch(() => ({}));
  return parseInput(schema, body ?? {}, message);
}
