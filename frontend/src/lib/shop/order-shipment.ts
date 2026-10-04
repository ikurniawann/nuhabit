// EPIC-039 Fase E — buat pengiriman utk order paid/packing.
// Dua mode:
//   * mode 'provider' : Biteship createShipment (origin dari settings) —
//                       waybill bisa menyusul via webhook biteship.
//   * mode 'manual'   : resi diinput back-office (RajaOngkir/kurir apa pun).
// Resi diketahui → order 'shipped' + WA resi ke pembeli (best-effort).

import { z } from "zod";
import { ApiError } from "@/lib/api/auth";
import { query, queryOne } from "@/lib/db";
import { canShipOrder } from "@/lib/shop/orders";
import { loadShippingContext } from "@/lib/shop/shipping";
import { sendShopOrderShippedWa } from "@/lib/shop/shop-wa";

export const shipmentBodySchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("provider") }),
  z.object({
    mode: z.literal("manual"),
    waybill: z.string().trim().min(6).max(60),
    courier_code: z.string().trim().max(30).optional(),
  }),
]);

export type ShipmentBody = z.infer<typeof shipmentBodySchema>;

type OrderRow = {
  id: string;
  order_number: string;
  status: string;
  access_token: string;
  customer_name: string;
  customer_phone: string;
  shipping_address: string;
  shipping_area_id: string | null;
  shipping_postal_code: string | null;
  courier_code: string | null;
  courier_service: string | null;
  total: string;
};

type OrderItemRow = {
  product_name: string;
  sku_name: string | null;
  quantity: string;
  unit_price: string;
  weight_gram: string | null;
};

async function markShipped(order: OrderRow, waybill: string) {
  await query(
    `UPDATE shop.orders SET status='shipped', waybill=$2, updated_at=now()
     WHERE id = $1::uuid AND status IN ('paid','packing')`,
    [order.id, waybill]
  );
  void sendShopOrderShippedWa({
    orderNumber: order.order_number,
    customerName: order.customer_name,
    customerPhone: order.customer_phone,
    total: Number(order.total) || 0,
    accessToken: order.access_token,
    waybill,
    courierLabel: [order.courier_code, order.courier_service].filter(Boolean).join(" "),
  }).catch((err) => console.error(`[shop] WA resi gagal: ${order.order_number}:`, err));
}

async function loadShippableOrder(id: string): Promise<OrderRow> {
  const order = await queryOne<OrderRow>(
    `SELECT id, order_number, status, access_token, customer_name,
            customer_phone, shipping_address, shipping_area_id,
            shipping_postal_code, courier_code, courier_service, total
     FROM shop.orders WHERE id = $1::uuid`,
    [id]
  );
  if (!order) throw ApiError.notFound("Order tidak ditemukan");
  if (!canShipOrder(order.status)) {
    throw ApiError.badRequest("Pengiriman hanya untuk order yang sudah dibayar");
  }

  const existing = await queryOne<{ id: string }>(
    `SELECT id FROM shop.shipments
     WHERE order_id = $1::uuid AND status NOT IN ('failed','cancelled')`,
    [id]
  );
  if (existing) throw ApiError.conflict("Order sudah punya pengiriman aktif");
  return order;
}

export type ShipmentResult = { provider_order_id?: string; waybill: string | null };

export async function createOrderShipment(
  id: string,
  body: ShipmentBody,
  userId: string
): Promise<ShipmentResult> {
  const order = await loadShippableOrder(id);

  if (body.mode === "manual") {
    await query(
      `INSERT INTO shop.shipments (order_id, provider, courier_code, courier_service, waybill, status, created_by)
       VALUES ($1::uuid, 'manual', $2, $3, $4, 'in_transit', $5::uuid)`,
      [id, body.courier_code || order.courier_code, order.courier_service, body.waybill, userId]
    );
    await markShipped(order, body.waybill);
    return { waybill: body.waybill };
  }

  // mode 'provider' — Biteship
  const { settings, provider, originId } = await loadShippingContext();
  if (!provider.capabilities.createShipment) {
    throw ApiError.badRequest(
      "Provider aktif tidak mendukung pembuatan pengiriman — buat di aplikasi kurir lalu input resi manual"
    );
  }
  if (!originId || !order.shipping_area_id) {
    throw ApiError.badRequest("Origin/tujuan tidak lengkap untuk pengiriman otomatis");
  }

  const items = await query<OrderItemRow>(
    `SELECT product_name, sku_name, quantity, unit_price, weight_gram
     FROM shop.order_items WHERE order_id = $1::uuid`,
    [id]
  );

  const shipment = await provider.createShipment({
    originId,
    originContactName: settings.origin_contact_name || "Toko",
    originContactPhone: settings.origin_contact_phone || "-",
    originAddress: settings.origin_address || "-",
    destination: {
      areaId: order.shipping_area_id,
      contactName: order.customer_name,
      contactPhone: order.customer_phone,
      address: order.shipping_address,
      postalCode: order.shipping_postal_code,
    },
    courierCode: order.courier_code || "jne",
    serviceCode: order.courier_service || "reg",
    items: items.map((item) => ({
      name: item.sku_name ? `${item.product_name} ${item.sku_name}` : item.product_name,
      value: Number(item.unit_price) || 0,
      weightGram: Number(item.weight_gram) || 1000,
      quantity: Number(item.quantity) || 1,
    })),
    referenceId: order.order_number,
  });

  await query(
    `INSERT INTO shop.shipments (
       order_id, provider, courier_code, courier_service,
       provider_order_id, waybill, price, status, created_by
     ) VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, 'pickup', $8::uuid)`,
    [
      id,
      provider.name,
      order.courier_code,
      order.courier_service,
      shipment.providerOrderId,
      shipment.waybill,
      shipment.price,
      userId,
    ]
  );

  if (shipment.waybill) {
    await markShipped(order, shipment.waybill);
  } else {
    // Waybill menyusul via webhook biteship — status order tetap packing
    await query(
      `UPDATE shop.orders SET status='packing', updated_at=now()
       WHERE id = $1::uuid AND status = 'paid'`,
      [id]
    );
  }
  return { provider_order_id: shipment.providerOrderId, waybill: shipment.waybill };
}
