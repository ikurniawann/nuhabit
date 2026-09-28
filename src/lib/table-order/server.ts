/**
 * Helper server-side self-order meja (dipakai route /api/table-order/*).
 * Semua akses DB lewat pool `@/lib/db` (search_path sudah memuat schema pos).
 */

import { query, queryOne } from "@/lib/db";
import { resolveBrandName } from "@/lib/branding-server";
import { getCrmDefaultVenue } from "@/lib/crm/server";
import { loadActiveXenditConfig } from "@/lib/payments/xendit";
import { createPgClient } from "@/lib/pg/create-client";
import type { BillingCharge } from "@/lib/pos/billing-settings";
import { resolveBillingProfile } from "@/lib/pos/billing-settings-server";
import { loadPosLoyaltySettings } from "@/lib/pos/loyalty-settings";
import {
  normalizeTableOrderProduct,
  type ProductRowInput,
  type TableOrderProduct,
} from "./menu";

export const TABLE_ORDER_TAG = "Self-service table order";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string) {
  return UUID_RE.test(value);
}

/** IP klien utk rate limit endpoint publik (di balik proxy: header X-Forwarded-For). */
export function clientIdentifier(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim() || "anon";
  return request.headers.get("x-real-ip") || "anon";
}

const PRODUCT_SELECT = `
  SELECT p.id, p.sku, p.name, p.description, p.base_price::float AS base_price,
         p.image_url, p.xp_points, p.station, p.prep_time_minutes, p.min_xp,
         p.is_active, p.is_available,
         p.category_id, c.name AS category_name,
         COALESCE(
           json_agg(
             json_build_object(
               'id', v.id, 'name', v.name,
               'price_adjustment', v.price_adjustment::float,
               'is_active', v.is_active
             ) ORDER BY v.display_order NULLS LAST, v.name
           ) FILTER (WHERE v.id IS NOT NULL),
           '[]'::json
         ) AS variants,
         -- Add-on per produk. Subquery berkorelasi (bukan JOIN) supaya baris
         -- varian tidak ikut terduplikasi oleh jumlah grup/opsi add-on.
         COALESCE((
           SELECT json_agg(
                    json_build_object(
                      'id', g.id, 'name', g.name,
                      'min_selection', g.min_selection, 'max_selection', g.max_selection,
                      'modifiers', COALESCE((
                        SELECT json_agg(
                                 json_build_object('id', m.id, 'name', m.name,
                                                   'price_adjustment', m.price_adjustment::float)
                                 ORDER BY m.display_order, m.name)
                        FROM pos.pos_modifiers m
                        WHERE m.group_id = g.id AND m.is_active IS NOT FALSE
                      ), '[]'::json)
                    ) ORDER BY g.display_order, g.name)
           FROM pos.pos_product_modifiers pm
           JOIN pos.pos_modifier_groups g ON g.id = pm.modifier_group_id
           WHERE pm.product_id = p.id AND g.is_active IS NOT FALSE
         ), '[]'::json) AS modifier_groups
  FROM pos.pos_products p
  LEFT JOIN pos.pos_categories c ON c.id = p.category_id
  LEFT JOIN pos.pos_product_variants v ON v.product_id = p.id`;

const PRODUCT_GROUP = `GROUP BY p.id, c.name, c.display_order`;

type SellableRow = ProductRowInput & {
  is_active: boolean | null;
  is_available: boolean | null;
  variants: string | ProductRowInput["variants"];
};

export type CatalogMeta = {
  total_products: number;
  sellable_products: number;
  hidden_unavailable: number;
};

/** Katalog yang boleh dipesan pemesan: aktif & tersedia, urut kategori lalu nama. */
export async function loadSellableCatalog(search?: string | null) {
  const params: unknown[] = [];
  let where = `WHERE p.is_active = true AND p.is_available = true`;
  const term = String(search || "").trim();
  if (term) {
    params.push(`%${term}%`);
    where += ` AND p.name ILIKE $${params.length}`;
  }
  const rows = await query<SellableRow>(
    `${PRODUCT_SELECT} ${where} ${PRODUCT_GROUP}
     ORDER BY c.display_order NULLS LAST, c.name NULLS LAST, p.name`,
    params
  );
  return rows.map(normalizeTableOrderProduct);
}

/** Diagnosa kenapa daftar menu kosong (utk pesan di layar & log). */
export async function loadCatalogMeta(): Promise<CatalogMeta> {
  const row = await queryOne<{ total: number; sellable: number; inactive_available: number }>(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE is_active = true AND is_available = true)::int AS sellable,
            count(*) FILTER (WHERE is_active = true AND is_available = false)::int AS inactive_available
     FROM pos.pos_products`
  );
  return {
    total_products: row?.total ?? 0,
    sellable_products: row?.sellable ?? 0,
    hidden_unavailable: row?.inactive_available ?? 0,
  };
}

/** Produk berdasarkan id (utk validasi order) — termasuk yang nonaktif agar bisa ditolak eksplisit. */
export async function loadProductsByIds(ids: string[]) {
  const unique = [...new Set(ids.filter(isUuid))];
  if (unique.length === 0) return new Map<string, TableOrderProduct & { sellable: boolean }>();
  const rows = await query<SellableRow>(
    `${PRODUCT_SELECT} WHERE p.id = ANY($1::uuid[]) ${PRODUCT_GROUP}`,
    [unique]
  );
  const map = new Map<string, TableOrderProduct & { sellable: boolean }>();
  for (const row of rows) {
    map.set(row.id, {
      ...normalizeTableOrderProduct(row),
      sellable: row.is_active !== false && row.is_available !== false,
    });
  }
  return map;
}

export type TableInfo = {
  id: string;
  table_number: string | null;
  qr_code: string | null;
  name: string | null;
  area: string | null;
  status: string | null;
  is_active: boolean | null;
};

/** Resolve kode dari QR (qr_code / table_number / uuid) → baris pos_tables. */
export async function loadTableByCode(code: string): Promise<TableInfo | null> {
  const value = code.trim();
  if (!value) return null;
  if (isUuid(value)) {
    return queryOne<TableInfo>(
      `SELECT id, table_number, qr_code, name, area, status::text AS status, is_active
       FROM pos.pos_tables WHERE id = $1 LIMIT 1`,
      [value]
    );
  }
  return queryOne<TableInfo>(
    `SELECT id, table_number, qr_code, name, area, status::text AS status, is_active
     FROM pos.pos_tables
     WHERE upper(qr_code) = upper($1) OR upper(table_number) = upper($1)
     ORDER BY (upper(qr_code) = upper($1)) DESC
     LIMIT 1`,
    [value]
  );
}

export function tableLabel(table: TableInfo | null, fallbackCode: string) {
  return table?.name || table?.table_number || table?.qr_code || fallbackCode.toUpperCase();
}

export type VenueContext = {
  companyId: string | null;
  branchId: string | null;
  brandName: string;
  charges: BillingCharge[];
  billingProfileName: string;
  qrisAvailable: boolean;
  arkRate: number;
};

/** Konteks venue utk sesi self-order: brand, profil billing, ketersediaan QRIS, rate ARK. */
export async function loadVenueContext(): Promise<VenueContext> {
  const db = createPgClient();
  const venue = await getCrmDefaultVenue(db);

  const [brandName, billing, qrisAvailable, loyalty] = await Promise.all([
    resolveBrandName(venue.companyId).catch(() => "BCD Coffee"),
    resolveBillingProfile({ branchId: venue.branchId }),
    loadActiveXenditConfig(db)
      .then(() => true)
      .catch(() => false),
    loadPosLoyaltySettings(db).catch(() => null),
  ]);

  return {
    companyId: venue.companyId,
    branchId: venue.branchId,
    brandName,
    charges: billing.charges.filter((charge) => charge.is_enabled && !charge.is_optional),
    billingProfileName: billing.name,
    qrisAvailable,
    arkRate: loyalty?.ark_rate ?? 1000,
  };
}
