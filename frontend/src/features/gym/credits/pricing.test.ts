import { describe, expect, it } from "vitest";
import type { CreditPackage } from "./api";
import { priceAt, sellablePackages } from "./pricing";

const pkg = (over: Partial<CreditPackage>): CreditPackage => ({
  id: "p",
  name: "10 Visit",
  description: "",
  kind: "credits",
  credits: 10,
  price_idr: 800_000,
  validity_days: 60,
  purchase_limit_per_member: null,
  applicable_class_type_ids: null,
  branch_id: null,
  branch_name: null,
  is_public: true,
  badge: null,
  branch_prices: [],
  status: "active",
  sort_order: 0,
  sold_count: 0,
  referenced: false,
  ...over,
});

describe("sellablePackages", () => {
  const everywhere = pkg({ id: "all" });
  const kemang = pkg({ id: "kemang", branch_id: "k" });
  const archived = pkg({ id: "old", status: "archived" });

  it("keeps packages for every branch and for the chosen one", () => {
    expect(sellablePackages([everywhere, kemang, archived], "k").map((p) => p.id)).toEqual(["all", "kemang"]);
  });

  it("hides packages restricted to another branch", () => {
    expect(sellablePackages([everywhere, kemang], "s").map((p) => p.id)).toEqual(["all"]);
  });

  it("hides branch packages when no branch is chosen", () => {
    expect(sellablePackages([everywhere, kemang], "").map((p) => p.id)).toEqual(["all"]);
  });
});

describe("priceAt", () => {
  const priced = pkg({ branch_prices: [{ branch_id: "k", price_idr: 700_000 }] });

  it("uses the branch price", () => {
    expect(priceAt(priced, "k")).toBe(700_000);
  });

  it("falls back to the base price", () => {
    expect(priceAt(priced, "s")).toBe(800_000);
    expect(priceAt(priced, "")).toBe(800_000);
  });
});
