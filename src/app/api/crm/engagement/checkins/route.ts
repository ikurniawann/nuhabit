import { getPool } from "@/lib/db";
import { engagementRoute, ok } from "@/lib/crm/engagement/admin-route";

/** GET — 200 scan QR terakhir (diterima maupun ditolak) + ringkasan hari ini. */
export const GET = engagementRoute("Gagal memuat log check-in", async () => {
  const pool = getPool();
  const [{ rows }, { rows: today }] = await Promise.all([
    pool.query(
      `SELECT k.id, k.decision, k.reason, k.created_at, c.name AS member_name, c.phone AS member_phone,
              u.full_name AS cashier_name
         FROM crm.member_checkins k
         LEFT JOIN pos.pos_customers c ON c.id = k.customer_id
         LEFT JOIN configuration.users u ON u.id = k.scanned_by
        ORDER BY k.created_at DESC LIMIT 200`
    ),
    pool.query(
      `SELECT count(*) FILTER (WHERE decision = 'accepted')::int AS accepted,
              count(*) FILTER (WHERE decision = 'denied')::int AS denied,
              count(DISTINCT customer_id) FILTER (WHERE decision = 'accepted')::int AS members
         FROM crm.member_checkins
        WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Jakarta') AT TIME ZONE 'Asia/Jakarta'`
    ),
  ]);
  return ok({ checkins: rows, today: today[0] });
});
