import { describe, expect, it } from "vitest";
import {
  addOneYear,
  cleanPerks,
  earnedTier,
  evaluateMembership,
  keepTier,
  membershipBenefits,
  type MembershipTier,
  nextTier,
  windowStart,
} from "./membership";

const tier = (id: string, min: number, extra: Partial<MembershipTier> = {}): MembershipTier => ({
  id,
  name: id,
  min_spend: min,
  display_color: null,
  discount_percent: 0,
  early_booking_days: 0,
  cancel_window_hours: null,
  waitlist_priority: false,
  perks: [],
  ...extra,
});

const silver = tier("silver", 3_000_000);
const gold = tier("gold", 10_000_000, { discount_percent: 10, early_booking_days: 2, cancel_window_hours: 6, waitlist_priority: true });
const black = tier("black", 25_000_000);
const tiers = [gold, black, silver];
const today = "2026-10-22";

describe("evaluateMembership", () => {
  it("tanpa tier apa pun → tanpa tier", () => {
    expect(evaluateMembership([], 50_000_000, null, today)).toEqual({ tier: null, valid_until: null, change: null });
  });

  it("di bawah ambang terendah → tanpa tier", () => {
    expect(evaluateMembership(tiers, 2_999_999, null, today).tier).toBeNull();
  });

  it("naik langsung saat ambang tercapai, berlaku 12 bulan", () => {
    const r = evaluateMembership(tiers, 10_000_000, { tier_id: "silver", valid_until: "2027-01-01" }, today);
    expect(r.tier?.id).toBe("gold");
    expect(r.valid_until).toBe("2027-10-22");
    expect(r.change).toMatchObject({ direction: "up", from: { id: "silver" }, to: { id: "gold" } });
  });

  it("member baru langsung ke tier sesuai spending (lompat tier)", () => {
    const r = evaluateMembership(tiers, 30_000_000, null, today);
    expect(r.tier?.id).toBe("black");
    expect(r.change?.direction).toBe("up");
  });

  it("masih memenuhi ambang → masa berlaku diperpanjang, tanpa perubahan", () => {
    const r = evaluateMembership(tiers, 12_000_000, { tier_id: "gold", valid_until: "2027-01-01" }, today);
    expect(r).toMatchObject({ tier: { id: "gold" }, valid_until: "2027-10-22", change: null });
  });

  it("spending turun tapi masa berlaku belum habis → tier bertahan", () => {
    const r = evaluateMembership(tiers, 1_000_000, { tier_id: "gold", valid_until: today }, today);
    expect(r).toMatchObject({ tier: { id: "gold" }, valid_until: today, change: null });
  });

  it("masa berlaku habis → turun ke tier sesuai spending", () => {
    const r = evaluateMembership(tiers, 4_000_000, { tier_id: "gold", valid_until: "2026-10-21" }, today);
    expect(r.tier?.id).toBe("silver");
    expect(r.valid_until).toBe("2027-10-22");
    expect(r.change).toMatchObject({ direction: "down", from: { id: "gold" }, to: { id: "silver" } });
  });

  it("masa berlaku habis & di bawah semua ambang → tanpa tier", () => {
    const r = evaluateMembership(tiers, 0, { tier_id: "silver", valid_until: "2026-01-01" }, today);
    expect(r).toMatchObject({ tier: null, valid_until: null, change: { direction: "down", to: null } });
  });

  it("tier tersimpan sudah dihapus → dievaluasi ulang dari spending", () => {
    const r = evaluateMembership(tiers, 4_000_000, { tier_id: "deleted", valid_until: "2027-06-01" }, today);
    expect(r.tier?.id).toBe("silver");
    expect(r.change).toMatchObject({ direction: "up", from: null });
  });
});

describe("helper", () => {
  it("earnedTier tepat di ambang", () => {
    expect(earnedTier(tiers, 25_000_000)?.id).toBe("black");
  });

  it("nextTier & sisa spending", () => {
    expect(nextTier(tiers, silver, 4_000_000)).toEqual({ tier: gold, spend_needed: 6_000_000 });
    expect(nextTier(tiers, null, 0)).toEqual({ tier: silver, spend_needed: 3_000_000 });
    expect(nextTier(tiers, black, 30_000_000)).toBeNull();
  });

  it("keepTier hanya saat spending di bawah ambang tier saat ini", () => {
    expect(keepTier(gold, 12_000_000, "2027-10-22")).toBeNull();
    expect(keepTier(gold, 7_500_000, "2027-03-01")).toEqual({ spend_needed: 2_500_000, by: "2027-03-01" });
  });

  it("benefit dibekukan untuk member diblokir", () => {
    expect(membershipBenefits(gold, false)).toEqual({ early_booking_days: 2, cancel_window_hours: 6, waitlist_priority: true, discount_percent: 10 });
    expect(membershipBenefits(gold, true)).toEqual({ early_booking_days: 0, cancel_window_hours: null, waitlist_priority: false, discount_percent: 0 });
    expect(membershipBenefits(null, false).discount_percent).toBe(0);
  });

  it("tanggal: 29 Feb + 1 tahun & awal jendela 365 hari", () => {
    expect(addOneYear("2028-02-29")).toBe("2029-03-01");
    expect(windowStart("2026-10-22")).toBe("2025-10-23");
  });

  it("cleanPerks merapikan input", () => {
    expect(cleanPerks(["  Guest pass 1x/bulan ", "", "guest pass 1x/bulan", "Merch  eksklusif"])).toEqual(["Guest pass 1x/bulan", "Merch eksklusif"]);
  });
});
