import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import { PARTNER_XP_CAP, type PartnerType } from "./partner-types";

export * from "./partner-types";

/**
 * Partner loyalty eksternal (port aturan NüHabit domain/external.go):
 * tanda tangan HMAC, toleransi timestamp, pencocokan member, dan keputusan
 * atas event. Murni (tanpa DB) supaya setiap aturan teruji.
 */

/** Selisih maksimal header timestamp dari jam server. */
export const TIMESTAMP_TOLERANCE_SECONDS = 5 * 60;

export const SIGNATURE_HEADER = "x-signature";
export const TIMESTAMP_HEADER = "x-timestamp";
const SIGNATURE_PREFIX = "sha256=";

/** Secret acak 32 byte (hex), ditampilkan ke admin sekali saja. */
export function generatePartnerSecret(): string {
  return randomBytes(32).toString("hex");
}

export function signPayload(rawBody: string, secret: string): string {
  return SIGNATURE_PREFIX + createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
}

/**
 * Cek `sha256=<hex>` = HMAC-SHA256(raw body, secret). Partner tanpa secret
 * tidak bisa mengirim apa pun. Perbandingan waktu-konstan.
 */
export function verifySignature(rawBody: string, header: string | null, secret: string | null): boolean {
  if (!secret || !header || !header.startsWith(SIGNATURE_PREFIX)) return false;
  const provided = header.slice(SIGNATURE_PREFIX.length).trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(provided)) return false;
  const expected = createHmac("sha256", secret).update(rawBody, "utf8").digest();
  return timingSafeEqual(Buffer.from(provided, "hex"), expected);
}

/** Header timestamp (detik Unix) wajib dalam ±5 menit dari jam server. */
export function isTimestampFresh(
  header: string | null,
  now: Date,
  toleranceSeconds = TIMESTAMP_TOLERANCE_SECONDS
): boolean {
  if (!header || !/^\d{9,11}$/.test(header.trim())) return false;
  const skew = Math.abs(now.getTime() / 1000 - Number(header.trim()));
  return skew <= toleranceSeconds;
}

export interface MatchCandidate {
  customerId: string;
  email: string | null;
  phone: string | null;
}

const digits = (value: string) => value.replace(/\D/g, "");
const tail8 = (value: string) => digits(value).slice(-8);

/**
 * Cari member yang dimaksud partner: email dulu, lalu telepon (8 digit
 * terakhir, jadi +6281… dan 081… sama), tidak pernah nama. Telepon yang
 * cocok ke lebih dari satu member dibiarkan unmatched: salah memberi poin
 * lebih buruk daripada menunggu pencocokan manual.
 */
export function matchSubject(subject: string, candidates: MatchCandidate[]): string | null {
  const needle = subject.trim().toLowerCase();
  if (!needle) return null;

  const byEmail = candidates.find((c) => c.email && c.email.trim().toLowerCase() === needle);
  if (byEmail) return byEmail.customerId;

  if (needle.includes("@") || digits(needle).length < 8) return null;
  const tail = tail8(needle);
  const byPhone = [...new Set(candidates.filter((c) => c.phone && tail8(c.phone) === tail).map((c) => c.customerId))];
  return byPhone.length === 1 ? byPhone[0] : null;
}

/** 8 digit terakhir nomor (untuk prefilter SQL kandidat), atau null. */
export function phoneTail(subject: string): string | null {
  const d = digits(subject);
  return !subject.includes("@") && d.length >= 8 ? d.slice(-8) : null;
}

export type ExternalEventStatus = "processed" | "unmatched" | "ignored";

/**
 * Nasib event: tanpa member → unmatched (antrean untuk dicocokkan manual,
 * member mungkin baru daftar minggu depan); partner nonaktif → ignored;
 * selain itu processed, dan XP hanya bila partner dipercaya memberi XP.
 */
export function decideEvent(
  partner: { is_active: boolean; awards_xp: boolean; xp_per_event: number },
  matched: boolean
): { status: ExternalEventStatus; xp: number } {
  if (!matched) return { status: "unmatched", xp: 0 };
  if (!partner.is_active) return { status: "ignored", xp: 0 };
  const xp = partner.awards_xp ? Math.min(PARTNER_XP_CAP, Math.max(0, Math.floor(partner.xp_per_event))) : 0;
  return { status: "processed", xp };
}

/** Kanal ledger XP & sumber event menurut tipe partner. */
export function partnerChannel(type: string): { eventChannel: PartnerType; ledgerChannel: string } {
  if (type === "photobooth" || type === "studio_game") return { eventChannel: type, ledgerChannel: type };
  // Ledger XP belum punya kanal "other"; partner lain dicatat sebagai manual.
  return { eventChannel: "other", ledgerChannel: "manual" };
}
