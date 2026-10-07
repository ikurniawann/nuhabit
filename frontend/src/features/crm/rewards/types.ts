import type { QuotaPeriod } from "@/lib/crm/rewards";

export type { QuotaPeriod };

export type Tier = {
  id: string;
  code: string;
  name: string;
  rank: number;
};

export type Reward = {
  id: string;
  code: string;
  name: string;
  reward_type: "discount" | "merchandise" | "avatar" | "voucher" | "ark_coin" | "custom";
  /** Syarat minimum lifetime XP. TIDAK dipotong saat redeem (EPIC-011 Fase F). */
  min_xp: number;
  required_tier_id: string | null;
  required_tier?: Pick<Tier, "code" | "name" | "rank"> | null;
  stock_total: number | null;
  stock_redeemed: number;
  max_redemptions_per_member: number | null;
  quota_period: QuotaPeriod;
  image_url: string | null;
  reward_data: Record<string, unknown>;
  starts_at: string | null;
  ends_at: string | null;
  is_active: boolean;
  created_at: string;
};

export type RedemptionStatus = "pending" | "approved" | "fulfilled" | "cancelled" | "expired";

export type Redemption = {
  id: string;
  redemption_number: string;
  status: RedemptionStatus;
  channel: "portal" | "admin";
  min_xp_at_redeem: number;
  total_xp_at_redeem: number | null;
  requested_at: string;
  approved_at: string | null;
  fulfilled_at: string | null;
  cancelled_at: string | null;
  notes: string | null;
  customer_id: string;
  customer_name: string | null;
  customer_phone: string | null;
  customer_total_xp: number | null;
  reward_id: string;
  reward_code: string;
  reward_name: string;
  reward_type: Reward["reward_type"];
};

export interface RewardsListParams {
  reward_type?: string;
}

export interface RewardsListResult {
  rewards: Reward[];
  tiers: Tier[];
}

export interface RedemptionsListParams {
  status?: string;
}

export interface SaveRewardPayload {
  code: string;
  name: string;
  reward_type: Reward["reward_type"];
  min_xp: number;
  required_tier_id: string | null;
  linked_avatar_id: string | null;
  stock_total: number | null;
  stock_redeemed: number;
  max_redemptions_per_member: number | null;
  quota_period: QuotaPeriod;
  image_url: string | null;
  reward_data: Record<string, unknown>;
  starts_at: string | null;
  ends_at: string | null;
  is_active: boolean;
}

export type RewardForm = {
  id: string;
  code: string;
  name: string;
  reward_type: Reward["reward_type"];
  min_xp: number;
  required_tier_id: string;
  stock_total: string;
  stock_redeemed: number;
  max_redemptions_per_member: string;
  quota_period: QuotaPeriod;
  is_active: boolean;
};

/** Kandidat member pada panel klaim reward kasir. */
export type ClaimMemberOption = {
  customer_id: string;
  name: string;
  phone: string;
  total_xp: number;
};
