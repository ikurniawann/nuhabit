import { describe, expect, it } from "vitest";
import { reorderQuantity, suggestReorder } from "./reorder";

describe("reorderQuantity", () => {
  it("memesan sampai maksimum dikurangi stok dan yang sudah dipesan", () => {
    expect(reorderQuantity({ onHand: 3, onOrder: 2, minimum: 10, maximum: 50 })).toBe(45);
  });

  it("tidak pernah negatif", () => {
    expect(reorderQuantity({ onHand: 40, onOrder: 20, minimum: 10, maximum: 50 })).toBe(0);
  });

  it("memakai minimum bila maksimum lebih kecil atau kosong", () => {
    expect(reorderQuantity({ onHand: 2, onOrder: 0, minimum: 10, maximum: 5 })).toBe(8);
    expect(reorderQuantity({ onHand: 2, onOrder: 0, minimum: 10, maximum: null })).toBe(8);
  });

  it("membulatkan ke 3 desimal", () => {
    expect(reorderQuantity({ onHand: 0.1, onOrder: 0.2, minimum: 0, maximum: 1 })).toBe(0.7);
  });
});

describe("suggestReorder", () => {
  it("dengan maksimum: order up to max", () => {
    expect(suggestReorder({ onHand: 4, onOrder: 6, minimum: 10, maximum: 100 })).toEqual({
      shortage: 6,
      suggestedQty: 90,
      basis: "maximum",
    });
  });

  it("tanpa maksimum: aturan lama kekurangan x 1,5", () => {
    expect(suggestReorder({ onHand: 4, onOrder: 0, minimum: 10, maximum: null })).toEqual({
      shortage: 6,
      suggestedQty: 9,
      basis: "minimum_buffer",
    });
  });

  it("tanpa maksimum dan tanpa kekurangan: pesan sebesar minimum", () => {
    expect(suggestReorder({ onHand: 10, onOrder: 0, minimum: 10, maximum: 0 }).suggestedQty).toBe(10);
  });
});
