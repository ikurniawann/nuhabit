import { describe, expect, it } from "vitest";
import {
  blockerMessage,
  entitlementQuota,
  evaluateCollectibleGate,
  parseIntervalXp,
  remainingEntitlements,
} from "./collectibles";

describe("entitlementQuota", () => {
  it("floor kelipatan interval", () => {
    expect(entitlementQuota(50_000, 5_000)).toBe(10);
    expect(entitlementQuota(4_999, 5_000)).toBe(0);
    expect(entitlementQuota(5_000, 5_000)).toBe(1);
  });

  it("interval tidak valid → 0 (bukan Infinity/NaN)", () => {
    expect(entitlementQuota(50_000, 0)).toBe(0);
    expect(entitlementQuota(50_000, -5)).toBe(0);
    expect(entitlementQuota(NaN, 5_000)).toBe(0);
  });
});

describe("remainingEntitlements", () => {
  it("kuota dikurangi terpakai", () => {
    expect(remainingEntitlements(50_000, 5_000, 3)).toBe(7);
  });

  it("koreksi XP turun dijepit ke 0 — artwork tidak ditarik", () => {
    // Dulu XP 50rb (10 jatah), 8 terpakai, lalu admin koreksi XP jadi 20rb.
    expect(remainingEntitlements(20_000, 5_000, 8)).toBe(0);
  });

  it("menurunkan interval langsung menambah jatah tanpa migrasi", () => {
    expect(remainingEntitlements(50_000, 5_000, 3)).toBe(7);
    expect(remainingEntitlements(50_000, 2_500, 3)).toBe(17);
  });

  it("used tak valid dianggap 0", () => {
    expect(remainingEntitlements(10_000, 5_000, NaN)).toBe(2);
    expect(remainingEntitlements(10_000, 5_000, -2)).toBe(2);
  });
});

describe("evaluateCollectibleGate", () => {
  const base = { isActive: true };

  it("lolos semua syarat", () => {
    expect(
      evaluateCollectibleGate(10_000, { ...base, minLifetimeXp: 5_000, requiredTierRank: 1, memberTierRank: 2 })
    ).toEqual({ allowed: true, blocker: null });
  });

  it("nonaktif / belum rilis / berakhir / stok habis", () => {
    const now = new Date("2026-07-25T10:00:00+07:00");
    expect(evaluateCollectibleGate(10_000, { isActive: false }, now).blocker).toBe("inactive");
    expect(
      evaluateCollectibleGate(10_000, { ...base, startsAt: "2026-08-01T00:00:00Z" }, now).blocker
    ).toBe("not_started");
    expect(
      evaluateCollectibleGate(10_000, { ...base, endsAt: "2026-07-01T00:00:00Z" }, now).blocker
    ).toBe("ended");
    expect(evaluateCollectibleGate(10_000, { ...base, stockRemaining: 0 }, now).blocker).toBe("out_of_stock");
  });

  it("ambang XP artwork ditegakkan (jatah boleh dipakai KE BAWAH, bukan ke atas)", () => {
    expect(evaluateCollectibleGate(4_000, { ...base, minLifetimeXp: 5_000 }).blocker).toBe("below_min_xp");
    // Artwork lama berambang rendah tetap boleh — arah ke bawah.
    expect(evaluateCollectibleGate(50_000, { ...base, minLifetimeXp: 1_000 }).allowed).toBe(true);
  });

  it("tier minimal ditegakkan; tanpa tier member = tidak layak", () => {
    expect(
      evaluateCollectibleGate(10_000, { ...base, requiredTierRank: 2, memberTierRank: 1 }).blocker
    ).toBe("below_tier");
    expect(
      evaluateCollectibleGate(10_000, { ...base, requiredTierRank: 2, memberTierRank: null }).blocker
    ).toBe("below_tier");
  });
});

describe("blockerMessage & parseIntervalXp", () => {
  it("pesan kurang XP menghitung selisih", () => {
    expect(blockerMessage("below_min_xp", { totalXp: 3_500, minXp: 5_000 })).toBe("Kurang 1.500 XP lagi");
  });

  it("interval dari settings string; rusak → default 5000", () => {
    expect(parseIntervalXp("2500")).toBe(2_500);
    expect(parseIntervalXp("abc")).toBe(5_000);
    expect(parseIntervalXp("0")).toBe(5_000);
  });
});
