import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { XP_SOURCE } from "../loyalty/progress-page";
import { ID } from "./i18n";
import { PROGRESS_ID } from "./i18n-progress";
import { spendProgressPct, tierPerkKeys, type MembershipTier } from "./queries-progress";

const placeholders = (text: string) =>
  [...text.matchAll(/\{(\w+)\}/g)]
    .map((m) => m[1])
    .sort()
    .join();

const tier = (min: number, extra: Partial<MembershipTier> = {}): MembershipTier => ({
  id: String(min),
  name: `T${min}`,
  color: null,
  min_spend_idr: min,
  discount_percent: 0,
  early_booking_days: 0,
  cancel_window_hours: null,
  waitlist_priority: false,
  perks: [],
  ...extra,
});

describe("membership and progress screens dictionary", () => {
  const keys = new Set<string>();
  for (const file of ["../loyalty/membership-page.tsx", "../loyalty/progress-page.tsx"]) {
    const source = readFileSync(path.resolve(__dirname, file), "utf8");
    for (const match of source.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)) keys.add(match[1]);
  }
  const perks = tierPerkKeys({ discount_percent: 5, early_booking_days: 1, cancel_window_hours: 2, waitlist_priority: true }).map((p) => p.key);

  it("translates every key the screens use", () => {
    expect(keys.size).toBeGreaterThan(30);
    expect([...keys, ...perks, ...Object.values(XP_SOURCE)].filter((key) => !(key in ID))).toEqual([]);
  });

  it("keeps placeholders identical between key and translation", () => {
    expect(Object.entries(PROGRESS_ID).filter(([en, id]) => placeholders(en) !== placeholders(id))).toEqual([]);
  });
});

describe("membership card helpers", () => {
  it("lists only the perks a tier applies", () => {
    expect(tierPerkKeys(tier(0)).length).toBe(0);
    expect(tierPerkKeys(tier(0, { cancel_window_hours: 0 })).map((p) => p.vars)).toEqual([{ n: 0 }]);
  });

  it("measures the way from the current tier to the next", () => {
    const spend = (total: number) => ({ total_idr: total, gym_idr: 0, pos_idr: 0, shop_idr: 0, from: "", to: "" });
    expect(spendProgressPct({ tier: tier(1_000_000), next: { tier: tier(5_000_000), spend_needed_idr: 2_000_000 }, spend: spend(3_000_000) })).toBe(50);
    expect(spendProgressPct({ tier: null, next: { tier: tier(1_000_000), spend_needed_idr: 750_000 }, spend: spend(250_000) })).toBe(25);
    expect(spendProgressPct({ tier: tier(5_000_000), next: null, spend: spend(9_000_000) })).toBe(100);
  });
});
