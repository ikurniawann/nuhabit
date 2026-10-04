import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { getMemberSession } from "@/lib/member-portal/session";

/**
 * GET /api/member-portal/visits — rekap kunjungan member per venue/stall:
 * berapa kali transaksi di mana, hari berkunjung, dan kunjungan terakhir.
 * Untuk dialog "Kunjungan" di Citizen Profile (portal Nox).
 *
 * "Kunjungan" dihitung dari order LUNAS (bukan status completed — alur kasir
 * meninggalkan order paid berstatus pending, lihat dashboard POS).
 */
export async function GET() {
  try {
    const session = await getMemberSession();
    if (!session) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }

    const pool = getPool();
    const { rows: venues } = await pool.query(
      `SELECT COALESCE(w.name, 'Venue lain') AS venue_name,
              COUNT(*)::int AS order_count,
              COUNT(DISTINCT (o.ordered_at AT TIME ZONE 'Asia/Jakarta')::date)::int AS day_count,
              MAX(o.ordered_at) AS last_visit_at
       FROM pos.pos_orders o
       LEFT JOIN configuration.warehouses w ON w.id = o.warehouse_id
       WHERE o.customer_id = $1
         AND o.payment_status = 'paid'
         AND o.status::text NOT IN ('cancelled', 'voided', 'merged')
       GROUP BY COALESCE(w.name, 'Venue lain')
       ORDER BY MAX(o.ordered_at) DESC`,
      [session.customerId]
    );

    const { rows: customer } = await pool.query(
      `SELECT visit_count FROM pos.pos_customers WHERE id = $1`,
      [session.customerId]
    );

    return NextResponse.json({
      success: true,
      data: {
        visit_count: Number(customer[0]?.visit_count) || 0,
        venues,
      },
    });
  } catch (error) {
    console.error("Error fetching member visits:", error);
    return NextResponse.json(
      { success: false, error: "Gagal memuat riwayat kunjungan" },
      { status: 500 }
    );
  }
}
