import { describe, expect, it } from "vitest";
import { PORTAL_TABS } from "@/lib/member-portal/links";
import { goLinkHref } from "./go-link";

describe("goLinkHref", () => {
  it.each([
    ["classes", "/member/classes"],
    ["my-classes", "/member/my-classes"],
    ["credits", "/member/wallet"],
    ["workout", "/member/workout"],
    ["races", "/member/races"],
    ["coaches", "/member/trainers"],
    ["profile", "/member/profile"],
    ["coins", "/member/coins"],
    ["topup", "/member/coins/topup"],
    ["history", "/member/orders"],
    ["events", "/member/events"],
    ["challenges", "/member/challenges"],
    ["promos", "/member/promos"],
    ["rewards", "/member/rewards"],
    ["badges", "/member/badges"],
    ["collection", "/member/collection"],
    ["reviews", "/member/reviews"],
  ])("maps the %s tab to its app route", (go, href) => {
    expect(goLinkHref(go)).toBe(href);
  });

  it("gives every portal tab except home a route outside the old portal", () => {
    for (const tab of PORTAL_TABS.filter((tab) => tab !== "home")) {
      const href = goLinkHref(tab);
      expect(href, tab).toMatch(/^\/member\/[a-z-]+(\/[a-z-]+)?$/);
      expect(href, tab).not.toMatch(/^\/member\/(v1|classic|nox)\b/);
    }
  });

  it("opens a promo code on the promo detail page, upper-cased", () => {
    expect(goLinkHref("promo:kopi10")).toBe("/member/promos/KOPI10");
  });

  it.each([null, undefined, "", "home", "https://evil.example", "promo:x", "unknown"])("stays on home for %s", (go) => {
    expect(goLinkHref(go)).toBeNull();
  });
});
