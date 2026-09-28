import { createHash, randomInt } from "crypto";
import { brandName } from "@/lib/branding";

/**
 * OTP portal member (EPIC-011 Fase D) — konstanta & helper murni.
 */

export const OTP_LENGTH = 6;
export const OTP_TTL_MS = 5 * 60 * 1000; // 5 menit
export const OTP_MAX_ATTEMPTS = 5;
/** Maks permintaan OTP per nomor dalam jendela rate-limit */
export const OTP_RATE_LIMIT_COUNT = 3;
export const OTP_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 menit

/** Normalisasi nomor HP ke digit 62xxx (selaras buildWaLink Fonnte). */
export function normalizePhoneDigits(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (!digits) return null;
  const normalized = digits.startsWith("0") ? `62${digits.slice(1)}` : digits;
  // panjang wajar nomor Indonesia: 10-15 digit
  if (normalized.length < 10 || normalized.length > 15) return null;
  return normalized;
}

export function generateOtpCode(): string {
  // randomInt crypto-safe; pad supaya selalu 6 digit
  return String(randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, "0");
}

export function hashSecret(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function otpMessage(code: string): string {
  return (
    `Kode masuk Portal Member ${brandName()} Anda: *${code}*\n` +
    `Berlaku 5 menit. JANGAN bagikan kode ini kepada siapa pun, ` +
    `termasuk yang mengaku staf ${brandName()}.`
  );
}
