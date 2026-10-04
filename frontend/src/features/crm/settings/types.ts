export type CrmSettings = {
  /** Saklar fitur (lib/crm/loyalty-features). Default aktif. */
  ark_coin_enabled: boolean;
  xp_enabled: boolean;
  topup_bonus_percent: number;
  profile_completion_free_xp: number;
  /** Customer service (EPIC-012 Fase D). */
  cs_sla_response_minutes: number;
  cs_sla_resolution_minutes: number;
  cs_business_hours_start: number;
  cs_business_hours_end: number;
  cs_auto_reply_enabled: boolean;
  cs_auto_reply_text: string;
  cs_csat_enabled: boolean;
  cs_csat_text: string;
};

export type CrmTierConfig = {
  id?: string;
  code: string;
  name: string;
  rank: number;
  min_lifetime_xp: number;
  min_total_spend: number;
  xp_multiplier: number;
  discount_percent: number;
  display_color?: string | null;
  is_active: boolean;
};

export type PosProductXp = {
  id: string;
  sku: string;
  name: string;
  base_price: number;
  xp: number;
  category?: { name: string } | null;
};

export type CrmXpRuleConfig = {
  id?: string;
  code: string;
  name: string;
  source_channel: string;
  source_type: string;
  source_id?: string | null;
  outlet_scope?: "all" | "specific";
  outlet_id?: string | null;
  xp_mode: "fixed" | "per_item" | "per_amount" | "multiplier" | "percentage";
  xp_value: number;
  amount_step: number;
  min_amount: number;
  max_xp_per_event: number | null;
  tier_multiplier_enabled: boolean;
  priority: number;
  is_active: boolean;
};
