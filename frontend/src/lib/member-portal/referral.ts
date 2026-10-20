import { readStorage, removeStorage, STORAGE_KEYS, writeStorage } from "@/lib/storage-keys";

/**
 * Referral code and device id shared by the member app sign-up and the
 * public /join checkout. A shared link (?ref=CODE) is remembered until the
 * visitor signs up; the device id feeds the server's same-device guard.
 */

/** Upper-cased code without spaces; "" when it cannot be a code (server rule: 4 to 16 letters or digits). */
export function normalizeReferralCode(raw: string | null | undefined): string {
  const code = (raw ?? "").replace(/\s+/g, "").toUpperCase();
  return /^[A-Z0-9]{4,16}$/.test(code) ? code : "";
}

/** Remembers a code from a shared link; an invalid one is ignored. */
export function rememberReferralCode(raw: string | null | undefined): string {
  const code = normalizeReferralCode(raw);
  if (code) writeStorage(STORAGE_KEYS.memberReferralCode, code);
  return code;
}

export function storedReferralCode(): string {
  return normalizeReferralCode(readStorage(STORAGE_KEYS.memberReferralCode));
}

export function forgetReferralCode(): void {
  removeStorage(STORAGE_KEYS.memberReferralCode);
}

/** A random id kept on this device; "" when storage is blocked. */
export function deviceId(): string {
  const stored = readStorage(STORAGE_KEYS.memberDeviceId);
  if (stored) return stored;
  if (typeof crypto === "undefined" || typeof crypto.randomUUID !== "function") return "";
  const id = crypto.randomUUID();
  writeStorage(STORAGE_KEYS.memberDeviceId, id);
  return readStorage(STORAGE_KEYS.memberDeviceId) ?? "";
}

/** The referee campaign's discount, as the server sends it. */
export interface ReferralDiscount {
  type: "percent" | "fixed";
  value: number;
  max_discount: number | null;
}

/** GET /api/member-portal/referral/{code}: who invited and what the friend gets. */
export interface ReferralInvite {
  code: string;
  referrer_name: string;
  referee_credits: number;
  referee_discount: ReferralDiscount | null;
}

/** Looks a code up; null when it is unknown or the program is off. */
export async function lookupReferral(code: string): Promise<ReferralInvite | null> {
  const normalized = normalizeReferralCode(code);
  if (!normalized) return null;
  try {
    const res = await fetch(`/api/member-portal/referral/${encodeURIComponent(normalized)}`, { credentials: "same-origin" });
    const json = (await res.json()) as { success?: boolean; data?: ReferralInvite };
    return res.ok && json.success && json.data ? json.data : null;
  } catch {
    return null;
  }
}

/** "20%" or "Rp50.000" for a discount. */
export function discountLabel(d: ReferralDiscount, formatIdr: (n: number) => string): string {
  return d.type === "percent" ? `${d.value}%` : formatIdr(d.value);
}
