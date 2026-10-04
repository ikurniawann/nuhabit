import { describe, expect, it } from "vitest";
import { tenureDays } from "./onboarding-view";

describe("tenureDays", () => {
  const now = new Date("2026-10-04T10:00:00Z");

  it("counts whole days since joining", () => {
    expect(tenureDays("2026-10-01", now)).toBe(3);
    expect(tenureDays("2025-10-04", now)).toBe(365);
  });

  it("returns 0 on the join day", () => {
    expect(tenureDays("2026-10-04", now)).toBe(0);
  });

  it("is negative for a future join date", () => {
    expect(tenureDays("2026-10-10", now)).toBe(-6);
  });
});
