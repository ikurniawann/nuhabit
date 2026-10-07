/** Normalisasi nomor HP ke digit 62xxx (selaras buildWaLink Fonnte). Murni, aman untuk klien. */
export function normalizePhoneDigits(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (!digits) return null;
  const normalized = digits.startsWith("0") ? `62${digits.slice(1)}` : digits;
  // panjang wajar nomor Indonesia: 10-15 digit
  if (normalized.length < 10 || normalized.length > 15) return null;
  return normalized;
}
