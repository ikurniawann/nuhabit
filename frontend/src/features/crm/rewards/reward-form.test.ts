import { describe, expect, it } from "vitest";
import {
  DEFAULT_REWARD_FORM,
  countPending,
  duplicateRewardForm,
  filterRewards,
  quotaLabel,
  remainingStock,
  rewardFormToPayload,
  rewardToForm,
  summarizeRewards,
} from "./reward-form";
import type { Redemption, Reward } from "./types";

const reward = (patch: Partial<Reward> = {}): Reward => ({
  id: "r1",
  code: "kopi",
  name: "Kopi Gratis",
  reward_type: "voucher",
  min_xp: 500,
  required_tier_id: "t1",
  stock_total: 10,
  stock_redeemed: 3,
  max_redemptions_per_member: 2,
  quota_period: "monthly",
  image_url: null,
  reward_data: {},
  starts_at: null,
  ends_at: null,
  is_active: true,
  created_at: "2026-01-01T00:00:00Z",
  ...patch,
});

describe("reward form", () => {
  it("maps a reward to the form and back to the save payload", () => {
    const form = rewardToForm(reward());
    expect(form).toEqual({
      id: "r1",
      code: "kopi",
      name: "Kopi Gratis",
      reward_type: "voucher",
      min_xp: 500,
      required_tier_id: "t1",
      stock_total: "10",
      stock_redeemed: 3,
      max_redemptions_per_member: "2",
      quota_period: "monthly",
      is_active: true,
    });
    expect(rewardFormToPayload(form)).toMatchObject({
      code: "kopi",
      min_xp: 500,
      required_tier_id: "t1",
      stock_total: 10,
      stock_redeemed: 3,
      max_redemptions_per_member: 2,
      quota_period: "monthly",
      linked_avatar_id: null,
      image_url: null,
      reward_data: {},
    });
  });

  it("treats blank limits as unlimited and clamps the per-member quota to at least 1", () => {
    expect(rewardFormToPayload(DEFAULT_REWARD_FORM)).toMatchObject({
      stock_total: null,
      max_redemptions_per_member: null,
      required_tier_id: null,
    });
    expect(rewardFormToPayload({ ...DEFAULT_REWARD_FORM, max_redemptions_per_member: "0", stock_total: "-4" })).toMatchObject({
      max_redemptions_per_member: 1,
      stock_total: 0,
    });
  });

  it("duplicates as a hidden new draft with zero usage", () => {
    expect(duplicateRewardForm(reward())).toMatchObject({
      id: "",
      code: "kopi-copy",
      name: "Kopi Gratis Copy",
      stock_redeemed: 0,
      is_active: false,
      stock_total: "10",
    });
  });

  it("labels quotas and remaining stock", () => {
    expect(quotaLabel(reward({ max_redemptions_per_member: null }))).toBe("Tanpa batas");
    expect(quotaLabel(reward())).toBe("2x · per bulan");
    expect(remainingStock(reward())).toBe(7);
    expect(remainingStock(reward({ stock_total: null }))).toBeNull();
    expect(remainingStock(reward({ stock_total: 1, stock_redeemed: 5 }))).toBe(0);
  });

  it("filters by code, name, or type and summarises the catalog", () => {
    const list = [reward(), reward({ id: "r2", code: "tumbler", name: "Tumbler", reward_type: "merchandise", is_active: false, stock_total: null })];
    expect(filterRewards(list, " TUMB ").map((r) => r.id)).toEqual(["r2"]);
    expect(filterRewards(list, "voucher").map((r) => r.id)).toEqual(["r1"]);
    expect(filterRewards(list, "")).toBe(list);
    expect(summarizeRewards(list)).toEqual({ active: 1, stock: 10 });
  });

  it("counts pending redemptions", () => {
    const rows = [{ status: "pending" }, { status: "approved" }, { status: "pending" }] as Redemption[];
    expect(countPending(rows)).toBe(2);
  });
});
