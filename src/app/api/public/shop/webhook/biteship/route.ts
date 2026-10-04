// EPIC-039 Fase E — webhook tracking Biteship (order.status / waybill).
// Biteship tidak menandatangani payload; amankan dengan token rahasia
// BITESHIP_WEBHOOK_TOKEN. Token dibaca dari header `x-webhook-token` atau
// `Authorization: Bearer <token>`; query `?token=` tetap diterima untuk URL
// yang sudah terdaftar di dashboard Biteship (token di query ikut tercatat
// di log akses, jadi header lebih disukai). Tanpa env token → webhook
// ditolak (503) supaya tidak pernah terbuka tanpa sengaja.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { query, queryOne } from '@/lib/db';
import { checkRateLimit, clientIpFrom } from '@/lib/public/rate-limit';
import { sendShopOrderShippedWa } from '@/lib/shop/shop-wa';
import { safeEqual } from '@/lib/security/compare';

const payloadSchema = z.object({
  event: z.string().optional(),
  order_id: z.string().optional(),
  courier_tracking_id: z.string().nullish(),
  courier_waybill_id: z.string().nullish(),
  status: z.string().optional(),
});

// Status Biteship → status shipment internal
const STATUS_MAP: Record<string, string> = {
  confirmed: 'pickup',
  allocated: 'pickup',
  picking_up: 'pickup',
  picked: 'in_transit',
  dropping_off: 'in_transit',
  delivered: 'delivered',
  rejected: 'failed',
  courier_not_found: 'failed',
  returned: 'failed',
  cancelled: 'cancelled',
};

function biteshipToken(request: NextRequest): string | null {
  return (
    request.headers.get('x-webhook-token') ||
    /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '')?.[1] ||
    request.nextUrl.searchParams.get('token')
  );
}

export async function POST(request: NextRequest) {
  const ip = clientIpFrom(request.headers);
  if (!checkRateLimit(`biteship-webhook:${ip}`, { limit: 120, windowMs: 60_000 })) {
    return NextResponse.json({ success: false, error: 'Too many requests' }, { status: 429 });
  }

  const expectedToken = process.env.BITESHIP_WEBHOOK_TOKEN;
  if (!expectedToken) {
    return NextResponse.json(
      { success: false, error: 'Webhook belum dikonfigurasi' },
      { status: 503 }
    );
  }
  if (!safeEqual(biteshipToken(request), expectedToken)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const parsed = payloadSchema.safeParse(await request.json());
    if (!parsed.success || !parsed.data.order_id) {
      return NextResponse.json({ success: true, ignored: true });
    }
    const payload = parsed.data;
    const waybill = payload.courier_waybill_id || payload.courier_tracking_id || null;
    const mappedStatus = STATUS_MAP[String(payload.status || '').toLowerCase()] || null;

    const shipment = await queryOne<{ id: string; order_id: string; waybill: string | null }>(
      `UPDATE shop.shipments
       SET status = COALESCE($2, status),
           waybill = COALESCE(waybill, $3),
           tracking_history = tracking_history || jsonb_build_object(
             'at', now(), 'status', $4, 'event', $5
           ),
           updated_at = now()
       WHERE provider_order_id = $1
       RETURNING id, order_id, waybill`,
      [payload.order_id, mappedStatus, waybill, payload.status || '', payload.event || '']
    );
    if (!shipment) {
      return NextResponse.json({ success: true, ignored: true });
    }

    // Resi baru diketahui → order shipped + WA resi (idempoten: hanya saat
    // order masih paid/packing tanpa waybill)
    if (shipment.waybill) {
      const order = await queryOne<{
        order_number: string;
        access_token: string;
        customer_name: string;
        customer_phone: string;
        courier_code: string | null;
        courier_service: string | null;
        total: string;
      }>(
        `UPDATE shop.orders
         SET status = 'shipped', waybill = $2, updated_at = now()
         WHERE id = $1::uuid AND status IN ('paid','packing') AND waybill IS NULL
         RETURNING order_number, access_token, customer_name, customer_phone,
                   courier_code, courier_service, total`,
        [shipment.order_id, shipment.waybill]
      );
      if (order) {
        void sendShopOrderShippedWa({
          orderNumber: order.order_number,
          customerName: order.customer_name,
          customerPhone: order.customer_phone,
          total: Number(order.total) || 0,
          accessToken: order.access_token,
          waybill: shipment.waybill,
          courierLabel: [order.courier_code, order.courier_service]
            .filter(Boolean)
            .join(' '),
        }).catch((err) => console.error('[shop] WA resi (webhook) gagal:', err));
      }
    }

    // Terkirim sampai tujuan → order selesai
    if (mappedStatus === 'delivered') {
      await query(
        `UPDATE shop.orders SET status='completed', updated_at=now()
         WHERE id = $1::uuid AND status = 'shipped'`,
        [shipment.order_id]
      );
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('[shop] biteship webhook error:', error);
    return NextResponse.json({ success: false, error: 'Webhook error' }, { status: 500 });
  }
}
