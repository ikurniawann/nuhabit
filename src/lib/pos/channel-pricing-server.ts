import { query, queryOne } from "@/lib/db";
import type { ChannelRule, RoundingMode, RoundingStep } from "./channel-pricing";

/** Akses DB untuk harga per channel (pos.sales_channels + pos.pos_product_channel_prices). */

type ChannelRow = {
  code: string;
  name: string;
  markup_percent: number;
  rounding_step: number;
  rounding_mode: string;
  is_active: boolean;
};

const CHANNEL_SELECT = `SELECT code, name, markup_percent::float AS markup_percent, rounding_step,
                               rounding_mode, is_active
                        FROM pos.sales_channels`;

function toRule(row: ChannelRow): ChannelRule {
  return {
    code: row.code,
    name: row.name,
    markupPercent: Number(row.markup_percent) || 0,
    roundingStep: Number(row.rounding_step) as RoundingStep,
    roundingMode: row.rounding_mode as RoundingMode,
    isActive: row.is_active === true,
  };
}

export async function loadSalesChannels(): Promise<ChannelRule[]> {
  const rows = await query<ChannelRow>(`${CHANNEL_SELECT} ORDER BY sort_order, name`);
  return rows.map(toRule);
}

export async function loadChannelRule(code: string): Promise<ChannelRule | null> {
  const row = await queryOne<ChannelRow>(`${CHANNEL_SELECT} WHERE code = $1`, [code]);
  return row ? toRule(row) : null;
}

/** product_id → harga manual untuk satu channel. */
export async function loadChannelOverrides(code: string): Promise<Map<string, number>> {
  const rows = await query<{ product_id: string; price: number }>(
    "SELECT product_id, price::float AS price FROM pos.pos_product_channel_prices WHERE channel_code = $1",
    [code]
  );
  return new Map(rows.map((row) => [row.product_id, Number(row.price)]));
}

export type ChannelProductRow = {
  id: string;
  name: string;
  sku: string | null;
  category_name: string | null;
  base_price: number;
  is_available: boolean | null;
  variant_count: number;
  modifier_count: number;
};

/** Produk aktif yang dijual (sama cakupannya dgn katalog GoFood). */
export async function loadChannelProducts(): Promise<ChannelProductRow[]> {
  return query<ChannelProductRow>(
    `SELECT p.id, p.name, p.sku, c.name AS category_name, p.base_price::float AS base_price, p.is_available,
            (SELECT count(*)::int FROM pos.pos_product_variants v
              WHERE v.product_id = p.id AND v.is_active IS NOT FALSE) AS variant_count,
            (SELECT count(*)::int FROM pos.pos_product_modifiers pm WHERE pm.product_id = p.id) AS modifier_count
     FROM pos.pos_products p
     LEFT JOIN pos.pos_categories c ON c.id = p.category_id
     WHERE p.is_active = true AND COALESCE(p.product_kind, 'regular') <> 'gift_card'
     ORDER BY c.display_order NULLS LAST, c.name NULLS LAST, p.name`
  );
}
