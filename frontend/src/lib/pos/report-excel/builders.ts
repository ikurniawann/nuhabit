import type ExcelJS from "exceljs";
import type {
  PaymentMethodsReport, ProductSalesReport, ProfitBucket, ProfitReport, RevenueCompositionReport,
  RushHourReport, TransactionReport, VoidReport,
} from "@/lib/pos/reports/types";
import { formatPeriodLabel } from "@/lib/pos/report-period";
import {
  addKeyValues, addSectionTitle, addTable, addTitleBlock, newWorkbook, printedLine, round0, round2, wibDateTime,
  type CellValue, type TableCol,
} from "@/lib/pos/report-excel/workbook";

/**
 * Pembangun Excel rapi per laporan POS (Desktop → Drive → Reports).
 * Setiap builder menerima JSON persis seperti respons API laporan terkait.
 */

export const REPORT_EXPORTS = {
  profit: { label: "Profit", description: "Omzet, HPP, laba kotor per produk/kategori/station/kasir/tanggal" },
  "revenue-composition": { label: "Revenue Composition", description: "Komposisi pendapatan Food vs Beverage per kategori & harian" },
  transactions: { label: "Transaksi", description: "Daftar transaksi, rekap per stall, produk terlaris, harian" },
  "rush-hour": { label: "Rush Hour", description: "Kepadatan per jam & hari, heatmap hari × jam" },
  voids: { label: "Void", description: "Transaksi dibatalkan beserta alasan, kasir, supervisor, dan itemnya" },
  "product-sales": { label: "Product Sales", description: "Penjualan per produk: qty, omzet, jumlah order" },
  "payment-methods": { label: "Payment Methods", description: "Rekap metode pembayaran & tren per hari" },
} as const;
export type ReportExportKey = keyof typeof REPORT_EXPORTS;
export const REPORT_EXPORT_KEYS = Object.keys(REPORT_EXPORTS) as ReportExportKey[];
export function isReportExportKey(v: string): v is ReportExportKey {
  return v in REPORT_EXPORTS;
}

export interface ExportMeta { companyName: string; stallLabel: string; generatedAt: Date }

const titleLines = (report: { filters: { date_from: string; date_to: string } }, meta: ExportMeta) => [
  `Periode: ${formatPeriodLabel(report.filters.date_from, report.filters.date_to)}`,
  `Stall: ${meta.stallLabel}`,
  printedLine(meta.generatedAt),
];

const PROFIT_COLS: TableCol[] = [
  { header: "Nama", width: 36 }, { header: "Qty", fmt: "qty", width: 10 }, { header: "Omzet (Rp)", fmt: "rp", width: 18 },
  { header: "HPP (Rp)", fmt: "rp", width: 18 }, { header: "Laba Kotor (Rp)", fmt: "rp", width: 18 }, { header: "Margin", fmt: "pct", width: 10 },
];
const profitRows = (b: ProfitBucket[]) => b.map((x) => [x.label, round2(x.quantity), round0(x.revenue), round0(x.cogs), round0(x.gross_profit), round2(x.gross_margin_pct)]);
const profitTotals = (b: ProfitBucket[]): CellValue[] => {
  const rev = b.reduce((s, x) => s + x.revenue, 0);
  const gp = b.reduce((s, x) => s + x.gross_profit, 0);
  return ["TOTAL", round2(b.reduce((s, x) => s + x.quantity, 0)), round0(rev), round0(b.reduce((s, x) => s + x.cogs, 0)), round0(gp), rev > 0 ? round2((gp / rev) * 100) : 0];
};

export async function buildProfitWorkbook(r: ProfitReport, meta: ExportMeta): Promise<ExcelJS.Workbook> {
  const wb = await newWorkbook();
  const ws = wb.addWorksheet("Ringkasan");
  let row = addTitleBlock(ws, `${meta.companyName} — Laporan Profit`, titleLines(r, meta));
  row = addKeyValues(ws, row, [
    ["Jumlah transaksi", r.summary.orders, "num"], ["Jumlah baris item", r.summary.items, "num"],
    ["Qty terjual", round2(r.summary.quantity), "qty"], ["Omzet", round0(r.summary.revenue), "rp"],
    ["HPP (COGS)", round0(r.summary.cogs), "rp"], ["Laba kotor", round0(r.summary.gross_profit), "rp"],
    ["Margin kotor", round2(r.summary.gross_margin_pct), "pct"], ["Item tanpa HPP (cost 0)", r.summary.zero_cost_items, "num"],
  ]);
  row = addSectionTitle(ws, row, "Per Tanggal");
  addTable(ws, row, [{ ...PROFIT_COLS[0], header: "Tanggal", width: 16 }, ...PROFIT_COLS.slice(1)], profitRows(r.breakdowns.dates), { totals: profitTotals(r.breakdowns.dates) });
  const sheets: Array<[string, ProfitBucket[]]> = [
    ["Per Produk", r.breakdowns.products], ["Per Kategori", r.breakdowns.categories],
    ["Per Station", r.breakdowns.stations], ["Per Kasir", r.breakdowns.cashiers],
  ];
  for (const [name, buckets] of sheets) {
    const s = wb.addWorksheet(name);
    const start = addTitleBlock(s, `${name} — ${formatPeriodLabel(r.filters.date_from, r.filters.date_to)}`, []);
    addTable(s, start, PROFIT_COLS, profitRows(buckets), { totals: profitTotals(buckets), freezeHeader: true });
  }
  return wb;
}

export async function buildRevenueCompositionWorkbook(r: RevenueCompositionReport, meta: ExportMeta): Promise<ExcelJS.Workbook> {
  const wb = await newWorkbook();
  const ws = wb.addWorksheet("Ringkasan");
  let row = addTitleBlock(ws, `${meta.companyName} — Laporan Revenue Composition`, titleLines(r, meta));
  row = addKeyValues(ws, row, [
    ["Jumlah transaksi", r.summary.orders, "num"], ["Qty terjual", round2(r.summary.quantity), "qty"],
    ["Penjualan", round0(r.summary.sales), "rp"], ["Biaya (HPP)", round0(r.summary.cost), "rp"],
    ["Margin", round0(r.summary.margin), "rp"], ["Rasio biaya", round2(r.summary.cost_pct), "pct"],
    ["Item tanpa HPP (cost 0)", r.summary.zero_cost_items, "num"],
  ]);
  const cols: TableCol[] = [
    { header: "Kelompok / Kategori", width: 34 }, { header: "Qty", fmt: "qty", width: 10 }, { header: "Penjualan (Rp)", fmt: "rp", width: 18 },
    { header: "Biaya (Rp)", fmt: "rp", width: 16 }, { header: "Margin (Rp)", fmt: "rp", width: 16 }, { header: "Rasio biaya", fmt: "pct", width: 12 },
    { header: "Share penjualan", fmt: "pct", width: 14 }, { header: "Share qty", fmt: "pct", width: 12 },
  ];
  row = addSectionTitle(ws, row, "Food vs Beverage");
  row = addTable(ws, row, cols, r.groups.map((g) => [g.label, round2(g.quantity), round0(g.sales), round0(g.cost), round0(g.margin), round2(g.cost_pct), round2(g.sales_share_pct), round2(g.qty_share_pct)]));
  for (const g of r.groups) {
    row = addSectionTitle(ws, row, `Kategori ${g.label}`);
    row = addTable(ws, row, cols, g.categories.map((c) => [c.label, round2(c.quantity), round0(c.sales), round0(c.cost), round0(c.margin), round2(c.cost_pct), round2(c.sales_share_pct), round2(c.qty_share_pct)]));
  }
  const d = wb.addWorksheet("Harian");
  const start = addTitleBlock(d, `Harian — ${formatPeriodLabel(r.filters.date_from, r.filters.date_to)}`, []);
  addTable(d, start, [
    { header: "Tanggal", width: 14 }, { header: "Food Qty", fmt: "qty", width: 10 }, { header: "Food (Rp)", fmt: "rp", width: 16 }, { header: "Food share", fmt: "pct", width: 11 },
    { header: "Beverage Qty", fmt: "qty", width: 12 }, { header: "Beverage (Rp)", fmt: "rp", width: 16 }, { header: "Beverage share", fmt: "pct", width: 13 }, { header: "Total (Rp)", fmt: "rp", width: 16 },
  ], r.daily.map((x) => [x.date, round2(x.food.quantity), round0(x.food.sales), round2(x.food.sales_share_pct), round2(x.beverage.quantity), round0(x.beverage.sales), round2(x.beverage.sales_share_pct), round0(x.food.sales + x.beverage.sales)]), { freezeHeader: true });
  return wb;
}

export async function buildTransactionsWorkbook(r: TransactionReport, meta: ExportMeta): Promise<ExcelJS.Workbook> {
  const wb = await newWorkbook();
  const ws = wb.addWorksheet("Ringkasan");
  let row = addTitleBlock(ws, `${meta.companyName} — Laporan Transaksi`, titleLines(r, meta));
  row = addKeyValues(ws, row, [
    ["Jumlah transaksi", r.summary.transactions, "num"], ["Omzet (sebelum diskon/pajak)", round0(r.summary.revenue), "rp"],
    ["Diskon", round0(r.summary.discount), "rp"], ["Pajak", round0(r.summary.tax), "rp"], ["Service", round0(r.summary.service), "rp"],
    ["Nett (dibayar pelanggan)", round0(r.summary.nett), "rp"], ["ARK Coin terpakai", round0(r.summary.total_ark_used), "num"],
  ]);
  row = addSectionTitle(ws, row, "Per Stall");
  row = addTable(ws, row, [{ header: "Stall", width: 28 }, { header: "Kode", width: 12 }, { header: "Transaksi", fmt: "num", width: 12 }, { header: "Qty", fmt: "qty", width: 10 }, { header: "Penjualan (Rp)", fmt: "rp", width: 18 }],
    r.per_stall.map((s) => [s.stall_name, s.stall_code ?? "", s.transactions, round2(s.quantity), round0(s.sales)]));
  row = addSectionTitle(ws, row, "Produk Terlaris");
  addTable(ws, row, [{ header: "Produk", width: 36 }, { header: "Qty", fmt: "qty", width: 10 }, { header: "Omzet (Rp)", fmt: "rp", width: 18 }],
    r.top_products.map((p) => [p.product_name, round2(p.quantity), round0(p.revenue)]));

  const h = wb.addWorksheet("Harian");
  const hs = addTitleBlock(h, `Harian — ${formatPeriodLabel(r.filters.date_from, r.filters.date_to)}`, []);
  addTable(h, hs, [{ header: "Tanggal", width: 14 }, { header: "Transaksi", fmt: "num", width: 12 }, { header: "Nett (Rp)", fmt: "rp", width: 18 }],
    r.daily.map((d) => [d.date, d.transactions, round0(d.nett)]), { totals: ["TOTAL", r.daily.reduce((s, d) => s + d.transactions, 0), round0(r.daily.reduce((s, d) => s + d.nett, 0))], freezeHeader: true });

  const t = wb.addWorksheet("Transaksi");
  const ts = addTitleBlock(t, `Daftar Transaksi — ${formatPeriodLabel(r.filters.date_from, r.filters.date_to)}`, [`${r.rows.length} transaksi`]);
  addTable(t, ts, [
    { header: "No", fmt: "num", width: 6 }, { header: "Waktu (WIB)", width: 20 }, { header: "No. Order", width: 20 }, { header: "Checkout", width: 16 },
    { header: "Stall", width: 22 }, { header: "Metode Bayar", width: 16 }, { header: "Subtotal (Rp)", fmt: "rp", width: 16 }, { header: "Diskon (Rp)", fmt: "rp", width: 14 },
    { header: "Pajak (Rp)", fmt: "rp", width: 14 }, { header: "Service (Rp)", fmt: "rp", width: 14 }, { header: "Total (Rp)", fmt: "rp", width: 16 }, { header: "ARK Coin", fmt: "num", width: 12 },
    { header: "Status", width: 12 }, { header: "Comp", width: 16 },
  ], r.rows.map((x, i) => [
    i + 1, wibDateTime(x.ordered_at), x.order_number ?? "", x.checkout_number ?? "", x.stall_name ?? "", x.payment_method_name || x.payment_method || "",
    round0(x.subtotal), round0(x.discount_amount), round0(x.tax_amount), round0(x.service_charge_amount), round0(x.total_amount), round0(x.ark_coins_used),
    x.status ?? "", x.comp_type ? `${x.comp_type}${x.comp_approved_name ? ` (${x.comp_approved_name})` : ""}` : "",
  ]), {
    totals: ["TOTAL", "", "", "", "", "", round0(r.rows.reduce((s, x) => s + x.subtotal, 0)), round0(r.rows.reduce((s, x) => s + x.discount_amount, 0)),
      round0(r.rows.reduce((s, x) => s + x.tax_amount, 0)), round0(r.rows.reduce((s, x) => s + x.service_charge_amount, 0)), round0(r.rows.reduce((s, x) => s + x.total_amount, 0)),
      round0(r.rows.reduce((s, x) => s + x.ark_coins_used, 0)), "", ""],
    freezeHeader: true,
  });
  return wb;
}

export async function buildRushHourWorkbook(r: RushHourReport, meta: ExportMeta): Promise<ExcelJS.Workbook> {
  const wb = await newWorkbook();
  const ws = wb.addWorksheet("Ringkasan");
  let row = addTitleBlock(ws, `${meta.companyName} — Laporan Rush Hour`, titleLines(r, meta));
  row = addKeyValues(ws, row, [
    ["Jumlah transaksi", r.summary.transactions, "num"], ["Omzet", round0(r.summary.revenue), "rp"],
    ["Qty item", round2(r.summary.quantity), "qty"], ["Rata-rata per transaksi", round0(r.summary.average_ticket), "rp"],
    ["Jam tersibuk (transaksi)", r.peak_hour.hour_label ? `${r.peak_hour.hour_label} · ${r.peak_hour.transactions} transaksi` : "—"],
    ["Jam omzet tertinggi", r.peak_revenue_hour.hour_label ? `${r.peak_revenue_hour.hour_label} · Rp ${round0(r.peak_revenue_hour.revenue).toLocaleString("id-ID")}` : "—"],
    ["Hari tersibuk", r.peak_day.dow_label ? `${r.peak_day.dow_label} · ${r.peak_day.transactions} transaksi` : "—"],
  ]);
  row = addSectionTitle(ws, row, "Per Hari");
  addTable(ws, row, [{ header: "Hari", width: 14 }, { header: "Transaksi", fmt: "num", width: 12 }, { header: "Omzet (Rp)", fmt: "rp", width: 18 }, { header: "Kontribusi omzet", fmt: "pct", width: 16 }],
    r.weekdays.map((d) => [d.label, d.transactions, round0(d.revenue), r.summary.revenue > 0 ? round2((d.revenue / r.summary.revenue) * 100) : 0]));

  const h = wb.addWorksheet("Per Jam");
  const hs = addTitleBlock(h, `Per Jam — ${formatPeriodLabel(r.filters.date_from, r.filters.date_to)}`, []);
  addTable(h, hs, [
    { header: "Jam", width: 14 }, { header: "Transaksi", fmt: "num", width: 12 }, { header: "Omzet (Rp)", fmt: "rp", width: 18 },
    { header: "Qty item", fmt: "qty", width: 12 }, { header: "Rata-rata (Rp)", fmt: "rp", width: 16 }, { header: "Kontribusi omzet", fmt: "pct", width: 16 }, { header: "Kontribusi qty", fmt: "pct", width: 14 },
  ], r.hourly.map((x) => [
    x.label, x.transactions, round0(x.revenue), round2(x.quantity), round0(x.average_ticket),
    r.summary.revenue > 0 ? round2((x.revenue / r.summary.revenue) * 100) : 0, r.summary.quantity > 0 ? round2((x.quantity / r.summary.quantity) * 100) : 0,
  ]), { totals: ["TOTAL", r.summary.transactions, round0(r.summary.revenue), round2(r.summary.quantity), round0(r.summary.average_ticket), 100, 100], freezeHeader: true });

  const m = wb.addWorksheet("Heatmap");
  const ms = addTitleBlock(m, "Heatmap jumlah transaksi — hari × jam", []);
  const hours = [...new Set(r.heatmap.map((c) => c.hour))].sort((a, b) => a - b);
  const byKey = new Map(r.heatmap.map((c) => [`${c.dow}-${c.hour}`, c.transactions]));
  addTable(m, ms, [{ header: "Hari", width: 12 }, ...hours.map((hr) => ({ header: r.hourly.find((x) => x.hour === hr)?.label ?? String(hr), fmt: "num" as const, width: 8 }))],
    r.weekdays.map((d) => [d.label, ...hours.map((hr) => byKey.get(`${d.dow}-${hr}`) ?? 0)]), { freezeHeader: true });
  return wb;
}

export async function buildVoidsWorkbook(r: VoidReport, meta: ExportMeta): Promise<ExcelJS.Workbook> {
  const wb = await newWorkbook();
  const ws = wb.addWorksheet("Void");
  let row = addTitleBlock(ws, `${meta.companyName} — Laporan Void`, titleLines(r, meta));
  row = addKeyValues(ws, row, [["Jumlah void", r.summary.voids, "num"], ["Nilai void", round0(r.summary.amount), "rp"]]);
  addTable(ws, row, [
    { header: "No", fmt: "num", width: 6 }, { header: "No. Order", width: 20 }, { header: "Checkout", width: 16 }, { header: "Dipesan (WIB)", width: 20 }, { header: "Di-void (WIB)", width: 20 },
    { header: "Alasan", width: 34 }, { header: "Kasir", width: 18 }, { header: "Supervisor", width: 18 }, { header: "Stall", width: 20 }, { header: "Metode Bayar", width: 16 }, { header: "Total (Rp)", fmt: "rp", width: 16 },
  ], r.rows.map((x, i) => [
    i + 1, x.order_number ?? "", x.checkout_number ?? "", wibDateTime(x.ordered_at), wibDateTime(x.voided_at), x.void_reason ?? "", x.created_by_name, x.voided_by_name,
    x.stall_name ?? "", x.payment_method_name || x.payment_method || "", round0(x.total_amount),
  ]), { totals: ["TOTAL", "", "", "", "", "", "", "", "", "", round0(r.rows.reduce((s, x) => s + x.total_amount, 0))], freezeHeader: true });

  const it = wb.addWorksheet("Item Void");
  const is = addTitleBlock(it, "Item pada transaksi yang di-void", []);
  addTable(it, is, [
    { header: "No. Order", width: 20 }, { header: "Produk", width: 34 }, { header: "SKU", width: 18 }, { header: "Qty", fmt: "qty", width: 8 }, { header: "Harga (Rp)", fmt: "rp", width: 14 }, { header: "Total (Rp)", fmt: "rp", width: 16 },
  ], r.rows.flatMap((x) => x.items.map((i) => [x.order_number ?? "", i.product_name, i.product_sku ?? "", round2(i.quantity), round0(i.unit_price), round0(i.total_amount)])), { freezeHeader: true });
  return wb;
}

export async function buildProductSalesWorkbook(r: ProductSalesReport, meta: ExportMeta): Promise<ExcelJS.Workbook> {
  const wb = await newWorkbook();
  const ws = wb.addWorksheet("Product Sales");
  let row = addTitleBlock(ws, `${meta.companyName} — Laporan Product Sales`, titleLines(r, meta));
  row = addKeyValues(ws, row, [["Jumlah produk", r.summary.products, "num"], ["Qty terjual", round2(r.summary.quantity), "qty"], ["Total omzet", round0(r.summary.revenue), "rp"]]);
  const total = r.summary.revenue || 0;
  addTable(ws, row, [
    { header: "Rank", fmt: "num", width: 7 }, { header: "SKU", width: 20 }, { header: "Produk", width: 36 }, { header: "Stall", width: 22 },
    { header: "Qty", fmt: "qty", width: 10 }, { header: "Omzet (Rp)", fmt: "rp", width: 18 }, { header: "Jumlah order", fmt: "num", width: 13 }, { header: "Kontribusi omzet", fmt: "pct", width: 16 },
  ], r.rows.map((x, i) => [i + 1, x.product_sku ?? "", x.product_name, x.stall_name ?? "", round2(x.quantity), round0(x.revenue), x.order_count, total > 0 ? round2((x.revenue / total) * 100) : 0]),
    { totals: ["TOTAL", "", "", "", round2(r.summary.quantity), round0(r.summary.revenue), "", 100], freezeHeader: true });
  return wb;
}

export async function buildPaymentMethodsWorkbook(r: PaymentMethodsReport, meta: ExportMeta): Promise<ExcelJS.Workbook> {
  const wb = await newWorkbook();
  const ws = wb.addWorksheet("Ringkasan");
  let row = addTitleBlock(ws, `${meta.companyName} — Laporan Payment Methods`, titleLines(r, meta));
  row = addKeyValues(ws, row, [
    ["Total pembayaran", round0(r.summary.total_amount), "rp"], ["Jumlah pembayaran", r.summary.payment_count, "num"],
    ["Jumlah order", r.summary.order_count, "num"], ["Jumlah metode", r.summary.method_count, "num"],
  ]);
  row = addSectionTitle(ws, row, "Per Metode Pembayaran");
  addTable(ws, row, [
    { header: "Metode", width: 26 }, { header: "Nominal (Rp)", fmt: "rp", width: 18 }, { header: "Porsi", fmt: "pct", width: 10 },
    { header: "Jumlah pembayaran", fmt: "num", width: 18 }, { header: "Jumlah order", fmt: "num", width: 14 },
  ], r.by_method.map((m) => [m.label, round0(m.amount), round2(m.pct), m.payment_count, m.order_count]),
    { totals: ["TOTAL", round0(r.summary.total_amount), 100, r.summary.payment_count, r.summary.order_count] });

  const s = wb.addWorksheet("Per Periode");
  const ss = addTitleBlock(s, `Tren per ${r.filters.granularity === "day" ? "hari" : r.filters.granularity === "month" ? "bulan" : "tahun"} — ${formatPeriodLabel(r.filters.date_from, r.filters.date_to)}`, []);
  const methodCols = r.method_columns;
  addTable(s, ss, [
    { header: "Periode", width: 16 }, { header: "Total (Rp)", fmt: "rp", width: 18 }, { header: "Pembayaran", fmt: "num", width: 12 },
    ...methodCols.map((c) => ({ header: `${c.label} (Rp)`, fmt: "rp" as const, width: 16 })),
  ], r.series.map((p) => [
    p.label, round0(p.total_amount), p.payment_count,
    ...methodCols.map((c) => round0(p.by_method.find((b) => b.method_key === c.method_key)?.amount ?? 0)),
  ]), {
    totals: ["TOTAL", round0(r.series.reduce((t, p) => t + p.total_amount, 0)), r.series.reduce((t, p) => t + p.payment_count, 0),
      ...methodCols.map((c) => round0(r.series.reduce((t, p) => t + (p.by_method.find((b) => b.method_key === c.method_key)?.amount ?? 0), 0)))],
    freezeHeader: true,
  });
  return wb;
}

export async function buildReportWorkbook(key: ReportExportKey, data: unknown, meta: ExportMeta): Promise<ExcelJS.Workbook> {
  switch (key) {
    case "profit": return buildProfitWorkbook(data as ProfitReport, meta);
    case "revenue-composition": return buildRevenueCompositionWorkbook(data as RevenueCompositionReport, meta);
    case "transactions": return buildTransactionsWorkbook(data as TransactionReport, meta);
    case "rush-hour": return buildRushHourWorkbook(data as RushHourReport, meta);
    case "voids": return buildVoidsWorkbook(data as VoidReport, meta);
    case "product-sales": return buildProductSalesWorkbook(data as ProductSalesReport, meta);
    case "payment-methods": return buildPaymentMethodsWorkbook(data as PaymentMethodsReport, meta);
  }
}
