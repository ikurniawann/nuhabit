import { describe, expect, it } from "vitest";
import { todayIso } from "./ui-dates";

describe("ui-dates", () => {
  it("todayIso memakai WIB", () => {
    expect(todayIso(new Date("2026-10-03T18:00:00Z"))).toBe("2026-10-04");
    expect(todayIso(new Date("2026-10-03T16:59:00Z"))).toBe("2026-10-03");
  });
});
