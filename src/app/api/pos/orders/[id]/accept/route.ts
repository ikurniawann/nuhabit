import { NextRequest, NextResponse } from "next/server";
import { requirePosMenu } from "@/lib/api/auth";
import { query } from "@/lib/db";
import { IAM } from "@/lib/iam/prefixes";
import { isSelfOrder } from "@/lib/table-order/incoming";
import { isUuid } from "@/lib/table-order/server";

export const dynamic = "force-dynamic";

/**
 * POST /api/pos/orders/[id]/accept — kasir menekan "Dibuat" pada pesanan
 * self-order baru (gelembung notifikasi POS → Orders, owner 2026-10-01):
 * status pending → confirmed. Status bayar TIDAK disentuh (tetap belum
 * dibayar, dilunasi kasir seperti biasa); item dapur tetap di KDS.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const pos = await requirePosMenu(IAM.pos);
  if (pos.error) return pos.error;

  const { id } = await params;
  const orderId = String(id || "").trim();
  if (!isUuid(orderId)) {
    return NextResponse.json({ success: false, error: "Order tidak valid" }, { status: 400 });
  }

  try {
    const rows = await query<{ status: string; special_requests: string | null; payment_status: string }>(
      `SELECT status::text AS status, special_requests, payment_status::text AS payment_status
       FROM pos.pos_orders WHERE id = $1 LIMIT 1`,
      [orderId]
    );
    const order = rows[0];
    if (!order) return NextResponse.json({ success: false, error: "Order tidak ditemukan" }, { status: 404 });
    if (!isSelfOrder(order)) {
      return NextResponse.json({ success: false, error: "Bukan pesanan self-order" }, { status: 409 });
    }
    if (order.status !== "pending") {
      return NextResponse.json(
        { success: false, error: `Pesanan sudah berstatus ${order.status}` },
        { status: 409 }
      );
    }

    // Kondisi status di WHERE: dua kasir menekan bersamaan → hanya satu yang tercatat.
    const updated = await query<{ id: string }>(
      `UPDATE pos.pos_orders
       SET status = 'confirmed'::pos_order_status, confirmed_at = now(), updated_at = now()
       WHERE id = $1 AND status = 'pending'::pos_order_status
       RETURNING id`,
      [orderId]
    );
    if (!updated[0]) {
      return NextResponse.json({ success: false, error: "Pesanan sudah diproses kasir lain" }, { status: 409 });
    }
    await query(
      `INSERT INTO pos.pos_order_status_history (order_id, from_status, to_status, changed_by, notes)
       VALUES ($1, 'pending', 'confirmed', $2, 'Dibuat oleh kasir (notifikasi self-order)')`,
      [orderId, pos.userId]
    );

    return NextResponse.json({
      success: true,
      data: { id: orderId, status: "confirmed", payment_status: order.payment_status },
    });
  } catch (error) {
    console.error("[pos/orders/accept] gagal:", error);
    return NextResponse.json({ success: false, error: "Gagal memproses pesanan" }, { status: 500 });
  }
}
