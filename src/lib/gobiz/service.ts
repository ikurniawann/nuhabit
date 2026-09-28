/**
 * Orkestrasi integrasi GoBiz/GoFood (EPIC-049): sinkron katalog, pendaftaran
 * webhook, pemrosesan event, terima/tolak/siap order, dan pemetaan ke
 * pos_orders (order_type delivery, lunas via 'gofood') sehingga KDS, laporan,
 * dan kasir melihatnya seperti order biasa.
 */

import { randomUUID } from "crypto";
import { query, queryOne } from "@/lib/db";
import { createPgClient } from "@/lib/pg/create-client";
import { getCrmDefaultVenue } from "@/lib/crm/server";
import { allocateQueueNumber } from "@/lib/pos/queue-number";
import { loadProductsByIds } from "@/lib/table-order/server";
import type { CatalogProductInput } from "./catalog";
import { buildGobizCatalog, priceCatalogForChannel } from "./catalog";
import { loadChannelOverrides, loadChannelRule } from "@/lib/pos/channel-pricing-server";
import {
  acceptGofoodOrder as apiAccept,
  getGobizAccessToken,
  GobizApiError,
  markGofoodFoodReady as apiFoodReady,
  pushGofoodCatalog,
  rejectGofoodOrder as apiReject,
  subscribeGobizNotification,
} from "./client";
import { ensureWebhookToken, gobizWebhookUrl, isGobizConfigured, loadGobizConfig, type GobizConfig } from "./config";
import {
  mapGofoodItems,
  posOrderNotes,
  shouldAdvanceStatus,
  statusFromEventName,
  summarizeGofoodOrder,
  type CatalogProductRef,
} from "./mapping";
import {
  GOFOOD_WEBHOOK_EVENTS,
  type GofoodCancelReasonCode,
  type GofoodOrderStatus,
  type GofoodOrderType,
  type GofoodWebhookEvent,
  type GofoodWebhookItem,
  type MappedGofoodLine,
  type UnmappedGofoodLine,
} from "./types";

const FALLBACK_CASHIER_ID = "00000000-0000-0000-0000-000000000001";
const GOFOOD_TAG = "GoFood";

export class GobizNotConfiguredError extends Error {
  constructor() {
    super("GoBiz belum dikonfigurasi — isi Client ID, Client Secret, dan Outlet ID di Settings → Integrasi");
    this.name = "GobizNotConfiguredError";
  }
}

async function requireConfig(): Promise<GobizConfig> {
  const config = await loadGobizConfig();
  if (!isGobizConfigured(config)) throw new GobizNotConfiguredError();
  return config;
}

// ---------------------------------------------------------------------------
// Koneksi, webhook, katalog
// ---------------------------------------------------------------------------

export async function testGobizConnection() {
  const config = await requireConfig();
  const token = await getGobizAccessToken(config);
  return { ok: true, environment: config.environment, token_preview: `${token.slice(0, 6)}…` };
}

export async function registerGobizWebhooks(appUrl: string) {
  const config = await requireConfig();
  const token = config.webhookToken || (await ensureWebhookToken());
  const url = gobizWebhookUrl(appUrl, token);
  const results: Array<{ event: string; ok: boolean; error?: string }> = [];
  for (const event of GOFOOD_WEBHOOK_EVENTS) {
    try {
      await subscribeGobizNotification(config, event, url);
      results.push({ event, ok: true });
    } catch (error) {
      results.push({ event, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { url, results };
}

type CatalogRow = {
  id: string;
  name: string;
  description: string | null;
  base_price: number;
  image_url: string | null;
  is_available: boolean | null;
  category_name: string | null;
  variants: Array<{ id: string; name: string; price_adjustment: number; group_name: string | null }> | string;
};

/** Katalog POS aktif (tersedia & tidak) — GoFood butuh full replace, in_stock ikut is_available. */
export async function loadCatalogProductsForGobiz(): Promise<CatalogProductInput[]> {
  const rows = await query<CatalogRow>(
    `SELECT p.id, p.name, p.description, p.base_price::float AS base_price, p.image_url,
            p.is_available, c.name AS category_name,
            COALESCE(json_agg(json_build_object(
              'id', v.id, 'name', v.name, 'price_adjustment', v.price_adjustment::float,
              'group_name', v.group_name
            ) ORDER BY v.display_order NULLS LAST, v.name) FILTER (WHERE v.id IS NOT NULL AND v.is_active IS NOT FALSE), '[]'::json) AS variants
     FROM pos.pos_products p
     LEFT JOIN pos.pos_categories c ON c.id = p.category_id
     LEFT JOIN pos.pos_product_variants v ON v.product_id = p.id
     WHERE p.is_active = true AND COALESCE(p.product_kind, 'regular') <> 'gift_card'
     GROUP BY p.id, c.name, c.display_order
     ORDER BY c.display_order NULLS LAST, c.name NULLS LAST, p.name`
  );
  return rows.map((row) => {
    const variants = typeof row.variants === "string" ? (JSON.parse(row.variants) as CatalogRow["variants"]) : row.variants;
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      price: Number(row.base_price) || 0,
      image: row.image_url,
      inStock: row.is_available !== false,
      categoryName: row.category_name,
      variants: (Array.isArray(variants) ? variants : []).map((variant) => ({
        id: variant.id,
        name: variant.name,
        priceAdjustment: Number(variant.price_adjustment) || 0,
        groupName: variant.group_name,
      })),
    };
  });
}

export async function syncCatalogToGobiz(appUrl: string) {
  const config = await requireConfig();
  const [baseProducts, gofoodRule, gofoodOverrides] = await Promise.all([
    loadCatalogProductsForGobiz(),
    loadChannelRule("gofood"),
    loadChannelOverrides("gofood"),
  ]);
  // Harga GoFood (markup + harga manual); tanpa baris channel = harga dasar.
  const products = gofoodRule ? priceCatalogForChannel(baseProducts, gofoodRule, gofoodOverrides) : baseProducts;
  const requestId = randomUUID();
  const built = buildGobizCatalog(products, { appUrl, requestId });

  const inserted = await queryOne<{ id: string }>(
    `INSERT INTO pos.gofood_catalog_syncs (request_id, item_count, status) VALUES ($1, $2, 'sent') RETURNING id`,
    [requestId, built.stats.items]
  );
  try {
    const response = await pushGofoodCatalog(config, built.payload);
    await query(`UPDATE pos.gofood_catalog_syncs SET status = 'success', response = $2 WHERE id = $1`, [
      inserted?.id,
      JSON.stringify(response),
    ]);
    return { request_id: requestId, stats: built.stats, response };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await query(`UPDATE pos.gofood_catalog_syncs SET status = 'failed', error = $2 WHERE id = $1`, [
      inserted?.id,
      message,
    ]);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Event webhook
// ---------------------------------------------------------------------------

export type GofoodOrderRow = {
  id: string;
  gofood_order_id: string;
  gofood_order_type: GofoodOrderType;
  outlet_id: string | null;
  status: GofoodOrderStatus;
  pos_order_id: string | null;
  order_total: number;
  currency: string;
  customer_name: string | null;
  driver_name: string | null;
  pin: string | null;
  cutlery_requested: boolean;
  takeaway_charges: number;
  items: MappedGofoodLine[];
  unmapped_items: UnmappedGofoodLine[];
  raw_payload: unknown;
  notes: string | null;
  awaiting_since: string | null;
  accepted_at: string | null;
  rejected_at: string | null;
  food_ready_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  pos_order_number?: string | null;
  pos_queue_number?: string | null;
  pos_status?: string | null;
};

const ORDER_SELECT = `
  SELECT g.*, g.order_total::float AS order_total, g.takeaway_charges::float AS takeaway_charges,
         o.order_number AS pos_order_number, o.queue_number AS pos_queue_number, o.status::text AS pos_status
  FROM pos.gofood_orders g
  LEFT JOIN pos.pos_orders o ON o.id = g.pos_order_id`;

export async function getGofoodOrder(id: string) {
  return queryOne<GofoodOrderRow>(`${ORDER_SELECT} WHERE g.id = $1`, [id]);
}

export async function getGofoodOrderByGofoodId(gofoodOrderId: string) {
  return queryOne<GofoodOrderRow>(`${ORDER_SELECT} WHERE g.gofood_order_id = $1`, [gofoodOrderId]);
}

export async function getGofoodOrderByPosOrderId(posOrderId: string) {
  return queryOne<GofoodOrderRow>(`${ORDER_SELECT} WHERE g.pos_order_id = $1`, [posOrderId]);
}

export async function listGofoodOrders(input: { status?: string | null; limit?: number } = {}) {
  const params: unknown[] = [];
  let where = "";
  if (input.status === "active") {
    where = `WHERE g.status IN ('created','awaiting_acceptance','accepted','driver_otw_pickup','driver_arrived','placed')`;
  } else if (input.status) {
    params.push(input.status);
    where = `WHERE g.status = $${params.length}`;
  }
  params.push(Math.min(200, Math.max(1, input.limit ?? 50)));
  return query<GofoodOrderRow>(`${ORDER_SELECT} ${where} ORDER BY g.created_at DESC LIMIT $${params.length}`, params);
}

/** Simpan event; false bila event_id sudah pernah diterima (idempotency). */
export async function recordGofoodEvent(event: GofoodWebhookEvent, idempotencyKey: string | null) {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO pos.gofood_events (event_id, event_name, gofood_order_id, idempotency_key, payload)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (event_id) DO NOTHING
     RETURNING id`,
    [
      event.header.event_id,
      event.header.event_name,
      event.body.order?.order_number ?? null,
      idempotencyKey,
      JSON.stringify(event),
    ]
  );
  return row?.id ?? null;
}

async function finishEvent(eventRowId: string | null, result: string, error?: string) {
  if (!eventRowId) return;
  await query(`UPDATE pos.gofood_events SET result = $2, error = $3, processed_at = now() WHERE id = $1`, [
    eventRowId,
    result,
    error ?? null,
  ]);
}

async function loadProductRefs(items: GofoodWebhookItem[]) {
  const ids = items.map((item) => String(item.external_id || "")).filter(Boolean);
  const products = await loadProductsByIds(ids);
  const refs = new Map<string, CatalogProductRef>();
  for (const [id, product] of products) {
    refs.set(id, {
      id,
      name: product.name,
      sku: product.sku,
      station: product.station,
      variants: product.variants.map((variant) => ({ id: variant.id, name: variant.name })),
    });
  }
  return refs;
}

/** Upsert baris gofood_orders dari event; kembalikan baris terbaru. */
async function upsertGofoodOrderFromEvent(event: GofoodWebhookEvent, venue: { companyId: string | null; branchId: string | null }) {
  const summary = summarizeGofoodOrder(event);
  const nextStatus = statusFromEventName(event.header.event_name);
  const existing = await getGofoodOrderByGofoodId(summary.gofood_order_id);

  // Item hanya dipetakan saat payload membawa order_items (event order.*).
  let mapped: { lines: MappedGofoodLine[]; unmapped: UnmappedGofoodLine[] } | null = null;
  if (summary.items.length > 0 && (!existing || existing.items.length === 0)) {
    mapped = mapGofoodItems(summary.items, await loadProductRefs(summary.items));
  }

  if (!existing) {
    const status: GofoodOrderStatus = nextStatus ?? "created";
    return (await queryOne<GofoodOrderRow>(
      `INSERT INTO pos.gofood_orders (
         gofood_order_id, gofood_order_type, outlet_id, status, order_total, currency,
         customer_name, driver_name, pin, cutlery_requested, takeaway_charges,
         items, unmapped_items, raw_payload, awaiting_since, cancel_reason, company_id, branch_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       RETURNING *, order_total::float AS order_total, takeaway_charges::float AS takeaway_charges`,
      [
        summary.gofood_order_id,
        summary.gofood_order_type,
        summary.outlet_id,
        status,
        summary.order_total,
        summary.currency,
        summary.customer_name,
        summary.driver_name,
        summary.pin,
        summary.cutlery_requested,
        summary.takeaway_charges,
        JSON.stringify(mapped?.lines ?? []),
        JSON.stringify(mapped?.unmapped ?? []),
        JSON.stringify(event),
        status === "awaiting_acceptance" ? new Date().toISOString() : null,
        summary.cancel_reason,
        venue.companyId,
        venue.branchId,
      ]
    ))!;
  }

  const advance = nextStatus ? shouldAdvanceStatus(existing.status, nextStatus) : false;
  const status = advance && nextStatus ? nextStatus : existing.status;
  return (await queryOne<GofoodOrderRow>(
    `UPDATE pos.gofood_orders SET
       status = $2,
       driver_name = COALESCE($3, driver_name),
       customer_name = COALESCE($4, customer_name),
       pin = COALESCE($5, pin),
       order_total = CASE WHEN $6 > 0 THEN $6 ELSE order_total END,
       items = CASE WHEN $7::jsonb IS NOT NULL THEN $7::jsonb ELSE items END,
       unmapped_items = CASE WHEN $8::jsonb IS NOT NULL THEN $8::jsonb ELSE unmapped_items END,
       raw_payload = $9,
       awaiting_since = CASE WHEN $2 = 'awaiting_acceptance' AND awaiting_since IS NULL THEN now() ELSE awaiting_since END,
       cancelled_at = CASE WHEN $2 = 'cancelled' AND cancelled_at IS NULL THEN now() ELSE cancelled_at END,
       completed_at = CASE WHEN $2 = 'completed' AND completed_at IS NULL THEN now() ELSE completed_at END,
       accepted_at = CASE WHEN $2 = 'accepted' AND accepted_at IS NULL THEN now() ELSE accepted_at END,
       cancel_reason = COALESCE($10, cancel_reason),
       updated_at = now()
     WHERE id = $1
     RETURNING *, order_total::float AS order_total, takeaway_charges::float AS takeaway_charges`,
    [
      existing.id,
      status,
      summary.driver_name,
      summary.customer_name,
      summary.pin,
      summary.order_total,
      mapped ? JSON.stringify(mapped.lines) : null,
      mapped ? JSON.stringify(mapped.unmapped) : null,
      JSON.stringify(event),
      summary.cancel_reason,
    ]
  ))!;
}

/** Buat pos_orders + item dari baris GoFood yang sudah diterima (idempoten per baris). */
export async function ensurePosOrderForGofood(row: GofoodOrderRow): Promise<string | null> {
  if (row.pos_order_id) return row.pos_order_id;
  if (row.items.length === 0) return null; // tidak ada item terpetakan — kasir tangani manual

  const db = createPgClient();
  const venue = await getCrmDefaultVenue(db);
  const { data: orderNumData, error: orderNumError } = await db.rpc("generate_order_number");
  if (orderNumError) throw orderNumError;
  const orderNumber = typeof orderNumData === "string" ? orderNumData : String(orderNumData);
  const queueNumber = await allocateQueueNumber(db, venue.companyId, venue.branchId);

  const subtotal = row.items.reduce((sum, line) => sum + line.unit_price * line.quantity, 0);
  const total = row.order_total > 0 ? row.order_total : subtotal;
  const otherCharges = Math.max(0, total - subtotal);
  const notes = posOrderNotes({
    gofood_order_id: row.gofood_order_id,
    gofood_order_type: row.gofood_order_type,
    pin: row.pin,
    customer_name: row.customer_name,
    cutlery_requested: row.cutlery_requested,
    unmappedCount: row.unmapped_items.length,
  });

  const { data: order, error: orderError } = await db
    .from("pos_orders")
    .insert({
      order_number: orderNumber,
      queue_number: queueNumber,
      order_type: "delivery",
      status: "confirmed",
      payment_status: "paid",
      customer_id: null,
      cashier_id: FALLBACK_CASHIER_ID,
      table_id: null,
      subtotal,
      discount_amount: 0,
      tax_amount: 0,
      service_charge_amount: 0,
      other_charges_amount: otherCharges,
      charges_breakdown: otherCharges > 0 ? [{ code: "GOFOOD", name: "Biaya GoFood", kind: "fee", amount: otherCharges }] : [],
      total_amount: total,
      payment_method: null,
      payment_method_code: "gofood",
      payment_method_name: GOFOOD_TAG,
      amount_paid: total,
      ark_coins_used: 0,
      notes,
      special_requests: `${GOFOOD_TAG} ${row.gofood_order_id}; type=${row.gofood_order_type}`,
      ordered_at: new Date().toISOString(),
      confirmed_at: new Date().toISOString(),
      company_id: venue.companyId,
      branch_id: venue.branchId,
    })
    .select()
    .single();
  if (orderError || !order) throw orderError ?? new Error("Gagal membuat order POS dari GoFood");
  const orderId = (order as { id: string }).id;

  const { error: itemsError } = await db.from("pos_order_items").insert(
    row.items.map((line) => ({
      order_id: orderId,
      product_id: line.product_id,
      product_name: line.product_name,
      product_sku: line.product_sku,
      variants: line.variant_name ? [{ name: line.variant_name }] : [],
      modifiers: [],
      quantity: line.quantity,
      unit_price: line.unit_price,
      subtotal: line.unit_price * line.quantity,
      total_amount: line.unit_price * line.quantity,
      kitchen_notes: [`${GOFOOD_TAG} ${row.gofood_order_id}`, line.notes].filter(Boolean).join(" · "),
      station: line.station,
      kitchen_status: "pending",
      xp_earned: 0,
      inventory_deducted: false,
    }))
  );
  if (itemsError) throw itemsError;

  await db.from("pos_order_status_history").insert({
    order_id: orderId,
    from_status: null,
    to_status: "confirmed",
    changed_by: FALLBACK_CASHIER_ID,
    notes: `Created from GoFood ${row.gofood_order_id}`,
  });

  await query(`UPDATE pos.gofood_orders SET pos_order_id = $2, updated_at = now() WHERE id = $1`, [row.id, orderId]);
  return orderId;
}

async function setPosOrderStatus(posOrderId: string, status: "cancelled" | "completed", note: string) {
  const current = await queryOne<{ status: string }>(`SELECT status::text AS status FROM pos.pos_orders WHERE id = $1`, [posOrderId]);
  if (!current) return;
  if (["cancelled", "voided", "completed", "merged"].includes(current.status)) return;
  const now = new Date().toISOString();
  await query(
    `UPDATE pos.pos_orders SET status = $2::pos_order_status, ${status === "cancelled" ? "cancelled_at" : "completed_at"} = now(), updated_at = now() WHERE id = $1`,
    [posOrderId, status]
  );
  if (status === "cancelled") {
    await query(`UPDATE pos.pos_order_items SET kitchen_status = 'cancelled', updated_at = now() WHERE order_id = $1`, [posOrderId]);
  }
  await query(
    `INSERT INTO pos.pos_order_status_history (order_id, from_status, to_status, changed_by, notes, changed_at)
     VALUES ($1, $2::pos_order_status, $3::pos_order_status, $4, $5, $6)`,
    [posOrderId, current.status, status, FALLBACK_CASHIER_ID, note, now]
  );
}

/** Auto-accept: klaim atomik supaya event dobel tidak menerima dua kali. */
async function claimForAutoAccept(rowId: string) {
  const claimed = await queryOne<{ id: string }>(
    `UPDATE pos.gofood_orders SET status = 'accepted', accepted_at = now(), updated_at = now()
     WHERE id = $1 AND status = 'awaiting_acceptance' RETURNING id`,
    [rowId]
  );
  return Boolean(claimed);
}

export async function processGofoodEvent(event: GofoodWebhookEvent, eventRowId: string | null): Promise<string> {
  const config = await loadGobizConfig();
  const eventName = event.header.event_name;

  if (!eventName.startsWith("gofood.order.") || !event.body.order?.order_number) {
    await finishEvent(eventRowId, "ignored_non_order");
    return "ignored_non_order";
  }

  try {
    const db = createPgClient();
    const venue = await getCrmDefaultVenue(db);
    const row = await upsertGofoodOrderFromEvent(event, venue);
    let result = `status:${row.status}`;

    if (eventName === "gofood.order.awaiting_merchant_acceptance" && row.status === "awaiting_acceptance") {
      if (config.autoAccept && isGobizConfigured(config)) {
        if (await claimForAutoAccept(row.id)) {
          try {
            await apiAccept(config, row.gofood_order_type, row.gofood_order_id);
            const fresh = (await getGofoodOrder(row.id)) ?? row;
            await ensurePosOrderForGofood(fresh);
            result = "auto_accepted";
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            await query(
              `UPDATE pos.gofood_orders SET status = 'awaiting_acceptance', accepted_at = NULL, last_error = $2, updated_at = now() WHERE id = $1`,
              [row.id, message]
            );
            result = `auto_accept_failed:${message}`;
          }
        }
      }
    } else if (eventName === "gofood.order.merchant_accepted" && row.status === "accepted") {
      // Diterima (mungkin dari aplikasi GoBiz) → pastikan order POS ada.
      await ensurePosOrderForGofood(row);
      result = "accepted_synced";
    } else if (eventName === "gofood.order.cancelled") {
      if (row.pos_order_id) await setPosOrderStatus(row.pos_order_id, "cancelled", `GoFood ${row.gofood_order_id} dibatalkan: ${row.cancel_reason || "-"}`);
      result = "cancelled";
    } else if (eventName === "gofood.order.completed") {
      if (row.pos_order_id) await setPosOrderStatus(row.pos_order_id, "completed", `GoFood ${row.gofood_order_id} selesai`);
      result = "completed";
    }

    await finishEvent(eventRowId, result);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishEvent(eventRowId, "error", message);
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Aksi kasir
// ---------------------------------------------------------------------------

export async function acceptGofoodOrderById(id: string) {
  const config = await requireConfig();
  const row = await getGofoodOrder(id);
  if (!row) throw new Error("Order GoFood tidak ditemukan");
  if (row.status !== "awaiting_acceptance" && row.status !== "created") {
    throw new Error(`Order sudah berstatus ${row.status}`);
  }
  await apiAccept(config, row.gofood_order_type, row.gofood_order_id);
  await query(`UPDATE pos.gofood_orders SET status = 'accepted', accepted_at = now(), last_error = NULL, updated_at = now() WHERE id = $1`, [id]);
  const fresh = (await getGofoodOrder(id))!;
  const posOrderId = await ensurePosOrderForGofood(fresh);
  return { ...fresh, pos_order_id: posOrderId };
}

export async function rejectGofoodOrderById(id: string, reason: { code: GofoodCancelReasonCode; description: string }) {
  const config = await requireConfig();
  const row = await getGofoodOrder(id);
  if (!row) throw new Error("Order GoFood tidak ditemukan");
  if (!["awaiting_acceptance", "created", "accepted"].includes(row.status)) {
    throw new Error(`Order sudah berstatus ${row.status}`);
  }
  await apiReject(config, row.gofood_order_type, row.gofood_order_id, reason);
  await query(
    `UPDATE pos.gofood_orders SET status = 'rejected', rejected_at = now(), cancel_reason = $2, last_error = NULL, updated_at = now() WHERE id = $1`,
    [id, `${reason.code}: ${reason.description}`]
  );
  if (row.pos_order_id) await setPosOrderStatus(row.pos_order_id, "cancelled", `GoFood ${row.gofood_order_id} ditolak: ${reason.description}`);
  return (await getGofoodOrder(id))!;
}

export async function markGofoodOrderReadyById(id: string) {
  const config = await requireConfig();
  const row = await getGofoodOrder(id);
  if (!row) throw new Error("Order GoFood tidak ditemukan");
  if (row.food_ready_at) return row;
  await apiFoodReady(config, row.gofood_order_type, row.gofood_order_id);
  await query(`UPDATE pos.gofood_orders SET food_ready_at = now(), last_error = NULL, updated_at = now() WHERE id = $1`, [id]);
  return (await getGofoodOrder(id))!;
}

/** Hook KDS: order POS ditandai siap → beri tahu GoFood (best-effort, tidak melempar). */
export async function notifyGofoodFoodReadyForPosOrder(posOrderId: string) {
  try {
    const row = await getGofoodOrderByPosOrderId(posOrderId);
    if (!row || row.food_ready_at || !["accepted", "driver_otw_pickup", "driver_arrived"].includes(row.status)) return;
    await markGofoodOrderReadyById(row.id);
  } catch (error) {
    const message = error instanceof GobizApiError ? `${error.status} ${error.message}` : error instanceof Error ? error.message : String(error);
    console.error(`[gobiz] food-prepared gagal utk pos_order=${posOrderId}:`, message);
    await query(`UPDATE pos.gofood_orders SET last_error = $2, updated_at = now() WHERE pos_order_id = $1`, [posOrderId, message]).catch(() => undefined);
  }
}
