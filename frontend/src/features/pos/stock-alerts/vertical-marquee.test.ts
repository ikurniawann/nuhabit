import { describe, expect, it } from "vitest";
import { shouldAnimateVerticalMarquee } from "./vertical-marquee";

describe("shouldAnimateVerticalMarquee", () => {
  it("is false when content fits in the viewport", () => {
    expect(shouldAnimateVerticalMarquee(400, 500)).toBe(false);
  });

  it("is false when content height equals viewport", () => {
    expect(shouldAnimateVerticalMarquee(500, 500)).toBe(false);
  });

  it("is true when content overflows the viewport", () => {
    expect(shouldAnimateVerticalMarquee(800, 500)).toBe(true);
  });
});
