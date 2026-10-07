/** Country codes the phone picker offers; +62 is the default. */
export interface CountryCode {
  code: string;
  dial: string;
  name: string;
}

export const COUNTRY_CODES: readonly CountryCode[] = [
  { code: "ID", dial: "+62", name: "Indonesia" },
  { code: "MY", dial: "+60", name: "Malaysia" },
  { code: "SG", dial: "+65", name: "Singapore" },
  { code: "TH", dial: "+66", name: "Thailand" },
  { code: "VN", dial: "+84", name: "Vietnam" },
  { code: "PH", dial: "+63", name: "Philippines" },
  { code: "BN", dial: "+673", name: "Brunei" },
  { code: "KH", dial: "+855", name: "Cambodia" },
  { code: "LA", dial: "+856", name: "Laos" },
  { code: "MM", dial: "+95", name: "Myanmar" },
  { code: "AU", dial: "+61", name: "Australia" },
  { code: "US", dial: "+1", name: "United States" },
  { code: "GB", dial: "+44", name: "United Kingdom" },
];

export const DEFAULT_COUNTRY = "ID";

const E164 = /^\+[1-9]\d{7,14}$/;

/** The local number cleaned: digits only, leading zeros dropped (0812 -> 812). */
export function localDigits(raw: string): string {
  return raw.replace(/\D/g, "").replace(/^0+/, "");
}

/**
 * Joins the country code and the local number into E.164 (+628123456789).
 * A local number that already starts with the same country code is not
 * doubled. null when the result is not valid E.164.
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
