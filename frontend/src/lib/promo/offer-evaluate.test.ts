import { describe, expect, it } from "vitest";
import {
  evaluateOfferRules,
  isOfferInPeriod,
  type OfferEvalRule,
} from "./offer-evaluate";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

describe("evaluateOfferRules", () => {
  it("applies bundle A+B cheaper than retail", () => {
    const rule: OfferEvalRule = {
      id: "r1",
      offer_type: "bundle",
      name: "Paket",
      bundle_price: 70_000,
      items: [
        { role: "component", product_id: A, qty: 1 },
        { role: "component", product_id: B, qty: 1 },
      ],
    };
    const result = evaluateOfferRules(
      [
        { productId: A, quantity: 1, unitPrice: 45_000 },
        { productId: B, quantity: 1, unitPrice: 40_000 },
      ],
      [rule]
    );
    // retail 85k - bundle 70k = 15k
    expect(result.offer_discount).toBe(15_000);
    expect(result.applied[0]?.name).toBe("Paket");
  });

  it("applies buy 1 get 1 same item", () => {
    const rule: OfferEvalRule = {
      id: "r2",
      offer_type: "bxgy",
      name: "BOGO",
      buy_qty: 1,
      get_qty: 1,
      get_mode: "same_as_buy",
      items: [{ role: "buy", product_id: A, qty: 1 }],
    };
    const result = evaluateOfferRules(
      [{ productId: A, quantity: 2, unitPrice: 10_000 }],
      [rule]
    );
    expect(result.offer_discount).toBe(10_000);
    expect(result.applied[0]?.free_units).toEqual([
      { productId: A, qty: 1, unitPrice: 10_000 },
    ]);
  });

  it("applies buy 1 get specific free item", () => {
    const rule: OfferEvalRule = {
      id: "r3",
      offer_type: "bxgy",
      name: "Gratis C",
      buy_qty: 1,
      get_qty: 1,
      get_mode: "specific_products",
      items: [
        { role: "buy", product_id: A, qty: 1 },
        { role: "get", product_id: C, qty: 1 },
      ],
    };
    const result = evaluateOfferRules(
      [
        { productId: A, quantity: 1, unitPrice: 45_000 },
        { productId: C, quantity: 1, unitPrice: 15_000 },
      ],
      [rule]
    );
    expect(result.offer_discount).toBe(15_000);
  });

  it("applies volume buy 5 → 3%", () => {
    const rule: OfferEvalRule = {
      id: "r4",
      offer_type: "volume",
      name: "Vol 5",
      volume_basis: "qty",
      volume_min: 5,
      discount_type: "percent",
      discount_value: 3,
      items: [],
    };
    const result = evaluateOfferRules(
      [{ productId: A, quantity: 5, unitPrice: 10_000 }],
      [rule]
    );
    expect(result.offer_discount).toBe(1_500);
  });

  it("picks larger discount when bundle vs bxgy compete", () => {
    const bundle: OfferEvalRule = {
      id: "b",
      offer_type: "bundle",
      name: "Bundle",
      bundle_price: 80_000,
      items: [
        { role: "component", product_id: A, qty: 1 },
        { role: "component", product_id: B, qty: 1 },
      ],
    };
    const bxgy: OfferEvalRule = {
      id: "x",
      offer_type: "bxgy",
      name: "BXGY",
      buy_qty: 1,
      get_qty: 1,
      get_mode: "same_as_buy",
      items: [{ role: "buy", product_id: A, qty: 1 }],
    };
    // A×2 + B×1 → bundle uses A+B (retail 90k-80k=10k), bxgy on A×2 = 45k free
    const result = evaluateOfferRules(
      [
        { productId: A, quantity: 2, unitPrice: 45_000 },
        { productId: B, quantity: 1, unitPrice: 45_000 },
      ],
      [bundle, bxgy]
    );
    // bxgy 45k > bundle 10k → apply bxgy first, then maybe leftover B alone no bundle
    expect(result.offer_discount).toBe(45_000);
    expect(result.applied.some((a) => a.name === "BXGY")).toBe(true);
  });
});

describe("isOfferInPeriod", () => {
  it("respects from/until", () => {
    expect(isOfferInPeriod({ valid_from: "2026-08-01", valid_until: "2026-08-31" }, "2026-08-13")).toBe(true);
    expect(isOfferInPeriod({ valid_from: "2026-08-20", valid_until: null }, "2026-08-13")).toBe(false);
    expect(isOfferInPeriod({ valid_from: null, valid_until: "2026-08-01" }, "2026-08-13")).toBe(false);
  });
});
