import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { createPgClient } from "@/lib/pg/create-client";
import { loadActiveXenditConfig } from "@/lib/payments/xendit";
import { checkRateLimit } from "@/lib/rate-limit";
import { paymentFlowFrom } from "@/lib/table-order/order-status";
import { checkAndSettleOrderQris, ensureOrderQris } from "@/lib/table-order/qris";
import { clientIdentifier, isUuid } from "@/lib/table-order/server";

export const dynamic = "force-dynamic";

type OrderRow = {
  id: string;
  order_number: string | null;
  queue_number: string | null;
  status: string;
  payment_status: string;
  payment_method: string | null;
  order_type: string | null;
  subtotal: number;
  tax_amount: number;
  service_charge_amount: number;
  other_charges_amount: number;
  total_amount: number;
  charges_breakdown: unknown;
  special_requests: string | null;
  ordered_at: string | null;
  xendit_qr_id: string | null;
  xendit_external_id: string | null;
  payment_proof_uploaded_at: string | null;
};

type ItemRow = {
  id: string;
  product_name: string;
  variants: unknown;
  modifiers: unknown;
  quantity: number;
  unit_price: number;
  total_amount: number;
  station: string | null;
  kitchen_status: string | null;
  xp_earned: number;
};

async function loadOrder(orderId: string) {
  const rows = await query<OrderRow>(
    `SELECT id, order_number, queue_number, status::text AS status,
            payment_status::text AS payment_status, payment_method::text AS payment_method,
            order_type::text AS order_type,
            subtotal::float AS subtotal, tax_amount::float AS tax_amount,
            service_charge_amount::float AS service_charge_amount,
            COALESCE(other_charges_amount, 0)::float AS other_charges_amount,
            total_amount::float AS total_amount, charges_breakdown,
            special_requests, ordered_at, xendit_qr_id, xendit_external_id,
            payment_proof_uploaded_at
     FROM pos.pos_orders WHERE id = $1 LIMIT 1`,
    [orderId]
  );
  return rows[0] ?? null;
}

function variantName(raw: unknown) {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const first = raw[0] as { name?: unknown } | null;
  return first && typeof first.name === "string" ? first.name : null;
}

function paymentFlowOf(order: OrderRow) {
  return paymentFlowFrom(order.special_requests, order.payment_method);
}

/**
 * GET /api/table-order/orders/[id]?qr=1 — status pesanan utk layar pelacakan
 * pemesan (id UUID acak berfungsi sebagai token akses; tidak ada data pribadi).
 *
 * Bila order masih unpaid dan punya QR Xendit, status QR dicek ke Xendit dan
 * order dilunasi otomatis kalau sudah dibayar (cadangan webhook). `qr=1`
 * menyertakan ulang qr_string (setelah reload halaman).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const orderId = String(id || "").trim();
  if (!isUuid(orderId)) {
    return NextResponse.json({ success: false, error: "Order tidak valid" }, { status: 400 });
  }

  const rate = checkRateLimit(`table-order:status:${clientIdentifier(request)}`, 90);
  if (!rate.allowed) {
    return NextResponse.json({ success: false, error: "Terlalu sering — tunggu sebentar" }, { status: 429 });
  }

  try {
    let order = await loadOrder(orderId);
    if (!order) {
      return NextResponse.json({ success: false, error: "Order tidak ditemukan" }, { status: 404 });
    }

    const wantQr = request.nextUrl.searchParams.get("qr") === "1";
    let qris: { qr_id: string; qr_string: string; amount: number; expires_at: string | null } | null = null;
    let qrisStatus: string | null = null;
    let qrisCheckError: string | null = null;

    const isUnpaidQris =
      order.payment_status === "unpaid" && paymentFlowOf(order) === "qris" && Boolean(order.xendit_qr_id);

    if (isUnpaidQris && order.xendit_qr_id) {
      const db = createPgClient();
      try {
        const xendit = await loadActiveXenditConfig(db);
        const check = await checkAndSettleOrderQris(db, order.id, order.xendit_qr_id, xendit);
        qrisStatus = check.status;
        if (check.paid) {
          order = (await loadOrder(orderId)) ?? order;
        } else if (wantQr) {
          const payload = await ensureOrderQris(db, order, xendit);
          qris = {
            qr_id: payload.qr_id,
            qr_string: payload.qr_string,
            amount: payload.amount,
            expires_at: payload.expires_at,
          };
        }
      } catch (error) {
        qrisCheckError = error instanceof Error ? error.message : "Gagal cek status QRIS";
        console.warn(`[table-order] qris check order=${orderId}:`, qrisCheckError);
      }
    }

    const items = await query<ItemRow>(
      `SELECT id, product_name, variants, modifiers, quantity, unit_price::float AS unit_price,
              total_amount::float AS total_amount, station, kitchen_status::text AS kitchen_status,
              COALESCE(xp_earned, 0)::int AS xp_earned
       FROM pos.pos_order_items WHERE order_id = $1 ORDER BY created_at, id`,
      [orderId]
    );

    return NextResponse.json({
      success: true,
      data: {
        id: order.id,
        order_number: order.order_number,
        queue_number: order.queue_number,
        status: order.status,
        payment_status: order.payment_status,
        payment_method: order.payment_method,
        payment_flow: paymentFlowOf(order),
        order_type: order.order_type,
        subtotal: order.subtotal,
        tax_amount: order.tax_amount,
        service_charge_amount: order.service_charge_amount,
        other_charges_amount: order.other_charges_amount,
        total_amount: order.total_amount,
        breakdown: Array.isArray(order.charges_breakdown) ? order.charges_breakdown : [],
        ordered_at: order.ordered_at,
        total_xp: items.reduce((sum, item) => sum + (Number(item.xp_earned) || 0), 0),
        items: items.map((item) => ({
          id: item.id,
          product_name: item.product_name,
          variant_name: variantName(item.variants),
          modifier_names: Array.isArray(item.modifiers)
            ? (item.modifiers as Array<{ name?: unknown }>).map((m) => String(m?.name ?? "")).filter(Boolean)
            : [],
          quantity: Number(item.quantity) || 0,
          unit_price: item.unit_price,
          total_amount: item.total_amount,
          station: item.station,
          kitchen_status: item.kitchen_status,
        })),
        payment_proof_uploaded_at: order.payment_proof_uploaded_at,
        qris,
        qris_status: qrisStatus,
        qris_check_error: qrisCheckError,
      },
    });
  } catch (error) {
    console.error("Table order status error:", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Gagal memuat status pesanan" },
      { status: 500 }
    );
  }
}
