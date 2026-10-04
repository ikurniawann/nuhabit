// Rem laju untuk route ticketing: staff per user (jendela global
// lib/rate-limit) dan endpoint publik per IP (lib/public/rate-limit).
// Keduanya melempar ApiError 429 dengan pesan pemanggil.

import { ApiError } from "@/lib/api/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  checkRateLimit as checkPublicRateLimit,
  clientIpFrom,
} from "@/lib/public/rate-limit";

const TOO_MANY_REQUESTS = "Terlalu banyak permintaan — coba lagi sebentar";

export function assertStaffRateLimit(key: string, limit: number, message: string): void {
  if (!checkRateLimit(key, limit).allowed) throw new ApiError(429, message);
}

export function assertPublicRateLimit(
  headers: Headers,
  bucket: string,
  rule: { limit: number; windowMs: number },
  message = TOO_MANY_REQUESTS
): void {
  if (!checkPublicRateLimit(`${bucket}:${clientIpFrom(headers)}`, rule)) {
    throw new ApiError(429, message);
  }
}
