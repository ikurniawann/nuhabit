import type { BadgeMetric } from "@/lib/crm/badges";

export type { BadgeMetric };

export type Badge = {
  id: string;
  code: string;
  name: string;
  image_url: string | null;
  metric: BadgeMetric;
  min_lifetime_xp: number;
  threshold: number | string | null;
  bonus_xp: number;
  is_active: boolean;
  awarded_count: number;
  created_at: string;
};

export interface BadgesListResult {
  badges: Badge[];
}

export interface SaveBadgePayload {
  id?: string;
  code: string;
  name: string;
  image_url: string | null;
  metric: BadgeMetric;
  min_lifetime_xp: number;
  threshold: number | null;
  bonus_xp: number;
  is_active: boolean;
}

export type BadgeForm = {
  id: string;
  code: string;
  name: string;
  image_url: string;
  metric: BadgeMetric;
  /** Ambang untuk metrik terpilih (XP, kunjungan, Rp, atau minggu). */
  threshold: string;
  bonus_xp: string;
  is_active: boolean;
};
