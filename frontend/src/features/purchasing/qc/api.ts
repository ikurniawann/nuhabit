import { apiErrorMessage } from "@/lib/purchasing/receiving-ui-http";
import type {
  QCInspection,
  QCListParams,
  QCListResult,
  QCRecord,
} from "./types";
import { QCNotFoundError } from "./types";

export type {
  QCRecord,
  QCInspection,
  QCListParams,
  QCListResult,
  QCItem,
  QCHasil,
} from "./types";
export {
  QCNotFoundError,
  QC_HASIL_COLORS,
  QC_HASIL_LABELS,
  getQcDisplayNumber,
  getQcGrnId,
  getQcGrnNumber,
  getQcItemMaterialLabel,
  formatQcMaterialsSummary,
  getQcTotals,
} from "./types";

function normalizeRecord(row: QCRecord): QCRecord {
  const grnId = row.grn_id || row.goods_receipt_id || null;
  return {
    ...row,
    grn_id: grnId,
    goods_receipt_id: grnId || row.goods_receipt_id,
    hasil: (row.hasil || row.status?.toLowerCase() || "partial") as QCRecord["hasil"],
  };
}

export async function listQC(params: QCListParams = {}): Promise<QCListResult> {
  const sp = new URLSearchParams();
  if (params.page) sp.set("page", String(params.page));
  if (params.limit) sp.set("limit", String(params.limit));
  if (params.search) sp.set("search", params.search);

  const res = await fetch(`/api/purchasing/qc?${sp.toString()}`);
  const json = await res.json();
  if (!res.ok) {
    throw new Error(apiErrorMessage(json, "Gagal memuat daftar QC"));
  }

  const rows = (json.data || []) as QCRecord[];

  return {
    data: rows.map(normalizeRecord),
    total: json.pagination?.total || 0,
  };
}

export async function getQC(id: string): Promise<QCInspection> {
  const res = await fetch(`/api/purchasing/qc/${id}`);
  const json = await res.json();

  if (!res.ok) {
    if (res.status === 404) throw new QCNotFoundError();
    throw new Error(apiErrorMessage(json, "Gagal memuat data QC"));
  }

  const row = normalizeRecord(json.data as QCRecord);
  const totals = {
    jumlah_diperiksa: Number(row.jumlah_diperiksa ?? 0),
    jumlah_diterima: Number(row.jumlah_diterima ?? 0),
    jumlah_ditolak: Number(row.jumlah_ditolak ?? 0),
  };

  const firstItem = row.items?.[0];
  const bahanBaku = firstItem?.raw_material || firstItem?.bahan_baku;

  return {
    ...row,
    qc_number: row.qc_number || row.id,
    goods_receipt_id: row.goods_receipt_id || row.grn_id || "",
    bahan_baku_id: firstItem?.raw_material_id || firstItem?.bahan_baku_id || "",
    bahan_baku: bahanBaku
      ? {
          id: bahanBaku.id,
          kode: bahanBaku.kode || "",
          nama: bahanBaku.nama || "",
        }
      : undefined,
    jumlah_diperiksa: totals.jumlah_diperiksa,
    jumlah_diterima: totals.jumlah_diterima,
    jumlah_ditolak: totals.jumlah_ditolak,
    hasil: (row.hasil || "partial") as QCInspection["hasil"],
    parameter_inspeksi: (row.parameter_inspeksi as Record<string, string> | null) || null,
    catatan: row.catatan ?? null,
    inspector_id: row.inspector?.id || (row as { inspector_id?: string }).inspector_id || "",
    tanggal_inspeksi: row.tanggal_inspeksi || row.created_at || new Date().toISOString(),
    created_at: row.created_at || new Date().toISOString(),
    status: row.status || "PARTIAL",
    rekomendasi: (row.rekomendasi as QCInspection["rekomendasi"]) || "REWORK",
  };
}
