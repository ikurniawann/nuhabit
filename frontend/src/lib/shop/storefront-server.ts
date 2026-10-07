import "server-only";
// EPIC-039 Fase D — server logic storefront publik: katalog, checkout
// (reservasi stok klaim-dulu + invoice Xendit), commit/release reservasi.
//
// Stok: reuse fungsi klaim Fase A/B (pos_sell_merchandise_stock /
// _sku_stock) — reservasi = klaim + baris shop.stock_reservations ber-TTL.
// Expired dirilis opportunistik via shop.release_expired_reservations()
// (dipanggil di katalog & checkout, tanpa cron).

import { query, queryOne, withTransaction } from "@/lib/db";
import { createInvoice, getInvoiceExpiryHours, isXenditConfigured } from "@/lib/xendit/client";
import type { CatalogProduct, CatalogSku } from "@/lib/shop/types";

export const SHOP_INVOICE_PREFIX = "shop-order-";

export type StorefrontRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  venue_ids: string[] | null;
};

const DEFAULT_ITEM_WEIGHT_GRAM = 1000;

export async function releaseExpiredReservations(): Promise<void> {
  try {
    await query("SELECT shop.release_expired_reservations()");
  } catch (error) {
    console.error("[shop] release expired reservations failed:", error);
  }
}

export async function resolveStorefront(slug: string): Promise<StorefrontRow | null> {
  if (slug.toLowerCase() === "default") {
    return queryOne<StorefrontRow>(
      `SELECT id, slug, name, description, venue_ids
       FROM shop.storefronts
       WHERE is_active = true
       ORDER BY is_default DESC, created_at, id
       LIMIT 1`
    );
  }
  return queryOne<StorefrontRow>(
    `SELECT id, slug, name, description, venue_ids
     FROM shop.storefronts
     WHERE lower(slug) = lower($1) AND is_active = true`,
    [slug]
  );
}

/** Katalog publik: produk merchandise aktif yang didistribusikan ke channel web. */
export async function buildShopCatalog(): Promise<CatalogProduct[]> {
  const rows = await query<{
    id: string;
    name: string;
    description: string | null;
    long_description: string | null;
    size_guide: string | null;
    image_url: string | null;
    base_price: string;
    channel_price: string | null;
    weight_gram: string | null;
    inventory_quantity: string | null;
  }>(
    `SELECT p.id, p.name, p.description, p.long_description, p.size_guide, p.image_url,
            p.base_price, pc.price_override AS channel_price,
            p.weight_gram, p.inventory_quantity
     FROM pos.pos_products p
     JOIN shop.product_channels pc
       ON pc.product_id = p.id AND pc.channel_code = 'web' AND pc.is_distributed
     WHERE p.product_kind = 'merchandise'
       AND p.is_active = true AND p.is_available = true
     ORDER BY p.name`
  );

  if (rows.length === 0) return [];
  const productIds = rows.map((row) => row.id);

  const skuRows = await query<{
    id: string;
    product_id: string;
    sku: string;
    name: string;
    price_override: string | null;
    stock_quantity: string;
  }>(
    `SELECT id, product_id, sku, name, price_override, stock_quantity
     FROM pos.pos_product_skus
     WHERE product_id = ANY($1::uuid[]) AND is_active = true
     ORDER BY name`,
    [productIds]
  );

  const imageRows = await query<{ product_id: string; url: string }>(
    `SELECT product_id, url
     FROM pos.pos_product_images
     WHERE product_id = ANY($1::uuid[])
     ORDER BY display_order`,
    [productIds]
  );

  const skusByProduct = new Map<string, CatalogSku[]>();
  for (const sku of skuRows) {
    const list = skusByProduct.get(sku.product_id) ?? [];
    list.push({
      id: sku.id,
      sku: sku.sku,
      name: sku.name,
      price: Number(sku.price_override ?? NaN),
      stock: Number(sku.stock_quantity) || 0,
      preorder: false,
    });
    skusByProduct.set(sku.product_id, list);
  }

  const imagesByProduct = new Map<string, string[]>();
  for (const image of imageRows) {
    const list = imagesByProduct.get(image.product_id) ?? [];
    list.push(image.url);
    imagesByProduct.set(image.product_id, list);
  }

  return rows.map((row) => {
    const basePrice = Number(row.channel_price ?? row.base_price) || 0;
    const skus = (skusByProduct.get(row.id) ?? []).map((sku) => ({
      ...sku,
      price: Number.isFinite(sku.price) ? sku.price : basePrice,
    }));
    const stock =
      skus.length > 0
        ? skus.reduce((sum, sku) => sum + sku.stock, 0)
        : Number(row.inventory_quantity) || 0;

    return {
      id: row.id,
      name: row.name,
      description: row.description,
      longDescription: row.long_description,
      sizeGuide: row.size_guide,
      imageUrl: row.image_url,
      images: imagesByProduct.get(row.id) ?? [],
      price: basePrice,
      weightGram: row.weight_gram === null ? null : Number(row.weight_gram),
      stock,
      // Koleksi dan pre-order hanya dihitung rute Go (/api/public/shop).
      collection: null,
      preorderUntil: null,
      preorder: false,
      skus,
    };
  });
}

// ── Checkout ────────────────────────────────────────────────────────────

export type CheckoutItemInput = {
  product_id: string;
  sku_id?: string | null;
  quantity: number;
};

export type CheckoutInput = {
  storefront: StorefrontRow;
  items: CheckoutItemInput[];
  customer: { name: string; phone: string; email?: string | null };
  destination: {
    areaId: string;
    label: string;
    postalCode?: string | null;
    address: string;
  };
  courier: { code: string; serviceCode: string; provider: string; cost: number };
  notes?: string | null;
  /** URL absolut halaman status utk redirect Xendit */
  baseUrl: string;
};

export type CheckoutResult =
  | {
      ok: true;
      orderId: string;
      orderNumber: string;
      accessToken: string;
      invoiceUrl: string;
    }
  | { ok: false; status: number; reason: string };

type ResolvedLine = {
  productId: string;
  skuId: string | null;
  productName: string;
  skuName: string | null;
  skuCode: string | null;
  quantity: number;
  unitPrice: number;
  weightGram: number;
};

type ClaimRef = { productId: string; skuId: string | null; qty: number };

async function claimLine(claim: ClaimRef): Promise<{ success: boolean; reason?: string }> {
  const row = claim.skuId
    ? await queryOne<{ result: { success?: boolean; skipped?: boolean; reason?: string } }>(
        "SELECT public.pos_sell_merchandise_sku_stock($1::uuid, $2::numeric) AS result",
        [claim.skuId, claim.qty]
      )
    : await queryOne<{ result: { success?: boolean; skipped?: boolean; reason?: string } }>(
        "SELECT public.pos_sell_merchandise_stock($1::uuid, $2::numeric) AS result",
        [claim.productId, claim.qty]
      );
  const result = row?.result ?? {};
  if (result.success === false) {
    return { success: false, reason: result.reason };
  }
  // skipped=true (produk non-tracking) tetap dianggap sukses — stok tidak dijaga
  return { success: true };
}

async function restoreClaims(claims: ClaimRef[]): Promise<void> {
  for (const claim of claims) {
    try {
      if (claim.skuId) {
        await query("SELECT public.pos_sell_merchandise_sku_stock($1::uuid, $2::numeric)", [
          claim.skuId,
          -claim.qty,
        ]);
      } else {
        await query("SELECT public.pos_sell_merchandise_stock($1::uuid, $2::numeric)", [
          claim.productId,
          -claim.qty,
        ]);
      }
    } catch (error) {
      console.error("[shop] checkout restore claim failed:", error);
    }
  }
}

/** Muat & validasi baris keranjang dari katalog (harga TIDAK dipercaya dari klien). */
async function resolveLines(items: CheckoutItemInput[]): Promise<
  | { ok: true; lines: ResolvedLine[] }
  | { ok: false; reason: string }
> {
  if (items.length === 0) return { ok: false, reason: "Your cart is empty" };
  if (items.length > 50) return { ok: false, reason: "Too many items in the cart" };

  const lines: ResolvedLine[] = [];
  for (const item of items) {
    const qty = Math.floor(Number(item.quantity));
    if (!Number.isFinite(qty) || qty <= 0 || qty > 999) {
      return { ok: false, reason: "Invalid item quantity" };
    }

    const product = await queryOne<{
      id: string;
      name: string;
      base_price: string;
      channel_price: string | null;
      weight_gram: string | null;
      has_active_sku: boolean;
    }>(
      `SELECT p.id, p.name, p.base_price, pc.price_override AS channel_price,
              p.weight_gram,
              EXISTS (
                SELECT 1 FROM pos.pos_product_skus s
                WHERE s.product_id = p.id AND s.is_active = true
              ) AS has_active_sku
       FROM pos.pos_products p
       JOIN shop.product_channels pc
         ON pc.product_id = p.id AND pc.channel_code = 'web' AND pc.is_distributed
       WHERE p.id = $1::uuid AND p.product_kind = 'merchandise'
         AND p.is_active = true AND p.is_available = true`,
      [item.product_id]
    );
    if (!product) {
      return { ok: false, reason: "A product is no longer available. Reload the catalog." };
    }

    const basePrice = Number(product.channel_price ?? product.base_price) || 0;
    const weight = product.weight_gram === null
      ? DEFAULT_ITEM_WEIGHT_GRAM
      : Number(product.weight_gram) || DEFAULT_ITEM_WEIGHT_GRAM;

    if (item.sku_id) {
      const sku = await queryOne<{
        id: string;
        sku: string;
        name: string;
        price_override: string | null;
      }>(
        `SELECT id, sku, name, price_override
         FROM pos.pos_product_skus
         WHERE id = $1::uuid AND product_id = $2::uuid AND is_active = true`,
        [item.sku_id, item.product_id]
      );
      if (!sku) {
        return { ok: false, reason: "A variant is no longer available. Reload the catalog." };
      }
      lines.push({
        productId: product.id,
        skuId: sku.id,
        productName: product.name,
        skuName: sku.name,
        skuCode: sku.sku,
        quantity: qty,
        unitPrice: sku.price_override === null ? basePrice : Number(sku.price_override) || basePrice,
        weightGram: weight,
      });
    } else {
      if (product.has_active_sku) {
        return { ok: false, reason: `Choose a variant for ${product.name}` };
      }
      lines.push({
        productId: product.id,
        skuId: null,
        productName: product.name,
        skuName: null,
        skuCode: null,
        quantity: qty,
        unitPrice: basePrice,
        weightGram: weight,
      });
    }
  }
  return { ok: true, lines };
}

export function totalWeightGram(lines: Array<{ weightGram: number; quantity: number }>): number {
  return lines.reduce((sum, line) => sum + line.weightGram * line.quantity, 0);
}

/** Berat & nilai keranjang dari katalog server (ongkir tidak bisa dimanipulasi klien). */
export async function computeCartWeightAndValue(
  items: Array<{ product_id: string; quantity: number }>
): Promise<{ weightGram: number; itemValue: number }> {
  let weightGram = 0;
  let itemValue = 0;
  for (const item of items) {
    const product = await queryOne<{ weight_gram: string | null; base_price: string }>(
      `SELECT weight_gram, base_price FROM pos.pos_products
       WHERE id = $1::uuid AND product_kind = 'merchandise' AND is_active = true`,
      [item.product_id]
    );
    if (!product) continue;
    const unitWeight =
      product.weight_gram === null
        ? DEFAULT_ITEM_WEIGHT_GRAM
        : Number(product.weight_gram) || DEFAULT_ITEM_WEIGHT_GRAM;
    weightGram += unitWeight * item.quantity;
    itemValue += (Number(product.base_price) || 0) * item.quantity;
  }
  return { weightGram, itemValue };
}

export async function processShopCheckout(input: CheckoutInput): Promise<CheckoutResult> {
  if (!isXenditConfigured()) {
    return { ok: false, status: 503, reason: "Online payment is not available yet" };
  }

  const resolved = await resolveLines(input.items);
  if (!resolved.ok) return { ok: false, status: 400, reason: resolved.reason };
  const lines = resolved.lines;

  const subtotal = lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
  const shippingCost = Math.max(0, Math.round(Number(input.courier.cost) || 0));
  const total = subtotal + shippingCost;
  if (total <= 0) return { ok: false, status: 400, reason: "Invalid order total" };

  // Klaim stok SEBELUM order dibuat (pola kasir Fase A). Gagal di tengah →
  // klaim yang sudah jadi dikembalikan.
  const claims: ClaimRef[] = [];
  for (const line of lines) {
    const claim = { productId: line.productId, skuId: line.skuId, qty: line.quantity };
    const result = await claimLine(claim);
    if (!result.success) {
      await restoreClaims(claims);
      const label = line.skuName ? `${line.productName} (${line.skuName})` : line.productName;
      return {
        ok: false,
        status: 400,
        reason:
          result.reason === "variant_required"
            ? `Choose a variant for ${line.productName}`
            : `Not enough stock for ${label}`,
      };
    }
    claims.push(claim);
  }

  const expiresAt = new Date(Date.now() + getInvoiceExpiryHours() * 60 * 60 * 1000);

  let orderId = "";
  let orderNumber = "";
  let accessToken = "";
  try {
    await withTransaction(async (client) => {
      const orderRow = await client.query(
        `INSERT INTO shop.orders (
           storefront_id, customer_name, customer_phone, customer_email,
           shipping_address, shipping_area_id, shipping_area_label,
           shipping_postal_code, shipping_provider, courier_code,
           courier_service, subtotal, shipping_cost, total,
           invoice_expires_at, notes
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         RETURNING id, order_number, access_token`,
        [
          input.storefront.id,
          input.customer.name,
          input.customer.phone,
          input.customer.email || null,
          input.destination.address,
          input.destination.areaId,
          input.destination.label,
          input.destination.postalCode || null,
          input.courier.provider,
          input.courier.code,
          input.courier.serviceCode,
          subtotal,
          shippingCost,
          total,
          expiresAt.toISOString(),
          input.notes || null,
        ]
      );
      const order = orderRow.rows[0] as {
        id: string;
        order_number: string;
        access_token: string;
      };
      orderId = order.id;
      orderNumber = order.order_number;
      accessToken = order.access_token;

      for (const line of lines) {
        await client.query(
          `INSERT INTO shop.order_items (
             order_id, product_id, sku_id, product_name, sku_name, sku_code,
             quantity, unit_price, total, weight_gram
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            orderId,
            line.productId,
            line.skuId,
            line.productName,
            line.skuName,
            line.skuCode,
            line.quantity,
            line.unitPrice,
            line.unitPrice * line.quantity,
            line.weightGram,
          ]
        );
      }

      for (const claim of claims) {
        await client.query(
          `INSERT INTO shop.stock_reservations (order_id, product_id, sku_id, qty, expires_at)
           VALUES ($1,$2,$3,$4,$5)`,
          [orderId, claim.productId, claim.skuId, claim.qty, expiresAt.toISOString()]
        );
      }
    });
  } catch (error) {
    console.error("[shop] checkout order insert failed:", error);
    await restoreClaims(claims);
    return { ok: false, status: 500, reason: "Could not place the order. Try again." };
  }

  try {
    const invoice = await createInvoice({
      externalId: `${SHOP_INVOICE_PREFIX}${orderId}`,
      amount: total,
      payerName: input.customer.name,
      description: `Order ${orderNumber} — ${input.storefront.name}`,
      redirectUrl: `${input.baseUrl}/shop/order/${accessToken}`,
    });

    await query(
      `UPDATE shop.orders
       SET xendit_invoice_id = $2, xendit_invoice_url = $3, updated_at = now()
       WHERE id = $1::uuid`,
      [orderId, invoice.invoiceId, invoice.invoiceUrl]
    );

    return { ok: true, orderId, orderNumber, accessToken, invoiceUrl: invoice.invoiceUrl };
  } catch (error) {
    console.error(`[shop] xendit invoice failed for order ${orderId}:`, error);
    // Kompensasi penuh: stok balik, reservasi released, order dibatalkan
    await restoreClaims(claims);
    await query(
      `UPDATE shop.stock_reservations SET status='released', updated_at=now()
       WHERE order_id = $1::uuid AND status='held'`,
      [orderId]
    ).catch(() => {});
    await query(
      `UPDATE shop.orders SET status='cancelled', updated_at=now() WHERE id = $1::uuid`,
      [orderId]
    ).catch(() => {});
    return { ok: false, status: 502, reason: "Could not create the payment invoice. Try again." };
  }
}

/** Webhook PAID: commit reservasi (stok final milik order). */
export async function commitOrderReservations(orderId: string): Promise<void> {
  await query(
    `UPDATE shop.stock_reservations SET status='committed', updated_at=now()
     WHERE order_id = $1::uuid AND status='held'`,
    [orderId]
  );
}

/** Webhook EXPIRED / pembatalan: kembalikan stok reservasi yang masih held. */
export async function releaseOrderReservations(orderId: string): Promise<void> {
  const rows = await query<{ id: string; product_id: string; sku_id: string | null; qty: string }>(
    `UPDATE shop.stock_reservations SET status='released', updated_at=now()
     WHERE order_id = $1::uuid AND status='held'
     RETURNING id, product_id, sku_id, qty`,
    [orderId]
  );
  await restoreClaims(
    rows.map((row) => ({
      productId: row.product_id,
      skuId: row.sku_id,
      qty: Number(row.qty) || 0,
    }))
  );
}

/**
 * Fase E — pembatalan order yang SUDAH dibayar (refund manual via dashboard
 * Xendit, keputusan owner): reservasi committed dikembalikan juga.
 */
export async function restoreCommittedReservations(orderId: string): Promise<void> {
  const rows = await query<{ id: string; product_id: string; sku_id: string | null; qty: string }>(
    `UPDATE shop.stock_reservations SET status='released', updated_at=now()
     WHERE order_id = $1::uuid AND status IN ('held','committed')
     RETURNING id, product_id, sku_id, qty`,
    [orderId]
  );
  await restoreClaims(
    rows.map((row) => ({
      productId: row.product_id,
      skuId: row.sku_id,
      qty: Number(row.qty) || 0,
    }))
  );
}
