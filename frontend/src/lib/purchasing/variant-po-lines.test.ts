import { describe, expect, it } from "vitest";
import {
  requiresSkuOnGrn,
  resolveGrnItemSku,
  validatePoLinesAgainstSkus,
  type SkuOwnershipRow,
} from "@/lib/purchasing/variant-po-lines";

const KAOS_001 = "kaos-001";
const KAOS_002 = "kaos-002";
const KAOS_003 = "kaos-003"; // non-variant product

const skuRows: SkuOwnershipRow[] = [
  { id: "sku-a", source_product_id: KAOS_001, is_active: true },
  { id: "sku-b", source_product_id: KAOS_001, is_active: true },
  { id: "sku-inactive", source_product_id: KAOS_001, is_active: false },
  { id: "sku-other-product", source_product_id: KAOS_002, is_active: true },
];

const variantProductIds = new Set([KAOS_001, KAOS_002]);

describe("validatePoLinesAgainstSkus", () => {
  it("accepts variant lines with valid SKUs + a non-variant line without SKU", () => {
    const result = validatePoLinesAgainstSkus(
      [
        { product_id: KAOS_001, pos_sku_id: "sku-a" },
        { product_id: KAOS_001, pos_sku_id: "sku-b" },
        { product_id: KAOS_003, pos_sku_id: null },
      ],
      skuRows,
      variantProductIds
    );
    expect(result).toEqual({ ok: true });
  });

  it("rejects a variant product line without pos_sku_id", () => {
    const result = validatePoLinesAgainstSkus(
      [{ product_id: KAOS_001, pos_sku_id: null }],
      skuRows,
      variantProductIds
    );
    expect(result).toEqual({ ok: false, error: "Produk ber-varian wajib memilih SKU" });
  });

  it("rejects a SKU that belongs to a different product", () => {
    const result = validatePoLinesAgainstSkus(
      [{ product_id: KAOS_001, pos_sku_id: "sku-other-product" }],
      skuRows,
      variantProductIds
    );
    expect(result).toEqual({ ok: false, error: "Varian tidak sesuai produk" });
  });

  it("rejects an inactive SKU", () => {
    const result = validatePoLinesAgainstSkus(
      [{ product_id: KAOS_001, pos_sku_id: "sku-inactive" }],
      skuRows,
      variantProductIds
    );
    expect(result).toEqual({ ok: false, error: "Varian tidak sesuai produk" });
  });

  it("rejects an unknown SKU id", () => {
    const result = validatePoLinesAgainstSkus(
      [{ product_id: KAOS_001, pos_sku_id: "sku-does-not-exist" }],
      skuRows,
      variantProductIds
    );
    expect(result).toEqual({ ok: false, error: "Varian tidak sesuai produk" });
  });

  it("rejects a duplicate product+SKU line", () => {
    const result = validatePoLinesAgainstSkus(
      [
        { product_id: KAOS_001, pos_sku_id: "sku-a" },
        { product_id: KAOS_001, pos_sku_id: "sku-a" },
      ],
      skuRows,
      variantProductIds
    );
    expect(result).toEqual({ ok: false, error: "Baris SKU ganda" });
  });

  it("allows two lines for the same product with different SKUs", () => {
    const result = validatePoLinesAgainstSkus(
      [
        { product_id: KAOS_001, pos_sku_id: "sku-a" },
        { product_id: KAOS_001, pos_sku_id: "sku-b" },
      ],
      skuRows,
      variantProductIds
    );
    expect(result).toEqual({ ok: true });
  });
});

describe("resolveGrnItemSku", () => {
  it("inherits pos_sku_id from the PO item when the GRN item sends none", () => {
    const result = resolveGrnItemSku({ pos_sku_id: null }, { pos_sku_id: "sku-a" });
    expect(result).toEqual({ ok: true, pos_sku_id: "sku-a" });
  });

  it("accepts a client pos_sku_id that matches the PO item", () => {
    const result = resolveGrnItemSku({ pos_sku_id: "sku-a" }, { pos_sku_id: "sku-a" });
    expect(result).toEqual({ ok: true, pos_sku_id: "sku-a" });
  });

  it("rejects a client pos_sku_id that mismatches the PO item", () => {
    const result = resolveGrnItemSku({ pos_sku_id: "sku-b" }, { pos_sku_id: "sku-a" });
    expect(result).toEqual({ ok: false, error: "SKU tidak sesuai item PO" });
  });

  it("resolves to null when the PO item has no SKU (non-variant product)", () => {
    const result = resolveGrnItemSku({ pos_sku_id: null }, { pos_sku_id: null });
    expect(result).toEqual({ ok: true, pos_sku_id: null });
  });

  it("resolves to null when there is no PO item reference at all", () => {
    const result = resolveGrnItemSku({ pos_sku_id: null }, null);
    expect(result).toEqual({ ok: true, pos_sku_id: null });
  });
});

describe("requiresSkuOnGrn", () => {
  it("requires SKU for a variant product without pos_sku_id", () => {
    expect(requiresSkuOnGrn(true, null)).toBe(true);
    expect(requiresSkuOnGrn(true, undefined)).toBe(true);
  });

  it("does not require SKU once pos_sku_id is set", () => {
    expect(requiresSkuOnGrn(true, "sku-a")).toBe(false);
  });

  it("never requires SKU for non-variant products", () => {
    expect(requiresSkuOnGrn(false, null)).toBe(false);
    expect(requiresSkuOnGrn(false, "sku-a")).toBe(false);
  });
});
