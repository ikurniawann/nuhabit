import { describe, expect, it } from "vitest";
import { campaignLabel, listQuery, PAGE_SIZE, type PromoCampaign } from "./api";

describe("referral list query", () => {
  it("leaves empty filters out and pages by offset", () => {
    expect(listQuery("", " ", 0)).toBe(`limit=${PAGE_SIZE}&offset=0`);
    expect(listQuery("held", " budi ", 2)).toBe(`status=held&q=budi&limit=${PAGE_SIZE}&offset=${2 * PAGE_SIZE}`);
  });
});

describe("campaign label", () => {
  const idr = (n: number) => `Rp${n}`;
  const base: PromoCampaign = { id: "c", name: "Teman baru", discount_type: "percent", value: 20, max_discount: null, scope: "gym", is_active: true };

  it("shows the discount and its cap", () => {
    expect(campaignLabel(base, idr)).toBe("Teman baru (diskon 20%)");
    expect(campaignLabel({ ...base, max_discount: 50000 }, idr)).toBe("Teman baru (diskon 20%, maks. Rp50000)");
    expect(campaignLabel({ ...base, discount_type: "fixed", value: 75000, is_active: false }, idr)).toBe("Teman baru (diskon Rp75000) · nonaktif");
  });
});
