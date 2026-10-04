import { afterEach, describe, expect, it, vi } from "vitest";
import {
  calculateXp,
  clampXpAdjustment,
  findBestRule,
  isXpEligiblePayment,
  itemAmount,
  pickTierForXp,
  sumUnreversedEarnByOrder,
  voidReverseKey,
  type CrmXpRule,
} from "./loyalty-rules";

function rule(overrides: Partial<CrmXpRule> = {}): CrmXpRule {
  return {
    id: "r1",
    source_channel: "pos",
    source_type: "order_amount",
    source_id: null,
    outlet_scope: "all",
    outlet_id: null,
    xp_mode: "fixed",
    xp_value: 10,
    amount_step: 1,
    min_amount: 0,
    max_xp_per_event: null,
    tier_multiplier_enabled: false,
    priority: 1,
    starts_at: null,
    ends_at: null,
    is_active: true,
    ...overrides,
  };
}

afterEach(() => vi.useRealTimers());

describe("isXpEligiblePayment", () => {
  it("hanya ARK Coin (tanpa peduli huruf besar) yang dapat XP belanja", () => {
    expect(isXpEligiblePayment("ark_coin")).toBe(true);
    expect(isXpEligiblePayment("ARK_COIN")).toBe(true);
    expect(isXpEligiblePayment("cash")).toBe(false);
    expect(isXpEligiblePayment(null)).toBe(false);
    expect(isXpEligiblePayment(undefined)).toBe(false);
  });
});

describe("calculateXp", () => {
  it("fixed, per_item, per_amount, multiplier, percentage", () => {
    expect(calculateXp(rule({ xp_mode: "fixed", xp_value: 7 }), { amount: 50_000, quantity: 3 })).toBe(7);
    expect(calculateXp(rule({ xp_mode: "per_item", xp_value: 4 }), { amount: 0, quantity: 3 })).toBe(12);
    expect(
      calculateXp(rule({ xp_mode: "per_amount", xp_value: 2, amount_step: 10_000 }), { amount: 35_000, quantity: 1 })
    ).toBe(6);
    expect(calculateXp(rule({ xp_mode: "multiplier", xp_value: "0.5" }), { amount: 101, quantity: 1 })).toBe(50);
    expect(calculateXp(rule({ xp_mode: "percentage", xp_value: 10 }), { amount: 999, quantity: 1 })).toBe(99);
  });

  it("amount_step 0 dianggap 1; batas max_xp_per_event; tidak pernah negatif", () => {
    expect(calculateXp(rule({ xp_mode: "per_amount", xp_value: 1, amount_step: 0 }), { amount: 5, quantity: 1 })).toBe(5);
    expect(
      calculateXp(rule({ xp_mode: "multiplier", xp_value: 1, max_xp_per_event: 100 }), { amount: 500, quantity: 1 })
    ).toBe(100);
    expect(calculateXp(rule({ xp_mode: "fixed", xp_value: -5 }), { amount: 1, quantity: 1 })).toBe(0);
  });
});

describe("findBestRule", () => {
  it("ambil aturan pertama (urut prioritas) yang cocok tipe, sumber, outlet, jendela waktu, dan minimum", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-04T05:00:00Z"));
    const rules = [
      rule({ id: "product", source_type: "product", source_id: "p1" }),
      rule({ id: "other-outlet", outlet_scope: "specific", outlet_id: "o2" }),
      rule({ id: "future", starts_at: "2026-10-05T00:00:00Z" }),
      rule({ id: "expired", ends_at: "2026-10-01T00:00:00Z" }),
      rule({ id: "min", min_amount: "100000" }),
      rule({ id: "match", outlet_scope: "specific", outlet_id: "o1" }),
      rule({ id: "later" }),
    ];
    const input = { sourceType: "order_amount", sourceId: null, outletId: "o1", amount: 50_000 };
    expect(findBestRule(rules, input)?.id).toBe("match");
    expect(findBestRule(rules, { ...input, amount: 150_000 })?.id).toBe("min");
    expect(findBestRule(rules, { sourceType: "product", sourceId: "p1", outletId: null, amount: 0 })?.id).toBe("product");
    expect(findBestRule(rules, { sourceType: "product", sourceId: "p2", outletId: null, amount: 0 })).toBeUndefined();
  });
});

describe("itemAmount", () => {
  it("total_amount, lalu subtotal, lalu unit_price × qty (qty minimal 1)", () => {
    expect(itemAmount({ total_amount: "12000", subtotal: 1, unit_price: 1 })).toBe(12_000);
    expect(itemAmount({ subtotal: 9000, unit_price: 1 })).toBe(9000);
    expect(itemAmount({ unit_price: 5000, quantity: 3 })).toBe(15_000);
    expect(itemAmount({ unit_price: 5000, quantity: 0 })).toBe(5000);
  });
});

describe("pickTierForXp", () => {
  const tiers = [
    { id: "regular", rank: 0, min_lifetime_xp: 0 },
    { id: "gold", rank: 3, min_lifetime_xp: "30000" },
    { id: "silver", rank: 2, min_lifetime_xp: 10_000 },
  ];
  it("peringkat tertinggi yang ambangnya terlampaui, tanpa peduli urutan masukan", () => {
    expect(pickTierForXp(tiers, 0)?.id).toBe("regular");
    expect(pickTierForXp(tiers, 10_000)?.id).toBe("silver");
    expect(pickTierForXp(tiers, 45_000)?.id).toBe("gold");
    expect(pickTierForXp([{ id: "x", rank: 1, min_lifetime_xp: 5 }], 1)).toBeUndefined();
  });
});

describe("clampXpAdjustment", () => {
  it("dibulatkan ke nol; pengurangan tidak melewati saldo", () => {
    expect(clampXpAdjustment(25.9, 10)).toBe(25);
    expect(clampXpAdjustment(-25.9, 100)).toBe(-25);
    expect(clampXpAdjustment(-500, 90)).toBe(-90);
    expect(clampXpAdjustment(-5, 0)).toBe(-0);
  });
});

describe("sumUnreversedEarnByOrder", () => {
  const row = (reference_id: string, xp_delta: number | string) => ({
    customer_id: "c1",
    member_id: "m1",
    xp_delta,
    outlet_id: null,
    company_id: null,
    branch_id: null,
    reference_id,
  });
  it("menjumlah XP earn per order dan melewati order yang sudah ditarik", () => {
    const result = sumUnreversedEarnByOrder(
      [row("o1", 10), row("o1", "5"), row("o2", 7), row("o3", 3)],
      new Set([voidReverseKey("o2")])
    );
    expect([...result.entries()].map(([id, entry]) => [id, entry.xp])).toEqual([
      ["o1", 15],
      ["o3", 3],
    ]);
  });
});
