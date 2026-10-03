import { describe, expect, it } from "vitest";
import { goLinkHref } from "./go-link";

describe("goLinkHref", () => {
  it.each([
    ["classes", "/member/classes"],
    ["my-classes", "/member/my-classes"],
    ["credits", "/member/wallet"],
    ["topup", "/member/wallet/topup"],
    ["workout", "/member/workout"],
    ["races", "/member/races"],
    ["coaches", "/member/trainers"],
    ["profile", "/member/profile"],
    ["history", "/member/visits"],
  ])("maps the %s tab to its app route", (go, href) => {
    expect(goLinkHref(go)).toBe(href);
  });

  it("opens a promo code on the promo detail page, upper-cased", () => {
    expect(goLinkHref("promo:kopi10")).toBe("/member/promos/KOPI10");
  });

  it.each(["events", "challenges", "rewards", "badges", "collection", "reviews", "coins", "promos"])(
    "sends the legacy %s tab to the old portal",
    (go) => {
      expect(goLinkHref(go)).toBe(`/member/v1?go=${go}`);
    }
  );

  it.each([null, undefined, "", "home", "https://evil.example", "promo:x", "unknown"])(
    "stays on home for %s",
    (go) => {
      expect(goLinkHref(go)).toBeNull();
    }
  );
});
