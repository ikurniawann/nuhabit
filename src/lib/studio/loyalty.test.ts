import { describe, expect, it } from "vitest";
import {
  applyBookingBenefits,
  consecutiveStreakWeeks,
  isoWeekStart,
  isOffpeak,
  leaderboardAlias,
  parseBenefits,
  resolveTier,
  ruleXp,
  type Tier,
} from "./loyalty";

const tier = (code: string, name: string, rank: number, min: number, meta: Record<string, unknown>): Tier => ({
  id: code, code, name, rank, min_lifetime_xp: min, discount_percent: 0, display_color: null, benefits: parseBenefits(meta),
});
const TIERS = [
  tier("regular", "Starter", 1, 0, {}),
  tier("bronze", "Open", 2, 1000, { early_booking_days: 1 }),
  tier("silver", "Pro", 3, 3000, { early_booking_days: 2, waitlist_priority: true }),
  tier("gold", "Elite", 4, 7500, { early_booking_days: 3, cancel_window_hours: 6, waitlist_priority: true }),
];

describe("tier seumur hidup", () => {
  it("naik sesuai XP lifetime dan menghitung XP menuju tier berikutnya", () => {
    expect(resolveTier(TIERS, 0, "active").tier?.name).toBe("Starter");
    const r = resolveTier(TIERS, 3200, "active");
    expect(r.tier?.name).toBe("Pro");
    expect(r.next?.tier.name).toBe("Elite");
    expect(r.next?.xp_needed).toBe(4300);
    expect(resolveTier(TIERS, 9000, "active").next).toBeNull();
  });

  it("diblokir/banned → tier dasar tanpa benefit (pulih bila status aktif lagi)", () => {
    const blocked = resolveTier(TIERS, 9000, "suspended");
    expect(blocked.tier?.name).toBe("Starter");
    expect(blocked.earnedTier?.name).toBe("Elite");
    expect(blocked.frozen).toBe(true);
    expect(blocked.benefits.early_booking_days).toBe(0);
    expect(resolveTier(TIERS, 9000, "banned").benefits.waitlist_priority).toBe(false);
  });
});

describe("benefit booking", () => {
  const base = { booking_open_days: 7, cancel_window_hours: 12, waitlist_enabled: true };
  it("booking lebih awal & batas batal hanya bila lebih longgar", () => {
    expect(applyBookingBenefits(base, TIERS[3].benefits)).toEqual({ booking_open_days: 10, cancel_window_hours: 6, waitlist_enabled: true });
    expect(applyBookingBenefits({ ...base, cancel_window_hours: 4 }, TIERS[3].benefits).cancel_window_hours).toBe(4);
    expect(applyBookingBenefits(base, TIERS[0].benefits)).toEqual(base);
  });
});

describe("streak & XP", () => {
  it("minggu ISO dimulai Senin", () => {
    expect(isoWeekStart("2026-10-04")).toBe("2026-09-28"); // Minggu
    expect(isoWeekStart("2026-09-28")).toBe("2026-09-28");
  });

  it("menghitung minggu berturut-turut dengan minimal sesi", () => {
    const days = ["2026-09-08", "2026-09-09", "2026-09-10", "2026-09-15", "2026-09-16", "2026-09-18", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-29", "2026-09-30", "2026-10-01"];
    expect(consecutiveStreakWeeks(days, "2026-09-28", 3)).toBe(4);
    expect(consecutiveStreakWeeks(days.slice(0, 5), "2026-09-14", 3)).toBe(0);
    expect(consecutiveStreakWeeks(days, "2026-10-05", 3)).toBe(0);
  });

  it("jam sepi, XP per aturan, alias leaderboard", () => {
    expect(isOffpeak("10:00:00", { start: "10:00", end: "16:00" })).toBe(true);
    expect(isOffpeak("16:00", { start: "10:00", end: "16:00" })).toBe(false);
    expect(isOffpeak("12:00", {})).toBe(false);
    expect(ruleXp({ xp_mode: "fixed", xp_value: 50, amount_step: 1 })).toBe(50);
    expect(ruleXp({ xp_mode: "per_amount", xp_value: 1, amount_step: 10000 }, 755000)).toBe(75);
    expect(leaderboardAlias("Maya Kartika Sari")).toBe("Maya K.");
    expect(leaderboardAlias("Ilham")).toBe("Ilham");
    expect(leaderboardAlias("")).toBe("Atlet");
  });
});
