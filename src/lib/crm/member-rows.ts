// Bentuk baris member CRM (profil + customer POS) dan normalisasinya untuk API.
import { toNumber } from "./server";

export const POS_CUSTOMER_COLUMNS =
  "id, name, phone, email, membership_tier, ark_coin_balance, total_xp, total_spent, visit_count, is_active";

export type CustomerRow = {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  membership_tier: string | null;
  ark_coin_balance: number | string | null;
  total_xp: number | string | null;
  total_spent: number | string | null;
  visit_count: number | string | null;
  is_active: boolean | null;
  is_kol?: boolean | null;
  kol_monthly_limit_idr?: number | string | null;
};

export type TierRow = {
  id: string;
  code: string;
  name: string;
  rank: number;
  xp_multiplier?: number | string | null;
  discount_percent?: number | string | null;
  min_lifetime_xp?: number | string | null;
  min_total_spend?: number | string | null;
};

export type MemberProfileRow = {
  id: string;
  customer_id: string;
  member_code: string;
  tier_id: string;
  lifetime_xp: number | string;
  loyalty_score: number | string;
  active_avatar_id: string | null;
  joined_at: string;
  last_activity_at: string | null;
  status: string;
  metadata: Record<string, unknown>;
  tier?: TierRow | null;
};

export function normalizeCustomer(customer: CustomerRow) {
  return {
    id: customer.id,
    name: customer.name ?? "",
    phone: customer.phone ?? "",
    email: customer.email ?? "",
    membership_tier: customer.membership_tier ?? "regular",
    ark_coin_balance: toNumber(customer.ark_coin_balance),
    total_xp: toNumber(customer.total_xp),
    total_spent: toNumber(customer.total_spent),
    visit_count: toNumber(customer.visit_count),
    is_active: customer.is_active !== false,
  };
}

/** Field profil yang sama di daftar maupun detail member. */
export function profileFields(profile: MemberProfileRow) {
  return {
    id: profile.id,
    customer_id: profile.customer_id,
    member_code: profile.member_code,
    tier: profile.tier ?? null,
    lifetime_xp: toNumber(profile.lifetime_xp),
    loyalty_score: toNumber(profile.loyalty_score),
    active_avatar_id: profile.active_avatar_id,
    joined_at: profile.joined_at,
    last_activity_at: profile.last_activity_at,
    status: profile.status,
    metadata: profile.metadata ?? {},
  };
}

/** Customer POS tanpa profil CRM, ditampilkan sebagai member "pos-<id>". */
export function syntheticMemberBase(customer: ReturnType<typeof normalizeCustomer>) {
  return {
    id: `pos-${customer.id}`,
    customer_id: customer.id,
    member_code: customer.phone || customer.id.slice(0, 8),
    tier: { code: customer.membership_tier, name: customer.membership_tier },
    lifetime_xp: customer.total_xp,
    loyalty_score: customer.total_xp,
  };
}
