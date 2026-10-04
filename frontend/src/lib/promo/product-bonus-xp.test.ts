import { describe, expect, it } from "vitest";
import { computeProductBonusXp } from "./product-bonus-xp";

const bonus = new Map([
  ["latte", 10],
  ["cake", 5],
  ["mug", 0],
]);

describe("computeProductBonusXp", () => {
  it("menjumlah qty × bonus_xp per baris", () => {
    expect(
      computeProductBonusXp(
        [
          { product_id: "latte", quantity: 2 },
          { product_id: "cake", quantity: 3 },
          { product_id: "mug", quantity: 1 },
        ],
        bonus
      )
    ).toBe(35);
  });

  it("produk sama di dua baris dihitung dua kali sesuai qty", () => {
    expect(
      computeProductBonusXp(
        [
          { product_id: "latte", quantity: 1 },
          { productId: "latte", quantity: "2" },
        ],
        bonus
      )
    ).toBe(30);
  });

  it("produk tanpa bonus, tanpa id, atau qty tidak valid diabaikan", () => {
    expect(
      computeProductBonusXp(
        [
          { product_id: "unknown", quantity: 5 },
          { product_id: null, quantity: 5 },
          { product_id: "latte", quantity: "abc" },
          { product_id: "cake", quantity: -2 },
        ],
        bonus
      )
    ).toBe(0);
  });

  it("qty pecahan dibulatkan ke bawah, bonus negatif dianggap 0", () => {
    expect(
      computeProductBonusXp(
        [
          { product_id: "latte", quantity: 1.9 },
          { product_id: "neg", quantity: 3 },
        ],
        new Map([
          ["latte", 10],
          ["neg", -7],
        ])
      )
    ).toBe(10);
  });
});
