import { describe, it, expect } from "vitest";
import { MONTH_NAMES_ID, monthName, monthYearLabel } from "./month-label";

describe("month-label", () => {
  it("maps 1-12 to Indonesian month names", () => {
    expect(MONTH_NAMES_ID).toHaveLength(12);
    expect(monthName(1)).toBe("Januari");
    expect(monthName(12)).toBe("Desember");
  });

  it("returns empty for out-of-range months", () => {
    expect(monthName(0)).toBe("");
    expect(monthName(13)).toBe("");
    expect(monthName(null)).toBe("");
  });

  it("joins month and year", () => {
    expect(monthYearLabel(10, 2026)).toBe("Oktober 2026");
    expect(monthYearLabel(null, 2026)).toBe("2026");
  });
});
