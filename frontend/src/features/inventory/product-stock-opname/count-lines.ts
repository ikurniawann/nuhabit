import type {
  ProductStockOpnameLine,
  ProductStockOpnamePreviewLine,
} from "./types";

/** Baris hitung opname produk + aturan murninya (diuji unit). */

export type ProductCountLine = {
  key: string;
  lineId?: string;
  product_id: string;
  product_kode: string;
  product_nama: string;
  satuan: string | null;
  qty_system: number;
  qty_counted_input: string;
  // EPIC-047 Fase 3 — terisi saat baris mewakili satu SKU (produk merchandise
  // ber-varian); null = baris level produk lama.
  pos_sku_id: string | null;
  pos_sku_code: string | null;
  pos_sku_name: string | null;
};

/** Kunci baris unik per produk + SKU. */
export function productLineKey(productId: string, posSkuId?: string | null) {
  return `${productId}::${posSkuId ?? ""}`;
}

export function productLinesFromDetail(
  lines: ProductStockOpnameLine[],
): ProductCountLine[] {
  return lines.map((line) => ({
    key: line.id,
    lineId: line.id,
    product_id: line.product_id,
    product_kode: line.product_kode || "",
    product_nama: line.product_nama || "",
    satuan: line.satuan ?? null,
    qty_system: line.qty_system,
    qty_counted_input: line.qty_counted == null ? "" : String(line.qty_counted),
    pos_sku_id: line.pos_sku_id ?? null,
    pos_sku_code: line.pos_sku_code ?? null,
    pos_sku_name: line.pos_sku_name ?? null,
  }));
}

export function productLinesFromPreview(
  items: ProductStockOpnamePreviewLine[],
): ProductCountLine[] {
  return items.map((item) => ({
    key: productLineKey(item.product_id, item.pos_sku_id),
    product_id: item.product_id,
    product_kode: item.product_kode,
    product_nama: item.product_nama,
    satuan: item.satuan,
    qty_system: item.qty_system,
    qty_counted_input: "",
    pos_sku_id: item.pos_sku_id ?? null,
    pos_sku_code: item.pos_sku_code ?? null,
    pos_sku_name: item.pos_sku_name ?? null,
  }));
}

export function resolveQty(line: ProductCountLine): number | null {
  if (line.qty_counted_input === "") return null;
  const n = Number(line.qty_counted_input);
  return Number.isFinite(n) ? n : null;
}

export function productCountProgress(lines: ProductCountLine[]) {
  const counted = lines.filter((line) => line.qty_counted_input !== "");
  const variance = counted.filter((line) => {
    const n = resolveQty(line);
    return n !== null && n !== line.qty_system;
  }).length;
  return { counted: counted.length, variance, total: lines.length };
}

/** Pesan galat input qty, atau null bila valid. `requireAll` untuk menyelesaikan opname. */
export function productQtyInputError(
  lines: ProductCountLine[],
  requireAll: boolean,
): string | null {
  if (requireAll) {
    const uncounted = lines.filter(
      (line) => line.qty_counted_input === "",
    ).length;
    if (uncounted > 0) return `${uncounted} baris belum dihitung`;
  }
  const invalid = lines.some((line) => {
    if (line.qty_counted_input === "") return false;
    const n = Number(line.qty_counted_input);
    return !Number.isFinite(n) || n < 0;
  });
  return invalid ? "Qty fisik harus angka ≥ 0" : null;
}

type CreatedLine = {
  id: string;
  product_id: string;
  pos_sku_id?: string | null;
};

/** Baris terhitung → update server, memetakan produk+SKU ke id baris sesi baru. */
export function productCountedUpdates(
  lines: ProductCountLine[],
  records: CreatedLine[],
) {
  const byKey = new Map(
    records.map((r) => [productLineKey(r.product_id, r.pos_sku_id), r.id]),
  );
  return lines
    .filter((line) => line.qty_counted_input !== "")
    .map((line) => ({
      id:
        line.lineId ||
        byKey.get(productLineKey(line.product_id, line.pos_sku_id)) ||
        "",
      qty_counted: resolveQty(line) ?? 0,
    }))
    .filter((line) => line.id);
}
