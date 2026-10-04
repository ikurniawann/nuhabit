import { describe, expect, it } from "vitest";
import type { Product } from "@/lib/pos-api";
import {
  ALL_FILTER,
  catalogAddKind,
  catalogCategories,
  catalogLine,
  displayXp,
  filterCatalog,
  findSkuByScan,
  giftCardLine,
  merchSkuLine,
  productXpLock,
  productXpLockMessage,
  searchSuggestions,
  stallBlockedReason,
  stallFilterOptions,
} from "./catalog";

const product = (overrides: Partial<Product> = {}): Product => ({
  id: "p1",
  sku: "KOP-01",
  name: "Kopi Susu",
  base_price: 20_000,
  is_active: true,
  is_available: true,
  ...overrides,
});

describe("catalog lists", () => {
  it("categories start with All and use Uncategorized as fallback", () => {
    expect(
      catalogCategories([
        product({ category: { name: "Kopi" } }),
        product({ id: "p2" }),
        product({ id: "p3", category: { name: "Kopi" } }),
      ])
    ).toEqual(["All", "Kopi", "Uncategorized"]);
  });

  it("blocks an empty catalog only for stall-selection reasons", () => {
    expect(stallBlockedReason(0, "multiple_unselected")).toBe("multiple_unselected");
    expect(stallBlockedReason(0, "all_stalls")).toBe("all_stalls");
    expect(stallBlockedReason(3, "all_stalls")).toBeNull();
    expect(stallBlockedReason(0, "something_else")).toBeNull();
    expect(stallBlockedReason(0, null)).toBeNull();
  });

  it("stall filters list each warehouse once with a fallback label", () => {
    expect(
      stallFilterOptions([
        product({ warehouse_id: "w1", warehouse_name: " Bar " }),
        product({ id: "p2", warehouse_id: "w1", warehouse_name: "Other" }),
        product({ id: "p3", warehouse_id: "w2", warehouse_name: "  " }),
        product({ id: "p4" }),
      ])
    ).toEqual([
      { id: ALL_FILTER, label: "Semua stall" },
      { id: "w1", label: "Bar" },
      { id: "w2", label: "Stall" },
    ]);
  });

  it("filters by stall, category and name", () => {
    const items = [
      product({ warehouse_id: "w1", category: { name: "Kopi" } }),
      product({ id: "p2", name: "Teh Tarik", warehouse_id: "w2", category: { name: "Teh" } }),
    ];
    expect(filterCatalog(items, { stall: "w2", category: ALL_FILTER, search: "" }).map((p) => p.id)).toEqual([
      "p2",
    ]);
    expect(filterCatalog(items, { stall: ALL_FILTER, category: "Kopi", search: "" }).map((p) => p.id)).toEqual([
      "p1",
    ]);
    expect(filterCatalog(items, { stall: ALL_FILTER, category: ALL_FILTER, search: "TEH" }).map((p) => p.id)).toEqual(
      ["p2"]
    );
  });

  it("suggests up to 8 products by name or SKU", () => {
    const many = Array.from({ length: 12 }, (_, i) => product({ id: `p${i}`, sku: `SKU-${i}` }));
    expect(searchSuggestions(many, "kopi")).toHaveLength(8);
    expect(searchSuggestions(many, "sku-11").map((p) => p.id)).toEqual(["p11"]);
    expect(searchSuggestions(many, "  ")).toEqual([]);
  });
});

describe("findSkuByScan", () => {
  const merch = product({
    product_kind: "merchandise",
    skus: [
      { id: "s1", sku: "TEE-M", name: "M", barcode: "899001" },
      { id: "s2", sku: "TEE-L", name: "L", is_active: false },
    ],
  });

  it("matches a full barcode or SKU code, case-insensitive", () => {
    expect(findSkuByScan([merch], "899001")?.sku.id).toBe("s1");
    expect(findSkuByScan([merch], " tee-m ")?.sku.id).toBe("s1");
  });

  it("ignores short input and inactive variants", () => {
    expect(findSkuByScan([merch], "899")).toBeNull();
    expect(findSkuByScan([merch], "TEE-L")).toBeNull();
  });
});

describe("catalogAddKind", () => {
  it("routes gift cards, SKU merchandise and customizable products to dialogs", () => {
    expect(catalogAddKind(product({ product_kind: "gift_card" }))).toBe("gift_card");
    expect(
      catalogAddKind(product({ product_kind: "merchandise", skus: [{ id: "s", sku: "x", name: "x" }] }))
    ).toBe("merch_sku");
    expect(
      catalogAddKind(
        product({ product_kind: "merchandise", skus: [{ id: "s", sku: "x", name: "x", is_active: false }] })
      )
    ).toBe("simple");
    expect(
      catalogAddKind(product({ variants: [{ id: "v", product_id: "p1", name: "L" } as never] }))
    ).toBe("customize");
    expect(catalogAddKind(product())).toBe("simple");
  });
});

describe("productXpLock", () => {
  const vip = product({ min_xp: 500 } as Partial<Product>);

  it("locks privilege products until the member has enough XP", () => {
    expect(productXpLock(vip, null, true)).toEqual({ minXp: 500, customerXp: 0, locked: true });
    expect(productXpLock(vip, { total_xp: 499 }, true).locked).toBe(true);
    expect(productXpLock(vip, { total_xp: "500" }, true).locked).toBe(false);
  });

  it("never locks when XP is disabled or the product has no minimum", () => {
    expect(productXpLock(vip, null, false).locked).toBe(false);
    expect(productXpLock(product(), null, true).locked).toBe(false);
  });

  it("explains the lock with or without a member", () => {
    expect(productXpLockMessage({ minXp: 500, customerXp: 120 }, true)).toBe(
      "Produk khusus member ≥ 500 XP (XP member: 120)"
    );
    expect(productXpLockMessage({ minXp: 500, customerXp: 0 }, false)).toBe(
      "Produk khusus member ≥ 500 XP — pilih member dulu"
    );
  });
});

describe("displayXp", () => {
  it("uses catalog XP or a stable 1..100 value from the id", () => {
    expect(displayXp(product({ xp: 0 }))).toBe(0);
    const derived = displayXp(product({ id: "abc" }));
    expect(derived).toBe(((97 + 98 + 99) % 100) + 1);
  });
});

describe("cart lines", () => {
  const stalled = product({ warehouse_name: "Bar", stall_name: null, image_url: "img", station: "bar" });

  it("defaults to one unit at base price with the stall name fallback", () => {
    expect(catalogLine(stalled)).toEqual({
      id: "p1",
      productId: "p1",
      name: "Kopi Susu",
      price: 20_000,
      quantity: 1,
      imageUrl: "img",
      station: "bar",
      stallName: "Bar",
    });
  });

  it("gift card lines are unique per nominal", () => {
    const line = giftCardLine(product({ name: "Gift" }), { nominal: 50_000, quantity: 2 }, (v) => `Rp${v}`);
    expect(line).toMatchObject({ id: "p1-50000", name: "Gift Rp50000", price: 50_000, quantity: 2 });
  });

  it("merch SKU lines use the variant id and price override", () => {
    const line = merchSkuLine(product({ name: "Tee" }), { id: "s1", sku: "TEE-M", name: "M", price_override: 90_000 });
    expect(line).toMatchObject({ id: "p1::sku:s1", skuId: "s1", skuCode: "TEE-M", name: "Tee — M", price: 90_000 });
    expect(merchSkuLine(product(), { id: "s2", sku: "x", name: "L" }).price).toBe(20_000);
  });
});
