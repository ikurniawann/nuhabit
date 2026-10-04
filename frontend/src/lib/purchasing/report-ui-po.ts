import { formatDate } from "@/lib/format";
import type { BreakdownInput } from "./report-ui-shared";
import type { PODetailRow, StatusSummary } from "./report-ui-types";

export const PO_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  pending_approval: "Pending Approval",
  approved: "Approved",
  sent: "Sent",
  partial: "Partially Received",
  partially_received: "Partially Received",
  received: "Fully Received",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

export const PO_STATUS_STYLES: Record<string, string> = {
  draft: "border-gray-200/80 bg-gray-50 text-gray-700",
  pending_approval: "border-amber-200/80 bg-amber-50 text-amber-700",
  approved: "border-blue-200/80 bg-blue-50 text-blue-700",
  sent: "border-violet-200/80 bg-violet-50 text-violet-700",
  partial: "border-amber-200/80 bg-amber-50 text-amber-700",
  partially_received: "border-amber-200/80 bg-amber-50 text-amber-700",
  received: "border-emerald-200/80 bg-emerald-50 text-emerald-700",
  rejected: "border-red-200/80 bg-red-50 text-red-700",
  cancelled: "border-red-200/80 bg-red-50 text-red-700",
};

export const PO_STATUS_OPTIONS = [
  { value: "all", label: "Semua Status" },
  ...Object.entries(PO_STATUS_LABELS).map(([value, label]) => ({ value, label })),
];

const RECEIVED_STATUSES = ["received", "partially_received", "partial"];

type Raw = Record<string, unknown>;

const text = (value: unknown) => (value == null ? undefined : String(value));
const num = (value: unknown) => Number(value || 0);

/** Normalisasi respons /reports/po-detail (nama kolom lama & baru) ke baris laporan. */
export function normalizePoDetailRows(rows: unknown[]): PODetailRow[] {
  return (rows as Raw[]).map((po) => {
    const items = Array.isArray(po.items) ? (po.items as Raw[]) : [];
    const poNumber = String(po.po_number ?? "");
    return {
      id: String(po.id || poNumber),
      no_po: poNumber,
      tanggal_po: String(po.tanggal_po ?? ""),
      supplier: String(po.vendor ?? ""),
      vendor_code: text(po.vendor_code),
      supplier_id: text(po.supplier_id),
      status: String(po.status || "").toLowerCase(),
      total: num(po.total_amount),
      item_count: Number(po.item_count || items.length || 0),
      items: items.map((item) => ({
        id: String(item.id || item.bahan_baku_id || `${poNumber}-${item.kode_bahan}`),
        nama_bahan: String(item.nama_bahan || item.nama || "-"),
        kode_bahan: text(item.kode_bahan || item.kode),
        qty_order: num(item.qty_order || item.quantity),
        qty_received: num(item.qty_received),
        harga_satuan: num(item.harga_satuan || item.unit_price),
        satuan: text(item.satuan),
        subtotal: Number(item.subtotal || num(item.qty_order) * num(item.harga_satuan)),
      })),
    };
  });
}

/** Rekap PO per status, nilai terbesar dulu. */
export function poStatusBreakdown(pos: PODetailRow[]): BreakdownInput[] {
  const byStatus = new Map<string, { count: number; total: number }>();
  for (const po of pos) {
    const entry = byStatus.get(po.status) ?? { count: 0, total: 0 };
    entry.count += 1;
    entry.total += po.total || 0;
    byStatus.set(po.status, entry);
  }
  return [...byStatus.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .map(([status, { count, total }]) => ({
      key: status,
      label: PO_STATUS_LABELS[status] || status,
      caption: `${count} PO`,
      value: total,
    }));
}

/** Jumlah & nilai PO yang sudah diterima (penuh atau sebagian). */
export function receivedSummary(byStatus: StatusSummary[]) {
  const received = byStatus.filter((row) => RECEIVED_STATUSES.includes(row.status));
  return {
    count: received.reduce((sum, row) => sum + row.count, 0),
    total: received.reduce((sum, row) => sum + row.total, 0),
  };
}

export const PO_DETAIL_CSV_HEADERS = [
  "No PO",
  "Tanggal",
  "Supplier",
  "Status",
  "Nama Bahan",
  "Kode Bahan",
  "Qty Order",
  "Qty Diterima",
  "Harga Satuan",
  "Subtotal",
  "Total PO",
];

/** Satu baris per item; kolom header PO hanya di baris item pertama. Angka mentah. */
export function poDetailCsvRows(pos: PODetailRow[]): string[][] {
  return pos.flatMap((po) => {
    const head = (first: boolean) =>
      first ? [po.no_po, formatDate(po.tanggal_po), po.supplier, po.status] : ["", "", "", ""];
    if (po.items.length === 0) return [[...head(true), "-", "-", "", "", "", "", String(po.total)]];
    return po.items.map((item, index) => [
      ...head(index === 0),
      item.nama_bahan,
      item.kode_bahan || "",
      String(item.qty_order),
      String(item.qty_received),
      String(item.harga_satuan),
      String(item.subtotal),
      index === 0 ? String(po.total) : "",
    ]);
  });
}
