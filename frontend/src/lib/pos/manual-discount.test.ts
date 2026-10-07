import { describe, expect, it } from "vitest";
import {
  buildDiscountReason,
  computeDiscountAmount,
  computeOrderDiscountStack,
  formatDiscountLabel,
  reconstructOrderDiscountBreakdown,
  type DiscountType,
} from "./manual-discount";

describe("computeDiscountAmount", () => {
  it("computes percent with floor and cap", () => {
    expect(computeDiscountAmount(10_000, "percent", 10)).toBe(1_000);
    expect(computeDiscountAmount(999, "percent", 10)).toBe(99);
    expect(computeDiscountAmount(100, "percent", 150)).toBe(100);
  });

  it("computes fixed with cap", () => {
    expect(computeDiscountAmount(10_000, "fixed", 2_500)).toBe(2_500);
    expect(computeDiscountAmount(1_000, "fixed", 5_000)).toBe(1_000);
  });

  it("returns 0 for empty / invalid", () => {
    expect(computeDiscountAmount(10_000, null, 10)).toBe(0);
    expect(computeDiscountAmount(10_000, "percent", 0)).toBe(0);
    expect(computeDiscountAmount(0, "fixed", 100)).toBe(0);
  });
});

describe("computeOrderDiscountStack", () => {
  it("stacks item → membership → promo → manual", () => {
    const stack = computeOrderDiscountStack({
      items: [
        { line_subtotal: 100_000, discount_type: "percent", discount_value: 10 },
        { line_subtotal: 50_000, discount_type: "fixed", discount_value: 5_000 },
      ],
      membership_pct: 10,
      promo_discount: 8_000,
      manual_discount_type: "percent",
      manual_discount_value: 5,
    });

    // line: 10k + 5k = 15k; items_subtotal = 135k
    expect(stack.line_discount_total).toBe(15_000);
    expect(stack.items_subtotal).toBe(135_000);
    expect(stack.membership_amount).toBe(13_500);
    // promo capped to remaining after membership: min(8000, 135000-13500)=8000
    expect(stack.promo_amount).toBe(8_000);
    // manual 5% of (135000-13500-8000)=113500 → 5675
    expect(stack.manual_amount).toBe(5_675);
    expect(stack.discount_amount).toBe(15_000 + 13_500 + 8_000 + 5_675);
    expect(stack.after_discount).toBe(135_000 - 13_500 - 8_000 - 5_675);
    expect(stack.gross_subtotal).toBe(150_000);
  });

  it("caps manual fixed to remaining basis", () => {
    const stack = computeOrderDiscountStack({
      items: [{ line_subtotal: 10_000 }],
      membership_pct: 0,
      promo_discount: 0,
      manual_discount_type: "fixed",
      manual_discount_value: 99_000,
    });
    expect(stack.manual_amount).toBe(10_000);
    expect(stack.after_discount).toBe(0);
  });

  it("applies offer before membership", () => {
    const stack = computeOrderDiscountStack({
      items: [{ line_subtotal: 100_000 }],
      offer_discount: 20_000,
      membership_pct: 10,
    });
    expect(stack.offer_amount).toBe(20_000);
    expect(stack.membership_amount).toBe(8_000);
    expect(stack.discount_amount).toBe(28_000);
  });
});

describe("buildDiscountReason", () => {
  it("joins non-empty segments", () => {
    expect(
      buildDiscountReason({
        has_item_discounts: true,
        offer_labels: ["Paket Hemat"],
        membership_pct: 10,
        promo_code: "SUMMER",
        manual_type: "percent" as DiscountType,
        manual_value: 5,
      })
    ).toBe(
      "ITEM line discounts; OFFER Paket Hemat; MEMBER 10%; PROMO SUMMER; MANUAL 5%"
    );
  });

  it("formats fixed manual", () => {
    expect(
      buildDiscountReason({
        has_item_discounts: false,
        membership_pct: 0,
        promo_code: null,
        manual_type: "fixed",
        manual_value: 2500,
      })
    ).toBe("MANUAL Rp 2500");
  });
});

describe("formatDiscountLabel", () => {
  it("formats badge text", () => {
    expect(formatDiscountLabel("percent", 10)).toBe("−10%");
    expect(formatDiscountLabel("fixed", 5000)).toBe("−Rp5.000");
  });
});

describe("reconstructOrderDiscountBreakdown", () => {
  it("splits item / membership / promo / manual amounts", () => {
    const stack = computeOrderDiscountStack({
      items: [
        { line_subtotal: 100_000, discount_type: "percent", discount_value: 10 },
        { line_subtotal: 50_000, discount_type: "fixed", discount_value: 5_000 },
      ],
      membership_pct: 10,
      promo_discount: 8_000,
      manual_discount_type: "percent",
      manual_discount_value: 5,
    });
    const reason = buildDiscountReason({
      has_item_discounts: true,
      membership_pct: 10,
      promo_code: "POS-ABC",
      manual_type: "percent",
      manual_value: 5,
    });
    const breakdown = reconstructOrderDiscountBreakdown({
      subtotal: stack.gross_subtotal,
      discount_amount: stack.discount_amount,
      discount_reason: reason,
      manual_discount_type: "percent",
      manual_discount_value: 5,
      items: stack.line_results.map((line) => ({
        discount_amount: line.discount_amount,
      })),
    });
    expect(breakdown.item_amount).toBe(15_000);
    expect(breakdown.membership_amount).toBe(13_500);
    expect(breakdown.promo_amount).toBe(8_000);
    expect(breakdown.manual_amount).toBe(5_675);
    expect(breakdown.promo_code).toBe("POS-ABC");
    expect(breakdown.total).toBe(stack.discount_amount);
  });
});
