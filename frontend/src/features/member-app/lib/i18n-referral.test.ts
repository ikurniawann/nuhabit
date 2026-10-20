import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { refereeRewards, referrerRewards } from "../referral/referral-page";
import { fill, ID } from "./i18n";
import { FRIEND_STATUS, referralLink, type ReferralView } from "./queries-referral";

const placeholders = (text: string) =>
  [...text.matchAll(/\{(\w+)\}/g)]
    .map((m) => m[1])
    .sort()
    .join();

const view = (program: Partial<ReferralView["program"]>): ReferralView => ({
  code: "NH2K7QXA",
  program: { active: true, referrer_credits: 0, referrer_ark_idr: 0, referee_credits: 0, referee_discount: null, hold_days: 7, ...program },
  stats: { invited: 0, joined: 0, rewarded: 0 },
  friends: [],
  welcome: null,
});

const tId = (key: string, vars?: Record<string, string | number>) => fill(ID[key] ?? key, vars ?? {});

describe("referral screen dictionary", () => {
  const keys = new Set<string>();
  for (const file of ["../referral/referral-page.tsx", "../auth/register-page.tsx"]) {
    const source = readFileSync(path.resolve(__dirname, file), "utf8");
    for (const match of source.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)) keys.add(match[1]);
  }
  const all = [...keys, ...Object.values(FRIEND_STATUS)];

  it("translates every key with the same placeholders", () => {
    expect(all.filter((key) => !(key in ID))).toEqual([]);
    expect(all.filter((key) => key in ID && placeholders(ID[key]) !== placeholders(key))).toEqual([]);
  });
});

describe("referral rewards", () => {
  it("lists what each side gets", () => {
    const full = view({
      referrer_credits: 2,
      referrer_ark_idr: 50_000,
      referee_credits: 1,
      referee_discount: { type: "percent", value: 20, max_discount: null },
    });
    expect(referrerRewards(full, tId)).toEqual(["2 kredit kelas bonus", expect.stringMatching(/^Rp\s?50\.000 dalam ARK Coin$/)]);
    expect(refereeRewards(full, tId)).toEqual(["Diskon 20% untuk paket pertamanya", "1 kredit kelas bonus"]);
    expect(referrerRewards(view({}), tId)).toEqual([]);
  });

  it("links to the member sign-up with the code", () => {
    expect(referralLink("https://nuhabit.id", "NH2K7QXA")).toBe("https://nuhabit.id/member/auth/register?ref=NH2K7QXA");
  });
});
