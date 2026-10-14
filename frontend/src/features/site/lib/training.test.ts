import { describe, expect, it } from "vitest";
import { classHref, coachHref, findBySlug, pageSlug } from "./training";

describe("pageSlug", () => {
  it("uses the stored slug and falls back to the name", () => {
    expect(pageSlug({ name: "Race Sim", slug: "" })).toBe("race-sim");
    expect(pageSlug({ name: "Race Sim", slug: "race-simulation" })).toBe("race-simulation");
    expect(pageSlug({ name: "  Engine & Pace " })).toBe("engine-pace");
    expect(classHref({ name: "Station" })).toBe("/training/classes/station");
    expect(coachHref({ name: "Maya Kusuma" })).toBe("/training/coaches/maya-kusuma");
  });

  it("finds an item and its index by slug", () => {
    const items = [{ name: "SkiErg" }, { name: "Sled Push", slug: "push" }];
    expect(findBySlug(items, "push")).toEqual({ item: items[1], index: 1 });
    expect(findBySlug(items, "nope")).toEqual({ item: undefined, index: -1 });
  });
});
