// Aturan XP & tier murni (tanpa I/O) — dipakai penulis XP di loyalty-*.ts.
import { toNumber } from "@/lib/crm/server";

export type PosOrderItemInput = {
  product_id?: string | null;
  productId?: string | null;
  quantity?: number | string | null;
  total_amount?: number | string | null;
  subtotal?: number | string | null;
  unit_price?: number | string | null;
};

export type CrmTier = {
  id: string;
  code: string;
  name: string;
  rank: number;
  min_lifetime_xp: number | string;
  min_total_spend: number | string;
  xp_multiplier: number | string;
};

export type CrmMemberProfile = {
  id: string;
  customer_id: string;
  tier_id: string;
  lifetime_xp: number | string;
  loyalty_score: number | string;
  tier?: Pick<CrmTier, "id" | "code" | "name" | "rank" | "xp_multiplier"> | null;
};

export type PosCustomerLoyaltyRow = {
  id: string;
  phone?: string | null;
  membership_tier?: string | null;
  total_xp?: number | string | null;
  total_spent?: number | string | null;
  visit_count?: number | string | null;
};

export type CrmXpRule = {
  id: string;
  source_channel: string;
  source_type: string;
  source_id: string | null;
  outlet_scope: "all" | "specific";
  outlet_id: string | null;
  xp_mode: "fixed" | "per_item" | "per_amount" | "multiplier" | "percentage";
  xp_value: number | string;
  amount_step: number | string;
  min_amount: number | string;
  max_xp_per_event: number | string | null;
  tier_multiplier_enabled: boolean;
  priority: number;
  starts_at: string | null;
  ends_at: string | null;
  is_active: boolean;
};

export type CrmXpAwardResult = {
  status: "posted" | "skipped" | "duplicate" | "error";
  xpAwarded: number;
  reason?: string;
  ledgerIds?: string[];
  details?: unknown;
};

// XP hanya diberikan untuk pembayaran penuh dengan ARK Coin (EPIC-011).
const XP_ELIGIBLE_PAYMENT_METHOD = "ark_coin";

export function isXpEligiblePayment(paymentMethod?: string | null) {
  return String(paymentMethod ?? "").toLowerCase() === XP_ELIGIBLE_PAYMENT_METHOD;
}

/** Aturan pertama (rules sudah urut prioritas) yang cocok sumber, outlet, jendela waktu, dan minimum. */
export function findBestRule(
  rules: CrmXpRule[],
  input: { sourceType: string; sourceId: string | null; outletId: string | null; amount: number },
  now = Date.now()
) {
  return rules.find((rule) => {
    if (rule.source_type !== input.sourceType) return false;
    if ((rule.source_id ?? null) !== (input.sourceId ?? null)) return false;
    if (rule.outlet_scope === "specific" && rule.outlet_id !== input.outletId) return false;
    if (rule.starts_at && new Date(rule.starts_at).getTime() > now) return false;
    if (rule.ends_at && new Date(rule.ends_at).getTime() < now) return false;
    if (input.amount < toNumber(rule.min_amount)) return false;
    return true;
  });
}

export function calculateXp(rule: CrmXpRule, input: { amount: number; quantity: number }) {
  const value = toNumber(rule.xp_value);
  const amountStep = Math.max(1, toNumber(rule.amount_step) || 1);
  let xp = 0;

  if (rule.xp_mode === "fixed") xp = value;
  if (rule.xp_mode === "per_item") xp = value * input.quantity;
  if (rule.xp_mode === "per_amount") xp = Math.floor(input.amount / amountStep) * value;
  if (rule.xp_mode === "multiplier") xp = input.amount * value;
  if (rule.xp_mode === "percentage") xp = input.amount * (value / 100);

  const capped = rule.max_xp_per_event != null ? Math.min(xp, toNumber(rule.max_xp_per_event)) : xp;
  return Math.max(0, Math.floor(capped));
}

export function itemQuantity(item: PosOrderItemInput) {
  return Math.max(1, toNumber(item.quantity) || 1);
}

export function itemAmount(item: PosOrderItemInput) {
  if (item.total_amount != null) return toNumber(item.total_amount);
  if (item.subtotal != null) return toNumber(item.subtotal);
  return toNumber(item.unit_price) * itemQuantity(item);
}

/**
 * Tier ditentukan MURNI dari lifetime XP (keputusan owner EPIC-011): tier aktif
 * dengan peringkat tertinggi yang ambang XP-nya terlampaui.
 */
export function pickTierForXp<T extends Pick<CrmTier, "rank" | "min_lifetime_xp">>(
  tiers: T[],
  lifetimeXp: number
): T | undefined {
  return [...tiers]
    .sort((a, b) => b.rank - a.rank)
    .find((tier) => lifetimeXp >= toNumber(tier.min_lifetime_xp));
}

/** Delta penyesuaian admin: dibulatkan ke nol, pengurangan dijepit agar XP tidak negatif. */
export function clampXpAdjustment(requested: number, currentXp: number) {
  const delta = Math.trunc(requested);
  return delta < 0 ? -Math.min(-delta, currentXp) : delta;
}

export type XpEarnRow = {
  customer_id: string;
  member_id: string;
  xp_delta: number | string;
  outlet_id: string | null;
  company_id: string | null;
  branch_id: string | null;
  reference_id: string;
};

export const voidReverseKey = (orderId: string) => `pos:order:${orderId}:void_reverse`;

/** Jumlah XP earn per order yang belum pernah ditarik (kunci reverse belum ada). */
export function sumUnreversedEarnByOrder(rows: XpEarnRow[], reversedKeys: ReadonlySet<string>) {
  const byOrder = new Map<string, { xp: number; row: XpEarnRow }>();
  for (const row of rows) {
    const orderId = String(row.reference_id);
    if (reversedKeys.has(voidReverseKey(orderId))) continue;
    const entry = byOrder.get(orderId) ?? { xp: 0, row };
    entry.xp += toNumber(row.xp_delta);
    byOrder.set(orderId, entry);
  }
  return byOrder;
}
