import type { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { isUuid } from "./candidate-query";

/**
 * Penjaga bersama route rekrutmen (HR maupun portal kandidat ber-token).
 * Semua melempar ApiError supaya handler cukup dibungkus apiHandler.
 */

export const TOO_MANY_REQUESTS = "Terlalu banyak permintaan, coba lagi sebentar lagi";

/** 429 bila kuota per menit untuk `key` habis. */
export function enforceRateLimit(key: string, limit?: number, message = TOO_MANY_REQUESTS) {
  if (!checkRateLimit(key, limit).allowed) throw ApiError.tooManyRequests(message);
}

/**
 * Tolak body yang mengaku terlalu besar SEBELUM di-parse/buffer.
 * Content-Length bisa absen (chunked): cek ukuran di zod/berkas tetap lapis kedua.
 */
export function assertBodySize(request: Request, maxBytes: number, message = "Ukuran permintaan terlalu besar") {
  const len = Number(request.headers.get("content-length"));
  if (Number.isFinite(len) && len > maxBytes) throw new ApiError(413, message);
}

/** 409 bila sesi kandidat tidak sedang berjalan. */
export function assertInProgress(session: { status: string }, message: string) {
  if (session.status !== "in_progress") throw ApiError.conflict(message);
}

/** 400 dengan `message` bila id bukan UUID. */
export function assertUuid(id: string, message: string) {
  if (!isUuid(id)) throw ApiError.badRequest(message);
}

/**
 * Body JSON tervalidasi. Tanpa `fixedMessage`, galat 400 berbunyi
 * "<path>: <pesan isu pertama>" (bentuk lama route psikotes/offer).
 */
export async function parseJsonBody<T extends z.ZodTypeAny>(
  request: Request,
  schema: T,
  fixedMessage?: string
): Promise<z.output<T>> {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (parsed.success) return parsed.data;
  if (fixedMessage) throw ApiError.badRequest(fixedMessage);
  const first = parsed.error.issues[0];
  throw ApiError.badRequest(first ? `${first.path.join(".")}: ${first.message}` : "Payload tidak valid");
}

const PORTAL_TOKEN_RE = /^[a-f0-9]{48,128}$/i;

/** Token link portal kandidat (psikotes/interview/offer): hex 48–128 karakter. */
export const isPortalToken = (token: string) => PORTAL_TOKEN_RE.test(token);

/**
 * Link portal kedaluwarsa? expires_at NULL tidak boleh berarti abadi:
 * fallback waktu terbit + `maxLifetimeMs`.
 */
export function isLinkExpired(
  link: { expires_at: string | null; issued_at: string | null },
  maxLifetimeMs: number,
  now = Date.now()
): boolean {
  const expiresAtMs = link.expires_at
    ? new Date(link.expires_at).getTime()
    : new Date(link.issued_at ?? 0).getTime() + maxLifetimeMs;
  return expiresAtMs < now;
}
