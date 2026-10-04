/** Logika murni form PO produk: baris item dari PR/master produk, SKU varian, dan payload. */
import type {
  ApprovedProductPRForPO,
  ProductPOFormInput,
  ProductPOFormProduct,
} from "./types";

export type ProductPOItemRow = ProductPOFormInput["items"][number] & {
  product_name?: string;
  unit_name?: string;
};

type UnitRef = { id: string; nama: string };

export const emptyProductItem = (): ProductPOItemRow => ({
  product_id: "",
  qty_ordered: 1,
  harga_satuan: 0,
  notes: "",
});

/** EPIC-047 Fase 2: produk ber-varian punya >=1 SKU merchandise aktif. */
export function isVariantProduct(product?: ProductPOFormProduct): boolean {
  return Boolean(product?.pos_skus && product.pos_skus.length > 0);
}

/** Baris item dari PR disetujui; harga estimasi PR, fallback harga modal master. */
export function productItemsFromPR(pr: ApprovedProductPRForPO, products: ProductPOFormProduct[]): ProductPOItemRow[] {
  return (pr.items ?? []).map((item) => {
    const product = products.find((p) => p.id === item.product_id);
    return {
      product_id: item.product_id || "",
      pr_item_id: item.id,
      satuan_id: item.satuan_id || product?.satuan_id || undefined,
      qty_ordered: Number(item.qty || 1),
      harga_satuan: Number(item.estimated_price || product?.harga_modal || 0),
      notes: item.description || product?.nama || "",
      product_name: product?.nama || item.description,
      unit_name: product?.satuan_nama || item.unit,
    };
  });
}

/** Ganti produk pada baris: harga acuan dari master; SKU lama tidak relevan lagi. */
export function withProduct(row: ProductPOItemRow, product: ProductPOFormProduct, units: UnitRef[]): ProductPOItemRow {
  return {
    ...row,
    product_id: product.id,
    pos_sku_id: null,
    satuan_id: product.satuan_id || undefined,
    product_name: product.nama,
    unit_name: product.satuan_nama || units.find((u) => u.id === product.satuan_id)?.nama,
    harga_satuan: Number(product.harga_modal || 0),
    notes: product.nama,
  };
}

export function validateProductPO(
  vendorId: string,
  items: ProductPOItemRow[],
  products: ProductPOFormProduct[]
): string | null {
  if (!vendorId) return "Vendor wajib dipilih.";
  if (items.some((item) => !item.product_id)) return "Semua item harus memilih produk.";
  const missingSku = items.some(
    (item) => isVariantProduct(products.find((p) => p.id === item.product_id)) && !item.pos_sku_id
  );
  if (missingSku) return "Produk ber-varian wajib memilih SKU (ukuran/warna) pada setiap baris.";
  return null;
}

export function toProductPayloadItems(items: ProductPOItemRow[]): ProductPOFormInput["items"] {
  return items.map((item) => ({
    product_id: item.product_id,
    pr_item_id: item.pr_item_id,
    satuan_id: item.satuan_id,
    qty_ordered: Number(item.qty_ordered),
    harga_satuan: Number(item.harga_satuan),
    notes: item.notes,
    pos_sku_id: item.pos_sku_id || undefined,
  }));
}
