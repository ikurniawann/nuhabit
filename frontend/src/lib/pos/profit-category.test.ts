import { describe, expect, it } from "vitest";
import {
  isPosGroupCategory,
  itemCategoryLabelMap,
  lookupItemCategoryName,
  resolveProfitCategory,
} from "./profit-category";

describe("isPosGroupCategory", () => {
  it("treats POS stall buckets as group categories", () => {
    expect(isPosGroupCategory("Makanan")).toBe(true);
    expect(isPosGroupCategory("minuman")).toBe(true);
    expect(isPosGroupCategory(" Dessert ")).toBe(true);
  });

  it("keeps real menu categories", () => {
    expect(isPosGroupCategory("Main Course")).toBe(false);
    expect(isPosGroupCategory("Kopi")).toBe(false);
    expect(isPosGroupCategory("Roti & Pastry")).toBe(false);
  });
});

describe("lookupItemCategoryName", () => {
  it("returns the master nama, then the raw code", () => {
    const map = itemCategoryLabelMap([{ code: "COFFEE", nama: "Kopi" }]);
    expect(lookupItemCategoryName("coffee", map)).toBe("Kopi");
    expect(lookupItemCategoryName("SIGNATURE-BOWL", map)).toBe("SIGNATURE-BOWL");
    expect(lookupItemCategoryName(null, map)).toBeNull();
  });
});

describe("itemCategoryLabelMap", () => {
  it("resolves purchasing kategori code to display name", () => {
    const map = itemCategoryLabelMap([
      { code: "COFFEE", nama: "Kopi" },
      { code: "MAIN", nama: "Main Course" },
    ]);
    expect(map.get("coffee")).toBe("Kopi");
    expect(map.get("MAIN".toLowerCase())).toBe("Main Course");
    expect(map.get("kopi")).toBe("Kopi");
  });
});

describe("resolveProfitCategory", () => {
  it("prefers item.products kategori over POS Makanan/Minuman/Dessert", () => {
    expect(
      resolveProfitCategory({
        itemCategoryCode: "COFFEE",
        itemCategoryName: "Kopi",
        posCategoryName: "Minuman",
      })
    ).toEqual({ id: "COFFEE", label: "Kopi" });

    expect(
      resolveProfitCategory({
        itemCategoryCode: "MAIN",
        itemCategoryName: "Main Course",
        posCategoryName: "Makanan",
      })
    ).toEqual({ id: "MAIN", label: "Main Course" });

    expect(
      resolveProfitCategory({
        itemCategoryCode: "BAKERY",
        itemCategoryName: "Roti & Pastry",
        posCategoryName: "Dessert",
      })
    ).toEqual({ id: "BAKERY", label: "Roti & Pastry" });
  });

  it("does not surface POS group buckets when item kategori is missing", () => {
    expect(
      resolveProfitCategory({
        itemCategoryCode: null,
        itemCategoryName: null,
        posCategoryName: "Makanan",
      })
    ).toEqual({ id: "uncategorized", label: "Tanpa kategori" });

    expect(
      resolveProfitCategory({
        posCategoryName: "Minuman",
      })
    ).toEqual({ id: "uncategorized", label: "Tanpa kategori" });

    expect(
      resolveProfitCategory({
        posCategoryName: "Dessert",
      })
    ).toEqual({ id: "uncategorized", label: "Tanpa kategori" });
  });

  it("keeps a non-group POS category as fallback", () => {
    expect(
      resolveProfitCategory({
        posCategoryName: "Merchandise",
      })
    ).toEqual({ id: "Merchandise", label: "Merchandise" });
  });

  it("uses the item kategori code when the master name is missing", () => {
    expect(
      resolveProfitCategory({
        itemCategoryCode: "SIGNATURE-BOWL",
        posCategoryName: "Makanan",
      })
    ).toEqual({ id: "SIGNATURE-BOWL", label: "SIGNATURE-BOWL" });
  });

  it("does not keep Dessert/Minuman/Makanan even when they come from item master", () => {
    expect(
      resolveProfitCategory({
        itemCategoryCode: "DESSERT",
        itemCategoryName: "Dessert",
        posCategoryName: "Dessert",
      })
    ).toEqual({ id: "uncategorized", label: "Tanpa kategori" });

    expect(
      resolveProfitCategory({
        itemCategoryCode: "BEVERAGE",
        itemCategoryName: "Minuman",
        posCategoryName: "Minuman",
      })
    ).toEqual({ id: "BEVERAGE", label: "BEVERAGE" });
  });
});
