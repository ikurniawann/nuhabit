import type { PromoDiscountType, PromoScope } from "@/lib/promo/promo";

/**
 * Promo yang tampil di portal member: hanya campaign yang ditandai admin
 * (show_in_member_portal), aktif, dalam periode, dan masih punya kuota. Kode
 * voucher sekali pakai (usage_limit 1, hasil batch kampanye) adalah milik
 * penerima tertentu, jadi tidak pernah ditampilkan ke semua member.
 */

export interface MemberPromoRow {
  campaign_id: string;
  name: string;
  description: string | null;
  discount_type: PromoDiscountType;
  value: number;
  max_discount: number | null;
  min_purchase: number;
  valid_from: string | null;
  valid_until: string | null;
  usage_limit: number | null;
  per_phone_limit: number | null;
  scope: PromoScope;
  is_active: boolean;
  show_in_member_portal: boolean;
  code: string;
  code_is_active: boolean;
  code_usage_limit: number | null;
  code_usage_count: number;
  /** Redemption hidup (held/captured) lintas semua kode campaign. */
  campaign_used_count: number;
  /** Redemption hidup campaign ini oleh member yang sedang login. */
  my_used_count: number;
}

export interface MemberPromo {
  code: string;
  name: string;
  description: string | null;
  discount_type: PromoDiscountType;
  value: number;
  max_discount: number | null;
  min_purchase: number;
  valid_from: string | null;
  valid_until: string | null;
  scope: PromoScope;
  per_member_limit: number | null;
  /** Member sudah memakai jatah per-nomornya. */
  used_up: boolean;
}

export function isMemberVisiblePromo(row: MemberPromoRow, today: string): boolean {
  if (!row.show_in_member_portal || !row.is_active || !row.code_is_active) return false;
  if (row.valid_from !== null && today < row.valid_from) return false;
  if (row.valid_until !== null && today > row.valid_until) return false;
  if (row.code_usage_limit !== null && row.code_usage_limit <= 1) return false;
  if (row.code_usage_limit !== null && row.code_usage_count >= row.code_usage_limit) return false;
  if (row.code_usage_limit === null && row.usage_limit !== null && row.campaign_used_count >= row.usage_limit) {
    return false;
  }
  return true;
}

/** Satu kode publik per campaign, urutan masukan dipertahankan. */
export function selectMemberPromos(rows: MemberPromoRow[], today: string): MemberPromo[] {
  const seen = new Set<string>();
  const promos: MemberPromo[] = [];
  for (const row of rows) {
    if (seen.has(row.campaign_id) || !isMemberVisiblePromo(row, today)) continue;
    seen.add(row.campaign_id);
    promos.push({
      code: row.code,
      name: row.name,
      description: row.description,
      discount_type: row.discount_type,
      value: row.value,
      max_discount: row.discount_type === "percent" ? row.max_discount : null,
      min_purchase: row.min_purchase,
      valid_from: row.valid_from,
      valid_until: row.valid_until,
      scope: row.scope,
      per_member_limit: row.per_phone_limit,
      used_up: row.per_phone_limit !== null && row.my_used_count >= row.per_phone_limit,
    });
  }
  return promos;
}
