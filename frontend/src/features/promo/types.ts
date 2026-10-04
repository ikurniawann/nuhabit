export type PromoScope =
  | "ticketing_online"
  | "ticketing_loket"
  | "pos"
  | "semua";

export type PromoDiscountType = "percent" | "fixed";

export type PromoEligibility = "semua" | "member" | "member_baru";

export const PROMO_ELIGIBILITY_LABELS: Record<PromoEligibility, string> = {
  semua: "Semua pembeli",
  member: "Khusus member",
  member_baru: "Member baru (transaksi pertama)",
};

export const PROMO_SCOPE_LABELS: Record<PromoScope, string> = {
  ticketing_online: "Booking Online",
  ticketing_loket: "Loket Tiket",
  pos: "Kasir POS",
  semua: "Semua Kanal",
};

/** Prefix default voucher dari kanal — biar user tidak perlu input manual. */
export const PROMO_SCOPE_PREFIX: Record<PromoScope, string> = {
  ticketing_online: "ONLINE",
  ticketing_loket: "LOKET",
  pos: "POS",
  semua: "ALL",
};

export interface PromoCampaign {
  id: string;
  name: string;
  description: string | null;
  discount_type: PromoDiscountType;
  value: string;
  max_discount: string | null;
  min_purchase: string;
  valid_from: string | null;
  valid_until: string | null;
  usage_limit: number | null;
  per_phone_limit: number | null;
  scope: PromoScope;
  is_active: boolean;
  /** Tampil di daftar promo portal member /member. */
  show_in_member_portal: boolean;
  target_product_ids: string[];
  target_category_ids: string[];
  eligibility: PromoEligibility;
  new_member_days: number | null;
  created_at: string;
  codes_count: string;
  held_count: string;
  captured_count: string;
  discount_captured: string;
}

export interface PromoCampaignFormValues {
  name: string;
  description?: string | null;
  discount_type: PromoDiscountType;
  value: number;
  max_discount?: number | null;
  min_purchase: number;
  valid_from?: string | null;
  valid_until?: string | null;
  usage_limit?: number | null;
  per_phone_limit?: number | null;
  scope: PromoScope;
  public_code?: string;
  target_product_ids?: string[];
  target_category_ids?: string[];
  eligibility?: PromoEligibility;
  new_member_days?: number | null;
}

export interface PromoCode {
  id: string;
  code: string;
  usage_limit: number | null;
  usage_count: number;
  is_active: boolean;
  created_at: string;
}

export interface PromoRedemption {
  id: string;
  code: string;
  context_type: string;
  context_id: string;
  phone: string | null;
  discount_amount: string;
  status: "held" | "captured" | "released";
  created_at: string;
}
