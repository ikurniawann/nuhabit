import { describe, expect, it } from "vitest";
import { formatOrderElapsed } from "./order-elapsed";

describe("formatOrderElapsed", () => {
  const now = Date.parse("2026-07-12T12:00:00.000Z");

  it("returns minutes under one hour", () => {
    expect(formatOrderElapsed("2026-07-12T11:45:00.000Z", now)).toBe("15 min");
  });

  it("returns hours and minutes", () => {
    expect(formatOrderElapsed("2026-07-12T10:20:00.000Z", now)).toBe("1h 40m");
  });

  it("returns dash for missing values", () => {
    expect(formatOrderElapsed(undefined, now)).toBe("-");
  });
});
