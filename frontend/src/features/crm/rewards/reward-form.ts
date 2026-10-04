import { QUOTA_PERIOD_LABELS } from "@/lib/crm/rewards";
import type { Redemption, RedemptionStatus, Reward, RewardForm, SaveRewardPayload } from "./types";

export const DEFAULT_REWARD_FORM: RewardForm = {
  id: "",
  code: "",
  name: "",
  reward_type: "discount",
  min_xp: 0,
  required_tier_id: "",
  stock_total: "",
  stock_redeemed: 0,
  max_redemptions_per_member: "",
  quota_period: "total",
  is_active: true,
};

export const REWARD_TYPE_LABELS: Record<Reward["reward_type"], string> = {
  discount: "Discount",
  merchandise: "Merchandise",
  avatar: "Avatar",
  voucher: "Voucher",
  ark_coin: "ARK Coin",
  custom: "Custom",
};

/** Jenis yang bisa dipilih admin (avatar dikelola di halaman Avatar). */
export const SELECTABLE_REWARD_TYPES: Reward["reward_type"][] = ["discount", "merchandise", "voucher", "ark_coin", "custom"];

export const REDEMPTION_STATUS_LABELS: Record<RedemptionStatus, string> = {
  pending: "Menunggu",
  approved: "Disetujui",
  fulfilled: "Diserahkan",
  cancelled: "Dibatalkan",
  expired: "Kedaluwarsa",
};

export const REDEMPTION_STATUS_STYLES: Record<RedemptionStatus, string> = {
  pending: "bg-amber-50 text-amber-700 border-amber-200",
  approved: "bg-sky-50 text-sky-700 border-sky-200",
  fulfilled: "bg-emerald-50 text-emerald-700 border-emerald-200",
  cancelled: "bg-slate-100 text-slate-500 border-slate-200",
  expired: "bg-slate-100 text-slate-500 border-slate-200",
};

export type RedemptionAction = "approve" | "fulfill" | "cancel";

export const REDEMPTION_ACTION_VERBS: Record<RedemptionAction, string> = {
  approve: "disetujui",
  fulfill: "diserahkan",
  cancel: "dibatalkan",
};

export function quotaLabel(reward: Pick<Reward, "max_redemptions_per_member" | "quota_period">): string {
  if (reward.max_redemptions_per_member == null) return "Tanpa batas";
  const period = QUOTA_PERIOD_LABELS[reward.quota_period] ?? "Total";
  return `${reward.max_redemptions_per_member}x · ${period.toLowerCase()}`;
}

/** Sisa stok; null = stok bebas. */
export function remainingStock(reward: Pick<Reward, "stock_total" | "stock_redeemed">): number | null {
  return reward.stock_total == null ? null : Math.max(0, reward.stock_total - reward.stock_redeemed);
}

export function rewardToForm(reward: Reward): RewardForm {
  return {
    id: reward.id,
    code: reward.code,
    name: reward.name,
    reward_type: reward.reward_type,
    min_xp: reward.min_xp,
    required_tier_id: reward.required_tier_id ?? "",
    stock_total: reward.stock_total == null ? "" : String(reward.stock_total),
    stock_redeemed: Number(reward.stock_redeemed ?? 0),
    max_redemptions_per_member:
      reward.max_redemptions_per_member == null ? "" : String(reward.max_redemptions_per_member),
    quota_period: reward.quota_period ?? "total",
    is_active: reward.is_active,
  };
}

/** Salinan reward sebagai draf baru: kode/nama ditandai, stok terpakai nol, disembunyikan. */
export function duplicateRewardForm(reward: Reward): RewardForm {
  return {
    ...rewardToForm(reward),
    id: "",
    code: `${reward.code}-copy`,
    name: `${reward.name} Copy`,
    stock_redeemed: 0,
    is_active: false,
  };
}

export function rewardFormToPayload(form: RewardForm): SaveRewardPayload {
  return {
    code: form.code,
    name: form.name,
    reward_type: form.reward_type,
    min_xp: Math.max(0, Number(form.min_xp) || 0),
    required_tier_id: form.required_tier_id || null,
    linked_avatar_id: null,
    stock_total: form.stock_total === "" ? null : Math.max(0, Number(form.stock_total) || 0),
    stock_redeemed: Math.max(0, Number(form.stock_redeemed) || 0),
    max_redemptions_per_member:
      form.max_redemptions_per_member === "" ? null : Math.max(1, Number(form.max_redemptions_per_member) || 1),
    quota_period: form.quota_period,
    image_url: null,
    reward_data: {},
    starts_at: null,
    ends_at: null,
    is_active: form.is_active,
  };
}

export function filterRewards(rewards: Reward[], search: string): Reward[] {
  const term = search.trim().toLowerCase();
  if (!term) return rewards;
  return rewards.filter((reward) => `${reward.code} ${reward.name} ${reward.reward_type}`.toLowerCase().includes(term));
}

export function summarizeRewards(rewards: Reward[]): { active: number; stock: number } {
  return {
    active: rewards.filter((reward) => reward.is_active).length,
    stock: rewards.reduce((sum, reward) => sum + (reward.stock_total ?? 0), 0),
  };
}

export function countPending(redemptions: Redemption[]): number {
  return redemptions.filter((item) => item.status === "pending").length;
}
