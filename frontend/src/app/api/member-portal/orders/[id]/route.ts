import { NextRequest, NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { getMemberSession } from "@/lib/member-portal/session";

/**
 * GET /api/member-portal/orders/[id] — detail satu order milik member:
 * item (nama/qty/harga/diskon per baris), diskon order, dan XP yang didapat.
 * Untuk dialog detail transaksi di Citizen History (portal Nox).
 *
 * Kepemilikan diverifikasi lewat customer_id di query — order orang lain
 * berperilaku persis seperti order yang tidak ada (404), tanpa membocorkan
 * bahwa id-nya valid.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getMemberSession();
    if (!session) {
      return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      return NextResponse.json({ success: false, error: "Order tidak ditemukan" }, { status: 404 });
    }

    const pool = getPool();
    const { rows: orders } = await pool.query(
      `SELECT o.id, o.order_number, o.ordered_at, o.total_amount::float AS total_amount,
              o.discount_amount::float AS discount_amount, o.discount_reason,
              o.payment_method, o.status, o.ark_coins_used::float AS ark_coins_used,
              w.name AS venue_name
       FROM pos.pos_orders o
       LEFT JOIN configuration.warehouses w ON w.id = o.warehouse_id
       WHERE o.id = $1 AND o.customer_id = $2`,
      [id, session.customerId]
    );
    const order = orders[0];
    if (!order) {
      return NextResponse.json({ success: false, error: "Order tidak ditemukan" }, { status: 404 });
    }

    const [{ rows: items }, { rows: xpLegacyRows }, { rows: xpLedgerRows }, { rows: rateRows }] =
      await Promise.all([
        pool.query(
          `SELECT product_name, quantity::float AS quantity, unit_price::float AS unit_price,
                  discount_amount::float AS discount_amount, total_amount::float AS total_amount
           FROM pos.pos_order_items WHERE order_id = $1 ORDER BY created_at`,
          [id]
        ),
        pool.query(
          `SELECT COALESCE(SUM(xp_earned), 0)::float AS xp_earned
           FROM pos.pos_xp_transactions WHERE order_id = $1 AND customer_id = $2`,
          [id, session.customerId]
        ),
        // XP sekarang dicatat di crm_xp_ledger (loyalty engine) —
        // pos_xp_transactions hanya berisi data lama. Baca keduanya:
        // ledger menang bila terisi, legacy jadi fallback order lama.
        pool.query(
          `SELECT COALESCE(SUM(xp_delta), 0)::float AS xp_earned
           FROM crm.crm_xp_ledger
           WHERE reference_table = 'pos_orders' AND reference_id = $1
             AND customer_id = $2 AND direction = 'earn'`,
          [id, session.customerId]
        ),
        // Kurs ARK utk konversi "Rp X / N Ark Coin" — sama dengan struk kasir.
        pool.query(
          `SELECT ark_rate::float AS ark_rate FROM pos.pos_loyalty_settings
           WHERE is_active = true ORDER BY updated_at DESC LIMIT 1`
        ),
      ]);

    const ledgerXp = Number(xpLedgerRows[0]?.xp_earned) || 0;
    const legacyXp = Number(xpLegacyRows[0]?.xp_earned) || 0;

    const subtotal = items.reduce(
      (sum, item) => sum + (Number(item.unit_price) || 0) * (Number(item.quantity) || 0),
      0
    );

    return NextResponse.json({
      success: true,
      data: {
        order: {
          id: order.id,
          order_number: order.order_number,
          ordered_at: order.ordered_at,
          total_amount: Number(order.total_amount) || 0,
          discount_amount: Number(order.discount_amount) || 0,
          discount_reason: order.discount_reason,
          payment_method: order.payment_method,
          ark_coins_used: Number(order.ark_coins_used) || 0,
          venue_name: order.venue_name,
          subtotal,
        },
        items,
        xp_earned: ledgerXp > 0 ? ledgerXp : legacyXp,
        ark_rate: Number(rateRows[0]?.ark_rate) || 0,
      },
    });
  } catch (error) {
    console.error("Error fetching member order detail:", error);
    return NextResponse.json(
      { success: false, error: "Gagal memuat detail order" },
      { status: 500 }
    );
  }
}
