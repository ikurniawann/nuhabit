import { describe, expect, it } from "vitest";
import {
  emptyProductItem,
  isVariantProduct,
  productItemsFromPR,
  toProductPayloadItems,
  validateProductPO,
  withProduct,
} from "./form-items";
import type { ProductPOFormProduct } from "./types";

const plain = { id: "p1", kode: "P-1", nama: "Kaos", satuan_id: "u1", satuan_nama: "Pcs", harga_modal: 50000 } as ProductPOFormProduct;
const variant = {
  ...plain,
  id: "p2",
  nama: "Hoodie",
  pos_skus: [{ id: "sku1", sku: "HD-M", name: "M" }],
} as ProductPOFormProduct;

describe("product PO form items", () => {
  it("detects variant products", () => {
    expect(isVariantProduct(plain)).toBe(false);
    expect(isVariantProduct(variant)).toBe(true);
    expect(isVariantProduct(undefined)).toBe(false);
  });

  it("maps PR items with master price fallback", () => {
    const [row] = productItemsFromPR(
      { id: "pr1", pr_number: "PR-1", items: [{ id: "i1", product_id: "p1", description: "", qty: 3, unit: "pcs", estimated_price: 0 }] },
      [plain]
    );
    expect(row).toMatchObject({ product_id: "p1", pr_item_id: "i1", qty_ordered: 3, harga_satuan: 50000, unit_name: "Pcs" });
  });

  it("resets the SKU when the product changes", () => {
    const row = withProduct({ ...emptyProductItem(), pos_sku_id: "old" }, plain, []);
    expect(row).toMatchObject({ product_id: "p1", pos_sku_id: null, harga_satuan: 50000, notes: "Kaos" });
  });

  it("requires a SKU for variant products", () => {
    const products = [plain, variant];
    expect(validateProductPO("", [emptyProductItem()], products)).toBe("Vendor wajib dipilih.");
    expect(validateProductPO("v1", [emptyProductItem()], products)).toBe("Semua item harus memilih produk.");
    const variantRow = withProduct(emptyProductItem(), variant, []);
    expect(validateProductPO("v1", [variantRow], products)).toMatch(/SKU/);
    expect(validateProductPO("v1", [{ ...variantRow, pos_sku_id: "sku1" }], products)).toBeNull();
  });

  it("sends pos_sku_id only when chosen", () => {
    const [item] = toProductPayloadItems([withProduct(emptyProductItem(), plain, [])]);
    expect(item.pos_sku_id).toBeUndefined();
    expect(item).toMatchObject({ product_id: "p1", qty_ordered: 1, harga_satuan: 50000 });
  });
});
