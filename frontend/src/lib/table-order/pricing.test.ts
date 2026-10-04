import { describe, expect, it } from "vitest";
import type { BillingCharge } from "@/lib/pos/billing-settings";
import { normalizeTableOrderProduct, resolveModifiers } from "./menu";
import {
  addToCart,
  adjustCartQuantity,
  directDecrementLine,
  MAX_LINE_QTY,
  memberDiscountAmount,
  memberPrice,
  productLines,
  productQuantity,
  setCartQuantity,
  summarizeCart,
} from "./pricing";

const latte = normalizeTableOrderProduct({
  id: "latte",
  name: "Iced Latte",
  base_price: 30000,
  xp_points: 30,
  station: "bar",
  variants: [
    { id: "reg", name: "Regular", price_adjustment: 0 },
    { id: "oat", name: "Oat Milk", price_adjustment: 8000 },
  ],
});

const cake = normalizeTableOrderProduct({
  id: "cake",
  name: "Cake",
  base_price: 25000,
  xp_points: 25,
  station: "kitchen",
  variants: [],
});

function percentCharge(code: string, kind: BillingCharge["charge_kind"], rate: number): BillingCharge {
  return {
    code,
    name: code,
    charge_kind: kind,
    calc_method: "percent",
    rate,
    amount: 0,
    apply_order: kind === "service" ? 100 : 200,
    is_enabled: true,
    is_optional: false,
    base: "subtotal_after_discount",
  };
}

describe("addToCart / quantity", () => {
  it("varian berbeda = baris berbeda; varian sama digabung", () => {
    let cart = addToCart([], latte);
    cart = addToCart(cart, latte, latte.variants[1]);
    cart = addToCart(cart, latte);
    expect(cart).toHaveLength(2);
    expect(cart[0]).toMatchObject({ cartId: "latte:reg", quantity: 2, unitPrice: 30000, variantName: "Regular" });
    expect(cart[1]).toMatchObject({ cartId: "latte:oat", quantity: 1, unitPrice: 38000 });
    expect(productQuantity(cart, "latte")).toBe(3);
  });

  it("produk tanpa varian memakai id produk sebagai cartId", () => {
    const cart = addToCart([], cake, null, 2);
    expect(cart[0]).toMatchObject({ cartId: "cake", variantId: null, quantity: 2, unitPrice: 25000 });
  });

  it("qty dibatasi MAX_LINE_QTY dan qty ≤ 0 menghapus baris", () => {
    let cart = addToCart([], cake, null, 500);
    expect(cart[0].quantity).toBe(MAX_LINE_QTY);
    cart = adjustCartQuantity(cart, "cake", -MAX_LINE_QTY);
    expect(cart).toEqual([]);
    expect(setCartQuantity(addToCart([], cake), "cake", 0)).toEqual([]);
    expect(adjustCartQuantity([], "tidak-ada", 1)).toEqual([]);
  });
});

describe("summarizeCart", () => {
  it("tanpa charge → total = subtotal, XP dijumlahkan per qty", () => {
    const cart = addToCart(addToCart([], latte, latte.variants[1], 2), cake);
    const summary = summarizeCart(cart);
    expect(summary.subtotal).toBe(38000 * 2 + 25000);
    expect(summary.total).toBe(summary.subtotal);
    expect(summary.totalItems).toBe(3);
    expect(summary.totalXp).toBe(30 * 2 + 25);
    expect(summary.taxAmount).toBe(0);
    expect(summary.breakdown).toEqual([]);
  });

  it("mengikuti profil billing venue (service 5% lalu pajak 10%) — bukan hardcode", () => {
    const cart = addToCart([], cake, null, 4); // 100.000
    const summary = summarizeCart(cart, [
      percentCharge("SERVICE", "service", 5),
      percentCharge("TAX", "tax", 10),
    ]);
    expect(summary.serviceChargeAmount).toBe(5000);
    expect(summary.taxAmount).toBe(10000);
    expect(summary.total).toBe(115000);
    expect(summary.breakdown.map((line) => line.code)).toEqual(["SERVICE", "TAX"]);
  });

  it("charge nonaktif diabaikan", () => {
    const cart = addToCart([], cake);
    const summary = summarizeCart(cart, [{ ...percentCharge("TAX", "tax", 10), is_enabled: false }]);
    expect(summary.total).toBe(25000);
  });

  it("keranjang kosong → semua nol", () => {
    expect(summarizeCart([], [percentCharge("TAX", "tax", 10)])).toMatchObject({
      totalItems: 0,
      subtotal: 0,
      total: 0,
      taxAmount: 0,
    });
  });
});

describe("keranjang dengan add-on", () => {
  const product = normalizeTableOrderProduct({
    id: "p1",
    name: "Iced Latte",
    base_price: 25000,
    modifier_groups: [
      { id: "g1", name: "Tambahan", min_selection: 0, max_selection: 2, modifiers: [
        { id: "a", name: "Shot", price_adjustment: 10000 }, { id: "b", name: "Oat Milk", price_adjustment: 5000 } ] },
    ],
  });
  const pick = (ids: string[]) => {
    const r = resolveModifiers(product, ids);
    if (!r.ok) throw new Error(r.error);
    return r.selected;
  };

  it("kombinasi add-on berbeda = baris berbeda; urutan pilihan tidak berpengaruh", () => {
    let cart = addToCart([], product, null, 1, pick(["a", "b"]));
    cart = addToCart(cart, product, null, 1, pick(["b", "a"]));
    cart = addToCart(cart, product, null, 1, []);
    expect(cart).toHaveLength(2);
    expect(cart[0]).toMatchObject({ quantity: 2, unitPrice: 40000, modifierNames: ["Shot", "Oat Milk"] });
    expect(cart[1]).toMatchObject({ quantity: 1, unitPrice: 25000, modifierIds: [] });
    expect(summarizeCart(cart).subtotal).toBe(105000);
  });
});

describe("diskon member (harga coret self-order)", () => {
  it("memberPrice: floor seperti kasir; 0%/negatif/>100% aman", () => {
    expect(memberPrice(28000, 10)).toBe(25200);
    expect(memberPrice(28500, 10)).toBe(25650);
    expect(memberPrice(10005, 10)).toBe(9005); // potongan 1.000,5 → 1.000
    expect(memberPrice(28000, 0)).toBe(28000);
    expect(memberPrice(28000, -5)).toBe(28000);
    expect(memberPrice(28000, 150)).toBe(0);
    expect(memberDiscountAmount(-100, 10)).toBe(0);
  });

  it("summarizeCart: diskon dari subtotal, pajak dihitung setelah diskon", () => {
    const cart = addToCart([], latte, null, 2); // 60.000
    const tax: BillingCharge = {
      code: "TAX",
      name: "PB1",
      charge_kind: "tax",
      calc_method: "percent",
      rate: 10,
      amount: 0,
      apply_order: 200,
      is_enabled: true,
      is_optional: false,
      base: "subtotal_after_discount",
    } as BillingCharge;
    const member = summarizeCart(cart, [tax], 10);
    expect(member.subtotal).toBe(60000);
    expect(member.memberDiscount).toBe(6000);
    expect(member.memberDiscountPercent).toBe(10);
    expect(member.taxAmount).toBe(5400);
    expect(member.total).toBe(59400);

    const guest = summarizeCart(cart, [tax]);
    expect(guest.memberDiscount).toBe(0);
    expect(guest.memberDiscountPercent).toBe(0);
    expect(guest.total).toBe(66000);
  });
});

describe("kurangi dari daftar menu (revisi 2026-10-01)", () => {
  it("satu varian di keranjang → langsung kurangi baris itu", () => {
    const cart = addToCart([], latte, latte.variants[0], 2);
    expect(directDecrementLine(cart, "latte")).toBe(cart[0].cartId);
  });

  it("dua varian (x2 + x4) → harus pilih dulu, tidak menebak baris terakhir", () => {
    let cart = addToCart([], latte, latte.variants[0], 2);
    cart = addToCart(cart, latte, latte.variants[1], 4);
    expect(productLines(cart, "latte").map((line) => line.quantity)).toEqual([2, 4]);
    expect(directDecrementLine(cart, "latte")).toBeNull();
  });

  it("produk tidak ada di keranjang → null", () => {
    expect(directDecrementLine(addToCart([], cake), "latte")).toBeNull();
  });
});
