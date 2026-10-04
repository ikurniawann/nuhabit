import type {
  BxgyGetMode,
  OfferDiscountType,
  OfferItemRole,
  OfferType,
  VolumeBasis,
} from "@/lib/promo/offer-rules";

export type {
  BxgyGetMode,
  OfferDiscountType,
  OfferItemRole,
  OfferType,
  VolumeBasis,
};

export type OfferRuleItem = {
  id?: string;
  role: OfferItemRole;
  product_id: string | null;
  category_id: string | null;
  qty: string | number;
  sort_order: number;
  product_name?: string | null;
  category_name?: string | null;
};

/** Batas & penggabungan — sama utk semua tipe penawaran. */
export type OfferRuleLimits = {
  sales_channels: string[] | null;
  max_uses: number | null;
  max_uses_per_member: number | null;
  is_exclusive: boolean;
  priority: number;
  unlock_code: string | null;
};

export type OfferRule = {
  id: string;
  offer_type: OfferType;
  name: string;
  description: string | null;
  valid_from: string | null;
  valid_until: string | null;
  is_active: boolean;
  bundle_price: string | null;
  buy_qty: number | null;
  get_qty: number | null;
  get_mode: BxgyGetMode | null;
  volume_basis: VolumeBasis | null;
  volume_min: string | null;
  discount_type: OfferDiscountType | null;
  discount_value: string | null;
  created_at: string;
  used_count: number;
  items: OfferRuleItem[];
} & OfferRuleLimits;

export type OfferRulePayload = {
  offer_type: OfferType;
  name: string;
  description?: string | null;
  valid_from?: string | null;
  valid_until?: string | null;
  is_active?: boolean;
  bundle_price?: number | null;
  buy_qty?: number | null;
  get_qty?: number | null;
  get_mode?: BxgyGetMode | null;
  volume_basis?: VolumeBasis | null;
  volume_min?: number | null;
  discount_type?: OfferDiscountType | null;
  discount_value?: number | null;
  items: Array<{
    role: OfferItemRole;
    product_id: string | null;
    category_id: string | null;
    qty?: number;
    sort_order?: number;
  }>;
} & Partial<OfferRuleLimits>;
