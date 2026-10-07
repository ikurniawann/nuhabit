import { describe, expect, it } from "vitest";
import type { PublicPlan } from "../types";
import { creditsLabel, groupPlans, joinHref, validityLabel } from "./plans";

const plan = (over: Partial<PublicPlan>): PublicPlan => ({
  id: "p1",
  name: "Paket",
  kind: "credits",
  description: "",
  credits: 5,
  validity_days: 60,
  price_idr: 800000,
  badge: null,
  sort_order: 0,
  ...over,
});

describe("groupPlans", () => {
  it("puts passes before credit packs and drops empty groups", () => {
    const groups = groupPlans([plan({ id: "c" }), plan({ id: "p", kind: "pass", credits: 0, validity_days: 28 })]);
    expect(groups.map((g) => [g.label, g.plans.map((p) => p.id)])).toEqual([
      ["Passes", ["p"]],
      ["Credit Packs", ["c"]],
    ]);
    expect(groupPlans([plan({})]).map((g) => g.kind)).toEqual(["credits"]);
    expect(groupPlans([])).toEqual([]);
  });
});

describe("labels", () => {
  it("names validity in days, weeks or months", () => {
    expect(validityLabel(1)).toBe("1 day");
    expect(validityLabel(7)).toBe("7 days");
    expect(validityLabel(14)).toBe("14 days");
    expect(validityLabel(28)).toBe("4 weeks");
    expect(validityLabel(56)).toBe("8 weeks");
    expect(validityLabel(60)).toBe("60 days");
    expect(validityLabel(182)).toBe("6 months");
  });

  it("describes what the plan grants", () => {
    expect(creditsLabel({ kind: "pass", credits: 0 })).toBe("Unlimited class bookings");
    expect(creditsLabel({ kind: "credits", credits: 10 })).toBe("10 class credits");
    expect(creditsLabel({ kind: "credits", credits: 1 })).toBe("1 class credit");
  });

  it("links to the checkout with the branch when known", () => {
    expect(joinHref("abc", "sulu-bandung")).toBe("/join?plan=abc&branch=sulu-bandung");
    expect(joinHref("abc", null)).toBe("/join?plan=abc");
  });
});
