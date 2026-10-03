export const angka = (value: number) => value.toLocaleString("id-ID");

export const tanggal = (iso: string, locale = "id-ID") =>
  new Date(iso).toLocaleString(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Jakarta",
  });

/** "Sen, 6 Okt 19.00" — hari + tanggal + jam WIB. */
export const hariJam = (iso: string, locale = "id-ID") =>
  new Date(iso).toLocaleString(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Jakarta",
  });

/** "6 Okt" — tanggal pendek WIB. */
export const tanggalPendek = (iso: string, locale = "id-ID") =>
  new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "short", timeZone: "Asia/Jakarta" });

export const TXN_LABELS: Record<string, string> = {
  topup: "Top-up",
  topup_bonus: "Bonus top-up",
  payment: "Pembayaran",
  refund: "Refund",
  bonus: "Bonus",
  expiration: "Kedaluwarsa",
  adjustment: "Penyesuaian",
  reversal: "Pembatalan",
  topup_refund: "Refund top-up",
  withdrawal: "Penarikan saldo",
};
