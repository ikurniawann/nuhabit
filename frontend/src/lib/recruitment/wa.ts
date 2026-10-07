/**
 * Bangun link wa.me dari nomor lokal Indonesia.
 * Nomor tersimpan umumnya format lokal (08xx…) — wa.me butuh format
 * internasional tanpa nol di depan, jadi `0` diganti `62` (pola sama dgn
 * reservation-page POS). Return null bila nomor kosong/tidak ada digit.
 */
export function buildWaLink(phone: string | null | undefined, message: string): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (!digits) return null;
  const normalized = digits.startsWith("0") ? `62${digits.slice(1)}` : digits;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(message)}`;
}
