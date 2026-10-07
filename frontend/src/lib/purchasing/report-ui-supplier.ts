import type { SupplierPerfRow } from "./report-ui-types";

/** Ringkasan kartu atas laporan performa supplier. Rata-rata on-time hanya dari supplier yang punya data. */
export function summarizeSupplierPerformance(rows: SupplierPerfRow[]) {
  const withOnTime = rows.filter((row) => row.on_time_rate != null);
  return {
    totalValue: rows.reduce((sum, row) => sum + (row.total_value || 0), 0),
    totalPo: rows.reduce((sum, row) => sum + (row.total_po || 0), 0),
    avgOnTime:
      withOnTime.length > 0
        ? withOnTime.reduce((sum, row) => sum + (row.on_time_rate || 0), 0) / withOnTime.length
        : null,
    avgReject: rows.length > 0 ? rows.reduce((sum, row) => sum + (row.reject_rate || 0), 0) / rows.length : 0,
  };
}

/** Supplier dengan nilai PO terbesar. */
export function topSpendSuppliers(rows: SupplierPerfRow[], limit = 8): SupplierPerfRow[] {
  return [...rows].sort((a, b) => (b.total_value || 0) - (a.total_value || 0)).slice(0, limit);
}

export function ratingTone(rating?: number): string {
  if (rating == null) return "text-muted-foreground";
  if (rating >= 4) return "text-emerald-600";
  if (rating >= 3) return "text-amber-600";
  return "text-red-600";
}

export const SUPPLIER_CSV_HEADERS = [
  "Rank",
  "Kode",
  "Supplier",
  "Total PO",
  "On-Time",
  "Terlambat",
  "On-Time %",
  "Reject Rate (%)",
  "Lead Time (Hari)",
  "Total Nilai",
  "Rating",
  "Quality Score",
];

const fixed1 = (value?: number | null) => (value != null ? value.toFixed(1) : "");

export function supplierCsvRows(rows: SupplierPerfRow[]): string[][] {
  return rows.map((row) => [
    String(row.rank || ""),
    row.supplier_code || "",
    row.supplier_name || "",
    String(row.total_po || 0),
    String(row.on_time_count || 0),
    String(row.late_count || 0),
    fixed1(row.on_time_rate),
    fixed1(row.reject_rate),
    fixed1(row.avg_lead_time_days),
    String(row.total_value || 0),
    fixed1(row.rating),
    row.quality_score != null ? String(row.quality_score) : "",
  ]);
}
