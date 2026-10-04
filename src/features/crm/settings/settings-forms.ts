import type { CrmSettings, CrmTierConfig, CrmXpRuleConfig, PosProductXp } from "./types";

/** Form & payload konfigurasi loyalty (nilai input disimpan sebagai string). */

export const XP_MODE_LABELS: Record<CrmXpRuleConfig["xp_mode"], string> = {
  fixed: "Tetap",
  per_item: "Per item",
  per_amount: "Per nominal",
  multiplier: "Pengali",
  percentage: "Persentase",
};

export type TierForm = {
  code: string;
  name: string;
  rank: number;
  min_lifetime_xp: string;
  discount_percent: string;
  xp_multiplier: string;
  is_active: boolean;
};

export type RuleForm = {
  code: string;
  name: string;
  source_type: string;
  xp_mode: CrmXpRuleConfig["xp_mode"];
  xp_value: string;
  amount_step: string;
  min_amount: string;
  max_xp_per_event: string;
  tier_multiplier_enabled: boolean;
  priority: string;
  is_active: boolean;
};

export const EMPTY_RULE_FORM: RuleForm = {
  code: "",
  name: "",
  source_type: "order_amount",
  xp_mode: "per_amount",
  xp_value: "1",
  amount_step: "1000",
  min_amount: "0",
  max_xp_per_event: "",
  tier_multiplier_enabled: true,
  priority: "100",
  is_active: true,
};

export const PRODUCT_XP_PAGE_SIZE = 30;

export function tierToForm(tier: CrmTierConfig): TierForm {
  return {
    code: tier.code,
    name: tier.name,
    rank: Number(tier.rank) || 0,
    min_lifetime_xp: String(Number(tier.min_lifetime_xp) || 0),
    discount_percent: String(Number(tier.discount_percent) || 0),
    xp_multiplier: String(Number(tier.xp_multiplier) || 1),
    is_active: tier.is_active !== false,
  };
}

/** Field yang tidak ada di form (min spend, warna) diambil dari tier tersimpan. */
export function tierFormToPayload(form: TierForm, existing: CrmTierConfig | undefined): CrmTierConfig {
  return {
    code: form.code,
    name: form.name.trim(),
    rank: form.rank,
    min_lifetime_xp: Number(form.min_lifetime_xp) || 0,
    min_total_spend: Number(existing?.min_total_spend) || 0,
    xp_multiplier: Number(form.xp_multiplier) || 1,
    discount_percent: Number(form.discount_percent) || 0,
    display_color: existing?.display_color,
    is_active: form.is_active,
  };
}

export function ruleToForm(rule: CrmXpRuleConfig): RuleForm {
  return {
    code: rule.code,
    name: rule.name,
    source_type: rule.source_type,
    xp_mode: rule.xp_mode,
    xp_value: String(Number(rule.xp_value) || 0),
    amount_step: String(Number(rule.amount_step) || 1),
    min_amount: String(Number(rule.min_amount) || 0),
    max_xp_per_event: rule.max_xp_per_event == null ? "" : String(rule.max_xp_per_event),
    tier_multiplier_enabled: rule.tier_multiplier_enabled !== false,
    priority: String(Number(rule.priority) || 100),
    is_active: rule.is_active !== false,
  };
}

export function ruleFormToPayload(form: RuleForm): CrmXpRuleConfig {
  return {
    code: form.code.trim().toLowerCase(),
    name: form.name.trim(),
    source_channel: "pos",
    source_type: form.source_type,
    xp_mode: form.xp_mode,
    xp_value: Number(form.xp_value) || 0,
    amount_step: Number(form.amount_step) || 1,
    min_amount: Number(form.min_amount) || 0,
    max_xp_per_event: form.max_xp_per_event === "" ? null : Number(form.max_xp_per_event) || 0,
    tier_multiplier_enabled: form.tier_multiplier_enabled,
    priority: Number(form.priority) || 100,
    is_active: form.is_active,
  };
}

/** Bonus topup dijepit 0–100%, XP gratis bulat dan tidak negatif. */
export function topupSettingsPayload(
  bonusPercent: string,
  freeXp: string
): Pick<CrmSettings, "topup_bonus_percent" | "profile_completion_free_xp"> {
  return {
    topup_bonus_percent: Math.min(100, Math.max(0, Number(bonusPercent) || 0)),
    profile_completion_free_xp: Math.max(0, Math.floor(Number(freeXp) || 0)),
  };
}

export function filterProducts(products: PosProductXp[], search: string): PosProductXp[] {
  const term = search.trim().toLowerCase();
  if (!term) return products;
  return products.filter(
    (product) =>
      product.name.toLowerCase().includes(term) ||
      product.sku.toLowerCase().includes(term) ||
      (product.category?.name ?? "").toLowerCase().includes(term)
  );
}
