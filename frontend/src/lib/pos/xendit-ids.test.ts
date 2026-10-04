import { describe, expect, it } from "vitest";
import { sanitizeXenditRef } from "./xendit-ids";

describe("sanitizeXenditRef", () => {
  it("keeps a normal Xendit id", () => {
    expect(sanitizeXenditRef("qr_abc")).toBe("qr_abc");
    expect(sanitizeXenditRef(" pos-1 ")).toBe("pos-1");
  });

  it("drops empty or oversized values", () => {
    expect(sanitizeXenditRef("")).toBeNull();
    expect(sanitizeXenditRef("x".repeat(129))).toBeNull();
  });
});
