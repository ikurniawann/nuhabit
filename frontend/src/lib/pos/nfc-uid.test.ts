import { describe, expect, it } from "vitest";
import { normalizeNfcUid } from "@/lib/pos/nfc-uid";

describe("normalizeNfcUid", () => {
  it("trims, strips separators, and uppercases card ids", () => {
    expect(normalizeNfcUid("  04:a1-b2 c3  ")).toBe("04A1B2C3");
  });

  it("returns an empty string when no alphanumeric characters remain", () => {
    expect(normalizeNfcUid(" :- ")).toBe("");
  });
});
