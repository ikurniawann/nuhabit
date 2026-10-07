import { describe, expect, it } from "vitest";
import { planOfferQuickAdd, type PosActiveOffer } from "./offers";

function baseOffer(
  partial: Partial<PosActiveOffer> & Pick<PosActiveOffer, "offer_type" | "items">
): PosActiveOffer {
  return {
    id: "r1",
    name: "Test",
    description: null,
    valid_from: null,
    valid_until: null,
    bundle_price: null,
    buy_qty: null,
    get_qty: null,
    get_mode: null,
    volume_basis: null,
    volume_min: null,
    discount_type: null,
    discount_value: null,
    eval: {
      id: "r1",
      offer_type: partial.offer_type,
      name: "Test",
      items: [],
    },
    ...partial,
  };
}

describe("planOfferQuickAdd", () => {
  it("adds one bundle set", () => {
    const plan = planOfferQuickAdd(
      baseOffer({
        offer_type: "bundle",
        items: [
          { role: "component", product_id: "a", product_name: "A", qty: 1 },
          { role: "component", product_id: "b", product_name: "B", qty: 2 },
        ],
      })
    );
    expect(plan).toEqual([
      { productId: "a", qty: 1, label: "A" },
      { productId: "b", qty: 2, label: "B" },
    ]);
  });

  it("bxgy same_as_buy adds buy+get of first buy product", () => {
    const plan = planOfferQuickAdd(
      baseOffer({
        offer_type: "bxgy",
        buy_qty: 2,
        get_qty: 1,
        get_mode: "same_as_buy",
        items: [
          { role: "buy", product_id: "x", product_name: "X", qty: 1 },
        ],
      })
    );
    expect(plan).toEqual([{ productId: "x", qty: 3, label: "X" }]);
  });

  it("volume qty adds min of first eligible", () => {
    const plan = planOfferQuickAdd(
      baseOffer({
        offer_type: "volume",
        volume_basis: "qty",
        volume_min: 5,
        items: [
          { role: "eligible", product_id: "v", product_name: "V", qty: 1 },
        ],
      })
    );
    expect(plan).toEqual([{ productId: "v", qty: 5, label: "V" }]);
  });
});
