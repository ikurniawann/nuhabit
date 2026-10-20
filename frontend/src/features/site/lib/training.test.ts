import { describe, expect, it } from "vitest";
import { classHref, coachHref, findBySlug, pageSlug, withCoachPhotos } from "./training";

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

describe("withCoachPhotos", () => {
  const gym = [
    { name: "Maya Kusuma", photo_url: "/api/files/site/coaches/maya.webp" },
    { name: "Rizky", photo_url: null },
  ];

  it("fills a missing photo from the gym coach of the same name", () => {
    const [maya] = withCoachPhotos([{ name: " maya kusuma", image_url: "" }], gym);
    expect(maya.image_url).toBe("/api/files/site/coaches/maya.webp");
  });

  it("keeps the content photo and leaves unmatched coaches alone", () => {
    const own = { name: "Maya Kusuma", image_url: "https://cdn.example/maya.jpg" };
    const rows = withCoachPhotos([own, { name: "Rizky", image_url: "" }, { name: "Dina", image_url: "" }], gym);
    expect(rows.map((c) => c.image_url)).toEqual(["https://cdn.example/maya.jpg", "", ""]);
  });
});
