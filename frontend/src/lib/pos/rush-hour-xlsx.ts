import { buildXlsxBuffer, type SheetSpec } from "@/lib/spreadsheet/exceljs-safe";
import {
  RUSH_HOUR_HEATMAP_HOURS,
  RUSH_HOUR_WEEKDAYS,
  buildHourRangeContribution,
  formatHourLabel,
  type buildRushHourReport,
} from "@/lib/pos/rush-hour";

/**
 * Export Excel report Rush Hour (permintaan owner 2026-09-01) — format
 * rapi 4 sheet:
 *   1. Ringkasan   — periode, total, jam/hari puncak, kontribusi rentang
 *                    jam terpilih (Amount & Quantity sekaligus)
 *   2. Per Jam     — 24 baris + total, lengkap % kontribusi omzet & item
 *   3. Per Hari    — rekap Senin–Minggu
 *   4. Heatmap     — matriks hari × jam (08:00–22:00) jumlah transaksi
 */

export interface RushHourXlsxMeta {
  companyName: string;
  periodLabel: string;
  stallLabel: string;
  rangeFrom: number;
  rangeTo: number;
  generatedAt: Date;
}

type RushHourReportData = ReturnType<typeof buildRushHourReport>;

const rupiah = (value: number) => Math.round(value);

export async function buildRushHourXlsx(
  report: RushHourReportData,
  meta: RushHourXlsxMeta
): Promise<Buffer> {
  const sheets: SheetSpec[] = [];
  const printed = `Dicetak: ${meta.generatedAt.toLocaleString("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Jakarta",
  })} WIB`;
  const range = buildHourRangeContribution(
    report.hourly,
    report.summary,
    meta.rangeFrom,
    meta.rangeTo
  );
  const rangeLabel = `${formatHourLabel(range.from_hour)}–${formatHourLabel(range.to_hour)}`;

  /* ---------------- Sheet 1: Ringkasan ---------------- */
  const ringkasan: unknown[][] = [
    [`${meta.companyName} — Report Rush Hour`],
    [`Periode: ${meta.periodLabel}`],
    [`Stall: ${meta.stallLabel}`],
    [printed],
    [],
    ["TOTAL KESELURUHAN"],
    ["Jumlah transaksi", report.summary.transactions],
    ["Omzet (Rp)", rupiah(report.summary.revenue)],
    ["Item terjual", report.summary.quantity],
    ["Rata-rata bill (Rp)", rupiah(report.summary.average_ticket)],
    [],
    ["PUNCAK"],
    [
      "Jam tersibuk",
      report.peak_hour.hour_label ?? "—",
      `${report.peak_hour.transactions} transaksi`,
    ],
    [
      "Jam omzet tertinggi",
      report.peak_revenue_hour.hour_label ?? "—",
      `Rp ${rupiah(report.peak_revenue_hour.revenue).toLocaleString("id-ID")}`,
    ],
    [
      "Hari tersibuk",
      report.peak_day.dow_label ?? "—",
      `${report.peak_day.transactions} transaksi`,
    ],
    [],
    [`KONTRIBUSI RENTANG JAM ${rangeLabel}`],
    ["Berdasarkan", "Nilai dalam rentang", "Total keseluruhan", "Kontribusi (%)"],
    [
      "Amount / omzet (Rp)",
      rupiah(range.revenue),
      rupiah(report.summary.revenue),
      range.share_revenue,
    ],
    ["Quantity / item terjual", range.quantity, report.summary.quantity, range.share_quantity],
    ["Jumlah transaksi", range.transactions, report.summary.transactions, range.share_transactions],
  ];
  sheets.push({
    name: "Ringkasan",
    rows: ringkasan as SheetSpec["rows"],
    columnWidths: [26, 20, 20, 16],
    merges: [0, 1, 2, 3, 5, 11, 17].map((r) => ({ s: { r, c: 0 }, e: { r, c: 3 } })),
  });

  /* ---------------- Sheet 2: Per Jam ---------------- */
  const headerJam = [
    "Jam", "Transaksi", "Omzet (Rp)", "Item Terjual",
    "Rata-rata Bill (Rp)", "% Omzet", "% Item",
  ];
  const pct = (part: number, total: number) =>
    total > 0 ? Math.round((part / total) * 1000) / 10 : 0;
  const perJam: unknown[][] = [
    [`${meta.companyName} — Rush Hour per Jam`],
    [`Periode: ${meta.periodLabel} · Stall: ${meta.stallLabel}`],
    [],
    headerJam,
    ...report.hourly.map((row) => [
      row.label,
      row.transactions,
      rupiah(row.revenue),
      row.quantity,
      rupiah(row.average_ticket),
      pct(row.revenue, report.summary.revenue),
      pct(row.quantity, report.summary.quantity),
    ]),
    [
      "TOTAL",
      report.summary.transactions,
      rupiah(report.summary.revenue),
      report.summary.quantity,
      rupiah(report.summary.average_ticket),
      report.summary.revenue > 0 ? 100 : 0,
      report.summary.quantity > 0 ? 100 : 0,
    ],
  ];
  sheets.push({
    name: "Per Jam",
    rows: perJam as SheetSpec["rows"],
    columnWidths: [8, 11, 16, 13, 18, 9, 9],
    merges: [0, 1].map((r) => ({ s: { r, c: 0 }, e: { r, c: headerJam.length - 1 } })),
  });

  /* ---------------- Sheet 3: Per Hari ---------------- */
  const perHari: unknown[][] = [
    [`${meta.companyName} — Rush Hour per Hari`],
    [`Periode: ${meta.periodLabel} · Stall: ${meta.stallLabel}`],
    [],
    ["Hari", "Transaksi", "Omzet (Rp)"],
    ...report.weekdays.map((day) => [day.label, day.transactions, rupiah(day.revenue)]),
  ];
  sheets.push({
    name: "Per Hari",
    rows: perHari as SheetSpec["rows"],
    columnWidths: [10, 11, 16],
    merges: [0, 1].map((r) => ({ s: { r, c: 0 }, e: { r, c: 2 } })),
  });

  /* ---------------- Sheet 4: Heatmap ---------------- */
  const heatHeader = ["Hari \\ Jam", ...RUSH_HOUR_HEATMAP_HOURS.map((h) => formatHourLabel(h))];
  const heatRows = RUSH_HOUR_WEEKDAYS.map((day) => [
    day.label,
    ...RUSH_HOUR_HEATMAP_HOURS.map((hour) => {
      const cell = report.heatmap.find((c) => c.dow === day.dow && c.hour === hour);
      return cell?.transactions ?? 0;
    }),
  ]);
  const heatmap: unknown[][] = [
    [`${meta.companyName} — Heatmap Transaksi (hari × jam)`],
    [`Periode: ${meta.periodLabel} · Stall: ${meta.stallLabel}`],
    [],
    heatHeader,
    ...heatRows,
  ];
  sheets.push({
    name: "Heatmap",
    rows: heatmap as SheetSpec["rows"],
    columnWidths: [11, ...RUSH_HOUR_HEATMAP_HOURS.map(() => 7)],
    merges: [0, 1].map((r) => ({ s: { r, c: 0 }, e: { r, c: heatHeader.length - 1 } })),
  });

  return buildXlsxBuffer(sheets);
}
