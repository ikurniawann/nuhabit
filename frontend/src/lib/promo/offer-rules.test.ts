import { describe, expect, it } from "vitest";
import { validateOfferRule, type OfferRuleInput } from "./offer-rules";

const ids = {
  a: "11111111-1111-4111-8111-111111111111",
  b: "22222222-2222-4222-8222-222222222222",
  c: "33333333-3333-4333-8333-333333333333",
};

describe("validateOfferRule — bundle", () => {
  it("rejects missing name / one component / zero price", () => {
    expect(
      validateOfferRule({
        offer_type: "bundle",
        name: "  ",
        bundle_price: 10,
        items: [
          { role: "component", product_id: ids.a, qty: 1 },
          { role: "component", product_id: ids.b, qty: 1 },
        ],
      })
    ).toMatch(/Nama/);

    expect(
      validateOfferRule({
        offer_type: "bundle",
        name: "Paket",
        bundle_price: 0,
        items: [
          { role: "component", product_id: ids.a, qty: 1 },
          { role: "component", product_id: ids.b, qty: 1 },
        ],
      })
    ).toMatch(/Harga/);

    expect(
      validateOfferRule({
        offer_type: "bundle",
        name: "Paket",
        bundle_price: 50000,
        items: [{ role: "component", product_id: ids.a, qty: 1 }],
      })
    ).toMatch(/minimal 2/);
  });

  it("accepts valid A+B bundle", () => {
    expect(
      validateOfferRule({
        offer_type: "bundle",
        name: "Paket Ayam",
        bundle_price: 99000,
        valid_from: "2026-08-01",
        valid_until: "2026-08-31",
        items: [
          { role: "component", product_id: ids.a, qty: 1 },
          { role: "component", product_id: ids.b, qty: 2 },
        ],
      })
    ).toBeNull();
  });

  it("rejects inverted period", () => {
    expect(
      validateOfferRule({
        offer_type: "bundle",
        name: "Paket",
        bundle_price: 10,
        valid_from: "2026-09-01",
        valid_until: "2026-08-01",
        items: [
          { role: "component", product_id: ids.a, qty: 1 },
          { role: "component", product_id: ids.b, qty: 1 },
        ],
      })
    ).toMatch(/Tanggal/);
  });
});

describe("validateOfferRule — bxgy", () => {
  const base: OfferRuleInput = {
    offer_type: "bxgy",
    name: "BOGO",
    buy_qty: 1,
    get_qty: 1,
    get_mode: "same_as_buy",
    items: [{ role: "buy", product_id: ids.a }],
  };

  it("accepts buy 1 get 1 same item", () => {
    expect(validateOfferRule(base)).toBeNull();
  });

  it("accepts buy 3 get 1", () => {
    expect(
      validateOfferRule({ ...base, buy_qty: 3, get_qty: 1 })
    ).toBeNull();
  });

  it("requires get products when specific_products", () => {
    expect(
      validateOfferRule({
        ...base,
        get_mode: "specific_products",
        items: [{ role: "buy", product_id: ids.a }],
      })
    ).toMatch(/produk gratis/);

    expect(
      validateOfferRule({
        ...base,
        get_mode: "specific_products",
        items: [
          { role: "buy", product_id: ids.a },
          { role: "get", product_id: ids.b },
          { role: "get", product_id: ids.c },
        ],
      })
    ).toBeNull();
  });
});

describe("validateOfferRule — volume", () => {
  it("accepts buy 5 → 3%", () => {
    expect(
      validateOfferRule({
        offer_type: "volume",
        name: "Diskon 5",
        volume_basis: "qty",
        volume_min: 5,
        discount_type: "percent",
        discount_value: 3,
        items: [],
      })
    ).toBeNull();
  });

  it("accepts min spend → fixed Rp", () => {
    expect(
      validateOfferRule({
        offer_type: "volume",
        name: "Min belanja",
        volume_basis: "spend",
        volume_min: 100000,
        discount_type: "fixed",
        discount_value: 3000,
        items: [{ role: "eligible", product_id: ids.a }],
      })
    ).toBeNull();
  });

  it("rejects percent > 100", () => {
    expect(
      validateOfferRule({
        offer_type: "volume",
        name: "Bad",
        volume_basis: "qty",
        volume_min: 5,
        discount_type: "percent",
        discount_value: 120,
        items: [],
      })
    ).toMatch(/100/);
  });
});
