import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { getMemberSession } from "@/lib/member-portal/session";

/**
 * GET /api/member-portal/transactions — riwayat wallet (topup/bonus/bayar)
 * + order terakhir milik member sendiri. EPIC-011 Fase D.
 */
export async function GET() {
  try {
    const session = await getMemberSession();
    if (!session) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const pool = getPool();
    const [{ rows: wallet }, { rows: orders }] = await Promise.all([
      pool.query(
        `SELECT id, type, amount::float AS amount,
                balance_after::float AS balance_after, notes, created_at
         FROM pos.pos_wallet_transactions
         WHERE customer_id = $1
         ORDER BY created_at DESC LIMIT 25`,
        [session.customerId]
      ),
      pool.query(
        `SELECT id, order_number, total_amount::float AS total_amount,
                payment_method, status, created_at
         FROM pos.pos_orders
         WHERE customer_id = $1 AND payment_status = 'paid'
         ORDER BY created_at DESC LIMIT 25`,
        [session.customerId]
      ),
    ]);

    return NextResponse.json({ success: true, data: { wallet, orders } });
  } catch (error) {
    console.error("Error fetching member transactions:", error);
    return NextResponse.json(
      { success: false, error: "Gagal memuat riwayat" },
      { status: 500 }
    );
  }
}
