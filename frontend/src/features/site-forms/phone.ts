/** Kode negara yang ditawarkan pemilih nomor telepon; +62 jadi bawaan. */
export interface CountryCode {
  code: string;
  dial: string;
  name: string;
}

export const COUNTRY_CODES: readonly CountryCode[] = [
  { code: "ID", dial: "+62", name: "Indonesia" },
  { code: "MY", dial: "+60", name: "Malaysia" },
  { code: "SG", dial: "+65", name: "Singapura" },
  { code: "TH", dial: "+66", name: "Thailand" },
  { code: "VN", dial: "+84", name: "Vietnam" },
  { code: "PH", dial: "+63", name: "Filipina" },
  { code: "BN", dial: "+673", name: "Brunei" },
  { code: "KH", dial: "+855", name: "Kamboja" },
  { code: "LA", dial: "+856", name: "Laos" },
  { code: "MM", dial: "+95", name: "Myanmar" },
  { code: "AU", dial: "+61", name: "Australia" },
  { code: "US", dial: "+1", name: "Amerika Serikat" },
  { code: "GB", dial: "+44", name: "Inggris" },
];

export const DEFAULT_COUNTRY = "ID";

const E164 = /^\+[1-9]\d{7,14}$/;

/** Nomor lokal dibersihkan: hanya digit, nol awal dibuang (0812 -> 812). */
export function localDigits(raw: string): string {
  return raw.replace(/\D/g, "").replace(/^0+/, "");
}

/**
 * Gabungkan kode negara dan nomor lokal menjadi E.164 (+628123456789).
 * Nomor lokal yang sudah diawali kode negara yang sama tidak digandakan.
 * null bila hasilnya bukan E.164 yang sah.
 */
export function toE164(countryCode: string, local: string): string | null {
  const country = COUNTRY_CODES.find((c) => c.code === countryCode);
  if (!country) return null;
  const dialDigits = country.dial.slice(1);
  let digits = localDigits(local);
  if (digits.startsWith(dialDigits) && digits.length > dialDigits.length + 6) {
    digits = digits.slice(dialDigits.length);
  }
  const e164 = `+${dialDigits}${digits}`;
  return E164.test(e164) ? e164 : null;
}

export function isE164(value: string): boolean {
  return E164.test(value);
}
