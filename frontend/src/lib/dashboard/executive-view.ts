/** Hitungan tampilan dashboard eksekutif (pure, diuji unit). */

/** Perubahan persen dibulatkan; pemanggil memastikan `before` > 0. */
export function changePercent(now: number, before: number): number {
  return Math.round(((now - before) / before) * 100);
}

/** Capaian target dalam persen (bisa > 100). */
export function targetPercent(value: number, target: number): number {
  return Math.round((value / target) * 100);
}

/** Omzet 7 hari terakhir vs 7 hari sebelumnya dari tren 14 hari (terlama dulu). */
export function compareWeeks(tren: Array<{ omzet: number }>) {
  const sum = (points: Array<{ omzet: number }>) => points.reduce((total, p) => total + p.omzet, 0);
  return { ini: sum(tren.slice(7)), lalu: sum(tren.slice(0, 7)) };
}
