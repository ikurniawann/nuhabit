import { describe, expect, it } from "vitest";
import { getHelpText } from "./help-content";

describe("getHelpText", () => {
  it("returns role-specific text when available", () => {
    expect(getHelpText("pos.void", "supervisor")).toMatch(/PIN/i);
  });
  it("falls back to default text when role has no override", () => {
    expect(getHelpText("pos.void", "kasir")).toBe(
      getHelpText("pos.void", "default")
    );
  });
  it("returns null for unknown helpId", () => {
    expect(getHelpText("nope.nope", "default")).toBeNull();
  });
});
