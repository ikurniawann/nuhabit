import { NextResponse } from "next/server";
import { ApiError } from "@/lib/api/auth";
import { readPrivateFile } from "@/lib/storage-private";
import { safeSegmentsUnder } from "@/lib/security/safe-path";

/**
 * Respons berkas storage PRIVATE rekrutmen (psikotes/interview). Segmen path
 * divalidasi safeSegmentsUnder (tolak traversal & folder lain) sebelum dibaca.
 * Pemanggil wajib sudah lolos guard HR.
 */
export async function privateFileResponse(
  segments: readonly string[],
  folder: "psikotes" | "interview",
  contentTypeFor?: (rel: string) => string | undefined
) {
  const safe = safeSegmentsUnder(segments, folder);
  if (!safe) throw ApiError.notFound("File tidak ditemukan");
  const rel = safe.join("/");
  const { data, mime } = await readPrivateFile(rel);
  if (!data) throw ApiError.notFound("File tidak ditemukan");
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": contentTypeFor?.(rel) ?? mime ?? "application/octet-stream",
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
