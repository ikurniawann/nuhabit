export type CrmCustomer = {
  id: string;
  name: string;
  phone: string;
  email: string;
  membership_tier: string;
  ark_coin_balance: number;
  total_xp: number;
  total_spent: number;
  visit_count: number;
  is_active: boolean;
  /** EPIC-043 — flag KOL + kuota komplimen bulanan (Rp; null = tanpa batas). */
  is_kol?: boolean;
  kol_monthly_limit_idr?: number | null;
};

export type CrmMember = {
  id: string;
  customer_id: string;
  member_code: string;
  tier: {
    code: string;
    name: string;
    rank?: number;
    xp_multiplier?: number;
    discount_percent?: number;
    min_lifetime_xp?: number;
    min_total_spend?: number;
  } | null;
  lifetime_xp: number;
  loyalty_score: number;
  active_avatar_id?: string | null;
  joined_at?: string | null;
  last_activity_at?: string | null;
  status: string;
  source?: string;
  customer: CrmCustomer | null;
};

export type CrmLedger = {
  id: string;
  direction: string;
  source_channel: string;
  source_type: string;
  xp_delta: number;
  balance_after: number;
  description: string | null;
  reference_table: string | null;
  reference_id: string | null;
  created_at: string;
};

export type CrmReward = {
  id: string;
  code: string;
  name: string;
  reward_type: string;
  /** Syarat minimum lifetime XP — tidak dipotong saat redeem. */
  min_xp: number;
  stock_total: number | null;
  stock_redeemed: number;
  max_redemptions_per_member: number | null;
  is_active: boolean;
  required_tier: {
    code: string;
    name: string;
    rank?: number;
  } | null;
};

export type CrmAvatar = {
  id: string;
  code: string;
  name: string;
  rarity: string;
  image_url: string;
  thumbnail_url: string | null;
  required_tier_id: string | null;
  xp_cost: number;
  stock_total: number | null;
  stock_redeemed: number;
  is_active: boolean;
  required_tier: {
    code: string;
    name: string;
    rank?: number;
  } | null;
};

export type CrmAvatarInventory = {
  id: string;
  member_id: string;
  avatar_id: string;
  redemption_id: string | null;
  acquisition_source: string;
  is_equipped: boolean;
  acquired_at: string;
  metadata?: {
    xp_cost?: number;
    granted_by?: string;
    note?: string | null;
  } | null;
  avatar: CrmAvatar | null;
};

export type CrmTier = {
  id: string;
  code: string;
  name: string;
  rank: number;
  is_active: boolean;
};

export type CrmRedemption = {
  id: string;
  redemption_number: string;
  reward_id: string;
  /** Syarat XP saat redeem diajukan — bukan biaya; XP tidak dipotong. */
  min_xp_at_redeem: number;
  status: string;
  voucher_code: string | null;
  requested_at: string;
  approved_at: string | null;
  reward: {
    id: string;
    code: string;
    name: string;
    reward_type: string;
    min_xp: number;
  } | null;
};

export type PosOrder = {
  id: string;
  order_number: string;
  total_amount: number;
  payment_status: string;
  status: string;
  ordered_at: string;
};

export interface MemberListParams {
  search?: string;
  tier?: string;
  limit?: number;
}

export interface MemberListResult {
  members: CrmMember[];
  schemaReady: boolean;
}

export interface MemberDetailBundle {
  member: CrmMember;
  xpLedger: CrmLedger[];
  recentOrders: PosOrder[];
  rewards: CrmReward[];
  tiers: CrmTier[];
  avatars: CrmAvatar[];
  redemptions: CrmRedemption[];
  avatarInventory: CrmAvatarInventory[];
}

export interface UpdateMemberPayload {
  customer: {
    name: string;
    phone: string | null;
    email: string | null;
    is_active: boolean;
    /** EPIC-043 — flag KOL + kuota komplimen bulanan (null = tanpa batas). */
    is_kol?: boolean;
    kol_monthly_limit_idr?: number | null;
  };
  member?: {
    tier_id?: string;
    status: string;
  };
}
