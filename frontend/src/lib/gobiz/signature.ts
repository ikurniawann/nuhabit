import { createHmac, timingSafeEqual } from "crypto";

/**
 * Verifikasi header X-Go-Signature webhook GoBiz: HMAC-SHA256 (hex) atas raw
 * body dengan notification secret ("Relay secret" di GoBiz Developer Portal).
 * Referensi: developer.gobiz.com/docs/api/webhooks/receiving-notifications.
 */
export type GobizSignatureStatus = "valid" | "invalid" | "missing" | "unconfigured";

export function computeGobizSignature(rawBody: string, secret: string) {
  return createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
}

export function verifyGobizSignature(
  rawBody: string,
  header: string | null | undefined,
  secret: string | null | undefined
): GobizSignatureStatus {
  if (!secret) return "unconfigured";
  const given = String(header || "").trim().toLowerCase();
  if (!given) return "missing";
  const expected = computeGobizSignature(rawBody, secret);
  if (given.length !== expected.length) return "invalid";
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected)) ? "valid" : "invalid";
}
