export type QCHasil = "approved" | "rejected" | "partial" | "passed" | "pending";

export type QCItem = {
  bahan_baku_id?: string | null;
  raw_material_id?: string | null;
  jumlah_diperiksa?: number | null;
  jumlah_diterima?: number | null;
  jumlah_ditolak?: number | null;
  qty_inspected?: number | null;
  qty_accepted?: number | null;
  qty_rejected?: number | null;
  raw_material?: {
    id: string;
    kode?: string | null;
    nama?: string | null;
  } | null;
  bahan_baku?: {
    id: string;
    kode?: string | null;
    nama?: string | null;
  } | null;
};

export type QCRecord = {
  id: string;
  qc_number?: string | null;
  grn_id?: string | null;
  goods_receipt_id?: string | null;
  grn_number?: string | null;
  hasil?: QCHasil | null;
  status?: "APPROVED" | "REJECTED" | "PARTIAL";
  rekomendasi?: "ACCEPT" | "REJECT" | "REWORK" | string | null;
  jumlah_diperiksa?: number | null;
  jumlah_diterima?: number | null;
  jumlah_ditolak?: number | null;
  tanggal_inspeksi?: string | null;
  created_at?: string | null;
  inspector?: {
    id?: string;
    name?: string;
    email?: string;
  } | null;
  inspector_id?: string | null;
  parameter_inspeksi?: Record<string, string> | null;
  catatan?: string | null;
  items?: QCItem[];
};

export type QCInspection = QCRecord & {
  qc_number: string;
  goods_receipt_id: string;
  bahan_baku_id?: string;
  bahan_baku?: {
    id: string;
    kode: string;
    nama: string;
  };
  jumlah_diperiksa: number;
  jumlah_diterima: number;
  jumlah_ditolak: number;
  hasil: QCHasil;
  parameter_inspeksi: Record<string, string> | null;
  catatan: string | null;
  inspector_id: string;
  tanggal_inspeksi: string;
  created_at: string;
  status: "APPROVED" | "REJECTED" | "PARTIAL";
  rekomendasi: "ACCEPT" | "REJECT" | "REWORK";
};

export interface QCListParams {
  page?: number;
  limit?: number;
  search?: string;
}

export interface QCListResult {
  data: QCRecord[];
  total: number;
}

export class QCNotFoundError extends Error {
  constructor() {
    super("Data QC tidak ditemukan");
    this.name = "QCNotFoundError";
  }
}

export const QC_HASIL_COLORS: Record<string, string> = {
  approved: "bg-green-100 text-green-800",
  passed: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
  partial: "bg-blue-100 text-blue-800",
  pending: "bg-yellow-100 text-yellow-800",
};

export const QC_HASIL_LABELS: Record<string, string> = {
  approved: "Lulus",
  passed: "Lulus",
  rejected: "Ditolak",
  partial: "Sebagian",
  pending: "Menunggu QC",
};

export function getQcDisplayNumber(record: Pick<QCRecord, "id" | "qc_number" | "grn_number">) {
  if (record.grn_number) return `QC-${record.grn_number}`;
  if (record.qc_number && record.qc_number !== record.id) return record.qc_number;
  return record.id.slice(0, 8).toUpperCase();
}

export function getQcGrnId(record: Pick<QCRecord, "grn_id" | "goods_receipt_id">) {
  return record.grn_id || record.goods_receipt_id || null;
}

export function getQcGrnNumber(record: Pick<QCRecord, "grn_number">) {
  return record.grn_number || "-";
}

export function getQcItemMaterialLabel(item: QCItem) {
  return (
    item.raw_material?.nama ||
    item.bahan_baku?.nama ||
    item.raw_material?.kode ||
    item.bahan_baku?.kode ||
    "—"
  );
}

export function formatQcMaterialsSummary(items?: QCItem[]) {
  if (!items?.length) return "—";
  const labels = items.map(getQcItemMaterialLabel).filter((label) => label !== "—");
  if (labels.length === 0) return `${items.length} item`;
  if (labels.length === 1) return labels[0];
  return `${labels[0]} +${labels.length - 1} lainnya`;
}

export function getQcTotals(record: QCRecord) {
  const inspected =
    Number(record.jumlah_diperiksa ?? 0) ||
    (record.items || []).reduce((sum, item) => sum + Number(item.jumlah_diperiksa ?? item.qty_inspected ?? 0), 0);
  const accepted =
    Number(record.jumlah_diterima ?? 0) ||
    (record.items || []).reduce((sum, item) => sum + Number(item.jumlah_diterima ?? item.qty_accepted ?? 0), 0);
  const rejected =
    Number(record.jumlah_ditolak ?? 0) ||
    (record.items || []).reduce((sum, item) => sum + Number(item.jumlah_ditolak ?? item.qty_rejected ?? 0), 0);

  return { inspected, accepted, rejected };
}
