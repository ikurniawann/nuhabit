/** Helper bersama layar laporan: CSV, unduhan, persentase, dan bar breakdown. */

/** CSV dengan semua sel di-quote; angka tetap mentah (tanpa format) supaya bisa dihitung di Excel. */
export function toCsv(headers: string[], rows: Array<Array<string | number>>): string {
  const line = (cells: Array<string | number>) =>
    cells.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",");
  return [line(headers), ...rows.map(line)].join("\n");
}

/** Cap tanggal file ekspor, mis. "2026-10-04" (UTC, sama seperti sebelumnya). */
export function dateStamp(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function downloadCsv(filename: string, headers: string[], rows: Array<Array<string | number>>): void {
  downloadBlob(new Blob([toCsv(headers, rows)], { type: "text/csv;charset=utf-8;" }), filename);
}

/** "12.5%" (satu desimal, gaya lama laporan); kosong/NaN menjadi "-". */
export function formatPct(value?: number | null): string {
  if (value == null || Number.isNaN(value)) return "-";
  return `${value.toFixed(1)}%`;
}

export type BreakdownInput = { key: string; label: string; caption: string; value: number };
export type BreakdownBar = BreakdownInput & { share: number; width: number };

/**
 * Lengkapi baris breakdown dengan pangsa (% dari total) dan lebar bar
 * (relatif ke nilai terbesar, minimal penyebut 1 supaya tidak membagi nol).
 */
export function breakdownBars(rows: BreakdownInput[], total: number): BreakdownBar[] {
  const max = Math.max(1, ...rows.map((row) => row.value));
  return rows.map((row) => ({
    ...row,
    share: total > 0 ? (row.value / total) * 100 : 0,
    width: (row.value / max) * 100,
  }));
}
