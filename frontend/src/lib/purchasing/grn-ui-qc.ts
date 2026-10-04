/** Form inspeksi QC per GRN (sisi klien): baris qty, parameter, validasi, payload. */
import { resolveOverallQcStatus, type QcOverallStatus } from "@/lib/purchasing/grn-qc-utils";
import { toNumber, type PosSkuRef } from "@/lib/purchasing/grn-ui-lines";

export const QC_PARAMETERS = ["Packaging", "Label", "Color", "Odor", "Texture", "Moisture", "Expiry Date"] as const;

export const QC_PARAMETER_LABELS: Record<(typeof QC_PARAMETERS)[number], string> = {
  Packaging: "Kemasan",
  Label: "Label",
  Color: "Warna",
  Odor: "Bau",
  Texture: "Tekstur",
  Moisture: "Kelembapan",
  "Expiry Date": "Tanggal Kedaluwarsa",
};

export type QcParameterResult = "OK" | "NG" | "NA";

export function initialQcResults(): Record<string, QcParameterResult> {
  return Object.fromEntries(QC_PARAMETERS.map((param) => [param, "OK" as const]));
}

type UnitRef = { nama?: string | null; kode?: string | null } | null;

/** Item GRN yang diinspeksi (subset dari GET /api/purchasing/grn/[id]). */
export type QcGrnItem = {
  id: string;
  raw_material_id?: string | null;
  product_id?: string | null;
  qty_diterima?: number | string | null;
  raw_material?: { nama?: string | null; kode?: string | null; satuan_besar?: UnitRef } | null;
  product?: { nama?: string | null; kode?: string | null } | null;
  satuan?: UnitRef;
  purchase_order_item?: { satuan?: UnitRef; pos_sku?: PosSkuRef | null } | null;
  pos_sku?: PosSkuRef | null;
};

export type QcLine = {
  grn_item_id: string;
  raw_material_id: string;
  product_id: string;
  materialName: string;
  materialCode: string;
  unitLabel: string;
  /** EPIC-047 Fase 2: "SKU — nama varian", kosong untuk produk tanpa varian. */
  variantLabel: string;
  qtyReceived: number;
  qty_inspected: string;
  qty_accepted: string;
  qty_rejected: string;
  catatan: string;
};

/** Baris QC untuk item yang diterima; default semua qty lolos. */
export function qcLinesFromGrnItems(items: QcGrnItem[] = []): QcLine[] {
  return items
    .filter((item) => toNumber(item.qty_diterima) > 0)
    .map((item) => {
      const qty = toNumber(item.qty_diterima);
      const sku = item.pos_sku || item.purchase_order_item?.pos_sku;
      return {
        grn_item_id: item.id,
        raw_material_id: item.raw_material_id || "",
        product_id: item.product_id || "",
        materialName: item.raw_material?.nama || item.product?.nama || "Item tidak dikenal",
        materialCode: item.raw_material?.kode || item.product?.kode || "-",
        unitLabel:
          item.satuan?.kode ||
          item.satuan?.nama ||
          item.raw_material?.satuan_besar?.kode ||
          item.purchase_order_item?.satuan?.kode ||
          "-",
        variantLabel: sku?.sku ? `${sku.sku} — ${sku.name || ""}` : "",
        qtyReceived: qty,
        qty_inspected: String(qty),
        qty_accepted: String(qty),
        qty_rejected: "0",
        catatan: "",
      };
    });
}

export type QcLineChange = { inspected?: string; accepted?: string; rejected?: string };

/**
 * Ubah satu kolom qty dan selaraskan yang lain: semua dibatasi 0..qty diterima,
 * lolos + gagal = diinspeksi.
 */
export function updateQcLine(line: QcLine, change: QcLineChange): QcLine {
  const max = line.qtyReceived;
  const clamp = (value: number) => Math.min(max, Math.max(0, value));
  const inspected = clamp(toNumber(change.inspected ?? line.qty_inspected));

  let accepted: number;
  let rejected: number;
  if (change.accepted !== undefined) {
    accepted = clamp(toNumber(change.accepted));
    rejected = Math.max(0, inspected - accepted);
  } else if (change.rejected !== undefined) {
    rejected = clamp(toNumber(change.rejected));
    accepted = Math.max(0, inspected - rejected);
  } else {
    accepted = Math.min(toNumber(line.qty_accepted), inspected);
    rejected = Math.max(0, inspected - accepted);
  }

  return {
    ...line,
    qty_inspected: String(inspected),
    qty_accepted: String(accepted),
    qty_rejected: String(rejected),
  };
}

export function qcTotals(lines: QcLine[]) {
  return lines.reduce(
    (acc, line) => ({
      inspected: acc.inspected + toNumber(line.qty_inspected),
      accepted: acc.accepted + toNumber(line.qty_accepted),
      rejected: acc.rejected + toNumber(line.qty_rejected),
    }),
    { inspected: 0, accepted: 0, rejected: 0 }
  );
}

export function qcOverallStatus(lines: QcLine[]): QcOverallStatus {
  return resolveOverallQcStatus(
    lines.map((line) => ({ qty_accepted: toNumber(line.qty_accepted), qty_rejected: toNumber(line.qty_rejected) }))
  );
}

export function qcParameterSummary(results: Record<string, string>) {
  const values = Object.values(results);
  const count = (value: string) => values.filter((v) => v === value).length;
  return { ok: count("OK"), ng: count("NG"), na: count("NA") };
}

const EPSILON = 0.0001;

/** Pesan galat pertama, atau null bila semua baris valid. */
export function validateQcLines(lines: QcLine[]): string | null {
  if (lines.length === 0) return "Tidak ada item diterima untuk QC";
  for (const line of lines) {
    const inspected = toNumber(line.qty_inspected);
    const accepted = toNumber(line.qty_accepted);
    const rejected = toNumber(line.qty_rejected);
    if (inspected <= 0) return `Qty inspeksi wajib diisi untuk ${line.materialName}`;
    if (inspected > line.qtyReceived + EPSILON) {
      return `Qty inspeksi tidak boleh melebihi qty diterima untuk ${line.materialName}`;
    }
    if (Math.abs(accepted + rejected - inspected) > EPSILON) {
      return `Qty lolos dan gagal harus sama dengan qty inspeksi untuk ${line.materialName}`;
    }
  }
  return null;
}

const RECOMMENDATION: Record<QcOverallStatus, "ACCEPT" | "REWORK" | "REJECT"> = {
  approved: "ACCEPT",
  partial: "REWORK",
  rejected: "REJECT",
};

export function buildQcPayload(lines: QcLine[], results: Record<string, string>, catatan: string) {
  const status = qcOverallStatus(lines);
  return {
    status,
    parameter_inspeksi: { parameters: [...QC_PARAMETERS] },
    hasil_inspeksi: results,
    catatan: catatan || null,
    rekomendasi: RECOMMENDATION[status],
    items: lines.map((line) => ({
      grn_item_id: line.grn_item_id,
      ...(line.raw_material_id ? { raw_material_id: line.raw_material_id } : { product_id: line.product_id }),
      qty_inspected: toNumber(line.qty_inspected),
      qty_accepted: toNumber(line.qty_accepted),
      qty_rejected: toNumber(line.qty_rejected),
      catatan: line.catatan || null,
    })),
  };
}
