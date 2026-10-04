/**
 * Pemformat tampilan bersama: rupiah, angka, tanggal, jam. Rupiah mengikuti
 * PUEBI ("Rp1.250.000", tanpa spasi). Tanggal & jam selalu WIB supaya server
 * (UTC) dan browser menampilkan hal yang sama.
 */

const LOCALE = "id-ID";
const TIME_ZONE = "Asia/Jakarta";

type NumberLike = number | string | null | undefined;

function toNumber(value: NumberLike): number {
  const n = typeof value === "string" ? Number(value) : (value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function formatNumber(value: NumberLike, maximumFractionDigits = 0): string {
  return toNumber(value).toLocaleString(LOCALE, { maximumFractionDigits });
}

/** "Rp1.250.000"; negatif "-Rp1.250.000"; dibulatkan ke rupiah. */
export function formatRupiah(value: NumberLike): string {
  const n = Math.round(toNumber(value));
  return `${n < 0 ? "-" : ""}Rp${Math.abs(n).toLocaleString(LOCALE)}`;
}

/** Ringkas untuk kartu & grafik: "Rp950", "Rp165 rb", "Rp1,25 jt", "Rp2,5 M". */
export function formatRupiahCompact(value: NumberLike): string {
  const n = toNumber(value);
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  const scaled = (divisor: number, suffix: string, digits: number) =>
    `${sign}Rp${(abs / divisor).toLocaleString(LOCALE, { maximumFractionDigits: digits })} ${suffix}`;
  if (abs >= 1_000_000_000) return scaled(1_000_000_000, "M", 2);
  if (abs >= 1_000_000) return scaled(1_000_000, "jt", 2);
  if (abs >= 1_000) return scaled(1_000, "rb", 0);
  return formatRupiah(n);
}

type DateLike = Date | string | number | null | undefined;

function toDate(value: DateLike): Date | null {
  if (value === null || value === undefined || value === "") return null;
  // "YYYY-MM-DD" adalah tanggal kalender: jangkarkan ke tengah hari WIB supaya tidak bergeser.
  const d =
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? new Date(`${value}T12:00:00+07:00`)
      : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function format(value: DateLike, options: Intl.DateTimeFormatOptions, fallback: string): string {
  const d = toDate(value);
  return d ? d.toLocaleString(LOCALE, { timeZone: TIME_ZONE, ...options }) : fallback;
}

/** "4 Okt 2026" */
export const formatDate = (value: DateLike, fallback = "-") =>
  format(value, { day: "numeric", month: "short", year: "numeric" }, fallback);

/** "Sabtu, 4 Oktober 2026" */
export const formatDateLong = (value: DateLike, fallback = "-") =>
  format(value, { weekday: "long", day: "numeric", month: "long", year: "numeric" }, fallback);

/** "14.30" */
export const formatTime = (value: DateLike, fallback = "-") =>
  format(value, { hour: "2-digit", minute: "2-digit", hour12: false }, fallback);

/** "4 Okt 2026, 14.30" */
export const formatDateTime = (value: DateLike, fallback = "-") =>
  format(
    value,
    { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false },
    fallback
  );
