export type Tier = {
  id: string;
  code: string;
  name: string;
  rank: number;
};

export type Avatar = {
  id: string;
  code: string;
  name: string;
  rarity: "common" | "rare" | "epic" | "legendary" | "limited";
  image_url: string;
  thumbnail_url: string | null;
  required_tier_id: string | null;
  required_tier?: Pick<Tier, "code" | "name" | "rank"> | null;
  xp_cost: number;
  stock_total: number | null;
  stock_redeemed: number;
  is_active: boolean;
  created_at: string;
};

export interface AvatarsListParams {
  rarity?: string;
}

export interface AvatarsListResult {
  avatars: Avatar[];
  tiers: Tier[];
}

export interface SaveAvatarPayload {
  code: string;
  name: string;
  rarity: Avatar["rarity"];
  image_url: string;
  thumbnail_url: string | null;
  required_tier_id: string | null;
  xp_cost: number;
  stock_total: number | null;
  stock_redeemed: number;
  starts_at: string | null;
  ends_at: string | null;
  is_active: boolean;
  metadata: Record<string, unknown>;
}

export type AvatarForm = {
  id: string;
  code: string;
  name: string;
  rarity: Avatar["rarity"];
  image_url: string;
  thumbnail_url: string;
  required_tier_id: string;
  xp_cost: number;
  stock_total: string;
  stock_redeemed: number;
  is_active: boolean;
};
