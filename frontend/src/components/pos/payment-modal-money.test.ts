import { describe, expect, it } from "vitest";

import { formatIdrInput, parseIdrDigits } from "./idr-input";

describe("formatIdrInput / parseIdrDigits", () => {
  it("formats with id-ID thousand separators", () => {
    expect(formatIdrInput("500000")).toBe("500.000");
    expect(formatIdrInput(95000)).toBe("95.000");
  });

  it("parses formatted or raw digits", () => {
    expect(parseIdrDigits("500.000")).toBe(500000);
    expect(parseIdrDigits("500000")).toBe(500000);
    expect(parseIdrDigits("")).toBe(0);
  });
});
