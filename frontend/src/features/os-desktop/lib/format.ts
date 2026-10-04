/** Format tampilan desktop (menubar, kalender, kartu monitoring). Murni. */

export function formatClockTime(date: Date): string {
  return new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit" }).format(date);
}

export function formatClockDate(date: Date): string {
  return new Intl.DateTimeFormat("id-ID", { weekday: "short", day: "2-digit", month: "short" }).format(date);
}

/** Rp ringkas: rb / jt / M. */
export function formatRupiah(value: number): string {
  if (value >= 1_000_000_000) return `Rp ${(value / 1_000_000_000).toLocaleString("id-ID", { maximumFractionDigits: 2 })} M`;
  if (value >= 1_000_000) return `Rp ${(value / 1_000_000).toLocaleString("id-ID", { maximumFractionDigits: 2 })} jt`;
  if (value >= 1_000) return `Rp ${(value / 1_000).toLocaleString("id-ID", { maximumFractionDigits: 0 })} rb`;
  return `Rp ${value.toLocaleString("id-ID", { maximumFractionDigits: 0 })}`;
}

/** Persen perubahan terhadap pembanding; pembanding 0 → null (tak bermakna). */
export function deltaPct(current: number, base: number): number | null {
  if (base <= 0) return null;
  return Math.round(((current - base) / base) * 100);
}

const BULAN_PENDEK = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Ags", "Sep", "Okt", "Nov", "Des"];

/** "2026-03-31" → "31 Mar 26". */
export function formatTanggalPendek(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${BULAN_PENDEK[m - 1]} ${String(y).slice(2)}`;
}

export const WEEKDAY_SHORT = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];

/** Sel kalender bulanan: null untuk kotak kosong sebelum tanggal 1. */
export function buildMonthCells(date: Date): Array<number | null> {
  const year = date.getFullYear();
  const month = date.getMonth();
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  return [
    ...Array.from({ length: firstDay }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => index + 1),
  ];
}
