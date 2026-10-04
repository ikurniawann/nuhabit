import { describe, expect, it } from "vitest";
import { todayWib } from "./dates";

describe("todayWib", () => {
  it("memakai kalender WIB, bukan UTC", () => {
    expect(todayWib(new Date("2026-10-03T17:30:00Z"))).toBe("2026-10-04");
    expect(todayWib(new Date("2026-10-03T16:59:00Z"))).toBe("2026-10-03");
  });
});
