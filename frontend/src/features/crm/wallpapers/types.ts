export type Tier = {
  id: string;
  code: string;
  name: string;
  rank: number;
};

export type Wallpaper = {
  id: string;
  code: string;
  name: string;
  rarity: "common" | "rare" | "epic" | "legendary" | "limited";
  image_url: string;
  thumbnail_url: string | null;
  min_lifetime_xp: number | null;
  required_tier_id: string | null;
  required_tier_name?: string | null;
  stock_total: number | null;
  stock_redeemed: number;
  is_active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
};

export interface WallpapersListResult {
  wallpapers: Wallpaper[];
  tiers: Tier[];
}

export interface SaveWallpaperPayload {
  id?: string;
  code: string;
  name: string;
  rarity: Wallpaper["rarity"];
  image_url: string;
  thumbnail_url: string | null;
  min_lifetime_xp: number | null;
  required_tier_id: string | null;
  stock_total: number | null;
  is_active: boolean;
  starts_at: string | null;
  ends_at: string | null;
}

export type WallpaperForm = {
  id: string;
  code: string;
  name: string;
  rarity: Wallpaper["rarity"];
  image_url: string;
  thumbnail_url: string;
  min_lifetime_xp: string;
  required_tier_id: string;
  stock_total: string;
  is_active: boolean;
  starts_at: string;
  ends_at: string;
};
