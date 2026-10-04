/** Penerimaan barang operasional (scope general) langsung dari PO, tanpa pengiriman/QC. */

type QtyLike = number | string | null | undefined;

export type GeneralReceivePoItem = {
  id: string;
  supply_item_id?: string | null;
  satuan_id?: string | null;
  qty_ordered?: QtyLike;
  qty_received?: QtyLike;
  supply_item?: { kode?: string | null; nama?: string | null; stockable?: boolean | null } | null;
};

export type GeneralReceiveLine = {
  poItemId: string;
  supplyItemId: string;
  satuanId?: string;
  kode: string;
  nama: string;
  stockable: boolean;
  ordered: number;
  received: number;
  remaining: number;
  /** Input pengguna (string supaya kolom bisa dikosongkan). */
  qtyDiterima: string;
};

const num = (value: QtyLike) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

/** Baris form untuk item yang punya supply item; default qty = sisa PO. */
export function buildGeneralReceiveLines(items: GeneralReceivePoItem[] = []): GeneralReceiveLine[] {
  return items.flatMap((item) => {
    if (!item.supply_item_id) return [];
    const ordered = num(item.qty_ordered);
    const received = num(item.qty_received);
    const remaining = Math.max(0, ordered - received);
    return [
      {
        poItemId: item.id,
        supplyItemId: item.supply_item_id,
        satuanId: item.satuan_id ?? undefined,
        kode: item.supply_item?.kode ?? "-",
        nama: item.supply_item?.nama ?? "Item",
        stockable: Boolean(item.supply_item?.stockable),
        ordered,
        received,
        remaining,
        qtyDiterima: String(remaining),
      },
    ];
  });
}

export function totalGeneralReceived(lines: GeneralReceiveLine[]): number {
  return lines.reduce((sum, line) => sum + num(line.qtyDiterima), 0);
}

export type GeneralGrnItemPayload = {
  purchase_order_item_id: string;
  supply_item_id: string;
  satuan_id?: string;
  qty_diterima: number;
  qty_ditolak: number;
};

/** Item payload GRN dari baris berisi qty, atau pesan galat pertama. */
export function buildGeneralGrnItems(
  lines: GeneralReceiveLine[]
): { items: GeneralGrnItemPayload[] } | { error: string } {
  const items: GeneralGrnItemPayload[] = [];
  for (const line of lines) {
    const qty = num(line.qtyDiterima);
    if (qty <= 0) continue;
    if (qty > line.remaining + 0.0001) {
      return { error: `Qty ${line.nama} melebihi sisa PO (maks ${line.remaining})` };
    }
    items.push({
      purchase_order_item_id: line.poItemId,
      supply_item_id: line.supplyItemId,
      satuan_id: line.satuanId,
      qty_diterima: qty,
      qty_ditolak: 0,
    });
  }
  return items.length > 0 ? { items } : { error: "Isi minimal satu qty diterima" };
}
