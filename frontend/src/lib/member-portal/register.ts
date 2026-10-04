import { normalizePhoneDigits } from "./phone";

/**
 * Pendaftaran mandiri member dari portal /member: aturan murni (tanpa DB)
 * supaya validasi klien dan server sama dan mudah diuji.
 */

export interface RegistrationInput {
  phone: unknown;
  name: unknown;
  email?: unknown;
  birth_date?: unknown;
  wa_consent?: unknown;
}

export interface Registration {
  /** Digit 62xxx untuk OTP & pencarian duplikat. */
  phoneDigits: string;
  /** Format simpan pos_customers: 08xxx, sama seperti yang diketik kasir. */
  phoneLocal: string;
  name: string;
  email: string | null;
  birthDate: string | null;
  waConsent: boolean;
}

export type RegistrationField = "phone" | "name" | "email" | "birth_date";

export type RegistrationResult =
  | { ok: true; value: Registration }
  | { ok: false; field: RegistrationField; error: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NAME_MAX = 100; // pos_customers.name varchar(100)
const EMAIL_MAX = 100;

/** 62812xxx → 0812xxx; nomor luar negeri tetap digit apa adanya. */
export function localPhoneFormat(digits62: string): string {
  return digits62.startsWith("62") ? `0${digits62.slice(2)}` : digits62;
}

/** Tanggal lahir sah: format YYYY-MM-DD, tanggal kalender nyata, umur 5-120 tahun. */
export function isValidBirthDate(value: string, today = new Date()): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return false;
  const age = today.getUTCFullYear() - y;
  return age >= 5 && age <= 120;
}

export function validateRegistration(input: RegistrationInput, today = new Date()): RegistrationResult {
  const phoneDigits = normalizePhoneDigits(typeof input.phone === "string" ? input.phone : "");
  if (!phoneDigits) return { ok: false, field: "phone", error: "Nomor WhatsApp tidak valid" };

  const name = typeof input.name === "string" ? input.name.trim().replace(/\s+/g, " ") : "";
  if (name.length < 2) return { ok: false, field: "name", error: "Nama minimal 2 huruf" };
  if (name.length > NAME_MAX) return { ok: false, field: "name", error: "Nama terlalu panjang" };

  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  if (email && (email.length > EMAIL_MAX || !EMAIL_RE.test(email))) {
    return { ok: false, field: "email", error: "Format email tidak valid" };
  }

  const birthDate = typeof input.birth_date === "string" ? input.birth_date.trim() : "";
  if (birthDate && !isValidBirthDate(birthDate, today)) {
    return { ok: false, field: "birth_date", error: "Tanggal lahir tidak valid" };
  }

  return {
    ok: true,
    value: {
      phoneDigits,
      phoneLocal: localPhoneFormat(phoneDigits),
      name,
      email: email || null,
      birthDate: birthDate || null,
      waConsent: input.wa_consent === true,
    },
  };
}
