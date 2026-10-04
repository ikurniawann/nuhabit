import "server-only";
// Pengaturan jual per ticket: harga override per kanal, toggle distribusi,
// komposisi paket (Fase P), papan Channel Manager, dan opsi registrasi loket.

import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { query, withTransaction } from "@/lib/db";
import {
  buildChannelBoard,
  buildLoketOptions,
  firstIncompleteVariant,
  type BoardChannelRow,
  type BoardDistributionRow,
  type BoardOverrideRow,
  type BoardProductRow,
  type BoardVariantRow,
  type ChannelOverrideRow,
  type LoketBundleMemberRow,
  type LoketOptionRow,
  type VariantPriceRow,
} from "./distribution";
import { lockProduct } from "./products-server";
import type { TicketingContext } from "./server";

// ── Harga override per kanal ──────────────────────────────────────────

const priceSchema = z.number().min(0).max(1_000_000_000).nullable();

export const channelPricesSchema = z.object({
  channel_id: z.string().uuid(),
  prices: z
    .array(
      z.object({
        variant_id: z.string().uuid(),
        price_regular: priceSchema,
        price_high: priceSchema,
      })
    )
    // Klien mengirim SEMUA varian produk sekaligus (bukan diff) — batas
    // dilonggarkan supaya ticket ber-varian banyak tidak gagal simpan
    .min(1)
    .max(50),
});

/**
 * Simpan harga override kanal per varian (Channel Manager). NULL = ikut
 * harga varian; keduanya NULL → baris override dihapus (bersih).
 */
export async function saveChannelPrices(
  ctx: TicketingContext,
  productId: string,
  body: z.infer<typeof channelPricesSchema>
) {
  await withTransaction(async (client) => {
    await lockProduct(client, ctx, productId, "1");

    const channel = await client.query(
      `SELECT 1 FROM ticketing.ticket_channels
       WHERE id = $1 AND branch_id = $2 AND company_id = $3`,
      [body.channel_id, ctx.branchId, ctx.companyId]
    );
    if (channel.rows.length === 0) throw ApiError.badRequest("Kanal tidak dikenal");

    // Varian yang di-update WAJIB milik ticket ini DAN masih aktif —
    // override utk varian nonaktif jadi baris hantu yang menyalakan
    // dirinya sendiri bila varian diaktifkan lagi (hasil review)
    const variantIds = body.prices.map((p) => p.variant_id);
    const owned = await client.query<{ id: string }>(
      `SELECT id FROM ticketing.ticket_product_variants
       WHERE ticket_product_id = $1 AND id = ANY($2) AND is_active = true`,
      [productId, variantIds]
    );
    if (owned.rows.length !== new Set(variantIds).size) {
      throw ApiError.badRequest("Ada varian yang bukan milik ticket ini / sudah nonaktif");
    }

    for (const price of body.prices) {
      if (price.price_regular === null && price.price_high === null) {
        await client.query(
          `DELETE FROM ticketing.ticket_variant_channel_prices
           WHERE variant_id = $1 AND channel_id = $2`,
          [price.variant_id, body.channel_id]
        );
        continue;
      }
      await client.query(
        `INSERT INTO ticketing.ticket_variant_channel_prices
           (company_id, branch_id, variant_id, channel_id,
            price_regular, price_high)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (variant_id, channel_id) DO UPDATE SET
           price_regular = EXCLUDED.price_regular,
           price_high = EXCLUDED.price_high,
           updated_at = now()`,
        [
          ctx.companyId,
          ctx.branchId,
          price.variant_id,
          body.channel_id,
          price.price_regular,
          price.price_high,
        ]
      );
    }
  });
}

// ── Toggle distribusi ─────────────────────────────────────────────────

export const toggleDistributionSchema = z.object({
  channel_id: z.string().uuid(),
  is_distributed: z.boolean(),
});

/**
 * Toggle distribusi ticket ke satu kanal. Menyalakan distribusi dijaga
 * guard: ticket harus Active dan SEMUA varian aktifnya lengkap harga
 * (Regular & High — langsung di varian atau tertutup override kanal ini).
 * Mematikan selalu boleh.
 */
export async function setChannelDistribution(
  ctx: TicketingContext,
  productId: string,
  body: z.infer<typeof toggleDistributionSchema>
) {
  await withTransaction(async (client) => {
    const product = await lockProduct<{ status: string }>(client, ctx, productId, "status");

    const channelResult = await client.query<{ id: string }>(
      `SELECT id FROM ticketing.ticket_channels
       WHERE id = $1 AND branch_id = $2 AND company_id = $3
         AND is_active = true`,
      [body.channel_id, ctx.branchId, ctx.companyId]
    );
    if (channelResult.rows.length === 0) throw ApiError.badRequest("Kanal tidak dikenal");

    if (body.is_distributed) {
      if (product.status !== "active") {
        throw ApiError.badRequest("Ticket masih Draft — aktifkan dulu sebelum didistribusi");
      }
      const variants = await client.query<VariantPriceRow>(
        `SELECT id, name, price_regular, price_high
         FROM ticketing.ticket_product_variants
         WHERE ticket_product_id = $1 AND is_active = true`,
        [productId]
      );
      if (variants.rows.length === 0) throw ApiError.badRequest("Ticket tidak punya varian aktif");
      const overrides = await client.query<ChannelOverrideRow>(
        `SELECT variant_id, price_regular, price_high
         FROM ticketing.ticket_variant_channel_prices
         WHERE channel_id = $1 AND variant_id = ANY($2)`,
        [body.channel_id, variants.rows.map((v) => v.id)]
      );
      const incomplete = firstIncompleteVariant(variants.rows, overrides.rows);
      if (incomplete) {
        throw ApiError.badRequest(
          `Harga varian "${incomplete.name}" belum lengkap (Regular & High Season) untuk kanal ini`
        );
      }
    }

    await client.query(
      `INSERT INTO ticketing.ticket_product_channels
         (company_id, branch_id, ticket_product_id, channel_id, is_distributed)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (ticket_product_id, channel_id) DO UPDATE SET
         is_distributed = EXCLUDED.is_distributed, updated_at = now()`,
      [ctx.companyId, ctx.branchId, productId, body.channel_id, body.is_distributed]
    );
  });
}

// ── Komposisi paket (Fase P) ──────────────────────────────────────────
// Replace-all (pola channel-prices): komponen = varian dari tiket SATUAN
// Active milik venue. Paket-dalam-paket ditolak; paket Active tidak boleh
// dikosongkan (guard aktivasi di updateProduct memeriksa hal yang sama).

export const bundleItemsSchema = z.object({
  items: z
    .array(
      z.object({
        component_variant_id: z.string().uuid(),
        qty: z.number().int().min(1).max(20),
      })
    )
    .max(10),
});

export async function saveBundleItems(
  ctx: TicketingContext,
  productId: string,
  items: z.infer<typeof bundleItemsSchema>["items"]
) {
  const variantIds = items.map((i) => i.component_variant_id);
  if (new Set(variantIds).size !== variantIds.length) {
    throw ApiError.badRequest("Ada komponen yang sama dipilih dua kali");
  }

  await withTransaction(async (client) => {
    const product = await lockProduct<{ product_kind: string; status: string }>(
      client,
      ctx,
      productId,
      "product_kind, status"
    );
    if (product.product_kind !== "bundle") {
      throw ApiError.badRequest("Komposisi hanya berlaku untuk produk paket");
    }
    if (product.status === "active" && items.length === 0) {
      throw ApiError.badRequest("Paket Active tidak boleh tanpa komposisi — turunkan ke Draft dulu");
    }

    if (variantIds.length > 0) {
      // Komponen sah = varian aktif milik venue dari produk SATUAN
      // Active (paket-dalam-paket & produk draft tertolak di sini)
      const valid = await client.query<{ id: string }>(
        `SELECT pv.id
         FROM ticketing.ticket_product_variants pv
         JOIN ticketing.ticket_products tp ON tp.id = pv.ticket_product_id
         WHERE pv.id = ANY($1) AND pv.branch_id = $2 AND pv.company_id = $3
           AND pv.is_active = true AND tp.status = 'active'
           AND tp.product_kind = 'single'`,
        [variantIds, ctx.branchId, ctx.companyId]
      );
      if (valid.rows.length !== variantIds.length) {
        throw ApiError.badRequest(
          "Ada komponen yang bukan tiket satuan Active — paket hanya boleh berisi varian tiket satuan yang aktif"
        );
      }
    }

    await client.query(`DELETE FROM ticketing.ticket_bundle_items WHERE bundle_product_id = $1`, [
      productId,
    ]);
    for (const [index, item] of items.entries()) {
      await client.query(
        `INSERT INTO ticketing.ticket_bundle_items
           (company_id, branch_id, bundle_product_id, component_variant_id,
            qty, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [ctx.companyId, ctx.branchId, productId, item.component_variant_id, item.qty, (index + 1) * 10]
      );
    }
  });
}

// ── Papan Channel Manager & opsi loket ────────────────────────────────

export async function loadChannelBoard(ctx: TicketingContext) {
  const scope = [ctx.branchId, ctx.companyId];
  const [products, variants, channels, distributions, overrides] = await Promise.all([
    query<BoardProductRow>(
      `SELECT id, code, name, status, product_kind, thumbnail_url
       FROM ticketing.ticket_products
       WHERE branch_id = $1 AND company_id = $2
       ORDER BY created_at DESC`,
      scope
    ),
    query<BoardVariantRow>(
      `SELECT id, ticket_product_id, name, price_regular, price_high
       FROM ticketing.ticket_product_variants
       WHERE branch_id = $1 AND company_id = $2 AND is_active = true
       ORDER BY sort_order`,
      scope
    ),
    query<BoardChannelRow>(
      `SELECT id, code, name, is_online FROM ticketing.ticket_channels
       WHERE branch_id = $1 AND company_id = $2 AND is_active = true
       ORDER BY sort_order`,
      scope
    ),
    query<BoardDistributionRow>(
      `SELECT ticket_product_id, channel_id, is_distributed
       FROM ticketing.ticket_product_channels
       WHERE branch_id = $1 AND company_id = $2`,
      scope
    ),
    query<BoardOverrideRow>(
      `SELECT variant_id, channel_id, price_regular, price_high
       FROM ticketing.ticket_variant_channel_prices
       WHERE branch_id = $1 AND company_id = $2`,
      scope
    ),
  ]);
  return buildChannelBoard({ products, variants, channels, distributions, overrides });
}

/**
 * Opsi ticket utk registrasi loket: hanya produk Active yang terdistribusi
 * ke kanal walk-in, per varian aktif (paket + komposisinya).
 */
export async function loadLoketOptions(ctx: TicketingContext) {
  const rows = await query<LoketOptionRow>(
    `SELECT pv.id AS variant_id, pv.name AS variant_name,
            tp.id AS ticket_product_id, tp.code AS ticket_code,
            tp.name AS ticket_name, tp.product_kind,
            pv.price_regular, pv.price_high
     FROM ticketing.ticket_product_variants pv
     JOIN ticketing.ticket_products tp ON tp.id = pv.ticket_product_id
     JOIN ticketing.ticket_product_channels pc
       ON pc.ticket_product_id = tp.id AND pc.is_distributed = true
     JOIN ticketing.ticket_channels ch
       ON ch.id = pc.channel_id AND ch.code = 'walk-in'
     WHERE tp.branch_id = $1 AND tp.company_id = $2
       AND tp.status = 'active' AND pv.is_active = true
     ORDER BY tp.name, pv.sort_order`,
    [ctx.branchId, ctx.companyId]
  );

  const bundleIds = rows.filter((r) => r.product_kind === "bundle").map((r) => r.ticket_product_id);
  const memberRows =
    bundleIds.length > 0
      ? await query<LoketBundleMemberRow>(
          `SELECT bi.bundle_product_id, bi.component_variant_id, bi.qty,
                  tp.name AS product_name, pv.name AS variant_name,
                  tp.status AS component_status,
                  tp.product_kind AS component_kind,
                  pv.is_active AS variant_is_active
           FROM ticketing.ticket_bundle_items bi
           JOIN ticketing.ticket_product_variants pv
             ON pv.id = bi.component_variant_id
           JOIN ticketing.ticket_products tp ON tp.id = pv.ticket_product_id
           WHERE bi.bundle_product_id = ANY($1)
             AND bi.branch_id = $2 AND bi.company_id = $3
           ORDER BY bi.sort_order, bi.created_at`,
          [bundleIds, ctx.branchId, ctx.companyId]
        )
      : [];
  return buildLoketOptions(rows, memberRows);
}
