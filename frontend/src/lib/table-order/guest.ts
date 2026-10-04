/**
 * Data pemesan self-order (owner 2026-09-28): nomor WhatsApp & nama WAJIB
 * sebelum memesan — tanpa OTP. Member yang login OTP otomatis memenuhi syarat.
 * Murni (dipakai klien & server).
 */

export const GUEST_NAME_MAX = 80;

export type GuestIdentity = { name: string; phone: string };

/** `08xx` / `+62 8xx` / `62-8xx` → `628xx`; bukan nomor ponsel Indonesia → null. */
export function normalizeGuestPhone(raw: string | null | undefined): string | null {
  const digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return null;
  const normalized = digits.startsWith("0") ? `62${digits.slice(1)}` : digits.startsWith("62") ? digits : `62${digits}`;
  // Ponsel Indonesia: 62 8xx, total 11–15 digit.
  return /^628\d{8,12}$/.test(normalized) ? normalized : null;
}

export function normalizeGuestName(raw: string | null | undefined): string | null {
  const name = String(raw || "").replace(/\s+/g, " ").trim().slice(0, GUEST_NAME_MAX);
  return name.length >= 2 ? name : null;
}

export function validateGuest(input: { name?: string | null; phone?: string | null }):
  | { ok: true; guest: GuestIdentity }
  | { ok: false; error: string } {
  const phone = normalizeGuestPhone(input.phone);
  if (!phone) return { ok: false, error: "Masukkan nomor WhatsApp yang valid (contoh 0812xxxxxxx)" };
  const name = normalizeGuestName(input.name);
  if (!name) return { ok: false, error: "Masukkan nama pemesan (minimal 2 huruf)" };
  return { ok: true, guest: { name, phone } };
}

/** 6281234567890 → 0812-••••-7890 (tampilan). */
export function displayGuestPhone(phone: string) {
  const local = phone.startsWith("62") ? `0${phone.slice(2)}` : phone;
  return local.length > 8 ? `${local.slice(0, 4)}-••••-${local.slice(-4)}` : local;
}

export function parseStoredGuest(raw: string | null): GuestIdentity | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<GuestIdentity>;
    const result = validateGuest({ name: value.name, phone: value.phone });
    return result.ok ? result.guest : null;
  } catch {
    return null;
  }
}
