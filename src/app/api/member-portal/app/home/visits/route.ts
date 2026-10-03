import { getPool } from "@/lib/db";
import type { VisitView } from "@/lib/member-app/home-views";
import { memberJson, withMemberSession } from "@/lib/member-portal/route";

/** GET — 100 scan gate terakhir member (lolos dan ditolak), dengan kelas atau cabangnya. */
export const GET = withMemberSession("Gagal memuat riwayat kunjungan", async (customerId) => {
  const { rows } = await getPool().query(
    `SELECT l.id, l.decision, l.reason, l.credit_delta, l.created_at,
            t.name AS class_type_name, br.name AS branch_name
       FROM gym.access_logs l
       LEFT JOIN gym.bookings b ON b.id = l.booking_id
       LEFT JOIN gym.class_sessions s ON s.id = b.session_id
       LEFT JOIN gym.class_types t ON t.id = s.class_type_id
       LEFT JOIN configuration.branches br ON br.id = l.branch_id
      WHERE l.customer_id = $1
      ORDER BY l.created_at DESC
      LIMIT 100`,
    [customerId]
  );
  return memberJson(
    rows.map(
      (r): VisitView => ({
        log: {
          id: r.id,
          result: r.decision.toUpperCase(),
          reasonCode: r.reason ? r.reason.toUpperCase() : null,
          creditDelta: r.credit_delta,
          createdAt: new Date(r.created_at).toISOString(),
        },
        gateName: r.class_type_name ?? r.branch_name ?? "Studio",
      })
    )
  );
});
