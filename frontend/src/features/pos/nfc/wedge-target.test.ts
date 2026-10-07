import { describe, expect, it } from "vitest";
import { shouldIgnoreWedgeKeydown } from "./wedge-target";

describe("shouldIgnoreWedgeKeydown", () => {
  it("ignores plain input targets (product search)", () => {
    const input = document.createElement("input");
    expect(shouldIgnoreWedgeKeydown(input)).toBe(true);
  });

  it("ignores textarea and select", () => {
    expect(shouldIgnoreWedgeKeydown(document.createElement("textarea"))).toBe(
      true
    );
    expect(shouldIgnoreWedgeKeydown(document.createElement("select"))).toBe(
      true
    );
  });

  it("does not ignore body / non-editable targets", () => {
    expect(shouldIgnoreWedgeKeydown(document.body)).toBe(false);
    expect(shouldIgnoreWedgeKeydown(document.createElement("div"))).toBe(false);
  });

  it("allows opt-in via data-pos-nfc-wedge=allow", () => {
    const input = document.createElement("input");
    input.setAttribute("data-pos-nfc-wedge", "allow");
    expect(shouldIgnoreWedgeKeydown(input)).toBe(false);
  });

  it("allows opt-in on a parent wrapper", () => {
    const wrap = document.createElement("div");
    wrap.setAttribute("data-pos-nfc-wedge", "allow");
    const input = document.createElement("input");
    wrap.appendChild(input);
    expect(shouldIgnoreWedgeKeydown(input)).toBe(false);
  });
});
