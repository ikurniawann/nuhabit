import { describe, expect, it } from "vitest";
import { isLowBalance } from "./balance";
import { isPortalLink, linkForNotificationType, parsePortalLink, portalUrl } from "./links";

describe("isLowBalance", () => {
  it("hanya bila 0 < saldo < ambang dan ambang aktif", () => {
    expect(isLowBalance(20_000, 50_000)).toBe(true);
    expect(isLowBalance(50_000, 50_000)).toBe(false);
    expect(isLowBalance(0, 50_000)).toBe(false);
    expect(isLowBalance(20_000, 0)).toBe(false);
    expect(isLowBalance(-5_000, 50_000)).toBe(false);
  });
});

describe("parsePortalLink", () => {
  it("mengenal tab portal dan promo:<kode>", () => {
    expect(parsePortalLink("events")).toEqual({ kind: "tab", tab: "events" });
    expect(parsePortalLink(" promo:kopi-10 ")).toEqual({ kind: "promo", code: "KOPI-10" });
    expect(parsePortalLink("PROMO:HEMAT")).toEqual({ kind: "promo", code: "HEMAT" });
  });

  it("menolak URL luar, tab tak dikenal, dan kode promo tak sah", () => {
    expect(parsePortalLink("https://example.com")).toBeNull();
    expect(parsePortalLink("admin")).toBeNull();
    expect(parsePortalLink("promo:")).toBeNull();
    expect(parsePortalLink("promo:a b")).toBeNull();
    expect(parsePortalLink(null)).toBeNull();
    expect(isPortalLink("coins")).toBe(true);
  });
});

describe("portalUrl & linkForNotificationType", () => {
  it("membangun URL /member?go= hanya untuk tautan sah", () => {
    expect(portalUrl("challenges")).toBe("/member?go=challenges");
    expect(portalUrl("javascript:alert(1)")).toBe("/member");
  });

  it("memetakan jenis notifikasi sistem ke layar portal", () => {
    expect(linkForNotificationType("booking_waitlist")).toBe("events");
    expect(linkForNotificationType("waitlist_promoted")).toBe("events");
    expect(linkForNotificationType("event_cancelled")).toBe("events");
    expect(linkForNotificationType("challenge_completed")).toBe("challenges");
    expect(linkForNotificationType("announcement")).toBeNull();
  });
});

import { badgeTarget } from "./badges";

describe("badgeTarget", () => {
  it("teks syarat mengikuti metrik badge", () => {
    expect(badgeTarget({ metric: "visits", threshold: 10, min_lifetime_xp: 0 })).toEqual({ key: "{n} visits", vars: { n: "10" } });
    expect(badgeTarget({ metric: "spend_idr", threshold: 500_000, min_lifetime_xp: 0 })).toEqual({ key: "Rp {n}", vars: { n: "500.000" } });
    expect(badgeTarget({ metric: "streak_weeks", threshold: 4, min_lifetime_xp: 0 })).toEqual({
      key: "{n}-week streak",
      vars: { n: "4" },
    });
    expect(badgeTarget({ metric: "manual", threshold: null, min_lifetime_xp: 0 })).toEqual({ key: "Given by the team" });
  });

  it("badge XP lama tanpa threshold memakai min_lifetime_xp", () => {
    expect(badgeTarget({ metric: "lifetime_xp", threshold: null, min_lifetime_xp: 1500 })).toEqual({
      key: "{n} XP",
      vars: { n: "1.500" },
    });
    expect(badgeTarget({ metric: undefined, threshold: null, min_lifetime_xp: 200 }).vars).toEqual({ n: "200" });
  });
});
