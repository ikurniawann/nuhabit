/**
 * Bentuk lama halaman QC (/api/purchasing/qc): baris grn_qc_inspections
 * dipetakan ke field berbahasa campuran (jumlah_*, hasil, rekomendasi).
 */
import { z } from "zod";
import { ApiError } from "@/lib/api/auth";

export type QcInspectionItemRow = {
  raw_material_id?: string | null;
  qty_inspected?: number | string | null;
  qty_accepted?: number | string | null;
  qty_rejected?: number | string | null;
  raw_material?: unknown;
  [key: string]: unknown;
};

export type QcInspectionRow = {
  id: string;
  grn_id: string;
  status?: string | null;
  parameter_inspeksi?: unknown;
  catatan?: string | null;
  inspector_id?: string | null;
  inspector?: unknown;
  inspected_at?: string | null;
  created_at?: string | null;
  grn?: { nomor_grn?: string } | null;
  items?: QcInspectionItemRow[];
  [key: string]: unknown;
};

/** Select bersama untuk daftar & detail QC. */
export const QC_INSPECTION_SELECT = `
  *,
  grn:grn_id(id, nomor_grn),
  inspector:inspector_id(id, name, email),
  items:grn_qc_inspection_items(
    id,
    grn_item_id,
    raw_material_id,
    qty_inspected,
    qty_accepted,
    qty_rejected,
    raw_material:raw_materials!raw_material_id(id, kode, nama)
  )
`;

export function mapQcStatus(status: string | null | undefined): "APPROVED" | "REJECTED" | "PARTIAL" {
  if (status === "approved") return "APPROVED";
  if (status === "rejected") return "REJECTED";
  return "PARTIAL";
}

function mapRecommendation(status: string | null | undefined): "ACCEPT" | "REJECT" | "REWORK" {
  if (status === "approved") return "ACCEPT";
  if (status === "rejected") return "REJECT";
  return "REWORK";
}

/** Field ringkasan yang dipakai daftar dan detail QC. */
function summarizeInspection(row: QcInspectionRow) {
  const items = row.items || [];
  const sum = (key: "qty_inspected" | "qty_accepted" | "qty_rejected") =>
    items.reduce((total, item) => total + Number(item[key] || 0), 0);

  return {
    qc_number: row.id,
    goods_receipt_id: row.grn_id,
    grn_number: row.grn?.nomor_grn,
    bahan_baku_id: items[0]?.raw_material_id,
    jumlah_diperiksa: sum("qty_inspected"),
    jumlah_diterima: sum("qty_accepted"),
    jumlah_ditolak: sum("qty_rejected"),
    tanggal_inspeksi: row.inspected_at || row.created_at,
    status: mapQcStatus(row.status),
    rekomendasi: mapRecommendation(row.status),
  };
}

/** Baris daftar GET /api/purchasing/qc. */
export function mapQcListRow(row: QcInspectionRow) {
  const summary = summarizeInspection(row);
  return {
    id: row.id,
    qc_number: summary.qc_number,
    goods_receipt_id: summary.goods_receipt_id,
    grn_id: row.grn_id,
    grn_number: summary.grn_number,
    bahan_baku_id: summary.bahan_baku_id,
    jumlah_diperiksa: summary.jumlah_diperiksa,
    jumlah_diterima: summary.jumlah_diterima,
    jumlah_ditolak: summary.jumlah_ditolak,
    hasil: row.status,
    parameter_inspeksi: row.parameter_inspeksi,
    catatan: row.catatan,
    inspector_id: row.inspector_id,
    inspector: row.inspector,
    tanggal_inspeksi: summary.tanggal_inspeksi,
    created_at: row.created_at,
    status: summary.status,
    rekomendasi: summary.rekomendasi,
    items: (row.items || []).map((item) => ({
      bahan_baku_id: item.raw_material_id,
      raw_material_id: item.raw_material_id,
      jumlah_diperiksa: item.qty_inspected,
      jumlah_diterima: item.qty_accepted,
      jumlah_ditolak: item.qty_rejected,
      raw_material: item.raw_material,
    })),
  };
}

/** Detail GET /api/purchasing/qc/[id]: baris asli + ringkasan. */
export function mapQcDetail(row: QcInspectionRow) {
  const { qc_number, goods_receipt_id, grn_number, bahan_baku_id, ...rest } = summarizeInspection(row);
  return {
    ...row,
    qc_number,
    goods_receipt_id,
    grn_number,
    bahan_baku_id,
    bahan_baku: row.items?.[0]?.raw_material,
    ...rest,
  };
}

const legacyQcItemSchema = z.object({
  grn_item_id: z.string().uuid("GRN Item ID tidak valid"),
  bahan_baku_id: z.string().uuid("Raw material ID tidak valid").optional(),
  raw_material_id: z.string().uuid("Raw material ID tidak valid").optional(),
  jumlah_diperiksa: z.number().min(0).optional(),
  jumlah_diterima: z.number().min(0).optional(),
  jumlah_ditolak: z.number().min(0).optional(),
  qty_inspected: z.number().min(0).optional(),
  qty_accepted: z.number().min(0).optional(),
  qty_rejected: z.number().min(0).optional(),
  hasil: z.enum(["passed", "rejected", "partial"]).optional(),
  parameter_inspeksi: z.record(z.string(), z.unknown()).optional(),
  alasan: z.string().optional(),
  catatan: z.string().optional().nullable(),
});

/** Body POST /api/purchasing/qc (field lama jumlah_* / bahan_baku_id masih diterima). */
export const createQcSchema = z.object({
  grn_id: z.string().uuid("GRN ID tidak valid"),
  items: z.array(legacyQcItemSchema).min(1, "Minimal 1 item QC"),
  catatan: z.string().optional().nullable(),
  parameter_inspeksi: z.record(z.string(), z.unknown()).optional(),
  hasil_inspeksi: z.record(z.string(), z.string()).optional(),
  rekomendasi: z.string().optional().nullable(),
});

/** Terjemahkan item lama ke input submitGrnQcInspection; qty diperiksa default = diterima + ditolak. */
export function toQcInspectionItems(items: z.infer<typeof legacyQcItemSchema>[]) {
  return items.map((item) => {
    const rawMaterialId = item.raw_material_id || item.bahan_baku_id;
    if (!rawMaterialId) {
      throw ApiError.badRequest("raw_material_id atau bahan_baku_id wajib diisi per item");
    }
    const qtyAccepted = item.qty_accepted ?? item.jumlah_diterima ?? 0;
    const qtyRejected = item.qty_rejected ?? item.jumlah_ditolak ?? 0;

    return {
      grn_item_id: item.grn_item_id,
      raw_material_id: rawMaterialId,
      qty_inspected: item.qty_inspected ?? item.jumlah_diperiksa ?? qtyAccepted + qtyRejected,
      qty_accepted: qtyAccepted,
      qty_rejected: qtyRejected,
      catatan: item.catatan ?? item.alasan ?? null,
    };
  });
}
