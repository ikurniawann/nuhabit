/**
 * EPIC-047 Fase 2 — jahitan "GRN per varian (beli barang jadi dari vendor)".
 * Murni (tanpa I/O); dipakai oleh:
 *  - POST /api/purchasing/po (module_type "product") — validasi baris PO
 *    ber-varian sebelum insert (`validatePoLinesAgainstSkus`).
 *  - POST/PATCH /api/purchasing/grn — mewarisi `pos_sku_id` dari item PO
 *    saat GRN dibuat (`resolveGrnItemSku`).
 *  - src/lib/purchasing/grn-qc.ts — gerbang "GRN produk ber-varian wajib
 *    menyebut SKU" sebelum posting stok (`requiresSkuOnGrn`).
 */

export type PoLineInput = {
  product_id: string;
  pos_sku_id?: string | null;
};

/** Baris SKU aktif/nonaktif produk merchandise, sudah dijoin ke item.products
 * pemiliknya (`pos_products.source_product_id`) oleh caller. */
export type SkuOwnershipRow = {
  id: string;
  source_product_id: string;
  is_active: boolean;
};

export type ValidatePoLinesResult = { ok: true } | { ok: false; error: string };

/**
 * Validasi baris PO produk terhadap SKU merchandise:
 * 1. Baris dengan `pos_sku_id` — SKU itu harus ada, aktif, dan milik produk
 *    (`item.products`) baris ini (bukan produk lain) → sebaliknya
 *    'Varian tidak sesuai produk'.
 * 2. Baris tanpa `pos_sku_id` untuk produk yang PUNYA SKU aktif (produk
 *    ber-varian) → 'Produk ber-varian wajib memilih SKU'.
 * 3. Dua baris produk+SKU yang identik dalam satu PO → 'Baris SKU ganda'.
 *    Baris SKU berbeda untuk produk yang sama tetap diperbolehkan (satu
 *    baris PO per SKU).
 */
export function validatePoLinesAgainstSkus(
  items: PoLineInput[],
  skuRows: SkuOwnershipRow[],
  variantProductIds: Set<string> | string[]
): ValidatePoLinesResult {
  const skuById = new Map(skuRows.map((row) => [row.id, row]));
  const variantIds = variantProductIds instanceof Set ? variantProductIds : new Set(variantProductIds);
  const seenLines = new Set<string>();

  for (const item of items) {
    if (item.pos_sku_id) {
      const sku = skuById.get(item.pos_sku_id);
      if (!sku || !sku.is_active || sku.source_product_id !== item.product_id) {
        return { ok: false, error: "Varian tidak sesuai produk" };
      }

      const lineKey = `${item.product_id}::${item.pos_sku_id}`;
      if (seenLines.has(lineKey)) {
        return { ok: false, error: "Baris SKU ganda" };
      }
      seenLines.add(lineKey);
      continue;
    }

    if (variantIds.has(item.product_id)) {
      return { ok: false, error: "Produk ber-varian wajib memilih SKU" };
    }
  }

  return { ok: true };
}

export type GrnSkuItemInput = {
  pos_sku_id?: string | null;
};

export type PoItemSkuRow = {
  pos_sku_id?: string | null;
} | null;

export type ResolveGrnItemSkuResult =
  | { ok: true; pos_sku_id: string | null }
  | { ok: false; error: string };

/**
 * GRN mewarisi `pos_sku_id` dari item PO yang dirujuk
 * (`purchase_order_item_id`). Kalau klien juga mengirim `pos_sku_id`, nilai
 * itu HARUS sama dengan milik item PO — kirim yang beda dianggap salah rujuk
 * (IDOR-style), bukan ditimpa diam-diam.
 */
export function resolveGrnItemSku(
  item: GrnSkuItemInput,
  poItem: PoItemSkuRow
): ResolveGrnItemSkuResult {
  const inherited = poItem?.pos_sku_id ?? null;

  if (item.pos_sku_id != null && item.pos_sku_id !== inherited) {
    return { ok: false, error: "SKU tidak sesuai item PO" };
  }

  return { ok: true, pos_sku_id: inherited };
}

/**
 * Gerbang posting stok GRN (dipakai di grn-qc.ts, SEBELUM tulisan apa pun):
 * produk ber-varian (POS merchandise dengan >=1 SKU aktif) yang GRN item-nya
 * tidak menyebut `pos_sku_id` harus ditolak — bukan diam-diam menambah stok
 * level produk seperti perilaku lama.
 */
export function requiresSkuOnGrn(
  isVariantProduct: boolean,
  posSkuId: string | null | undefined
): boolean {
  return isVariantProduct && !posSkuId;
}
