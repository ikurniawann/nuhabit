/**
 * Aturan murni penerimaan barang (GRN): pencocokan baris PO, batas sisa qty,
 * status awal dan pesan sukses. Dipakai POST/PATCH /api/purchasing/grn.
 */
import { ApiError } from "@/lib/api/auth";
import { formatNumber } from "@/lib/format";
import type { GrnStatus } from "@/lib/purchasing/grn";
import type { PurchasingModuleType } from "@/lib/purchasing/module-scope";
import { toQty } from "@/lib/purchasing/utils";
import { resolveGrnItemSku } from "@/lib/purchasing/variant-po-lines";

export const GRN_QTY_EPSILON = 0.000001;

/** Baris purchase_order_items yang dibaca saat validasi penerimaan. */
export type PoItemForReceive = {
  id: string;
  raw_material_id?: string | null;
  product_id?: string | null;
  supply_item_id?: string | null;
  pos_sku_id?: string | null;
  qty_ordered?: number | string | null;
  qty_received?: number | string | null;
  harga_satuan?: number | string | null;
  raw_material?: { nama?: string | null; nama_bahan?: string | null } | null;
  product?: { nama?: string | null } | null;
};

type LineRef = {
  purchase_order_item_id?: string | null;
  raw_material_id?: string | null;
  product_id?: string | null;
  supply_item_id?: string | null;
};

type ReceiveLine = LineRef & {
  pos_sku_id?: string | null;
  qty_diterima: number;
  qty_ditolak: number;
};

/** Kunci baris GRN: item PO bila ada, kalau tidak id barangnya. */
export function grnLineKey(line: LineRef): string {
  return (
    line.purchase_order_item_id ||
    line.raw_material_id ||
    line.product_id ||
    line.supply_item_id ||
    ""
  );
}

/** Lengkapi qty QC: accepted default = diterima, rejected default = sisa. */
export function normalizeQcOnItem<
  T extends { qty_diterima: number; qty_accepted?: number; qty_rejected?: number },
>(item: T): T & { qty_accepted: number; qty_rejected: number } {
  const received = toQty(item.qty_diterima);
  const accepted = item.qty_accepted != null ? toQty(item.qty_accepted) : received;
  const rejected =
    item.qty_rejected != null ? toQty(item.qty_rejected) : Math.max(0, received - accepted);
  return { ...item, qty_accepted: accepted, qty_rejected: rejected };
}

export function remainingPoQty(poItem: PoItemForReceive): number {
  return Math.max(0, toQty(poItem.qty_ordered) - toQty(poItem.qty_received));
}

function poItemLabel(poItem: PoItemForReceive): string {
  return (
    poItem.raw_material?.nama ||
    poItem.raw_material?.nama_bahan ||
    poItem.product?.nama ||
    "item ini"
  );
}

function exceedsRemainingError(
  poItem: PoItemForReceive,
  remaining: number,
  processed: number,
  scope = ""
): ApiError {
  return ApiError.badRequest(
    `Qty ${poItemLabel(poItem)} melebihi sisa PO. Maksimal ${formatNumber(remaining, 4)}${scope}, tetapi diinput ${formatNumber(processed, 4)} (diterima + ditolak).`
  );
}

/** Cari baris PO yang dirujuk satu baris GRN; produk ber-varian wajib lewat purchase_order_item_id. */
export function findPoItemForLine(
  line: LineRef,
  poItems: PoItemForReceive[]
): PoItemForReceive {
  let poItem: PoItemForReceive | undefined;
  if (line.purchase_order_item_id) {
    poItem = poItems.find((p) => p.id === line.purchase_order_item_id);
  } else if (line.product_id) {
    const matches = poItems.filter((p) => p.product_id === line.product_id);
    if (matches.length > 1) {
      throw ApiError.badRequest("Item PO ber-varian harus dirujuk lewat purchase_order_item_id");
    }
    poItem = matches[0];
  } else if (line.supply_item_id) {
    poItem = poItems.find((p) => p.supply_item_id === line.supply_item_id);
  } else {
    poItem = poItems.find((p) => p.raw_material_id === line.raw_material_id);
  }

  if (!poItem) {
    throw ApiError.badRequest("Item PO tidak ditemukan untuk validasi penerimaan");
  }
  return poItem;
}

/**
 * Validasi baris penerimaan baru terhadap sisa PO (diterima + ditolak per
 * baris PO) dan kembalikan pos_sku_id per baris (indeks sejajar `lines`).
 */
export function validateReceiveLines(
  lines: ReceiveLine[],
  poItems: PoItemForReceive[]
): (string | null)[] {
  const processedByKey = new Map<string, number>();
  for (const line of lines) {
    const key = grnLineKey(line);
    processedByKey.set(key, (processedByKey.get(key) || 0) + line.qty_diterima + line.qty_ditolak);
  }

  return lines.map((line) => {
    const poItem = findPoItemForLine(line, poItems);
    const remaining = remainingPoQty(poItem);
    const processed = processedByKey.get(grnLineKey(line)) || 0;
    if (processed > remaining + GRN_QTY_EPSILON) {
      throw exceedsRemainingError(poItem, remaining, processed);
    }

    if (!line.product_id) return null;
    const sku = resolveGrnItemSku(
      { pos_sku_id: line.pos_sku_id ?? null },
      { pos_sku_id: poItem.pos_sku_id ?? null }
    );
    if (!sku.ok) throw ApiError.badRequest(sku.error);
    return sku.pos_sku_id;
  });
}

/**
 * GRN Continue: hanya tambahan (kumulatif baru − tersimpan) yang dibandingkan
 * dengan sisa PO.
 */
export function validateAdditionalReceive(
  lines: (ReceiveLine & { raw_material_id: string })[],
  poItems: PoItemForReceive[],
  existingByKey: Map<string, { qty_diterima?: unknown; qty_ditolak?: unknown }>
): void {
  for (const line of lines) {
    const poItem = line.purchase_order_item_id
      ? poItems.find((p) => p.id === line.purchase_order_item_id)
      : poItems.find((p) => p.raw_material_id === line.raw_material_id);
    if (!poItem) {
      throw ApiError.badRequest("Item PO tidak ditemukan untuk validasi penerimaan");
    }

    const existing = existingByKey.get(grnLineKey(line));
    const deltaProcessed =
      Math.max(0, toQty(line.qty_diterima) - toQty(existing?.qty_diterima)) +
      Math.max(0, toQty(line.qty_ditolak) - toQty(existing?.qty_ditolak));
    const remaining = remainingPoQty(poItem);

    if (deltaProcessed > remaining + GRN_QTY_EPSILON) {
      throw exceedsRemainingError(poItem, remaining, deltaProcessed, " untuk penerimaan tambahan");
    }
  }
}

/** Status dari baris: semua ditolak → rejected; ada yang diterima → pending (menunggu QC). */
export function statusFromLines(
  lines: { qty_diterima: number; qty_ditolak: number }[]
): GrnStatus | undefined {
  const totalDiterima = lines.reduce((sum, line) => sum + line.qty_diterima, 0);
  const totalDitolak = lines.reduce((sum, line) => sum + line.qty_ditolak, 0);
  if (lines.every((line) => line.qty_diterima === 0) && totalDitolak > 0) return "rejected";
  if (totalDiterima > 0) return "pending";
  return undefined;
}

/** General langsung received (tanpa QC); RM/product pending; semua ditolak di pintu → rejected. */
export function resolveInitialGrnStatus(
  moduleType: PurchasingModuleType,
  totals: { total_diterima: number; total_ditolak: number }
): GrnStatus {
  if (totals.total_diterima === 0 && totals.total_ditolak > 0) return "rejected";
  return moduleType === "general" ? "received" : "pending";
}

export function grnCreatedMessage(params: {
  grnNumber: string;
  status: GrnStatus;
  moduleType: PurchasingModuleType;
  accountingNote: string | null;
}): string {
  const { grnNumber, status, moduleType, accountingNote } = params;
  const base =
    status === "rejected"
      ? `GRN ${grnNumber} berhasil dibuat — semua item ditolak`
      : moduleType === "general"
        ? `GRN ${grnNumber} berhasil dibuat`
        : `GRN ${grnNumber} berhasil dibuat — QC selesai dan stok sudah diperbarui`;
  return accountingNote ? `${base} (${accountingNote})` : base;
}
