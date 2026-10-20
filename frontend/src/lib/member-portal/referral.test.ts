import { describe, expect, it } from "vitest";
import { discountLabel, normalizeReferralCode } from "./referral";

describe("referral codes", () => {
  it("normalizes typed codes the way the server does", () => {
    expect(normalizeReferralCode(" nh2k 7qxa ")).toBe("NH2K7QXA");
    expect(normalizeReferralCode("abc")).toBe("");
    expect(normalizeReferralCode("NH-2K7Q")).toBe("");
    expect(normalizeReferralCode(null)).toBe("");
    expect(normalizeReferralCode("A".repeat(17))).toBe("");
  });

  it("labels a discount", () => {
    const idr = (n: number) => `Rp${n}`;
    expect(discountLabel({ type: "percent", value: 20, max_discount: 50_000 }, idr)).toBe("20%");
    expect(discountLabel({ type: "fixed", value: 50_000, max_discount: null }, idr)).toBe("Rp50000");
  });
});
