/**
 * EPIC-047 Fase 1B — jahitan "produksi selesai → stok per SKU". Murni (tanpa
 * I/O); dipakai oleh PATCH .../orders/[id] (action "complete") dan form
 * complete di UI production order.
 *
 * BOM & HPP tidak disentuh di sini — modul ini murni memecah `actual_qty`
 * satu batch produksi ke SKU POS-nya (Fase 1A: pos.pos_product_skus).
 */

export type VariantSplitRow = { pos_sku_id: string; qty: number };

export type ActiveSku = {
  id: string;
  sku: string;
  name: string;
  options?: Record<string, string> | null;
};

export type ValidateVariantSplitResult =
  | { ok: true; rows: VariantSplitRow[] }
  | { ok: false; error: string };

// numeric(14,2) di production_output_variants.qty — toleransi 2 desimal
// supaya pembulatan floating point tidak menolak split yang sebenarnya pas.
const QTY_TOLERANCE = 0.01;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatQtyForMessage(value: number): string {
  const rounded = round2(value);
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

/**
 * `true` kalau produk ini WAJIB melampirkan rincian per varian saat
 * complete — pola sama dengan `variant_required` Fase B: produk tertaut POS
 * merchandise DAN punya SKU aktif. Produk tanpa SKU aktif (belum bikin
 * matriks varian, atau bukan merchandise) tetap jalur lama (posting level
 * produk saja).
 */
export function requiresVariantSplit(activeSkus: ActiveSku[] | null | undefined): boolean {
  return Array.isArray(activeSkus) && activeSkus.length > 0;
}

/**
 * Validasi rincian split varian terhadap `actual_qty` batch & daftar SKU
 * aktif produk ini. Aturan (semua harus lolos, urutan pengecekan menentukan
 * pesan error yang dikembalikan):
 * 1. rows wajib ada & tidak kosong.
 * 2. setiap `pos_sku_id` harus ada di `activeSkus` (SKU aktif produk ini).
 * 3. tidak boleh ada `pos_sku_id` duplikat.
 * 4. setiap `qty` harus angka valid (finite) dan > 0.
 * 5. jumlah seluruh `qty` harus SAMA (toleransi 2 desimal) dengan `actualQty`.
 */
export function validateVariantSplit(
  actualQty: number,
  rows: VariantSplitRow[] | null | undefined,
  activeSkus: ActiveSku[]
): ValidateVariantSplitResult {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { ok: false, error: "Rincian varian wajib diisi" };
  }

  const activeIds = new Set(activeSkus.map((sku) => sku.id));
  const seen = new Set<string>();
  const normalized: VariantSplitRow[] = [];

  for (const row of rows) {
    const posSkuId = typeof row?.pos_sku_id === "string" ? row.pos_sku_id : "";
    if (!posSkuId || !activeIds.has(posSkuId)) {
      return { ok: false, error: "Varian tidak dikenal / tidak aktif" };
    }
    if (seen.has(posSkuId)) {
      return { ok: false, error: "Varian ganda" };
    }
    seen.add(posSkuId);

    const qty = Number(row?.qty);
    if (!Number.isFinite(qty) || qty <= 0) {
      return { ok: false, error: "Qty varian harus > 0" };
    }
    normalized.push({ pos_sku_id: posSkuId, qty: round2(qty) });
  }

  const sum = round2(normalized.reduce((acc, row) => acc + row.qty, 0));
  const target = round2(Number(actualQty) || 0);
  if (Math.abs(sum - target) > QTY_TOLERANCE) {
    return {
      ok: false,
      error: `Rincian varian harus berjumlah sama dengan jumlah aktual (${formatQtyForMessage(
        sum
      )} vs ${formatQtyForMessage(target)})`,
    };
  }

  return { ok: true, rows: normalized };
}

/**
 * Bagi rata `actualQty` ke daftar `skuIds`, jumlah baris hasil PASTI sama
 * persis dengan `actualQty` (sisa pembulatan 2 desimal dibagikan ke baris
 * pertama, satu sen per baris, berputar kalau sisanya lebih dari jumlah
 * baris). Dipakai tombol "Bagi rata" di form complete.
 */
export function splitEvenly(actualQty: number, skuIds: string[]): VariantSplitRow[] {
  const n = skuIds.length;
  if (n === 0) return [];

  const target = round2(Number(actualQty) || 0);
  const baseCents = Math.floor((target * 100) / n);
  const base = baseCents / 100;
  const rows: VariantSplitRow[] = skuIds.map((posSkuId) => ({ pos_sku_id: posSkuId, qty: base }));

  const distributedCents = baseCents * n;
  const remainderCents = Math.round(target * 100) - distributedCents;
  for (let i = 0; i < remainderCents; i++) {
    const row = rows[i % n];
    row.qty = round2(row.qty + 0.01);
  }

  return rows;
}
