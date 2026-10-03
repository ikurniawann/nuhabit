import { describe, expect, test } from "vitest";
import { badgeThreshold, describeBadgeRule, isBadgeEarned, longestWeeklyStreak, type MemberBadgeStats } from "./badges";

const stats: MemberBadgeStats = { lifetimeXp: 1200, visits: 8, spendIdr: 450_000, streakWeeks: 3 };

describe("isBadgeEarned", () => {
  test("lifetime XP memakai min_lifetime_xp (jalur lama tetap jalan)", () => {
    expect(isBadgeEarned({ metric: "lifetime_xp", min_lifetime_xp: 1000, threshold: null }, stats)).toBe(true);
    expect(isBadgeEarned({ metric: "lifetime_xp", min_lifetime_xp: 1201, threshold: null }, stats)).toBe(false);
  });
  test("metrik order memakai threshold, batas inklusif", () => {
    expect(isBadgeEarned({ metric: "visits", min_lifetime_xp: 0, threshold: 8 }, stats)).toBe(true);
    expect(isBadgeEarned({ metric: "visits", min_lifetime_xp: 0, threshold: 9 }, stats)).toBe(false);
    expect(isBadgeEarned({ metric: "spend_idr", min_lifetime_xp: 0, threshold: "450000.00" }, stats)).toBe(true);
    expect(isBadgeEarned({ metric: "streak_weeks", min_lifetime_xp: 0, threshold: 4 }, stats)).toBe(false);
  });
  test("badge manual tidak pernah diberikan otomatis", () => {
    expect(isBadgeEarned({ metric: "manual", min_lifetime_xp: 0, threshold: null }, stats)).toBe(false);
    expect(badgeThreshold({ metric: "manual", min_lifetime_xp: 0, threshold: null })).toBeNull();
  });
});

describe("longestWeeklyStreak", () => {
  test("rentetan terpanjang, duplikat dan urutan acak aman", () => {
    expect(
      longestWeeklyStreak(["2026-09-14", "2026-08-31", "2026-09-07", "2026-09-07", "2026-09-28", "2026-10-05"])
    ).toBe(3);
  });
  test("minggu yang bolong memutus rentetan", () => {
    expect(longestWeeklyStreak(["2026-09-07", "2026-09-21"])).toBe(1);
  });
  test("tanpa order → 0", () => {
    expect(longestWeeklyStreak([])).toBe(0);
  });
});

describe("describeBadgeRule", () => {
  test("teks ambang per metrik", () => {
    expect(describeBadgeRule({ metric: "visits", min_lifetime_xp: 0, threshold: 10 })).toBe("10 kunjungan");
    expect(describeBadgeRule({ metric: "manual", min_lifetime_xp: 0, threshold: null })).toBe(
      "Diberikan manual oleh admin"
    );
  });
});
