/**
 * Potongan bersama route API staf gym (/api/gym/**). Handler dibungkus
 * apiHandler; gerbang menu lewat requireIamMenuPrefix; galat bisnis dilempar
 * sebagai ApiError (SchedulingError dan GymCreditError turunannya).
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError } from "@/lib/api/auth";

export const ok = (data: unknown) => NextResponse.json({ success: true, data });

/**
 * Validasi masukan. Gagal = 400 dengan pesan Indonesia:
 * "field" → "Data tidak valid: <kolom>", "issue" → pesan kustom skema.
 */
export function parseInput<S extends z.ZodType>(
  schema: S,
  value: unknown,
  style: "field" | "issue" = "field"
): z.infer<S> {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;
  const issue = parsed.error.issues[0];
  const field = issue?.path.join(".");
  const message =
    style === "issue" && issue ? issue.message : field ? `Data tidak valid: ${field}` : "Data tidak valid";
  throw ApiError.badRequest(message, parsed.error.issues);
}

/** Body JSON tervalidasi; body yang bukan JSON diperlakukan sebagai kosong (400). */
export async function parseBody<S extends z.ZodType>(
  request: Request,
  schema: S,
  style: "field" | "issue" = "field"
): Promise<z.infer<S>> {
  return parseInput(schema, await request.json().catch(() => undefined), style);
}

const uuid = z.string().uuid();

/** UUID dari parameter rute atau query string; selain UUID = 400 "ID tidak valid". */
export function requireUuid(value: string | null | undefined, message = "ID tidak valid"): string {
  if (!value || !uuid.safeParse(value).success) throw ApiError.badRequest(message);
  return value;
}

/** Kode galat Postgres untuk unique violation. */
export const isUniqueViolation = (error: unknown) => (error as { code?: string } | null)?.code === "23505";
