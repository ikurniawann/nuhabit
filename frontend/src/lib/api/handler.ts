import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/auth";

/** Galat constraint Postgres (SQLSTATE) yang aman diterjemahkan jadi 4xx berpesan ramah. */
const PG_ERRORS: Record<string, { status: number; message: string }> = {
  "23505": { status: 409, message: "Data sudah ada di sistem" }, // unique_violation
  "23503": { status: 400, message: "Referensi data tidak valid" }, // foreign_key_violation
  "23514": { status: 400, message: "Data tidak memenuhi ketentuan" }, // check_violation
  "23502": { status: 400, message: "Data wajib diisi" }, // not_null_violation
  "22P02": { status: 400, message: "Format data tidak valid" }, // invalid_text_representation
};

/**
 * Respons galat seragam `{ success: false, error }` (bentuk yang sudah dibaca
 * klien lewat `json.error`). ApiError memakai status & pesannya; galat
 * constraint Postgres jadi 4xx berpesan ramah; sisanya 500 tanpa membocorkan
 * pesan internal.
 */
export function apiErrorResponse(error: unknown, context = "api"): NextResponse {
  if (error instanceof ApiError) return error.toResponse();
  const code = (error as { code?: unknown } | null)?.code;
  const pg = typeof code === "string" ? PG_ERRORS[code] : undefined;
  if (pg) {
    return NextResponse.json({ success: false, error: pg.message }, { status: pg.status });
  }
  console.error(`[${context}]`, error);
  return NextResponse.json({ success: false, error: "Terjadi kesalahan server" }, { status: 500 });
}

/** Bungkus handler route: lempar ApiError (atau biarkan galat) dan respons galat diseragamkan. */
export function apiHandler<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response>,
  context?: string
): (...args: Args) => Promise<Response> {
  return async (...args) => {
    try {
      return await handler(...args);
    } catch (error) {
      return apiErrorResponse(error, context);
    }
  };
}
