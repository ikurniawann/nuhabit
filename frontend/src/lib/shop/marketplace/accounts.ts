// EPIC-039 Fase F — akun marketplace (otorisasi, buffer stok) dan mapping
// listing marketplace ↔ produk/SKU lokal.

import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { logSync, resolveMarketplaceAdapter } from "./sync";
import type { MarketplaceAccountRow } from "./types";

const uuid = z.string().uuid();

/** Validasi UUID dari query/body; pesan 400 menyebut nama field. */
export function requireUuid(value: unknown, field: string): string {
  const parsed = uuid.safeParse(String(value ?? ""));
  if (!parsed.success) throw ApiError.badRequest(`${field} tidak valid`);
  return parsed.data;
}

export function listMarketplaceAccounts() {
  return query(
    `SELECT a.id, a.channel_code, a.shop_id, a.shop_name, a.status,
            a.stock_buffer, a.last_pull_at, a.token_expires_at,
            (SELECT COUNT(*) FROM shop.marketplace_links l WHERE l.account_id = a.id) AS link_count
     FROM shop.marketplace_accounts a
     ORDER BY a.created_at`
  );
}

export const accountPatchSchema = z.object({
  id: z.string().uuid(),
  stock_buffer: z.number().int().min(0).max(10000).optional(),
  status: z.enum(["disconnected"]).optional(),
});

export async function updateMarketplaceAccount(patch: z.infer<typeof accountPatchSchema>) {
  const updated = await queryOne(
    `UPDATE shop.marketplace_accounts
     SET stock_buffer = COALESCE($2, stock_buffer),
         status = COALESCE($3, status),
         access_token = CASE WHEN $3 = 'disconnected' THEN NULL ELSE access_token END,
         updated_at = now()
     WHERE id = $1::uuid
     RETURNING id, status, stock_buffer`,
    [patch.id, patch.stock_buffer ?? null, patch.status ?? null]
  );
  if (!updated) throw ApiError.notFound("Akun tidak ditemukan");
  return updated;
}

export async function getMarketplaceAccount(accountId: string): Promise<MarketplaceAccountRow> {
  const account = await queryOne<MarketplaceAccountRow>(
    "SELECT * FROM shop.marketplace_accounts WHERE id = $1::uuid",
    [accountId]
  );
  if (!account) throw ApiError.notFound("Akun tidak ditemukan");
  return account;
}

/** Simpan token hasil otorisasi Shopee (akun baru atau sambung ulang). */
export async function connectShopeeAccount(code: string, shopId: string): Promise<void> {
  const bundle = await resolveMarketplaceAdapter("shopee").exchangeCode(code, shopId);
  await query(
    `INSERT INTO shop.marketplace_accounts (
       channel_code, shop_id, access_token, refresh_token, token_expires_at, status
     ) VALUES ('shopee', $1, $2, $3, $4, 'connected')
     ON CONFLICT (channel_code, shop_id) DO UPDATE SET
       access_token = EXCLUDED.access_token,
       refresh_token = EXCLUDED.refresh_token,
       token_expires_at = EXCLUDED.token_expires_at,
       status = 'connected',
       updated_at = now()`,
    [shopId, bundle.accessToken, bundle.refreshToken, bundle.expiresAt.toISOString()]
  );
  await logSync(null, "auth", "ok", { shop_id: shopId });
}

export function listMarketplaceLinks(accountId: string) {
  return query(
    `SELECT l.*, p.name AS product_name, s.name AS sku_name, s.sku AS sku_code
     FROM shop.marketplace_links l
     JOIN pos.pos_products p ON p.id = l.product_id
     LEFT JOIN pos.pos_product_skus s ON s.id = l.sku_id
     WHERE l.account_id = $1::uuid
     ORDER BY l.created_at DESC`,
    [accountId]
  );
}

export const linkCreateSchema = z.object({
  account_id: z.string().uuid(),
  product_id: z.string().uuid(),
  sku_id: z.string().uuid().nullish(),
  marketplace_item_id: z.string().min(1),
  marketplace_model_id: z.string().nullish(),
  marketplace_item_name: z.string().nullish(),
});

function isUniqueViolation(error: unknown): boolean {
  if ((error as { code?: unknown } | null)?.code === "23505") return true;
  return /duplicate key|unique/i.test(error instanceof Error ? error.message : "");
}

export async function createMarketplaceLink(body: z.infer<typeof linkCreateSchema>) {
  const product = await queryOne<{ id: string; product_kind: string }>(
    "SELECT id, product_kind FROM pos.pos_products WHERE id = $1::uuid",
    [body.product_id]
  );
  if (!product || product.product_kind !== "merchandise") {
    throw ApiError.badRequest("Mapping hanya untuk produk merchandise");
  }

  try {
    return await queryOne(
      `INSERT INTO shop.marketplace_links (
         account_id, product_id, sku_id, marketplace_item_id,
         marketplace_model_id, marketplace_item_name
       ) VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6)
       RETURNING *`,
      [
        body.account_id,
        body.product_id,
        body.sku_id ?? null,
        body.marketplace_item_id,
        body.marketplace_model_id ?? null,
        body.marketplace_item_name ?? null,
      ]
    );
  } catch (error) {
    if (isUniqueViolation(error)) throw ApiError.conflict("Listing/produk ini sudah dipetakan");
    throw error;
  }
}

export async function deleteMarketplaceLink(id: string): Promise<void> {
  await query("DELETE FROM shop.marketplace_links WHERE id = $1::uuid", [id]);
}
