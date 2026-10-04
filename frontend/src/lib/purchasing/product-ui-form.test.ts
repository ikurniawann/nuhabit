import { describe, expect, it } from "vitest";
import {
  bomLineCost,
  calculateMarkupFromPrice,
  getBomQty,
  getBomWastePercent,
  materialUnitCost,
  productFormFromProduct,
} from "./product-ui-form";
import type { ProductWithCOGS, RawMaterialWithStock } from "@/types/purchasing";

const sugar = { avg_cost: 750000, satuan_kecil_id: "g", konversi_factor: 50000 } as unknown as RawMaterialWithStock;

describe("calculateMarkupFromPrice", () => {
  it("returns markup percent with two decimals", () => {
    expect(calculateMarkupFromPrice(3000, 10000)).toBe(233.33);
  });
  it("returns 0 without HPP", () => {
    expect(calculateMarkupFromPrice(0, 10000)).toBe(0);
  });
});

describe("materialUnitCost / bomLineCost", () => {
  it("normalises the big-unit price to the small unit", () => {
    expect(materialUnitCost(sugar)).toBe(15);
  });
  it("keeps the price when there is no small unit", () => {
    expect(materialUnitCost({ harga_terakhir: 2000 } as unknown as RawMaterialWithStock)).toBe(2000);
  });
  it("adds waste on top of qty x unit cost", () => {
    expect(bomLineCost(sugar, 20, 10)).toBeCloseTo(330);
  });
  it("treats a missing material as zero cost", () => {
    expect(bomLineCost(undefined, 5, 0)).toBe(0);
  });
});

describe("BOM item accessors", () => {
  it("reads qty from the first defined field", () => {
    expect(getBomQty({ qty_required: 3 })).toBe(3);
    expect(getBomQty({})).toBe(0);
  });
  it("prefers waste_persen, else converts waste_factor", () => {
    expect(getBomWastePercent({ waste_persen: 5, waste_factor: 0.2 })).toBe(5);
    expect(getBomWastePercent({ waste_factor: 0.2 })).toBe(20);
  });
});

describe("productFormFromProduct", () => {
  it("coerces numeric strings and normalises output type", () => {
    const form = productFormFromProduct({
      nama: "Latte",
      kategori: "COFFEE",
      unit_id: "cup",
      harga_jual: "28000",
      production_output_type: "FINISHED_GOOD",
    } as unknown as ProductWithCOGS);
    expect(form.harga_jual).toBe(28000);
    expect(form.satuan_id).toBe("cup");
    expect(form.production_output_type).toBe("FINISHED_GOOD");
    expect(form.is_active).toBe(true);
  });
});
