// EPIC-039 Fase E — back-office pesanan toko online: daftar, detail, transisi
// status. Pembuatan pengiriman ada di ./order-shipment.

import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import {
  releaseExpiredReservations,
  releaseOrderReservations,
  restoreCommittedReservations,
} from "@/lib/shop/storefront-server";

/**
 * Transisi yang diizinkan: paid→packing, shipped→completed, dan cancel
 * (pending/paid/packing). Shipped diproses lewat endpoint /shipment.
 */
const ORDER_TRANSITIONS: Record<string, readonly string[]> = {
  packing: ["paid"],
  completed: ["shipped"],
  cancelled: ["pending", "paid", "packing"],
};

/** Status asal yang boleh menuju `nextStatus`; null bila transisi tidak dikenal. */
export function allowedFromStatuses(nextStatus: string): readonly string[] | null {
  return Object.hasOwn(ORDER_TRANSITIONS, nextStatus) ? ORDER_TRANSITIONS[nextStatus] : null;
}

/** Order yang sudah dibayar dan belum dikirim boleh dibuatkan pengiriman. */
export function canShipOrder(status: string): boolean {
  return status === "paid" || status === "packing";
}

/** id order bukan UUID diperlakukan sama dengan order yang tidak ada. */
export function assertOrderId(id: string): void {
  if (!z.string().uuid().safeParse(id).success) throw ApiError.notFound("Order tidak ditemukan");
}

export type ShopOrderListFilter = { status: string; search: string; limit: number };

export function parseShopOrderListFilter(params: URLSearchParams): ShopOrderListFilter {
  return {
    status: String(params.get("status") || "").trim(),
    search: String(params.get("search") || "").trim(),
    limit: Math.min(200, Math.max(1, Number(params.get("limit")) || 100)),
  };
}

export async function listShopOrders(filter: ShopOrderListFilter) {
  await releaseExpiredReservations();

  const conditions: string[] = [];
  const params: unknown[] = [];
  if (filter.status) {
    params.push(filter.status);
    conditions.push(`o.status = $${params.length}`);
  }
  if (filter.search) {
    params.push(`%${filter.search}%`);
    conditions.push(
      `(o.order_number ILIKE $${params.length} OR o.customer_name ILIKE $${params.length} OR o.customer_phone ILIKE $${params.length})`
    );
  }
  params.push(filter.limit);

  return query(
    `SELECT o.id, o.order_number, o.status, o.customer_name, o.customer_phone,
            o.shipping_area_label, o.courier_code, o.courier_service,
            o.subtotal, o.shipping_cost, o.total, o.waybill, o.paid_at,
            o.created_at, o.customer_id,
            (SELECT COUNT(*) FROM shop.order_items i WHERE i.order_id = o.id) AS item_count,
            s.status AS shipment_status, s.provider AS shipment_provider
     FROM shop.orders o
     LEFT JOIN shop.shipments s
       ON s.order_id = o.id AND s.status NOT IN ('failed','cancelled')
     ${conditions.length ? `WHERE ${conditions.join(" AND ")}` : ""}
     ORDER BY o.created_at DESC
     LIMIT $${params.length}`,
    params
  );
}

export async function getShopOrderDetail(id: string) {
  const order = await queryOne<Record<string, unknown>>(
    `SELECT o.*, s.id AS shipment_id, s.provider AS shipment_provider,
            s.status AS shipment_status, s.provider_order_id,
            s.tracking_history
     FROM shop.orders o
     LEFT JOIN shop.shipments s
       ON s.order_id = o.id AND s.status NOT IN ('failed','cancelled')
     WHERE o.id = $1::uuid`,
    [id]
  );
  if (!order) throw ApiError.notFound("Order tidak ditemukan");

  const items = await query(
    `SELECT product_name, sku_name, sku_code, quantity, unit_price, total, weight_gram
     FROM shop.order_items WHERE order_id = $1::uuid ORDER BY product_name`,
    [id]
  );
  return { ...order, items };
}

export async function transitionShopOrder(id: string, nextStatus: string, note: string | null) {
  const allowedFrom = allowedFromStatuses(nextStatus);
  if (!allowedFrom) throw ApiError.badRequest("Transisi status tidak dikenal");

  const updated = await queryOne<{ id: string; status: string; prev_status: string }>(
    `UPDATE shop.orders o
     SET status = $2, updated_at = now(),
         notes = CASE WHEN $3::text IS NOT NULL
                      THEN COALESCE(o.notes || E'\n', '') || $3::text
                      ELSE o.notes END
     FROM (SELECT status AS prev_status FROM shop.orders WHERE id = $1::uuid) prev
     WHERE o.id = $1::uuid AND o.status = ANY($4::text[])
     RETURNING o.id, o.status, prev.prev_status`,
    [id, nextStatus, note, allowedFrom]
  );
  if (!updated) throw ApiError.conflict("Status order sudah berubah — muat ulang");

  if (nextStatus === "cancelled") {
    // Pending: reservasi held; paid/packing: committed — dua-duanya
    // dikembalikan. Refund uang = MANUAL via dashboard Xendit (owner).
    if (updated.prev_status === "pending") {
      await releaseOrderReservations(id);
    } else {
      await restoreCommittedReservations(id);
      await query(
        `UPDATE shop.shipments SET status='cancelled', updated_at=now()
         WHERE order_id = $1::uuid AND status NOT IN ('failed','cancelled')`,
        [id]
      ).catch(() => {});
    }
  }
  return updated;
}
