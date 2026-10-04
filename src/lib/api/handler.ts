import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/auth";
import { mapPgError } from "@/lib/errors/api-errors";

const PG_STATUS: Record<string, number> = {
  "23505": 409, // unique_violation
  "23503": 400, // foreign_key_violation
  "23514": 400, // check_violation
  "23502": 400, // not_null_violation
  "22P02": 400, // invalid_text_representation
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
  if (typeof code === "string" && code in PG_STATUS) {
    return NextResponse.json({ success: false, error: mapPgError(error).message }, { status: PG_STATUS[code] });
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
