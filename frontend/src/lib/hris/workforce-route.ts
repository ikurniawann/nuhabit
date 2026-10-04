import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { getWorkforceActor, type WorkforceActor } from "./workforce-auth";

/**
 * Bantuan bersama route HRIS kepegawaian/absensi: validasi parameter, body
 * JSON ber-zod, dan aktor wajib. Semua melempar ApiError supaya handler yang
 * dibungkus apiHandler cukup berisi guard → validasi → lib → respons.
 */

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** Parameter rute wajib UUID; selain itu 400 dengan pesan route. */
export function requireUuid(value: string, message = "ID tidak valid"): string {
  if (!UUID_RE.test(value)) throw ApiError.badRequest(message);
  return value;
}

/**
 * Validasi nilai mentah dengan skema. Gagal → 400 dengan `message` atau pesan
 * issue pertama (skema memuat pesan Indonesia), plus `details` daftar issue.
 */
export function parseInput<S extends z.ZodType>(schema: S, value: unknown, message?: string): z.output<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw ApiError.badRequest(
      message ?? parsed.error.issues[0]?.message ?? "Data tidak valid",
      parsed.error.issues
    );
  }
  return parsed.data;
}

/** Body JSON tervalidasi; body bukan JSON → 400. */
export async function readJson<S extends z.ZodType>(
  request: Request,
  schema: S,
  message?: string
): Promise<z.output<S>> {
  const body: unknown = await request.json().catch(() => undefined);
  if (body === undefined) throw ApiError.badRequest(message ?? "Body JSON tidak valid");
  return parseInput(schema, body, message);
}

/** Hasil query builder pg (shim PostgREST): galat dilempar, data dikembalikan. */
export function unwrap<T>(result: {
  data: T | null;
  error: { message: string; code?: string } | null;
}): T | null {
  if (result.error) {
    throw Object.assign(new Error(result.error.message), { code: result.error.code });
  }
  return result.data;
}

/** Hasil `.single()`: tidak ada baris (PGRST116/null) → 404; galat lain dilempar. */
export function unwrapSingle<T>(
  result: { data: T | null; error: { message: string; code?: string } | null },
  notFoundMessage: string
): T {
  if (result.error?.code === "PGRST116") throw ApiError.notFound(notFoundMessage);
  const data = unwrap(result);
  if (!data) throw ApiError.notFound(notFoundMessage);
  return data;
}

/** Aktor absensi/cuti wajib login; null → 401. */
export async function requireWorkforceActor(): Promise<WorkforceActor> {
  const actor = await getWorkforceActor();
  if (!actor) throw ApiError.unauthorized("Unauthorized");
  return actor;
}

/** Non-HR wajib tertaut record karyawan; kembalikan id karyawannya. */
export function requireLinkedEmployee(
  actor: WorkforceActor,
  message = "Akun ini tidak terhubung ke data karyawan"
): string {
  if (!actor.employeeId) throw ApiError.forbidden(message);
  return actor.employeeId;
}
