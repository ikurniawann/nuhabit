import { z } from "zod";
import { SALES_CHANNEL_CODES } from "@/lib/pos/sales-channels";
import { OFFER_TYPES } from "./offer-rules";

// Body buat/ubah penawaran (bundling, BXGY, volume) — dipakai route POST
// dan PATCH. Aturan bisnis lintas field ada di validateOfferRule.

const itemSchema = z.object({
  role: z.enum(["component", "buy", "get", "eligible"]),
  product_id: z.string().uuid().nullable().optional(),
  category_id: z.string().uuid().nullable().optional(),
  qty: z.number().positive().optional(),
  sort_order: z.number().int().optional(),
});

export const offerRuleBodySchema = z.object({
  offer_type: z.enum(OFFER_TYPES),
  name: z.string().min(1).max(160),
  description: z.string().nullable().optional(),
  valid_from: z.string().nullable().optional(),
  valid_until: z.string().nullable().optional(),
  is_active: z.boolean().optional(),
  bundle_price: z.number().nullable().optional(),
  buy_qty: z.number().int().nullable().optional(),
  get_qty: z.number().int().nullable().optional(),
  get_mode: z.enum(["same_as_buy", "specific_products"]).nullable().optional(),
  volume_basis: z.enum(["qty", "spend"]).nullable().optional(),
  volume_min: z.number().nullable().optional(),
  discount_type: z.enum(["percent", "fixed"]).nullable().optional(),
  discount_value: z.number().nullable().optional(),
  sales_channels: z.array(z.enum(SALES_CHANNEL_CODES)).nullable().optional(),
  max_uses: z.number().int().positive().nullable().optional(),
  max_uses_per_member: z.number().int().positive().nullable().optional(),
  is_exclusive: z.boolean().optional(),
  priority: z.number().int().min(0).max(1000).optional(),
  unlock_code: z.string().trim().max(40).nullable().optional(),
  items: z.array(itemSchema).default([]),
});
