import "server-only";
import type { z } from "zod";
import { ApiError, getPosSession, requireIamAction, type ApiUser } from "@/lib/api/auth";
import { getCrmDefaultVenue } from "@/lib/crm/server";
import { createPgClient } from "@/lib/pg/create-client";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * Penjaga bersama route POS untuk pola apiHandler: setiap fungsi melempar
 * ApiError (dipetakan ke `{ success: false, error }`) alih-alih mengembalikan
 * respons sendiri-sendiri.
 */

/** Sesi kasir POS (grant menu POS); 401 bila tidak ada. Mengembalikan user id. */
export async function requirePosSession(): Promise<string> {
  const userId = await getPosSession();
  if (!userId) throw ApiError.unauthorized("Authentication required");
  return userId;
}

/** Batas percobaan per kunci (in-memory); 429 bila terlampaui. */
export function enforceRateLimit(key: string, limit: number, message = "Terlalu banyak percobaan — tunggu sebentar") {
  if (!checkRateLimit(key, limit).allowed) throw ApiError.tooManyRequests(message);
}

/** Body JSON tervalidasi zod; JSON rusak diperlakukan sebagai body kosong. 400 bila tidak valid. */
export async function parseJsonBody<T extends z.ZodType>(
  request: Request,
  schema: T,
  message = "Validation failed"
): Promise<z.infer<T>> {
  const parsed = schema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) throw ApiError.badRequest(message, parsed.error.issues);
  return parsed.data;
}

/** Venue default CRM (company + cabang); 400 bila belum dikonfigurasi. */
export async function requireDefaultVenue(): Promise<{ companyId: string; branchId: string }> {
  const venue = await getCrmDefaultVenue(createPgClient());
  if (!venue.companyId || !venue.branchId) throw ApiError.badRequest("Venue belum dikonfigurasi");
  return { companyId: venue.companyId, branchId: venue.branchId };
}

/**
 * Izin aksi IAM untuk route yang belum memakai apiHandler: mengembalikan user,
 * atau respons 401/403 yang langsung dikembalikan route.
 */
export async function iamActionOrResponse(menus: readonly string[], action: string): Promise<ApiUser | Response> {
  try {
    return await requireIamAction(menus, action);
  } catch (error) {
    if (error instanceof ApiError) return error.toResponse();
    throw error;
  }
}
